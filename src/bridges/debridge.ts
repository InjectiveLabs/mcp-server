import Decimal from 'decimal.js'
import { isAddress } from 'ethers'
import { Config } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { accounts } from '../accounts/index.js'
import { toBaseUnits } from '../utils/denom-math.js'
import { evm, injAddressToEth, extractErc20Address, encodeErc20Approve } from '../evm/index.js'
import {
  DeBridgeApiError,
  InvalidTransferAmount,
  UnsupportedBridgeChain,
  UnknownDecimals,
} from '../errors/index.js'

export const DEBRIDGE_API_BASE = 'https://dln.debridge.finance/v1.0'
export const DEBRIDGE_INJECTIVE_CHAIN_ID = 100000029
const DEBRIDGE_TIMEOUT_MS = 15_000
const EVM_NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'
const DEBRIDGE_ALLOWED_HOSTS = new Set(['dln.debridge.finance'])

const CHAIN_ID_BY_NAME: Record<string, number> = {
  ethereum: 1,
  eth: 1,
  bsc: 56,
  binance: 56,
  polygon: 137,
  arbitrum: 42161,
  avalanche: 43114,
  base: 8453,
  optimism: 10,
  solana: 7565164,
}

export interface DeBridgeQuoteParams {
  srcDenom: string
  amount: string
  dstChain: string | number
  dstTokenAddress: string
  recipient: string
}

export interface DeBridgeQuoteResult {
  srcChainId: number
  dstChainId: number
  srcDenom: string
  srcTokenAddress: string
  srcAmount: string
  srcAmountBase: string
  dstTokenAddress: string
  recipient: string
  estimation: unknown
  quote: Record<string, unknown>
}

export interface DeBridgeSendParams extends DeBridgeQuoteParams {
  address: string
  password: string
  dstAuthorityAddress?: string
  gasLimit?: string | number | bigint
  gasPrice?: string
  memo?: string
}

export interface DeBridgeSendResult extends DeBridgeQuoteResult {
  txHash: string
  orderId: string
  approvalTxHash?: string
}

function getSourceTokenAddress(denom: string): string {
  if (denom === 'inj') return EVM_NATIVE_TOKEN
  if (denom.startsWith('erc20:')) {
    return extractErc20Address(denom)
  }
  throw new DeBridgeApiError(
    `Unsupported source denom "${denom}" for deBridge. Use "inj" or "erc20:0x...".`
  )
}

function validateAmount(amount: string): Decimal {
  const parsed = new Decimal(amount)
  if (parsed.lte(0)) {
    throw new InvalidTransferAmount('Amount must be greater than zero')
  }
  return parsed
}

function getRequiredString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.length > 0) return value
  throw new DeBridgeApiError(`Missing ${field} in deBridge response`)
}

function toQueryString(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    qs.set(key, String(value))
  }
  return qs.toString()
}

function parseOrderResponse(response: Record<string, unknown>): {
  orderId: string
  tx: { to: string; data: string; value: string }
} {
  const orderId = getRequiredString(response['orderId'], 'orderId')
  const txRaw = response['tx']
  if (!txRaw || typeof txRaw !== 'object') {
    throw new DeBridgeApiError('Missing tx object in deBridge response')
  }
  const tx = txRaw as Record<string, unknown>
  return {
    orderId,
    tx: {
      to: getRequiredString(tx['to'], 'tx.to'),
      data: getRequiredString(tx['data'], 'tx.data'),
      value: String(tx['value'] ?? '0'),
    },
  }
}

export function resolveDstChainId(nameOrId: string | number): number {
  if (typeof nameOrId === 'number' && Number.isInteger(nameOrId) && nameOrId > 0) {
    return nameOrId
  }

  const normalized = String(nameOrId).trim().toLowerCase()
  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }

  const mapped = CHAIN_ID_BY_NAME[normalized]
  if (!mapped) {
    throw new UnsupportedBridgeChain(nameOrId)
  }
  return mapped
}

export async function fetchDeBridgeApi(url: string): Promise<Record<string, unknown>> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new DeBridgeApiError('Invalid deBridge URL')
  }

  const isHttps = parsedUrl.protocol === 'https:'
  const isAllowedHost = DEBRIDGE_ALLOWED_HOSTS.has(parsedUrl.hostname.toLowerCase())
  if (!isHttps || !isAllowedHost) {
    throw new DeBridgeApiError('Blocked outbound URL: only https://dln.debridge.finance is allowed')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEBRIDGE_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    const rawBody = await response.text()

    let body: unknown
    try {
      body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      throw new DeBridgeApiError('deBridge returned non-JSON response')
    }

    if (!response.ok) {
      const details = typeof body === 'object' && body !== null
        ? JSON.stringify(body)
        : rawBody
      throw new DeBridgeApiError(`HTTP ${response.status}: ${details}`)
    }

    if (!body || typeof body !== 'object') {
      throw new DeBridgeApiError('Malformed deBridge response body')
    }

    return body as Record<string, unknown>
  } catch (err: unknown) {
    if (err instanceof DeBridgeApiError) throw err

    if (err instanceof Error && err.name === 'AbortError') {
      throw new DeBridgeApiError(`Request timed out after ${DEBRIDGE_TIMEOUT_MS}ms`)
    }

    const message = err instanceof Error ? err.message : String(err)
    throw new DeBridgeApiError(message)
  } finally {
    clearTimeout(timeout)
  }
}

function buildCreateTxUrl(
  params: {
    srcChainTokenIn: string
    srcChainTokenInAmount: string
    dstChainId: number
    dstChainTokenOut: string
    dstChainTokenOutRecipient: string
    srcChainOrderAuthorityAddress?: string
    dstChainOrderAuthorityAddress?: string
  },
): string {
  const base = DEBRIDGE_API_BASE.replace(/\/+$/, '')
  const query = toQueryString({
    srcChainId: DEBRIDGE_INJECTIVE_CHAIN_ID,
    srcChainTokenIn: params.srcChainTokenIn,
    srcChainTokenInAmount: params.srcChainTokenInAmount,
    dstChainId: params.dstChainId,
    dstChainTokenOut: params.dstChainTokenOut,
    dstChainTokenOutRecipient: params.dstChainTokenOutRecipient,
    srcChainOrderAuthorityAddress: params.srcChainOrderAuthorityAddress,
    dstChainOrderAuthorityAddress: params.dstChainOrderAuthorityAddress,
  })
  return `${base}/dln/order/create-tx?${query}`
}

function pickEstimation(response: Record<string, unknown>): unknown {
  return response['estimation'] ?? response['estimationWithoutFees'] ?? null
}

export async function getQuote(config: Config, params: DeBridgeQuoteParams): Promise<DeBridgeQuoteResult> {
  const amount = validateAmount(params.amount)
  const dstChainId = resolveDstChainId(params.dstChain)
  const srcTokenAddress = getSourceTokenAddress(params.srcDenom)

  const meta = await accounts.getDenomMetadata(config, params.srcDenom)
  if (meta.decimals === null) {
    throw new UnknownDecimals(params.srcDenom)
  }

  const srcAmountBase = toBaseUnits(amount, meta.decimals)
  const url = buildCreateTxUrl({
    srcChainTokenIn: srcTokenAddress,
    srcChainTokenInAmount: srcAmountBase,
    dstChainId,
    dstChainTokenOut: params.dstTokenAddress,
    dstChainTokenOutRecipient: params.recipient,
  })
  const response = await fetchDeBridgeApi(url)

  return {
    srcChainId: DEBRIDGE_INJECTIVE_CHAIN_ID,
    dstChainId,
    srcDenom: params.srcDenom,
    srcTokenAddress,
    srcAmount: params.amount,
    srcAmountBase,
    dstTokenAddress: params.dstTokenAddress,
    recipient: params.recipient,
    estimation: pickEstimation(response),
    quote: response,
  }
}

export async function sendBridge(config: Config, params: DeBridgeSendParams): Promise<DeBridgeSendResult> {
  const amount = validateAmount(params.amount)
  const dstChainId = resolveDstChainId(params.dstChain)
  const srcTokenAddress = getSourceTokenAddress(params.srcDenom)
  const srcAuthorityAddress = injAddressToEth(params.address)
  const dstAuthorityAddress = params.dstAuthorityAddress ?? params.recipient

  const meta = await accounts.getDenomMetadata(config, params.srcDenom)
  if (meta.decimals === null) {
    throw new UnknownDecimals(params.srcDenom)
  }

  const srcAmountBase = toBaseUnits(amount, meta.decimals)
  const url = buildCreateTxUrl({
    srcChainTokenIn: srcTokenAddress,
    srcChainTokenInAmount: srcAmountBase,
    dstChainId,
    dstChainTokenOut: params.dstTokenAddress,
    dstChainTokenOutRecipient: params.recipient,
    srcChainOrderAuthorityAddress: srcAuthorityAddress,
    dstChainOrderAuthorityAddress: dstAuthorityAddress,
  })

  const response = await fetchDeBridgeApi(url)
  const { tx, orderId } = parseOrderResponse(response)
  if (!isAddress(tx.to)) {
    throw new DeBridgeApiError(`Invalid tx.to address from deBridge response: ${tx.to}`)
  }
  const privateKeyHex = wallets.unlock(params.address, params.password)
  let approvalTxHash: string | undefined

  // For ERC20 bridge-ins, approve the deBridge execution contract first.
  if (params.srcDenom.startsWith('erc20:')) {
    const approveData = encodeErc20Approve(tx.to, srcAmountBase)
    const approveResult = await evm.broadcastEvmTx(config, {
      privateKeyHex,
      to: srcTokenAddress,
      data: approveData,
      value: '0',
      memo: `debridge approve ${orderId}`,
      gasLimit: params.gasLimit,
      gasPrice: params.gasPrice,
    })
    approvalTxHash = approveResult.txHash

    const bridgeResult = await evm.broadcastEvmTx(config, {
      privateKeyHex,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      nonce: approveResult.nonce + 1,
      gasLimit: params.gasLimit,
      gasPrice: params.gasPrice,
      memo: params.memo ?? `debridge order ${orderId}`,
    })

    return {
      txHash: bridgeResult.txHash,
      approvalTxHash,
      orderId,
      srcChainId: DEBRIDGE_INJECTIVE_CHAIN_ID,
      dstChainId,
      srcDenom: params.srcDenom,
      srcTokenAddress,
      srcAmount: params.amount,
      srcAmountBase,
      dstTokenAddress: params.dstTokenAddress,
      recipient: params.recipient,
      estimation: pickEstimation(response),
      quote: response,
    }
  }

  const evmResult = await evm.broadcastEvmTx(config, {
    privateKeyHex,
    to: tx.to,
    data: tx.data,
    value: tx.value,
    gasLimit: params.gasLimit,
    gasPrice: params.gasPrice,
    memo: params.memo ?? `debridge order ${orderId}`,
  })

  return {
    txHash: evmResult.txHash,
    approvalTxHash,
    orderId,
    srcChainId: DEBRIDGE_INJECTIVE_CHAIN_ID,
    dstChainId,
    srcDenom: params.srcDenom,
    srcTokenAddress,
    srcAmount: params.amount,
    srcAmountBase,
    dstTokenAddress: params.dstTokenAddress,
    recipient: params.recipient,
    estimation: pickEstimation(response),
    quote: response,
  }
}

export const debridge = {
  resolveDstChainId,
  fetchDeBridgeApi,
  getQuote,
  sendBridge,
}
