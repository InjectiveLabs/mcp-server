/**
 * Financial math helpers for perpetual futures.
 * All arithmetic uses Decimal.js — zero native JS float involvement.
 */
import Decimal from 'decimal.js'

/**
 * Quantize a value down to the nearest multiple of tickSize.
 * We round to the tick size's decimal places after multiplication to avoid
 * floating-point artifacts (e.g. 0.1 + 0.2 ≠ 0.3 in binary floating-point).
 */
export function quantize(value: Decimal, tickSize: Decimal): Decimal {
  const tickDecimals = Math.max(0, -tickSize.e)
  return value.div(tickSize).floor().mul(tickSize).toDecimalPlaces(tickDecimals, Decimal.ROUND_DOWN)
}

/**
 * Walk the orderbook to find the worst fill price for a given notional amount.
 * Returns the price at which the order would fully fill.
 *
 * @param levels - Array of [price, quantity] pairs sorted best-to-worst
 * @param notional - Total notional to fill in quote units
 */
/**
 * Returns 0 if the orderbook has insufficient depth to fill the full notional.
 * Callers should fall back to oracle price when 0 is returned.
 */
export function walkOrderbook(
  levels: Array<{ price: Decimal; quantity: Decimal }>,
  notional: Decimal,
): Decimal {
  let remaining = notional
  let worstPrice = new Decimal(0)

  for (const level of levels) {
    if (remaining.lte(0)) break
    const levelNotional = level.price.mul(level.quantity)
    remaining = remaining.minus(Decimal.min(levelNotional, remaining))
    worstPrice = level.price
  }

  // Orderbook exhausted without filling full notional — signal to caller
  if (remaining.gt(0)) return new Decimal(0)

  return worstPrice
}

/**
 * Apply slippage to a price:
 * - For buys: price * (1 + slippage)
 * - For sells: price * (1 - slippage)
 */
export function applySlippage(price: Decimal, slippage: Decimal, side: 'long' | 'short'): Decimal {
  if (side === 'long') {
    return price.mul(new Decimal(1).plus(slippage))
  }
  return price.mul(new Decimal(1).minus(slippage))
}

/**
 * Calculate required margin for a position.
 * margin = (price × quantity) / leverage
 */
export function calcMargin(price: Decimal, quantity: Decimal, leverage: Decimal): Decimal {
  return price.mul(quantity).div(leverage)
}

/**
 * Calculate estimated liquidation price (isolated margin).
 *
 * For longs:
 *   liqPrice = entryPrice × (1 - 1/leverage + maintenanceMarginRatio)
 *   (price must fall by ~1/leverage before position is liquidated)
 *
 * For shorts:
 *   liqPrice = entryPrice × (1 + 1/leverage + maintenanceMarginRatio)
 *   (price must rise by ~1/leverage before position is liquidated)
 *
 * Note: maintenanceMarginRatio is ADDED on both sides because it represents
 * the buffer below which equity triggers liquidation — it widens the gap to
 * liquidation in both directions.
 */
export function calcLiquidationPrice(
  entryPrice: Decimal,
  leverage: Decimal,
  maintenanceMarginRatio: Decimal,
  side: 'long' | 'short',
): Decimal {
  const leverageFraction = new Decimal(1).div(leverage)
  if (side === 'long') {
    return entryPrice.mul(new Decimal(1).minus(leverageFraction).plus(maintenanceMarginRatio))
  }
  return entryPrice.mul(new Decimal(1).plus(leverageFraction).plus(maintenanceMarginRatio))
}

/**
 * Convert a human-readable price (e.g. "30000.50") to the chain's integer
 * representation by scaling by 10^quoteDecimals / tickSize scale.
 *
 * On Injective, derivative market prices are stored as:
 *   price_in_chain = human_price × 10^(quoteDecimals - priceDecimals)
 *
 * minPriceTickSize from the API is already in chain units (e.g. "1000").
 * We quantize to that tick size and return the chain-unit string.
 */
export function priceToChainFormat(humanPrice: Decimal, minPriceTickSize: Decimal): string {
  return quantize(humanPrice, minPriceTickSize).toFixed(0)
}

/**
 * Convert a human-readable quantity to chain format and quantize to tick size.
 */
export function quantityToChainFormat(humanQuantity: Decimal, minQuantityTickSize: Decimal): string {
  return quantize(humanQuantity, minQuantityTickSize).toFixed(18).replace(/\.?0+$/, '')
}
