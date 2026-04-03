/**
 * Identity read handlers — query agent status and list registered agents
 * from the ERC-8004 IdentityRegistry contract via Injective EVM (read-only).
 */
import type { Hex } from 'viem'
import { zeroAddress } from 'viem'
import { evm } from '../evm/index.js'
import type { Config } from '../config/index.js'
import { createIdentityPublicClient } from './client.js'
import { getIdentityConfig } from './config.js'
import { IDENTITY_REGISTRY_ABI, REPUTATION_REGISTRY_ABI } from './abis.js'
import { IdentityNotFound, IdentityTxFailed } from '../errors/index.js'
import { decodeStringMetadata, METADATA_KEYS } from './helpers.js'

// ─── Parameter / result types ───────────────────────────────────────────────

export interface StatusParams {
  agentId: string
}

export interface StatusResult {
  agentId: string
  name: string
  agentType: string
  builderCode: string
  owner: string
  tokenURI: string
  linkedWallet: string
  reputation: {
    score: string
    count: string
  }
}

export interface ListParams {
  owner?: string
  type?: string
  limit?: number
}

export interface ListEntry {
  agentId: string
  name: string
  agentType: string
  owner: string
}

export interface ListResult {
  agents: ListEntry[]
  total: number
}

export interface ReputationParams {
  agentId: string
  clientAddresses?: string[]
  tag1?: string
  tag2?: string
}

export interface ReputationResult {
  agentId: string
  score: number
  count: number
  clients: string[]
}

export interface FeedbackListParams {
  agentId: string
  clientAddresses?: string[]
  tag1?: string
  tag2?: string
  includeRevoked?: boolean
}

export interface FeedbackEntry {
  client: string
  feedbackIndex: number
  value: number
  tag1: string
  tag2: string
  revoked: boolean
}

export interface FeedbackListResult {
  agentId: string
  entries: FeedbackEntry[]
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export const identityRead = {
  async status(config: Config, params: StatusParams): Promise<StatusResult> {
    const identityCfg = getIdentityConfig(config.network)
    const publicClient = createIdentityPublicClient(config.network)
    const tokenId = BigInt(params.agentId)

    try {
      const [nameRaw, builderCodeRaw, agentTypeRaw, owner, tokenURI, linkedWallet] = await Promise.all([
        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getMetadata',
          args: [tokenId, METADATA_KEYS.NAME],
        }) as Promise<Hex>,
        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getMetadata',
          args: [tokenId, METADATA_KEYS.BUILDER_CODE],
        }) as Promise<Hex>,
        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getMetadata',
          args: [tokenId, METADATA_KEYS.AGENT_TYPE],
        }) as Promise<Hex>,
        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'ownerOf',
          args: [tokenId],
        }) as Promise<string>,
        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'tokenURI',
          args: [tokenId],
        }) as Promise<string>,
        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getAgentWallet',
          args: [tokenId],
        }) as Promise<string>,
      ])

      const name = decodeStringMetadata(nameRaw)
      const builderCode = decodeStringMetadata(builderCodeRaw)
      const agentType = decodeStringMetadata(agentTypeRaw)

      // Reputation: getSummary requires client addresses, so fetch clients first
      let reputationScore = '0'
      let reputationCount = '0'
      try {
        const clients = await publicClient.readContract({
          address: identityCfg.reputationRegistry,
          abi: REPUTATION_REGISTRY_ABI,
          functionName: 'getClients',
          args: [tokenId],
        }) as `0x${string}`[]

        if (clients.length > 0) {
          const [count, summaryValue, decimals] = await publicClient.readContract({
            address: identityCfg.reputationRegistry,
            abi: REPUTATION_REGISTRY_ABI,
            functionName: 'getSummary',
            args: [tokenId, clients, '', ''],
          }) as [bigint, bigint, number]

          reputationCount = Number(count).toString()
          reputationScore = summaryValue !== 0n
            ? (Number(summaryValue) / Math.pow(10, Number(decimals))).toString()
            : '0'
        }
      } catch {
        // No reputation data — leave as zeros
      }

      return {
        agentId: params.agentId,
        name,
        agentType,
        builderCode,
        owner,
        tokenURI,
        linkedWallet,
        reputation: {
          score: reputationScore,
          count: reputationCount,
        },
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (
        message.includes('ERC721') ||
        message.includes('nonexistent') ||
        message.includes('invalid token')
      ) {
        throw new IdentityNotFound(params.agentId)
      }
      throw err
    }
  },

  async list(config: Config, params: ListParams): Promise<ListResult> {
    const identityCfg = getIdentityConfig(config.network)
    const publicClient = createIdentityPublicClient(config.network)
    const limit = params.limit ?? 20

    let ownerFilter: string | undefined
    if (params.owner) {
      ownerFilter = (params.owner.startsWith('inj1')
        ? evm.injAddressToEth(params.owner)
        : params.owner
      ).toLowerCase()
    }

    try {
      const logs = await publicClient.getLogs({
        address: identityCfg.identityRegistry,
        event: {
          name: 'Transfer',
          type: 'event',
          inputs: [
            { name: 'from', type: 'address', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'tokenId', type: 'uint256', indexed: true },
          ],
        },
        args: { from: zeroAddress },
        fromBlock: identityCfg.deployBlock,
        toBlock: 'latest',
      })

      // NOTE: Owner filter uses the mint recipient. If an agent NFT was
      // transferred after minting, the new owner won't appear in mint events.
      // Acceptable for V1 since agent transfers are rare.
      const filtered = ownerFilter
        ? logs.filter((log) => log.args.to?.toLowerCase() === ownerFilter)
        : logs

      // Over-fetch candidates to account for type filter + burned agents.
      // We fetch up to 3x the limit, then apply type filter, then cap.
      const overFetchLimit = params.type !== undefined ? limit * 3 : limit
      const candidateIds = filtered
        .slice(0, overFetchLimit)
        .map((log) => log.args.tokenId!)

      // Fetch metadata for all candidates in parallel
      const results = await Promise.allSettled(
        candidateIds.map(async (tokenId) => {
          const [nameRaw, agentTypeRaw, currentOwner] = await Promise.all([
            publicClient.readContract({
              address: identityCfg.identityRegistry,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: 'getMetadata',
              args: [tokenId, METADATA_KEYS.NAME],
            }) as Promise<Hex>,
            publicClient.readContract({
              address: identityCfg.identityRegistry,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: 'getMetadata',
              args: [tokenId, METADATA_KEYS.AGENT_TYPE],
            }) as Promise<Hex>,
            publicClient.readContract({
              address: identityCfg.identityRegistry,
              abi: IDENTITY_REGISTRY_ABI,
              functionName: 'ownerOf',
              args: [tokenId],
            }) as Promise<string>,
          ])
          const name = decodeStringMetadata(nameRaw)
          const agentType = decodeStringMetadata(agentTypeRaw)
          return { tokenId, name, agentType, currentOwner }
        }),
      )

      const agents: ListEntry[] = []
      for (const result of results) {
        if (result.status !== 'fulfilled') continue // burned agents
        const { tokenId, name, agentType, currentOwner } = result.value

        if (params.type !== undefined && agentType !== params.type) continue

        agents.push({
          agentId: tokenId.toString(),
          name,
          agentType,
          owner: currentOwner,
        })

        if (agents.length >= limit) break
      }

      return { agents, total: agents.length }
    } catch (err) {
      if (err instanceof IdentityTxFailed) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new IdentityTxFailed(`Failed to list agents: ${message}`)
    }
  },

  async reputation(config: Config, params: ReputationParams): Promise<ReputationResult> {
    const identityCfg = getIdentityConfig(config.network)
    const publicClient = createIdentityPublicClient(config.network)
    const tokenId = BigInt(params.agentId)

    try {
      // getSummary requires client addresses — fetch them first if not provided
      const clients = await publicClient.readContract({
        address: identityCfg.reputationRegistry,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'getClients',
        args: [tokenId],
      }) as `0x${string}`[]

      if (clients.length === 0) {
        return { agentId: params.agentId, score: 0, count: 0, clients: [] }
      }

      const summaryClients = params.clientAddresses?.length
        ? params.clientAddresses as `0x${string}`[]
        : clients

      const [count, summaryValue, summaryValueDecimals] = await publicClient.readContract({
        address: identityCfg.reputationRegistry,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'getSummary',
        args: [tokenId, summaryClients, params.tag1 ?? '', params.tag2 ?? ''],
      }) as [bigint, bigint, number]

      const score = Number(count) > 0
        ? Number(summaryValue) / Math.pow(10, Number(summaryValueDecimals))
        : 0

      return {
        agentId: params.agentId,
        score,
        count: Number(count),
        clients: clients as string[],
      }
    } catch {
      return { agentId: params.agentId, score: 0, count: 0, clients: [] }
    }
  },

  async feedbackList(config: Config, params: FeedbackListParams): Promise<FeedbackListResult> {
    const identityCfg = getIdentityConfig(config.network)
    const publicClient = createIdentityPublicClient(config.network)
    const tokenId = BigInt(params.agentId)

    try {
      const result = await publicClient.readContract({
        address: identityCfg.reputationRegistry,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'readAllFeedback',
        args: [
          tokenId,
          (params.clientAddresses ?? []) as `0x${string}`[],
          params.tag1 ?? '',
          params.tag2 ?? '',
          params.includeRevoked ?? false,
        ],
      }) as [string[], bigint[], bigint[], number[], string[], string[], boolean[]]

      const [clients, feedbackIndices, values, valueDecimals, tag1s, tag2s, revokedArr] = result

      const entries: FeedbackEntry[] = clients.map((client, i) => ({
        client,
        feedbackIndex: Number(feedbackIndices[i]!),
        value: Number(values[i]!) / Math.pow(10, Number(valueDecimals[i]!)),
        tag1: tag1s[i]!,
        tag2: tag2s[i]!,
        revoked: revokedArr[i]!,
      }))

      return { agentId: params.agentId, entries }
    } catch {
      return { agentId: params.agentId, entries: [] }
    }
  },
}
