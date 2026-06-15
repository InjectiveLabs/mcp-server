import { Interface, isAddress } from 'ethers'
import { Config } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { evm } from '../evm/index.js'
import { CctpApiError } from '../errors/index.js'

export const USDC_DECIMALS = 6
export const INJECTIVE_CCTP_DOMAIN = 29

const CCTP_TIMEOUT_MS = 15_000
const CIRCLE_IRIS_HOST = 'iris-api.circle.com'

const MESSAGE_TRANSMITTER_IFACE = new Interface([
  'function receiveMessage(bytes message, bytes attestation) returns (bool)',
])

export interface NativeUsdcInfo {
  network: Config['network']
  cosmosChainId: string
  evmChainId: number
  cctpDomain: number
  evmAddress: string
  denom: string
  decimals: number
  contracts: {
    tokenMessengerV2: string
    messageTransmitterV2: string
    tokenMinterV2: string
    messageV2?: string
  }
}

export interface CctpChain {
  slug: string
  name: string
  chainId: number
  chainHex: `0x${string}`
  domain: number
  usdc: string
  gas: string
}

export interface SupportedCctpChains {
  network: Config['network']
  injective: NativeUsdcInfo
  sourceChains: CctpChain[]
  aliases: Record<string, string>
  standardTransfer: {
    destinationCaller: string
    maxFee: string
    minFinalityThreshold: number
  }
}

export interface CctpAttestationStatusParams {
  sourceDomain: number
  burnTxHash: string
}

export interface CctpAttestationStatus {
  sourceDomain: number
  burnTxHash: string
  url: string
  status: string | null
  mintable: boolean
  message: string | null
  attestation: string | null
  raw: Record<string, unknown>
}

export interface CctpMintParams {
  address: string
  password: string
  message: string
  attestation: string
  gasLimit?: string | number | bigint
  gasPrice?: string
}

export interface CctpMintResult {
  txHash: string
  address: string
  messageTransmitter: string
  gasLimit: string
  gasPrice: string
  chainId: number
}

const NATIVE_USDC_BY_NETWORK: Record<Config['network'], Omit<NativeUsdcInfo, 'network' | 'cosmosChainId' | 'evmChainId'>> = {
  mainnet: {
    cctpDomain: INJECTIVE_CCTP_DOMAIN,
    evmAddress: '0xa00C59fF5a080D2b954d0c75e46E22a0c371235a',
    denom: 'erc20:0xa00c59ff5a080d2b954d0c75e46e22a0c371235a',
    decimals: USDC_DECIMALS,
    contracts: {
      tokenMessengerV2: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
      messageTransmitterV2: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
      tokenMinterV2: '0xfd78EE919681417d192449715b2594ab58f5D002',
      messageV2: '0xec546b6B005471ECf012e5aF77FBeC07e0FD8f78',
    },
  },
  testnet: {
    cctpDomain: INJECTIVE_CCTP_DOMAIN,
    evmAddress: '0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d',
    denom: 'erc20:0x0c382e685bbeefe5d3d9c29e29e341fee8e84c5d',
    decimals: USDC_DECIMALS,
    contracts: {
      tokenMessengerV2: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
      messageTransmitterV2: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
      tokenMinterV2: '0xb43db544E2c27092c107639Ad201b3dEfAbcF192',
    },
  },
}

const MAINNET_CCTP_SOURCE_CHAINS: CctpChain[] = [
  {
    slug: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    chainHex: '0x1',
    domain: 0,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    gas: 'ETH',
  },
  {
    slug: 'avalanche',
    name: 'Avalanche C-Chain',
    chainId: 43114,
    chainHex: '0xa86a',
    domain: 1,
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    gas: 'AVAX',
  },
  {
    slug: 'optimism',
    name: 'OP Mainnet',
    chainId: 10,
    chainHex: '0xa',
    domain: 2,
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    gas: 'ETH',
  },
  {
    slug: 'arbitrum',
    name: 'Arbitrum One',
    chainId: 42161,
    chainHex: '0xa4b1',
    domain: 3,
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    gas: 'ETH',
  },
  {
    slug: 'base',
    name: 'Base',
    chainId: 8453,
    chainHex: '0x2105',
    domain: 6,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    gas: 'ETH',
  },
  {
    slug: 'polygon',
    name: 'Polygon PoS',
    chainId: 137,
    chainHex: '0x89',
    domain: 7,
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    gas: 'POL',
  },
]

const CCTP_SOURCE_ALIASES: Record<string, string> = {
  arb: 'arbitrum',
  'arbitrum-one': 'arbitrum',
  eth: 'ethereum',
  mainnet: 'ethereum',
  op: 'optimism',
  'op-mainnet': 'optimism',
  matic: 'polygon',
  poly: 'polygon',
  avax: 'avalanche',
  'avalanche-c-chain': 'avalanche',
}

function validateHex(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new CctpApiError(`${field} must be 0x-prefixed hex`)
  }
  return value
}

function buildIrisUrl(params: CctpAttestationStatusParams): string {
  const query = new URLSearchParams({ transactionHash: params.burnTxHash })
  return `https://${CIRCLE_IRIS_HOST}/v2/messages/${params.sourceDomain}?${query.toString()}`
}

async function fetchCircleIris(url: string): Promise<Record<string, unknown>> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new CctpApiError('Invalid Circle Iris URL')
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== CIRCLE_IRIS_HOST) {
    throw new CctpApiError('Blocked outbound URL: only https://iris-api.circle.com is allowed')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CCTP_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    const rawBody = await response.text()
    let body: unknown

    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      throw new CctpApiError('Circle Iris returned non-JSON response')
    }

    if (!response.ok) {
      const details = body && typeof body === 'object' ? JSON.stringify(body) : rawBody
      throw new CctpApiError(`HTTP ${response.status}: ${details}`)
    }

    if (!body || typeof body !== 'object') {
      throw new CctpApiError('Malformed Circle Iris response body')
    }

    return body as Record<string, unknown>
  } catch (err: unknown) {
    if (err instanceof CctpApiError) throw err

    if (err instanceof Error && err.name === 'AbortError') {
      throw new CctpApiError(`Request timed out after ${CCTP_TIMEOUT_MS}ms`)
    }

    const message = err instanceof Error ? err.message : String(err)
    throw new CctpApiError(message)
  } finally {
    clearTimeout(timeout)
  }
}

function pickMessageRecord(raw: Record<string, unknown>): Record<string, unknown> | null {
  const messages = raw['messages']
  if (Array.isArray(messages) && messages.length > 0) {
    const first = messages[0]
    return first && typeof first === 'object' ? first as Record<string, unknown> : null
  }

  if ('message' in raw || 'attestation' in raw || 'status' in raw) {
    return raw
  }

  return null
}

export function nativeInfo(config: Config): NativeUsdcInfo {
  const info = NATIVE_USDC_BY_NETWORK[config.network]
  return {
    network: config.network,
    cosmosChainId: config.chainId,
    evmChainId: config.ethereumChainId,
    ...info,
  }
}

export function supportedChains(config: Config): SupportedCctpChains {
  return {
    network: config.network,
    injective: nativeInfo(config),
    sourceChains: config.network === 'mainnet' ? MAINNET_CCTP_SOURCE_CHAINS : [],
    aliases: CCTP_SOURCE_ALIASES,
    standardTransfer: {
      destinationCaller: `0x${'0'.repeat(64)}`,
      maxFee: '0',
      minFinalityThreshold: 2000,
    },
  }
}

export async function getAttestationStatus(
  params: CctpAttestationStatusParams,
): Promise<CctpAttestationStatus> {
  if (!Number.isInteger(params.sourceDomain) || params.sourceDomain < 0) {
    throw new CctpApiError('sourceDomain must be a non-negative integer')
  }
  validateHex(params.burnTxHash, 'burnTxHash')

  const url = buildIrisUrl(params)
  const raw = await fetchCircleIris(url)
  const messageRecord = pickMessageRecord(raw)
  const status = typeof messageRecord?.['status'] === 'string' ? messageRecord['status'] : null
  const message = typeof messageRecord?.['message'] === 'string' ? messageRecord['message'] : null
  const attestation = typeof messageRecord?.['attestation'] === 'string'
    ? messageRecord['attestation']
    : null

  return {
    sourceDomain: params.sourceDomain,
    burnTxHash: params.burnTxHash,
    url,
    status,
    mintable: status === 'complete' && !!message && !!attestation && attestation !== 'PENDING',
    message,
    attestation,
    raw,
  }
}

export function encodeReceiveMessage(message: string, attestation: string): string {
  return MESSAGE_TRANSMITTER_IFACE.encodeFunctionData('receiveMessage', [
    validateHex(message, 'message'),
    validateHex(attestation, 'attestation'),
  ])
}

export async function mint(config: Config, params: CctpMintParams): Promise<CctpMintResult> {
  const info = nativeInfo(config)
  const messageTransmitter = info.contracts.messageTransmitterV2
  if (!isAddress(messageTransmitter)) {
    throw new CctpApiError(`Invalid MessageTransmitterV2 address for ${config.network}`)
  }

  const privateKeyHex = wallets.unlock(params.address, params.password)
  const result = await evm.broadcastEvmTx(config, {
    privateKeyHex,
    to: messageTransmitter,
    data: encodeReceiveMessage(params.message, params.attestation),
    value: '0',
    gasLimit: params.gasLimit ?? 500_000,
    gasPrice: params.gasPrice,
    memo: 'cctp receiveMessage',
  })

  return {
    txHash: result.txHash,
    address: params.address,
    messageTransmitter,
    gasLimit: result.gasLimit,
    gasPrice: result.gasPrice,
    chainId: result.chainId,
  }
}

export const usdc = {
  nativeInfo,
  supportedChains,
  getAttestationStatus,
  encodeReceiveMessage,
  mint,
}
