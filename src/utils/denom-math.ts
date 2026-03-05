/**
 * Shared denom math utilities for converting between human-readable
 * amounts and chain base units.
 */
import Decimal from 'decimal.js'

/**
 * Convert a human-readable amount to chain base units.
 * e.g. "1.5" with 18 decimals → "1500000000000000000"
 */
export function toBaseUnits(humanAmount: Decimal, decimals: number): string {
  return humanAmount.mul(new Decimal(10).pow(decimals)).toFixed(0, Decimal.ROUND_DOWN)
}
