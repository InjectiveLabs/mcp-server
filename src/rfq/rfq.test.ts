import { describe, expect, it } from 'vitest'
import { mockMarket, testConfig } from '../test-utils/index.js'
import { getRfqConstants, summarizeMarketReadiness } from './index.js'

const mainnetConfig = testConfig('mainnet')
const nativeUsdcDenom = 'erc20:0xa00c59ff5a080d2b954d0c75e46e22a0c371235a'

describe('rfq constants', () => {
  it('returns canonical mainnet RFQ constants', () => {
    const constants = getRfqConstants(mainnetConfig)

    expect(constants.contractAddress).toBe('inj12stwq95jet57edcu4a65r48r46s9rzrs938n8k')
    expect(constants.chainId).toBe('injective-1')
    expect(constants.evmChainId).toBe(1776)
    expect(constants.collectQuotesMs).toBe(500)
    expect(constants.takerStreamUrl).toContain('/TakerStream')
  })

  it('returns configured testnet RFQ constants', () => {
    const constants = getRfqConstants(testConfig('testnet'))

    expect(constants.contractAddress).toBe('inj1vtswdey9c70n475q7q75wgmkfdw8xw4rcfeqa4')
    expect(constants.chainId).toBe('injective-888')
    expect(constants.evmChainId).toBe(1439)
  })
})

describe('rfq market readiness', () => {
  it('marks markets with the requested quote denom as eligible', () => {
    const constants = getRfqConstants(mainnetConfig)
    const readiness = summarizeMarketReadiness(constants, [
      mockMarket({
        symbol: 'BTC',
        ticker: 'BTC/USDC PERP',
        quoteDenom: nativeUsdcDenom,
      }),
      mockMarket({
        symbol: 'ETH',
        ticker: 'ETH/USDT PERP',
        quoteDenom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
      }),
    ], {
      quoteDenom: nativeUsdcDenom,
      symbol: '',
    })

    expect(readiness.counts).toEqual({ total: 2, eligible: 1, ineligible: 1 })
    expect(readiness.markets[0]!.symbol).toBe('BTC')
    expect(readiness.markets[0]!.rfqEligible).toBe(true)
    expect(readiness.markets[1]!.rfqEligible).toBe(false)
  })

  it('falls back to ticker matching when quote denom is unavailable', () => {
    const readiness = summarizeMarketReadiness(getRfqConstants(mainnetConfig), [
      mockMarket({
        symbol: 'SOL',
        ticker: 'SOL/USDC PERP',
        quoteDenom: '',
      }),
    ], {
      quoteDenom: nativeUsdcDenom,
      symbol: '',
    })

    expect(readiness.counts.eligible).toBe(1)
    expect(readiness.markets[0]!.tickerMatchesQuote).toBe(true)
  })

  it('does not use ticker fallback when quote denom is present but mismatched', () => {
    const readiness = summarizeMarketReadiness(getRfqConstants(mainnetConfig), [
      mockMarket({
        symbol: 'SOL',
        ticker: 'SOL/USDC PERP',
        quoteDenom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
      }),
    ], {
      quoteDenom: nativeUsdcDenom,
      symbol: '',
    })

    expect(readiness.counts.eligible).toBe(0)
    expect(readiness.markets[0]!.quoteDenomMatches).toBe(false)
    expect(readiness.markets[0]!.tickerMatchesQuote).toBe(false)
    expect(readiness.markets[0]!.rfqEligible).toBe(false)
  })

  it('filters by symbol when requested', () => {
    const readiness = summarizeMarketReadiness(getRfqConstants(mainnetConfig), [
      mockMarket({ symbol: 'BTC', ticker: 'BTC/USDC PERP', quoteDenom: nativeUsdcDenom }),
      mockMarket({ symbol: 'ETH', ticker: 'ETH/USDC PERP', quoteDenom: nativeUsdcDenom }),
    ], {
      quoteDenom: nativeUsdcDenom,
      symbol: 'ETH',
    })

    expect(readiness.markets).toHaveLength(1)
    expect(readiness.markets[0]!.symbol).toBe('ETH')
  })
})
