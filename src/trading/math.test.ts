import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import {
  quantize,
  walkOrderbook,
  applySlippage,
  calcMargin,
  calcLiquidationPrice,
} from './math.js'

describe('quantize', () => {
  it('rounds down to nearest tick', () => {
    const result = quantize(new Decimal('30123.7'), new Decimal('1'))
    expect(result.toFixed(0)).toBe('30123')
  })

  it('does not change value already on tick', () => {
    const result = quantize(new Decimal('30000'), new Decimal('100'))
    expect(result.toFixed(0)).toBe('30000')
  })

  it('rounds down a fractional quantity', () => {
    const result = quantize(new Decimal('1.234567'), new Decimal('0.001'))
    expect(result.toString()).toBe('1.234')
  })
})

describe('walkOrderbook', () => {
  const levels = [
    { price: new Decimal('30000'), quantity: new Decimal('1') },
    { price: new Decimal('30100'), quantity: new Decimal('2') },
    { price: new Decimal('30200'), quantity: new Decimal('5') },
  ]

  it('returns worst fill price for small notional (fills within first level)', () => {
    const price = walkOrderbook(levels, new Decimal('20000'))
    expect(price.toFixed(0)).toBe('30000')
  })

  it('returns deeper price for large notional', () => {
    const price = walkOrderbook(levels, new Decimal('100000'))
    // 30000*1 + 30100*2 = 90200, remaining → hits third level
    expect(price.toFixed(0)).toBe('30200')
  })

  it('handles empty orderbook', () => {
    const price = walkOrderbook([], new Decimal('10000'))
    expect(price.toFixed(0)).toBe('0')
  })
})

describe('applySlippage', () => {
  it('increases price for buys (long)', () => {
    const result = applySlippage(new Decimal('30000'), new Decimal('0.01'), 'long')
    expect(result.toFixed(2)).toBe('30300.00')
  })

  it('decreases price for sells (short)', () => {
    const result = applySlippage(new Decimal('30000'), new Decimal('0.01'), 'short')
    expect(result.toFixed(2)).toBe('29700.00')
  })
})

describe('calcMargin', () => {
  it('calculates correct margin at 10x leverage', () => {
    const margin = calcMargin(new Decimal('30000'), new Decimal('1'), new Decimal('10'))
    expect(margin.toFixed(0)).toBe('3000')
  })

  it('calculates correct margin at 5x leverage', () => {
    const margin = calcMargin(new Decimal('30000'), new Decimal('2'), new Decimal('5'))
    expect(margin.toFixed(0)).toBe('12000')
  })
})

describe('calcLiquidationPrice', () => {
  it('long liquidation price is below entry', () => {
    const liq = calcLiquidationPrice(
      new Decimal('30000'),
      new Decimal('10'),
      new Decimal('0.05'),
      'long',
    )
    // 30000 * (1 - 0.1 + 0.05) = 30000 * 0.95 = 28500
    expect(liq.toFixed(0)).toBe('28500')
  })

  it('short liquidation price is above entry', () => {
    const liq = calcLiquidationPrice(
      new Decimal('30000'),
      new Decimal('10'),
      new Decimal('0.05'),
      'short',
    )
    // 30000 * (1 + 0.1 + 0.05) = 30000 * 1.15 = 34500
    expect(liq.toFixed(0)).toBe('34500')
  })
})
