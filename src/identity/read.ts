/**
 * Identity read handlers — thin adapter over @injective/agent-sdk.
 *
 * Delegates all reads to AgentReadClient and maps SDK types to the MCP JSON
 * shapes that server.ts expects.
 */
import { AgentReadClient } from '@injective/agent-sdk'
import type { Config } from '../config/index.js'
import { evm } from '../evm/index.js'
import { IdentityNotFound } from '../errors/index.js'

// ─── Parameter / result types (consumed by server.ts) ─────────────────────

export interface StatusParams { agentId: string }
export interface StatusResult {
  agentId: string; name: string; agentType: string; builderCode: string;
  owner: string; tokenURI: string; linkedWallet: string;
  reputation: { score: string; count: string }
}

export interface ListParams { owner?: string; type?: string; limit?: number }
export interface ListEntry { agentId: string; name: string; agentType: string; owner: string }
export interface ListResult { agents: ListEntry[]; total: number }

export interface ReputationParams {
  agentId: string; clientAddresses?: string[]; tag1?: string; tag2?: string
}
export interface ReputationResult { agentId: string; score: number; count: number; clients: string[] }

export interface FeedbackListParams {
  agentId: string; clientAddresses?: string[]; tag1?: string; tag2?: string; includeRevoked?: boolean
}
export interface FeedbackEntry {
  client: string; feedbackIndex: number; value: number; tag1: string; tag2: string; revoked: boolean
}
export interface FeedbackListResult { agentId: string; entries: FeedbackEntry[] }

// ─── Client cache (one per network, no private key needed) ────────────────

const clientCache = new Map<string, AgentReadClient>()
function getClient(network: string): AgentReadClient {
  let client = clientCache.get(network)
  if (!client) {
    client = new AgentReadClient({ network: network as 'testnet' | 'mainnet' })
    clientCache.set(network, client)
  }
  return client
}

// ─── Handlers ─────────────────────────────────────────────────────────────

export const identityRead = {
  async status(config: Config, params: StatusParams): Promise<StatusResult> {
    const sdk = getClient(config.network)
    const agentId = BigInt(params.agentId)
    try {
      const enriched = await sdk.getEnrichedAgent(agentId)
      return {
        agentId: enriched.agentId.toString(),
        name: enriched.name,
        agentType: enriched.type,
        builderCode: enriched.builderCode,
        owner: enriched.owner,
        tokenURI: enriched.tokenUri,
        linkedWallet: enriched.wallet,
        reputation: {
          score: String(enriched.reputation.score),
          count: String(enriched.reputation.count),
        },
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ERC721') || msg.includes('nonexistent') || msg.includes('invalid token')) {
        throw new IdentityNotFound(params.agentId)
      }
      throw err
    }
  },

  async list(config: Config, params: ListParams): Promise<ListResult> {
    const sdk = getClient(config.network)
    const limit = params.limit ?? 20

    // Owner filter: convert inj1... to 0x...
    let ownerHex: `0x${string}` | undefined
    if (params.owner) {
      ownerHex = (params.owner.startsWith('inj')
        ? evm.injAddressToEth(params.owner)
        : params.owner) as `0x${string}`
    }

    // SDK doesn't filter by type — over-fetch 3x, filter in adapter
    const fetchLimit = params.type ? limit * 3 : limit

    const result = ownerHex
      ? await sdk.getAgentsByOwner(ownerHex, { limit: fetchLimit })
      : await sdk.listAgents({ limit: fetchLimit })

    let agents: ListEntry[] = result.agents.map((a) => ({
      agentId: a.agentId.toString(),
      name: a.name,
      agentType: a.type,
      owner: a.owner,
    }))

    if (params.type) {
      agents = agents.filter((a) => a.agentType === params.type)
    }

    const filteredTotal = agents.length
    agents = agents.slice(0, limit)
    return { agents, total: filteredTotal }
  },

  async reputation(config: Config, params: ReputationParams): Promise<ReputationResult> {
    const sdk = getClient(config.network)
    try {
      const rep = await sdk.getReputation(BigInt(params.agentId), {
        clientAddresses: params.clientAddresses as `0x${string}`[] | undefined,
        tag1: params.tag1,
        tag2: params.tag2,
      })
      return {
        agentId: params.agentId,
        score: rep.score,
        count: rep.count,
        clients: rep.clients as string[],
      }
    } catch (_err) {
      // Reputation is best-effort — return zeros if the agent has no feedback or registry errors
      return { agentId: params.agentId, score: 0, count: 0, clients: [] }
    }
  },

  async feedbackList(config: Config, params: FeedbackListParams): Promise<FeedbackListResult> {
    const sdk = getClient(config.network)
    try {
      const entries = await sdk.getFeedbackEntries(BigInt(params.agentId), {
        clientAddresses: params.clientAddresses as `0x${string}`[] | undefined,
        tag1: params.tag1,
        tag2: params.tag2,
        includeRevoked: params.includeRevoked,
      })
      return {
        agentId: params.agentId,
        entries: entries.map((e) => ({
          client: e.client,
          feedbackIndex: Number(e.feedbackIndex),
          value: Number(e.value) / 10 ** e.decimals,
          tag1: e.tags[0] ?? '',
          tag2: e.tags[1] ?? '',
          revoked: e.revoked,
        })),
      }
    } catch (_err) {
      // Feedback list is best-effort — return empty if agent has no feedback or registry errors
      return { agentId: params.agentId, entries: [] }
    }
  },
}
