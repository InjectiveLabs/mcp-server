/**
 * Singleton factory for Injective gRPC clients.
 * Features:
 * - Singleton per config (recreated on config change)
 * - Connection TTL — stale connections recycled after 5 minutes
 * - Basic retry with exponential backoff on transient failures
 */
import {
  IndexerGrpcAccountApi,
  IndexerGrpcDerivativesApi,
  IndexerGrpcOracleApi,
  IndexerGrpcAccountPortfolioApi,
  ChainGrpcBankApi,
  ChainGrpcPeggyApi,
  ChainGrpcEvmApi,
  TxGrpcApi,
  MsgBroadcasterWithPk,
  PrivateKey,
} from '@injectivelabs/sdk-ts'
import { Network } from '@injectivelabs/networks'
import { Config, NetworkName } from '../config/index.js'

export interface InjectiveClient {
  derivativesApi: IndexerGrpcDerivativesApi
  oracleApi: IndexerGrpcOracleApi
  portfolioApi: IndexerGrpcAccountPortfolioApi
  accountApi: IndexerGrpcAccountApi
  bankApi: ChainGrpcBankApi
  peggyApi: ChainGrpcPeggyApi
  evmApi: ChainGrpcEvmApi
  txApi: TxGrpcApi
  endpoints: Config['endpoints']
  chainId: string
  network: NetworkName
}

const TTL_MS = 5 * 60 * 1000 // 5 minutes

let cached: { client: InjectiveClient; expiresAt: number; cacheKey: string } | null = null

export function createClient(config: Config): InjectiveClient {
  const cacheKey = `${config.network}:${config.endpoints.indexer}`

  if (cached && cached.cacheKey === cacheKey && Date.now() < cached.expiresAt) {
    return cached.client
  }

  const client: InjectiveClient = {
    derivativesApi: new IndexerGrpcDerivativesApi(config.endpoints.indexer),
    oracleApi: new IndexerGrpcOracleApi(config.endpoints.indexer),
    portfolioApi: new IndexerGrpcAccountPortfolioApi(config.endpoints.indexer),
    accountApi: new IndexerGrpcAccountApi(config.endpoints.indexer),
    bankApi: new ChainGrpcBankApi(config.endpoints.grpc),
    peggyApi: new ChainGrpcPeggyApi(config.endpoints.grpc),
    evmApi: new ChainGrpcEvmApi(config.endpoints.grpc),
    txApi: new TxGrpcApi(config.endpoints.grpc),
    endpoints: config.endpoints,
    chainId: config.chainId,
    network: config.network,
  }

  cached = { client, expiresAt: Date.now() + TTL_MS, cacheKey }
  return client
}

/**
 * Build a MsgBroadcasterWithPk for signing and broadcasting transactions.
 * The private key is passed in, used, and the broadcaster discarded after use.
 */
export function createBroadcaster(config: Config, privateKeyHex: string): MsgBroadcasterWithPk {
  const network = config.network === 'mainnet' ? Network.MainnetSentry : Network.TestnetSentry
  const pk = PrivateKey.fromHex(privateKeyHex)

  return new MsgBroadcasterWithPk({
    network,
    privateKey: pk,
    simulateTx: true,
    gasBufferCoefficient: 1.3,
  })
}

/**
 * Retry a gRPC call with exponential backoff on transient errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 300,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastError = err
      const isTransient = isTransientError(err)
      if (!isTransient || attempt === maxAttempts - 1) throw err
      await sleep(baseDelayMs * Math.pow(2, attempt))
    }
  }
  throw lastError
}

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('timeout') ||
    msg.includes('unavailable') ||
    msg.includes('stream removed')
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
