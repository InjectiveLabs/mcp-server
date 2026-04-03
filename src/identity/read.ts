/**
 * Identity read handlers — query agent status and list registered agents
 * from the ERC-8004 IdentityRegistry contract via Injective EVM (read-only).
 */
import { getEthereumAddress } from '@injectivelabs/sdk-ts'
import type { Config } from '../config/index.js'
import { createIdentityPublicClient } from './client.js'
import { getIdentityConfig } from './config.js'
import { IDENTITY_REGISTRY_ABI, REPUTATION_REGISTRY_ABI } from './abis.js'
import { IdentityNotFound } from '../errors/index.js'

// ─── Parameter / result types ───────────────────────────────────────────────

export interface StatusParams {
  agentId: string
}

export interface StatusResult {
  agentId: string
  name: string
  agentType: number
  builderCode: string
  owner: string
  tokenURI: string
  linkedWallet: string
  reputation: {
    score: string
    feedbackCount: string
  }
}

export interface ListParams {
  owner?: string
  type?: number
  limit?: number
}

export interface ListEntry {
  agentId: string
  name: string
  agentType: number
  owner: string
}

export interface ListResult {
  agents: ListEntry[]
  total: number
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export const identityRead = {
  async status(config: Config, params: StatusParams): Promise<StatusResult> {
    const identityCfg = getIdentityConfig(config.network)
    const publicClient = createIdentityPublicClient(config.network)
    const tokenId = BigInt(params.agentId)

    try {
      const [metadata, owner, tokenURI, linkedWallet, reputation] = await Promise.all([
        publicClient.readContract({
          address: identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'getMetadata',
          args: [tokenId],
        }) as Promise<[string, number, string]>,
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
          functionName: 'getLinkedWallet',
          args: [tokenId],
        }) as Promise<string>,
        publicClient.readContract({
          address: identityCfg.reputationRegistry,
          abi: REPUTATION_REGISTRY_ABI,
          functionName: 'getReputation',
          args: [tokenId],
        }) as Promise<[bigint, bigint]>,
      ])

      return {
        agentId: params.agentId,
        name: metadata[0],
        agentType: metadata[1],
        builderCode: metadata[2],
        owner,
        tokenURI,
        linkedWallet,
        reputation: {
          score: reputation[0].toString(),
          feedbackCount: reputation[1].toString(),
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

    // Convert inj1... owner to 0x address for comparison
    let ownerFilter: string | undefined
    if (params.owner) {
      ownerFilter = (params.owner.startsWith('inj1')
        ? getEthereumAddress(params.owner)
        : params.owner
      ).toLowerCase()
    }

    try {
    // Scan Transfer events where from is zero address (mint events)
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
      args: { from: '0x0000000000000000000000000000000000000000' as `0x${string}` },
      fromBlock: identityCfg.deployBlock,
      toBlock: 'latest',
    })

    // Filter by owner if set, then cap at limit
    const filtered = ownerFilter
      ? logs.filter((log) => log.args.to?.toLowerCase() === ownerFilter)
      : logs

    const candidateIds = filtered
      .slice(0, limit)
      .map((log) => log.args.tokenId!)

    // For each agent ID, fetch metadata + current owner; skip burned agents
    const agents: ListEntry[] = []
    for (const tokenId of candidateIds) {
      try {
        const [metadata, currentOwner] = await Promise.all([
          publicClient.readContract({
            address: identityCfg.identityRegistry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'getMetadata',
            args: [tokenId],
          }) as Promise<[string, number, string]>,
          publicClient.readContract({
            address: identityCfg.identityRegistry,
            abi: IDENTITY_REGISTRY_ABI,
            functionName: 'ownerOf',
            args: [tokenId],
          }) as Promise<string>,
        ])

        const entry: ListEntry = {
          agentId: tokenId.toString(),
          name: metadata[0],
          agentType: metadata[1],
          owner: currentOwner,
        }

        // Apply type filter post-fetch
        if (params.type !== undefined && entry.agentType !== params.type) {
          continue
        }

        agents.push(entry)
      } catch {
        // Skip burned agents (readContract reverts for non-existent tokens)
        continue
      }
    }

    return { agents, total: agents.length }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to list agents: ${message}`)
    }
  },
}
