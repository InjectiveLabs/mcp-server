/**
 * Identity module — thin adapter over @injective/agent-sdk.
 *
 * Unlocks the keystore, creates an AgentClient per request, delegates
 * all write operations to the SDK, and formats responses into the exact
 * MCP JSON shapes that server.ts expects.
 */
import type { Config } from '../config/index.js'
import type { AgentType, ServiceType, ServiceEntry } from '@injective/agent-sdk'
import { AgentClient, PinataStorage } from '@injective/agent-sdk'
import { wallets } from '../wallets/index.js'
import { IdentityTxFailed, DeregisterNotConfirmed } from '../errors/index.js'

export type { ServiceEntry } from '@injective/agent-sdk'

// ─── Parameter / result types (consumed by server.ts) ─────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────

function requirePinataJwt(): string {
  const jwt = process.env['PINATA_JWT']
  if (!jwt) {
    throw new IdentityTxFailed(
      'IPFS storage not configured. Set PINATA_JWT environment variable or provide a uri parameter.',
    )
  }
  return jwt
}

function createClient(config: Config, address: string, password: string, storage?: PinataStorage): AgentClient {
  const hex = wallets.unlock(address, password)
  const privateKey = (hex.startsWith('0x') ? hex : `0x${hex}`) as `0x${string}`
  return new AgentClient({ privateKey, network: config.network, storage, audit: false })
}

interface WalletLinkInfo {
  walletTxHash?: string
  walletLinkSkipped?: boolean
  walletLinkReason?: string
}

function wrapSdkError(err: unknown, ...passthrough: (new (...a: never[]) => Error)[]): never {
  if (err instanceof IdentityTxFailed) throw err
  for (const E of passthrough) if (err instanceof E) throw err
  throw new IdentityTxFailed(err instanceof Error ? err.message : String(err))
}

function walletLinkInfo(wallet: string | undefined, signerAddress: string, txHashes: `0x${string}`[]): WalletLinkInfo {
  if (!wallet) return {}
  if (wallet.toLowerCase() !== signerAddress.toLowerCase()) {
    return {
      walletLinkSkipped: true,
      walletLinkReason: `Wallet ${wallet} does not match signer ${signerAddress} — only self-links supported`,
    }
  }
  if (txHashes.length > 1) {
    return { walletTxHash: txHashes[1] }
  }
  return {}
}

// ─── Handlers ─────────────────────────────────────────────────────────────

export const identity = {
  async register(config: Config, params: RegisterParams): Promise<RegisterResult> {
    const jwt = !params.uri ? requirePinataJwt() : undefined
    const storage = jwt ? new PinataStorage({ jwt }) : undefined

    try {
      const client = createClient(config, params.address, params.password, storage)
      const r = await client.register({
        name: params.name,
        type: params.type as AgentType,
        builderCode: params.builderCode,
        wallet: (params.wallet ?? client.address) as `0x${string}`,
        uri: params.uri,
        description: params.description,
        image: params.image,
        services: params.services,
      })

      return {
        agentId: r.agentId.toString(),
        txHash: r.txHashes[0]!,
        owner: client.address,
        evmAddress: client.address,
        cardUri: r.cardUri,
        ...walletLinkInfo(params.wallet, client.address, r.txHashes),
      }
    } catch (err) { wrapSdkError(err) }
  },

  async update(config: Config, params: UpdateParams): Promise<UpdateResult> {
    const hasCardUpdate = params.description !== undefined || params.image !== undefined
      || params.services !== undefined || (params.removeServices?.length ?? 0) > 0
    const jwt = (hasCardUpdate && !params.uri) ? requirePinataJwt() : undefined
    const storage = jwt ? new PinataStorage({ jwt }) : undefined

    try {
      const client = createClient(config, params.address, params.password, storage)
      const id = BigInt(params.agentId)
      const r = await client.update(id, {
        name: params.name,
        type: params.type as AgentType | undefined,
        builderCode: params.builderCode,
        wallet: params.wallet as `0x${string}` | undefined,
        uri: params.uri,
        description: params.description,
        image: params.image,
        services: params.services,
        removeServices: params.removeServices as ServiceType[] | undefined,
      })

      let cardUri: string | undefined
      if (params.uri !== undefined) {
        cardUri = params.uri                     // URI supplied directly — no RPC needed
      } else if (hasCardUpdate) {
        const status = await client.getStatus(id) // SDK doesn't return new URI in UpdateResult
        cardUri = status.tokenUri
      }

      return {
        agentId: params.agentId,
        txHashes: r.txHashes,
        cardUri,
        ...walletLinkInfo(params.wallet, client.address, r.txHashes),
      }
    } catch (err) { wrapSdkError(err) }
  },

  async deregister(config: Config, params: DeregisterParams): Promise<DeregisterResult> {
    if (!params.confirm) throw new DeregisterNotConfirmed()

    try {
      const client = createClient(config, params.address, params.password)
      const r = await client.deregister(BigInt(params.agentId))
      return { agentId: params.agentId, txHash: r.txHash }
    } catch (err) { wrapSdkError(err, DeregisterNotConfirmed) }
  },

  async giveFeedback(config: Config, params: GiveFeedbackParams): Promise<GiveFeedbackResult> {
    try {
      const client = createClient(config, params.address, params.password)
      const r = await client.giveFeedback({
        agentId: BigInt(params.agentId),
        value: BigInt(params.value),
        valueDecimals: params.valueDecimals,
        tag1: params.tag1,
        tag2: params.tag2,
        endpoint: params.endpoint,
        feedbackURI: params.feedbackURI,
        feedbackHash: params.feedbackHash as `0x${string}` | undefined,
      })

      return {
        txHash: r.txHash,
        agentId: params.agentId,
        feedbackIndex: r.feedbackIndex.toString(),
      }
    } catch (err) { wrapSdkError(err) }
  },

  async revokeFeedback(config: Config, params: RevokeFeedbackParams): Promise<RevokeFeedbackResult> {
    try {
      const client = createClient(config, params.address, params.password)
      const r = await client.revokeFeedback({
        agentId: BigInt(params.agentId),
        feedbackIndex: BigInt(params.feedbackIndex),
      })

      return { txHash: r.txHash, agentId: params.agentId }
    } catch (err) { wrapSdkError(err) }
  },
}
