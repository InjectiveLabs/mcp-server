/**
 * Trading module — open and close perpetual positions via market orders.
 *
 * Security: Private keys are decrypted, used to sign, then discarded.
 * The LLM/agent never sees the private key — only txHash is returned.
 */
import Decimal from 'decimal.js'
import { MsgCreateDerivativeMarketOrder, OrderTypeMap, PrivateKey } from '@injectivelabs/sdk-ts'
import { Config } from '../config/index.js'
import { wallets } from '../wallets/index.js'
import { markets } from '../markets/index.js'
import { accounts } from '../accounts/index.js'
import { createClient, createBroadcaster, withRetry } from '../client/index.js'
import { BroadcastFailed, NoLiquidity, NoPositionFound, QuantityTooSmall } from '../errors/index.js'
import {
  walkOrderbook,
  applySlippage,
  calcMargin,
  calcLiquidationPrice,
  quantize,
} from './math.js'

export interface OpenParams {
  address: string
  password: string
  symbol: string
  side: 'long' | 'short'
  /** Notional amount in USDT */
  amount: number | string
  leverage?: number
  /** Slippage tolerance as a fraction (e.g. 0.01 = 1%) */
  slippage?: number
}

export interface OpenResult {
  txHash: string
  executionPrice: string
  quantity: string
  margin: string
  liquidationPrice: string
}

export interface CloseParams {
  address: string
  password: string
  symbol: string
  /** Slippage tolerance for close orders (default 5%) */
  slippage?: number
}

export interface CloseResult {
  txHash: string
  closedQty: string
  exitPrice: string
  realizedPnl: string
}

const DEFAULT_LEVERAGE = 10
const DEFAULT_OPEN_SLIPPAGE = 0.01
const DEFAULT_CLOSE_SLIPPAGE = 0.05
const USDT_DECIMALS = 6

const QUOTE_SCALE = new Decimal(10).pow(USDT_DECIMALS)

/** Convert an orderbook price from chain units to human-readable units. */
function fromChainPrice(chainPrice: Decimal): Decimal {
  return chainPrice.div(QUOTE_SCALE)
}

/** Scale a human price to chain units using the market's tick size.
 *  The tick size from the API is already in chain units (e.g. 1000 = 0.001 USDT).
 *  We must first scale the human price to chain units (× 10^quoteDecimals),
 *  then quantize to the tick size.
 */
function toChainPrice(humanPrice: Decimal, tickSize: Decimal): string {
  const chainPrice = humanPrice.mul(QUOTE_SCALE)
  const quantized = quantize(chainPrice, tickSize)
  return quantized.toFixed(0, Decimal.ROUND_DOWN)
}

/** Scale a human quantity to chain units using the market's quantity tick size. */
function toChainQuantity(humanQty: Decimal, tickSize: Decimal): string {
  const quantized = quantize(humanQty, tickSize)
  return quantized.toFixed(18).replace(/\.?0+$/, '') || '0'
}

/** Convert USDT amount string to base units (×10^6). */
function usdtToBase(amount: Decimal): string {
  return amount.mul(new Decimal(10).pow(USDT_DECIMALS)).toFixed(0, Decimal.ROUND_DOWN)
}

export const trading = {
  async open(config: Config, params: OpenParams): Promise<OpenResult> {
    const {
      address,
      password,
      symbol,
      side,
      leverage = DEFAULT_LEVERAGE,
      slippage = DEFAULT_OPEN_SLIPPAGE,
    } = params
    const notional = new Decimal(params.amount)
    const leverageDec = new Decimal(leverage)
    const slippageDec = new Decimal(slippage)

    // 1. Decrypt key (discarded after broadcaster is built)
    const privateKeyHex = wallets.unlock(address, password)

    // 2. Resolve market
    const market = await markets.resolve(config, symbol)

    // 3. Fetch oracle price
    const oraclePrice = await markets.getPrice(config, market.marketId)

    // 4. Fetch orderbook and walk it to find worst fill price
    const client = createClient(config)
    const orderbook = await withRetry(() =>
      client.derivativesApi.fetchOrderbookV2(market.marketId)
    )

    const isBuy = side === 'long'
    const levels = isBuy
      ? (orderbook.sells ?? [])
      : (orderbook.buys ?? [])

    if (levels.length === 0) {
      throw new NoLiquidity(market.marketId)
    }

    // Orderbook prices are in chain units — convert to human-readable
    const orderbookLevels = levels.map(l => ({
      price: fromChainPrice(new Decimal(l.price)),
      quantity: new Decimal(l.quantity),
    }))

    const worstFillPrice = walkOrderbook(orderbookLevels, notional)
    const executionPrice = worstFillPrice.eq(0) ? oraclePrice : worstFillPrice

    // 5. Apply slippage buffer
    const priceWithSlippage = applySlippage(executionPrice, slippageDec, side)

    // 6. Quantize price and quantity to tick sizes
    const tickSize = new Decimal(market.tickSize)
    const qtyTickSize = new Decimal(market.minQuantityTick)

    const chainPrice = toChainPrice(priceWithSlippage, tickSize)

    // Quantity = notional / price
    const humanQty = notional.div(executionPrice)
    const chainQty = toChainQuantity(humanQty, qtyTickSize)

    if (chainQty === '0') {
      throw new QuantityTooSmall(market.minQuantityTick)
    }

    // 7. Calculate margin in USDT base units
    // Must use slippage-adjusted price (the price field sent to the chain),
    // otherwise chain validation rejects the order (price × qty / leverage > margin).
    const marginHuman = calcMargin(priceWithSlippage, humanQty, leverageDec)
    const chainMargin = usdtToBase(marginHuman)

    // 8. Derive subaccount ID
    const pk = PrivateKey.fromHex(privateKeyHex)
    const subaccountId = pk.toAddress().getSubaccountId(0)

    // 9. Build market order message
    const msg = MsgCreateDerivativeMarketOrder.fromJSON({
      marketId: market.marketId,
      subaccountId,
      injectiveAddress: address,
      orderType: isBuy ? OrderTypeMap.BUY : OrderTypeMap.SELL,
      price: chainPrice,
      margin: chainMargin,
      quantity: chainQty,
      feeRecipient: address,
    })

    // 10. Simulate and broadcast
    const broadcaster = createBroadcaster(config, privateKeyHex)
    let txHash: string
    try {
      const response = await broadcaster.broadcast({ msgs: [msg], memo: `open ${side} ${symbol}` })
      txHash = response.txHash
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BroadcastFailed(message)
    }

    // 11. Calculate liquidation price
    const maintenanceMarginRatio = new Decimal(market.maintenanceMarginRatio)
    const liqPrice = calcLiquidationPrice(executionPrice, leverageDec, maintenanceMarginRatio, side)

    return {
      txHash,
      executionPrice: executionPrice.toFixed(6),
      quantity: humanQty.toFixed(6),
      margin: marginHuman.toFixed(6),
      liquidationPrice: liqPrice.toFixed(6),
    }
  },

  async close(config: Config, params: CloseParams): Promise<CloseResult> {
    const {
      address,
      password,
      symbol,
      slippage = DEFAULT_CLOSE_SLIPPAGE,
    } = params
    const slippageDec = new Decimal(slippage)

    // 1. Decrypt key
    const privateKeyHex = wallets.unlock(address, password)

    // 2. Find open position
    const openPositions = await accounts.getPositions(config, address)
    const position = openPositions.find(
      p => p.symbol.toUpperCase() === symbol.toUpperCase()
    )
    if (!position) throw new NoPositionFound(symbol)

    // 3. Resolve market for tick sizes
    const market = await markets.resolve(config, symbol)

    // 4. Build reduce-only order (opposite side)
    const isClosingLong = position.side === 'long'
    const closeSide: 'long' | 'short' = isClosingLong ? 'short' : 'long'

    // Get orderbook for worst fill
    const client = createClient(config)
    const orderbook = await withRetry(() =>
      client.derivativesApi.fetchOrderbookV2(market.marketId)
    )

    // When closing a long, we sell — look at bids. When closing a short, we buy — look at asks.
    const levels = isClosingLong
      ? (orderbook.buys ?? [])
      : (orderbook.sells ?? [])

    if (levels.length === 0) throw new NoLiquidity(market.marketId)

    // Orderbook prices are in chain units — convert to human-readable
    const orderbookLevels = levels.map(l => ({
      price: fromChainPrice(new Decimal(l.price)),
      quantity: new Decimal(l.quantity),
    }))

    const positionQty = new Decimal(position.quantity)
    const positionNotional = positionQty.mul(new Decimal(position.markPrice))
    const worstFillPrice = walkOrderbook(orderbookLevels, positionNotional)
    const exitPrice = worstFillPrice.eq(0)
      ? new Decimal(position.markPrice)
      : worstFillPrice

    const exitPriceWithSlippage = applySlippage(exitPrice, slippageDec, closeSide)

    const tickSize = new Decimal(market.tickSize)
    const qtyTickSize = new Decimal(market.minQuantityTick)

    const chainPrice = toChainPrice(exitPriceWithSlippage, tickSize)
    const chainQty = toChainQuantity(positionQty, qtyTickSize)

    if (chainQty === '0') throw new QuantityTooSmall(market.minQuantityTick)

    // Reduce-only close order — no new margin posted
    const chainMargin = '0'

    const subaccountId = position.subaccountId

    const msg = MsgCreateDerivativeMarketOrder.fromJSON({
      marketId: market.marketId,
      subaccountId,
      injectiveAddress: address,
      orderType: isClosingLong ? OrderTypeMap.SELL : OrderTypeMap.BUY,
      price: chainPrice,
      margin: chainMargin,
      quantity: chainQty,
      feeRecipient: address,
    })

    const broadcaster = createBroadcaster(config, privateKeyHex)
    let txHash: string
    try {
      const response = await broadcaster.broadcast({ msgs: [msg], memo: `close ${symbol}` })
      txHash = response.txHash
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new BroadcastFailed(message)
    }

    // Estimated realized PnL — uses the slippage-adjusted submission price, not the
    // actual on-chain fill price. The real P&L may differ due to price improvement
    // or partial fills. Query the chain for the exact fill for reconciliation.
    const entryPrice = new Decimal(position.entryPrice)
    const direction = position.side === 'long' ? 1 : -1
    const realizedPnl = exitPriceWithSlippage.minus(entryPrice).mul(positionQty).mul(direction)

    return {
      txHash,
      closedQty: positionQty.toFixed(6),
      exitPrice: exitPriceWithSlippage.toFixed(6),
      realizedPnl: realizedPnl.toFixed(6),
    }
  },
}
