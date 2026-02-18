import { describe, it, expect } from 'vitest'
import {
  WalletNotFound,
  WrongPassword,
  MarketNotFound,
  NoPriceAvailable,
  NoLiquidity,
  QuantityTooSmall,
  NoPositionFound,
  InsufficientBalance,
  BroadcastFailed,
} from './index.js'

describe('error classes', () => {
  it('WalletNotFound has correct code and message', () => {
    const err = new WalletNotFound('inj1abc')
    expect(err.code).toBe('WALLET_NOT_FOUND')
    expect(err.name).toBe('WalletNotFound')
    expect(err.message).toContain('inj1abc')
    expect(err).toBeInstanceOf(Error)
  })

  it('WrongPassword has correct code', () => {
    const err = new WrongPassword()
    expect(err.code).toBe('WRONG_PASSWORD')
    expect(err.name).toBe('WrongPassword')
    expect(err.message).toContain('decryption')
  })

  it('MarketNotFound includes symbol', () => {
    const err = new MarketNotFound('DOGE')
    expect(err.code).toBe('MARKET_NOT_FOUND')
    expect(err.message).toContain('DOGE')
  })

  it('NoPriceAvailable includes marketId', () => {
    const err = new NoPriceAvailable('0xabc')
    expect(err.code).toBe('NO_PRICE_AVAILABLE')
    expect(err.message).toContain('0xabc')
  })

  it('NoLiquidity includes marketId', () => {
    const err = new NoLiquidity('0xdef')
    expect(err.code).toBe('NO_LIQUIDITY')
    expect(err.message).toContain('0xdef')
  })

  it('QuantityTooSmall includes min tick', () => {
    const err = new QuantityTooSmall('0.001')
    expect(err.code).toBe('QUANTITY_TOO_SMALL')
    expect(err.message).toContain('0.001')
  })

  it('NoPositionFound includes symbol', () => {
    const err = new NoPositionFound('BTC')
    expect(err.code).toBe('NO_POSITION_FOUND')
    expect(err.message).toContain('BTC')
  })

  it('InsufficientBalance includes amounts', () => {
    const err = new InsufficientBalance('100', '50')
    expect(err.code).toBe('INSUFFICIENT_BALANCE')
    expect(err.message).toContain('100')
    expect(err.message).toContain('50')
  })

  it('BroadcastFailed includes reason', () => {
    const err = new BroadcastFailed('out of gas')
    expect(err.code).toBe('BROADCAST_FAILED')
    expect(err.message).toContain('out of gas')
  })

  it('all errors are instanceof Error', () => {
    const errors = [
      new WalletNotFound('x'),
      new WrongPassword(),
      new MarketNotFound('x'),
      new NoPriceAvailable('x'),
      new NoLiquidity('x'),
      new QuantityTooSmall('x'),
      new NoPositionFound('x'),
      new InsufficientBalance('1', '0'),
      new BroadcastFailed('x'),
    ]
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error)
      expect(err.code).toBeTruthy()
      expect(err.name).toBeTruthy()
      expect(err.message).toBeTruthy()
    }
  })
})
