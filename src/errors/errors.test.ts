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
  InvalidTransferAmount,
  SelfTransferBlocked,
  UnknownDecimals,
  InvalidBridgeDenom,
  EvmTxFailed,
  DeBridgeApiError,
  UnsupportedBridgeChain,
  InvalidOrderStatesQuery,
  InvalidOrderParameters,
  IdentityNotFound,
  IdentityTxFailed,
  DeregisterNotConfirmed,
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

  it('InvalidTransferAmount includes reason', () => {
    const err = new InvalidTransferAmount('negative value')
    expect(err.code).toBe('INVALID_TRANSFER_AMOUNT')
    expect(err.name).toBe('InvalidTransferAmount')
    expect(err.message).toContain('negative value')
  })

  it('SelfTransferBlocked has correct message', () => {
    const err = new SelfTransferBlocked()
    expect(err.code).toBe('SELF_TRANSFER_BLOCKED')
    expect(err.name).toBe('SelfTransferBlocked')
    expect(err.message).toContain('yourself')
  })

  it('UnknownDecimals includes denom', () => {
    const err = new UnknownDecimals('factory/xyz/token')
    expect(err.code).toBe('UNKNOWN_DECIMALS')
    expect(err.name).toBe('UnknownDecimals')
    expect(err.message).toContain('factory/xyz/token')
  })

  it('InvalidBridgeDenom includes denom', () => {
    const err = new InvalidBridgeDenom('ibc/ABC')
    expect(err.code).toBe('INVALID_BRIDGE_DENOM')
    expect(err.name).toBe('InvalidBridgeDenom')
    expect(err.message).toContain('ibc/ABC')
  })

  it('EvmTxFailed includes reason', () => {
    const err = new EvmTxFailed('execution reverted')
    expect(err.code).toBe('EVM_TX_FAILED')
    expect(err.name).toBe('EvmTxFailed')
    expect(err.message).toContain('execution reverted')
  })

  it('DeBridgeApiError includes reason', () => {
    const err = new DeBridgeApiError('503 service unavailable')
    expect(err.code).toBe('DEBRIDGE_API_ERROR')
    expect(err.name).toBe('DeBridgeApiError')
    expect(err.message).toContain('503')
  })

  it('UnsupportedBridgeChain includes chain', () => {
    const err = new UnsupportedBridgeChain('moonbeam')
    expect(err.code).toBe('UNSUPPORTED_BRIDGE_CHAIN')
    expect(err.name).toBe('UnsupportedBridgeChain')
    expect(err.message).toContain('moonbeam')
  })

  it('InvalidOrderStatesQuery has correct code', () => {
    const err = new InvalidOrderStatesQuery()
    expect(err.code).toBe('INVALID_ORDER_STATES_QUERY')
    expect(err.name).toBe('InvalidOrderStatesQuery')
    expect(err.message).toContain('non-empty')
  })

  it('InvalidOrderParameters includes reason', () => {
    const err = new InvalidOrderParameters('price must be > 0')
    expect(err.code).toBe('INVALID_ORDER_PARAMETERS')
    expect(err.name).toBe('InvalidOrderParameters')
    expect(err.message).toContain('price must be > 0')
  })

  it('IdentityNotFound includes agentId', () => {
    const err = new IdentityNotFound('42')
    expect(err.code).toBe('IDENTITY_NOT_FOUND')
    expect(err.name).toBe('IdentityNotFound')
    expect(err.message).toContain('42')
  })

  it('IdentityTxFailed includes reason', () => {
    const err = new IdentityTxFailed('gas estimation failed')
    expect(err.code).toBe('IDENTITY_TX_FAILED')
    expect(err.name).toBe('IdentityTxFailed')
    expect(err.message).toContain('gas estimation failed')
  })

  it('DeregisterNotConfirmed has correct message', () => {
    const err = new DeregisterNotConfirmed()
    expect(err.code).toBe('DEREGISTER_NOT_CONFIRMED')
    expect(err.name).toBe('DeregisterNotConfirmed')
    expect(err.message).toContain('confirm=true')
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
      new InvalidTransferAmount('x'),
      new SelfTransferBlocked(),
      new UnknownDecimals('x'),
      new InvalidBridgeDenom('x'),
      new EvmTxFailed('x'),
      new DeBridgeApiError('x'),
      new UnsupportedBridgeChain('x'),
      new InvalidOrderStatesQuery(),
      new InvalidOrderParameters('x'),
      new IdentityNotFound('x'),
      new IdentityTxFailed('x'),
      new DeregisterNotConfirmed(),
    ]
    for (const err of errors) {
      expect(err).toBeInstanceOf(Error)
      expect(err.code).toBeTruthy()
      expect(err.name).toBeTruthy()
      expect(err.message).toBeTruthy()
    }
  })
})
