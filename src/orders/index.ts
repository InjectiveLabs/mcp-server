/**
 * Orders module — perpetual limit order lifecycle.
 *
 * Covers:
 * - Opening derivative limit orders
 * - Listing open derivative limit orders
 * - Cancelling derivative limit orders
 * - Querying derivative order states by hash
 *
 * Safety is enforced at function level:
 * - trade_limit_close requires an orderHash selector
 */
import Decimal from 'decimal.js'
import { MsgCreateDerivativeLimitOrder, MsgCancelDerivativeOrder, OrderTypeMap, getEthereumAddress } from '@injectivelabs/sdk-ts'
import { Config } from '../config/index.js'
import { markets } from '../markets/index.js'
import { wallets } from '../wallets/index.js'
import { createBroadcaster, createClient, withRetry } from '../client/index.js'
import { quantize } from '../trading/math.js'
import { BroadcastFailed, InvalidOrderStatesQuery, InvalidOrderParameters } from '../errors/index.js'

const USDT_DECIMALS = 6
const QUOTE_SCALE = new Decimal(10).pow(USDT_DECIMALS)

export interface TradeLimitOpenParams {
  address: string
  password: string
  symbol: string
  side: 'buy' | 'sell'
  price: string
  quantity: string
  margin: string
  subaccountIndex?: number
  reduceOnly?: boolean
  postOnly?: boolean
}

export interface TradeLimitOpenResult {
  txHash: string
  symbol: string
  marketId: string
  subaccountId: string
  side: 'buy' | 'sell'
  price: string
  quantity: string
  margin: string
  reduceOnly: boolean
  postOnly: boolean
}

export interface TradeLimitOrdersParams {
  address: string
  symbol?: string
  subaccountIndex?: number
}

export interface TradeLimitOrder {
  orderHash: string
  marketId: string
  subaccountId?: string
  side: 'buy' | 'sell' | 'unknown'
  price: string
  quantity: string
  fillable: string
  createdAt?: string
  updatedAt?: string
}

export interface TradeLimitCloseParams {
  address: string
  password: string
  symbol: string
  subaccountIndex?: number
  orderHash: string
}

export interface TradeLimitCloseResult {
  txHash: string
  symbol: string
  marketId: string
  subaccountId: string
  orderHash: string
}

export interface TradeLimitStatesParams {
  derivativeOrderHashes: string[]
}

export interface TradeLimitOrderState {
  orderHash: string
  status: 'booked' | 'partial' | 'filled' | 'canceled' | 'unknown'
  filledQuantity?: string
  remainingQuantity?: string
  raw: Record<string, unknown>
}

type AnyRecord = Record<string, unknown>

function toSubaccountId(address: string, index = 0): string {
  const ethAddress = getEthereumAddress(address)
  const suffix = index.toString(16).padStart(24, '0')
  return `${ethAddress}${suffix}`
}

function parsePositiveDecimal(name: string, value: string): Decimal {
  let parsed: Decimal
  try {
    parsed = new Decimal(value)
  } catch {
    throw new InvalidOrderParameters(`${name} must be a valid number`)
  }
  if (!parsed.isFinite() || parsed.lte(0)) {
    throw new InvalidOrderParameters(`${name} must be greater than zero`)
  }
  return parsed
}

function toChainPrice(price: Decimal, tickSize: Decimal): string {
  const chainPrice = price.mul(QUOTE_SCALE)
  return quantize(chainPrice, tickSize).toFixed(0)
}

function toChainQuantity(quantity: Decimal, tickSize: Decimal): string {
  const quantized = quantize(quantity, tickSize)
  return quantized.toFixed(18).replace(/\.?0+$/, '') || '0'
}

function usdtToBase(amount: Decimal): string {
  return amount.mul(QUOTE_SCALE).toFixed(0)
}

function readString(record: AnyRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

function getArrayField(record: AnyRecord, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function mapOrderSide(raw: unknown): 'buy' | 'sell' | 'unknown' {
  const normalized = String(raw ?? '').toLowerCase()
  if (normalized.includes('buy') || normalized === '1') return 'buy'
  if (normalized.includes('sell') || normalized === '2') return 'sell'
  return 'unknown'
}

function normalizeOpenOrder(raw: AnyRecord): TradeLimitOrder {
  const nestedOrder = (raw['order'] && typeof raw['order'] === 'object')
    ? raw['order'] as AnyRecord
    : {}
  const orderHash = readString(raw, 'orderHash', 'order_hash', 'hash')
    ?? readString(nestedOrder, 'orderHash', 'order_hash', 'hash')
    ?? ''
  const side = mapOrderSide(
    raw['orderType']
    ?? raw['orderSide']
    ?? raw['side']
    ?? nestedOrder['orderType']
    ?? nestedOrder['orderSide']
    ?? nestedOrder['side']
  )
  const marketId = readString(raw, 'marketId', 'market_id')
    ?? readString(nestedOrder, 'marketId', 'market_id')
    ?? ''

  return {
    orderHash,
    marketId,
    subaccountId: readString(raw, 'subaccountId', 'subaccount_id')
      ?? readString(nestedOrder, 'subaccountId', 'subaccount_id'),
    side,
    price: readString(raw, 'price') ?? readString(nestedOrder, 'price') ?? '0',
    quantity: readString(raw, 'quantity') ?? readString(nestedOrder, 'quantity') ?? '0',
    fillable: readString(raw, 'fillable', 'fillableQuantity', 'unfilledQuantity')
      ?? readString(nestedOrder, 'fillable', 'fillableQuantity', 'unfilledQuantity')
      ?? '0',
    createdAt: readString(raw, 'createdAt', 'created_at'),
    updatedAt: readString(raw, 'updatedAt', 'updated_at'),
  }
}

function normalizeOrderStatus(raw: unknown): 'booked' | 'partial' | 'filled' | 'canceled' | 'unknown' {
  const value = String(raw ?? '').toLowerCase()
  if (!value) return 'unknown'
  if (value.includes('cancel')) return 'canceled'
  if (value.includes('partial')) return 'partial'
  if (value.includes('fill')) return 'filled'
  if (value.includes('book') || value.includes('open')) return 'booked'
  return 'unknown'
}

function normalizeOrderState(raw: AnyRecord): TradeLimitOrderState {
  const orderHash = readString(raw, 'orderHash', 'order_hash', 'hash') ?? ''
  const nestedState = (raw['state'] && typeof raw['state'] === 'object')
    ? raw['state'] as AnyRecord
    : {}
  const status = normalizeOrderStatus(
    raw['status']
    ?? raw['state']
    ?? raw['orderStatus']
    ?? raw['order_state']
    ?? nestedState['status']
    ?? nestedState['state']
  )

  return {
    orderHash,
    status,
    filledQuantity: readString(raw, 'filledQuantity', 'filled_quantity'),
    remainingQuantity: readString(raw, 'remainingQuantity', 'remaining_quantity', 'unfilledQuantity'),
    raw,
  }
}

function resolveLimitOrderType(side: 'buy' | 'sell', postOnly = false): number {
  const map = OrderTypeMap as unknown as Record<string, number>
  if (side === 'buy') {
    if (postOnly && typeof map['BUY_PO'] === 'number') return map['BUY_PO']
    return map['BUY'] ?? 1
  }
  if (postOnly && typeof map['SELL_PO'] === 'number') return map['SELL_PO']
  return map['SELL'] ?? 2
}

export const orders = {
  async tradeLimitOpen(config: Config, params: TradeLimitOpenParams): Promise<TradeLimitOpenResult> {
    const market = await markets.resolve(config, params.symbol)
    const subaccountIndex = params.subaccountIndex ?? 0
    const price = parsePositiveDecimal('price', params.price)
    const quantity = parsePositiveDecimal('quantity', params.quantity)
    const margin = parsePositiveDecimal('margin', params.margin)
    const tickSize = new Decimal(market.tickSize)
    const qtyTickSize = new Decimal(market.minQuantityTick)

    const chainPrice = toChainPrice(price, tickSize)
    const chainQuantity = toChainQuantity(quantity, qtyTickSize)
    if (chainQuantity === '0') {
      throw new InvalidOrderParameters(`quantity rounds to zero at min tick ${market.minQuantityTick}`)
    }

    const chainMargin = usdtToBase(margin)
    const privateKeyHex = wallets.unlock(params.address, params.password)
    const subaccountId = toSubaccountId(params.address, subaccountIndex)
    const orderType = resolveLimitOrderType(params.side, params.postOnly ?? false)

    const msgPayload: AnyRecord = {
      marketId: market.marketId,
      subaccountId,
      injectiveAddress: params.address,
      sender: params.address,
      orderType,
      price: chainPrice,
      margin: chainMargin,
      quantity: chainQuantity,
      triggerPrice: '0',
      feeRecipient: params.address,
      isReduceOnly: params.reduceOnly ?? false,
    }

    const msg = MsgCreateDerivativeLimitOrder.fromJSON(msgPayload as never)
    const broadcaster = createBroadcaster(config, privateKeyHex)
    let txHash: string
    try {
      const response = await broadcaster.broadcast({
        msgs: [msg],
        memo: `limit open ${params.side} ${params.symbol}`,
      })
      txHash = response.txHash
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BroadcastFailed(message)
    }

    return {
      txHash,
      symbol: market.symbol,
      marketId: market.marketId,
      subaccountId,
      side: params.side,
      price: params.price,
      quantity: params.quantity,
      margin: params.margin,
      reduceOnly: params.reduceOnly ?? false,
      postOnly: params.postOnly ?? false,
    }
  },

  async tradeLimitOrders(config: Config, params: TradeLimitOrdersParams): Promise<TradeLimitOrder[]> {
    const subaccountId = toSubaccountId(params.address, params.subaccountIndex ?? 0)
    const marketId = params.symbol
      ? (await markets.resolve(config, params.symbol)).marketId
      : undefined
    const client = createClient(config)
    const response = await withRetry(() =>
      client.derivativesApi.fetchSubaccountOrdersList({ subaccountId, marketId })
    )

    const payload = (response && typeof response === 'object') ? (response as unknown as AnyRecord) : {}
    const rawOrders = Array.isArray(response)
      ? response
      : getArrayField(payload, ['orders', 'ordersList', 'derivativeOrders', 'derivativeOrdersList'])

    return rawOrders
      .filter(item => item && typeof item === 'object')
      .map(item => normalizeOpenOrder(item as AnyRecord))
      .filter(order => (marketId ? order.marketId === marketId : true))
  },

  async tradeLimitClose(config: Config, params: TradeLimitCloseParams): Promise<TradeLimitCloseResult> {
    if (!params.orderHash || params.orderHash.trim().length === 0) {
      throw new InvalidOrderParameters('orderHash is required')
    }

    const market = await markets.resolve(config, params.symbol)
    const subaccountId = toSubaccountId(params.address, params.subaccountIndex ?? 0)
    const privateKeyHex = wallets.unlock(params.address, params.password)
    const resolvedOrderHash = params.orderHash

    const msgPayload: AnyRecord = {
      sender: params.address,
      injectiveAddress: params.address,
      marketId: market.marketId,
      subaccountId,
      orderHash: resolvedOrderHash,
    }
    const msg = MsgCancelDerivativeOrder.fromJSON(msgPayload as never)
    const broadcaster = createBroadcaster(config, privateKeyHex)

    let txHash: string
    try {
      const response = await broadcaster.broadcast({
        msgs: [msg],
        memo: `limit close ${params.symbol}`,
      })
      txHash = response.txHash
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BroadcastFailed(message)
    }

    return {
      txHash,
      symbol: market.symbol,
      marketId: market.marketId,
      subaccountId,
      orderHash: resolvedOrderHash,
    }
  },

  async tradeLimitStates(config: Config, params: TradeLimitStatesParams): Promise<TradeLimitOrderState[]> {
    if (!Array.isArray(params.derivativeOrderHashes) || params.derivativeOrderHashes.length === 0) {
      throw new InvalidOrderStatesQuery()
    }

    const client = createClient(config)
    const response = await withRetry(() =>
      client.accountApi.fetchOrderStates({
        derivativeOrderHashes: params.derivativeOrderHashes,
      })
    )

    const payload = (response && typeof response === 'object')
      ? (response as unknown as AnyRecord)
      : {}
    const rawStates = Array.isArray(response)
      ? response
      : getArrayField(payload, ['orderStates', 'states', 'orders', 'derivativeOrderStates'])

    return rawStates
      .filter(item => item && typeof item === 'object')
      .map(item => normalizeOrderState(item as AnyRecord))
  },
}
