/**
 * Identity module — register, update, and deregister agent identities
 * on the ERC-8004 IdentityRegistry contract via Injective EVM.
 *
 * Security: Private keys are decrypted, used to sign EVM transactions,
 * then discarded. The LLM/agent never sees the private key.
 */
import type { Config } from '../config/index.js'
import type { PublicClient, WalletClient, Account, Chain } from 'viem'
import type { ServiceEntry } from './types.js'
import { wallets } from '../wallets/index.js'
import { createIdentityWalletClient, createIdentityPublicClient } from './client.js'
import { getIdentityConfig, getPinataJwt, type IdentityConfig } from './config.js'
import { IDENTITY_REGISTRY_ABI, REPUTATION_REGISTRY_ABI } from './abis.js'
import { encodeStringMetadata, walletLinkDeadline, signWalletLink, METADATA_KEYS } from './helpers.js'
import { IdentityTxFailed, DeregisterNotConfirmed } from '../errors/index.js'
import { generateAgentCard, fetchAgentCard, mergeAgentCard } from './card.js'
import { PinataStorage, StorageError } from './storage.js'

// ─── Parameter / result types ───────────────────────────────────────────────

export interface RegisterParams {
  address: string
  password: string
  name: string
  type: string
  builderCode: string
  wallet?: string
  uri?: string
  description?: string
  image?: string
  services?: ServiceEntry[]
}

export interface RegisterResult {
  agentId: string
  txHash: string
  owner: string
  evmAddress: string
  cardUri: string
  walletTxHash?: string
  walletLinkSkipped?: boolean
  walletLinkReason?: string
}

export interface UpdateParams {
  address: string
  password: string
  agentId: string
  name?: string
  type?: string
  builderCode?: string
  uri?: string
  wallet?: string
  description?: string
  image?: string
  services?: ServiceEntry[]
  removeServices?: string[]
}

export interface UpdateResult {
  agentId: string
  txHashes: string[]
  cardUri?: string
  walletTxHash?: string
  walletLinkSkipped?: boolean
  walletLinkReason?: string
}

export interface DeregisterParams {
  address: string
  password: string
  agentId: string
  confirm: boolean
}

export interface DeregisterResult {
  agentId: string
  txHash: string
}

export interface GiveFeedbackParams {
  address: string
  password: string
  agentId: string
  value: number
  valueDecimals?: number
  tag1?: string
  tag2?: string
  endpoint?: string
  feedbackURI?: string
  feedbackHash?: string
}

export interface GiveFeedbackResult {
  txHash: string
  agentId: string
  feedbackIndex?: string
}

export interface RevokeFeedbackParams {
  address: string
  password: string
  agentId: string
  feedbackIndex: number
}

export interface RevokeFeedbackResult {
  txHash: string
  agentId: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface TxContext {
  walletClient: WalletClient
  publicClient: PublicClient
  account: Account
  chain: Chain
  identityCfg: IdentityConfig
}

async function withIdentityTx<T>(
  config: Config,
  address: string,
  password: string,
  fn: (ctx: TxContext) => Promise<T>,
): Promise<T> {
  try {
    const privateKeyHex = wallets.unlock(address, password)
    const walletClient = createIdentityWalletClient(config.network, privateKeyHex)
    const publicClient = createIdentityPublicClient(config.network)
    const identityCfg = getIdentityConfig(config.network)
    const account = walletClient.account
    if (!account) throw new IdentityTxFailed('Wallet client has no account')

    return await fn({
      walletClient,
      publicClient,
      account,
      chain: walletClient.chain!,
      identityCfg,
    })
  } catch (err) {
    if (err instanceof IdentityTxFailed || err instanceof StorageError) throw err
    const message = err instanceof Error ? err.message : String(err)
    throw new IdentityTxFailed(message)
  }
}

interface WalletLinkResult {
  walletTxHash?: string
  walletLinkSkipped?: boolean
  walletLinkReason?: string
}

async function linkWalletIfSelf(
  ctx: TxContext,
  agentId: bigint,
  wallet: string | undefined,
): Promise<WalletLinkResult> {
  if (!wallet) return {}

  if (wallet.toLowerCase() !== ctx.account.address.toLowerCase()) {
    return {
      walletLinkSkipped: true,
      walletLinkReason: 'Wallet differs from signer. Link manually with the wallet\'s private key.',
    }
  }

  const deadline = walletLinkDeadline()
  const signature = await signWalletLink({
    account: ctx.account,
    agentId,
    newWallet: wallet as `0x${string}`,
    ownerAddress: ctx.account.address,
    deadline,
    chainId: ctx.identityCfg.chainId,
    verifyingContract: ctx.identityCfg.identityRegistry,
  })

  const walletTxHash = await ctx.walletClient.writeContract({
    chain: ctx.chain,
    account: ctx.account,
    address: ctx.identityCfg.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setAgentWallet',
    args: [agentId, wallet as `0x${string}`, deadline, signature],
  })
  await ctx.publicClient.waitForTransactionReceipt({ hash: walletTxHash })

  return { walletTxHash }
}

function requirePinataJwt(): string {
  const jwt = getPinataJwt()
  if (!jwt) {
    throw new IdentityTxFailed(
      'IPFS storage not configured. Set PINATA_JWT environment variable or provide a uri parameter.',
    )
  }
  return jwt
}

// ─── Handlers ───────────────────────────────────────────────────────────────

export const identity = {
  async register(config: Config, params: RegisterParams): Promise<RegisterResult> {
    // Fail fast: validate JWT before decrypting the key
    const jwt = !params.uri ? requirePinataJwt() : undefined
    let cardUri = params.uri ?? ''

    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      if (jwt) {
        const card = generateAgentCard({
          name: params.name,
          agentType: params.type,
          builderCode: params.builderCode,
          operatorAddress: ctx.account.address,
          chainId: ctx.identityCfg.chainId,
          description: params.description,
          image: params.image,
          services: params.services,
        })
        const storage = new PinataStorage(jwt)
        cardUri = await storage.uploadJSON(card, `agent-card-${params.name}`)
      }

      const metadata = [
        { metadataKey: METADATA_KEYS.NAME, metadataValue: encodeStringMetadata(params.name) },
        { metadataKey: METADATA_KEYS.AGENT_TYPE, metadataValue: encodeStringMetadata(params.type) },
        { metadataKey: METADATA_KEYS.BUILDER_CODE, metadataValue: encodeStringMetadata(params.builderCode) },
      ]

      const txHash = await ctx.walletClient.writeContract({
        chain: ctx.chain,
        account: ctx.account,
        address: ctx.identityCfg.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [cardUri, metadata],
      })

      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })

      // Extract agentId from Registered event: topics = [sig, agentId(indexed), owner(indexed)]
      // Must match exactly 3 topics to avoid confusing with Transfer (4 topics)
      let agentId = '0'
      const registryAddr = ctx.identityCfg.identityRegistry.toLowerCase()
      for (const log of receipt.logs) {
        if (
          log.address?.toLowerCase() === registryAddr &&
          log.topics.length === 3 &&
          log.topics[1]
        ) {
          agentId = BigInt(log.topics[1]).toString()
          break
        }
      }

      const walletResult = await linkWalletIfSelf(ctx, BigInt(agentId), params.wallet)

      return {
        agentId,
        txHash,
        owner: ctx.account.address,
        evmAddress: ctx.account.address,
        cardUri,
        ...walletResult,
      }
    })
  },

  async update(config: Config, params: UpdateParams): Promise<UpdateResult> {
    const hasCardUpdate = params.description !== undefined || params.image !== undefined
      || params.services !== undefined || (params.removeServices?.length ?? 0) > 0

    if ([params.name, params.type, params.builderCode, params.uri, params.wallet,
         params.description, params.image, params.services].every(v => v === undefined)
        && !(params.removeServices?.length)) {
      throw new IdentityTxFailed('No fields provided to update')
    }

    // Fail fast: validate JWT before decrypting the key
    const jwt = (hasCardUpdate && !params.uri) ? requirePinataJwt() : undefined

    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      const id = BigInt(params.agentId)
      const registry = ctx.identityCfg.identityRegistry
      const result: UpdateResult = { agentId: params.agentId, txHashes: [] }

      // Phase 1: send all metadata + URI txs sequentially (nonce ordering)
      const pendingHashes: `0x${string}`[] = []

      for (const [key, value] of [
        [METADATA_KEYS.NAME, params.name],
        [METADATA_KEYS.AGENT_TYPE, params.type],
        [METADATA_KEYS.BUILDER_CODE, params.builderCode],
      ] as const) {
        if (value !== undefined) {
          const txHash = await ctx.walletClient.writeContract({
            chain: ctx.chain, account: ctx.account,
            address: registry, abi: IDENTITY_REGISTRY_ABI,
            functionName: 'setMetadata',
            args: [id, key, encodeStringMetadata(value)],
          })
          pendingHashes.push(txHash)
        }
      }

      if (params.uri !== undefined && !hasCardUpdate) {
        const txHash = await ctx.walletClient.writeContract({
          chain: ctx.chain, account: ctx.account,
          address: registry, abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setAgentURI',
          args: [id, params.uri],
        })
        pendingHashes.push(txHash)
      }

      // Card update: fetch existing card, merge, re-upload
      if (jwt) {
        // Fetch existing card
        const tokenURI = await ctx.publicClient.readContract({
          address: ctx.identityCfg.identityRegistry,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: 'tokenURI',
          args: [id],
        }) as string

        let card: import('./types.js').AgentCard | null = null
        try {
          card = await fetchAgentCard(tokenURI, ctx.identityCfg.ipfsGateway)
        } catch {
          // Gateway unreachable — build fresh card rather than failing the update
        }

        if (card) {
          card = mergeAgentCard(card, {
            name: params.name,
            description: params.description,
            image: params.image,
            services: params.services,
            removeServices: params.removeServices,
          })
        } else {
          card = generateAgentCard({
            name: params.name ?? '',
            agentType: params.type ?? '',
            builderCode: params.builderCode ?? '',
            operatorAddress: ctx.account.address,
            chainId: ctx.identityCfg.chainId,
            description: params.description,
            image: params.image,
            services: params.services,
          })
        }

        const storage = new PinataStorage(jwt)
        const newUri = await storage.uploadJSON(card, `agent-card-update-${params.agentId}`)

        const txHash = await ctx.walletClient.writeContract({
          chain: ctx.chain, account: ctx.account,
          address: registry, abi: IDENTITY_REGISTRY_ABI,
          functionName: 'setAgentURI',
          args: [id, newUri],
        })
        pendingHashes.push(txHash)
        result.cardUri = newUri
      }

      // Phase 2: wait for all receipts in parallel
      await Promise.all(pendingHashes.map(h => ctx.publicClient.waitForTransactionReceipt({ hash: h })))

      const walletResult = await linkWalletIfSelf(ctx, id, params.wallet)

      result.txHashes = pendingHashes
      return {
        ...result,
        ...walletResult,
      }
    })
  },

  async deregister(config: Config, params: DeregisterParams): Promise<DeregisterResult> {
    if (!params.confirm) {
      throw new DeregisterNotConfirmed()
    }

    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      const txHash = await ctx.walletClient.writeContract({
        chain: ctx.chain,
        account: ctx.account,
        address: ctx.identityCfg.identityRegistry,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'deregister',
        args: [BigInt(params.agentId)],
      })

      await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })
      return { agentId: params.agentId, txHash }
    })
  },

  async giveFeedback(config: Config, params: GiveFeedbackParams): Promise<GiveFeedbackResult> {
    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      const feedbackHash = (params.feedbackHash ?? '0x' + '00'.repeat(32)) as `0x${string}`

      const txHash = await ctx.walletClient.writeContract({
        chain: ctx.chain,
        account: ctx.account,
        address: ctx.identityCfg.reputationRegistry,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'giveFeedback',
        args: [
          BigInt(params.agentId),
          BigInt(params.value),
          params.valueDecimals ?? 0,
          params.tag1 ?? '',
          params.tag2 ?? '',
          params.endpoint ?? '',
          params.feedbackURI ?? '',
          feedbackHash,
        ],
      })

      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })

      // Extract feedbackIndex from NewFeedback event
      let feedbackIndex: string | undefined
      const registryAddr = ctx.identityCfg.reputationRegistry.toLowerCase()
      for (const log of receipt.logs) {
        if (
          log.address?.toLowerCase() === registryAddr &&
          log.topics.length === 3 && // NewFeedback: [sig, agentId(indexed), client(indexed)]
          log.data &&
          log.data !== '0x'
        ) {
          // feedbackIndex is a non-indexed uint64 in log data
          feedbackIndex = BigInt(log.data).toString()
          break
        }
      }

      return { txHash, agentId: params.agentId, feedbackIndex }
    })
  },

  async revokeFeedback(config: Config, params: RevokeFeedbackParams): Promise<RevokeFeedbackResult> {
    return withIdentityTx(config, params.address, params.password, async (ctx) => {
      const txHash = await ctx.walletClient.writeContract({
        chain: ctx.chain,
        account: ctx.account,
        address: ctx.identityCfg.reputationRegistry,
        abi: REPUTATION_REGISTRY_ABI,
        functionName: 'revokeFeedback',
        args: [BigInt(params.agentId), BigInt(params.feedbackIndex)],
      })

      await ctx.publicClient.waitForTransactionReceipt({ hash: txHash })
      return { txHash, agentId: params.agentId }
    })
  },
}
