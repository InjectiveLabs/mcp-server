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

// ─── Handlers ───────────────────────────────────────────────────────────────

export const identityRead = {
  async status(config: Config, params: StatusParams): Promise<StatusResult> {
    const identityCfg = getIdentityConfig(config.network)
    const publicClient = createIdentityPublicClient(config.network)
    const tokenId = BigInt(params.agentId)

    try {
      const [nameRaw, builderCodeRaw, agentTypeRaw, owner, tokenURI, linkedWallet, reputation] = await Promise.all([
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
        // Reputation may not exist for new agents — return zeros on revert
        publicClient.readContract({
          address: identityCfg.reputationRegistry,
          abi: REPUTATION_REGISTRY_ABI,
          functionName: 'getSummary',
          args: [tokenId, [], '', ''],
        }).catch(() => [0n, 0n, 0]) as Promise<[bigint, bigint, number]>,
      ])

      const name = decodeStringMetadata(nameRaw)
      const builderCode = decodeStringMetadata(builderCodeRaw)
      const agentType = decodeStringMetadata(agentTypeRaw)

      return {
        agentId: params.agentId,
        name,
        agentType,
        builderCode,
        owner,
        tokenURI,
        linkedWallet,
        reputation: {
          score: reputation[1] !== 0n
            ? (Number(reputation[1]) / Math.pow(10, Number(reputation[2]))).toString()
            : '0',
          count: Number(reputation[0]).toString(),
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
}
