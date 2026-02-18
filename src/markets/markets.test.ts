import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { markets } from './index.js'
import { testConfig, mockDerivativeMarketRaw } from '../test-utils/index.js'
import { MarketNotFound, NoPriceAvailable } from '../errors/index.js'

// Mock the client module
vi.mock('../client/index.js', () => ({
  createClient: vi.fn(),
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}))

import { createClient } from '../client/index.js'
const mockedCreateClient = vi.mocked(createClient)

describe('markets.list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear internal cache between tests by using 0 TTL
  })

  it('returns mapped perpetual markets', async () => {
    const rawMarkets = [
      mockDerivativeMarketRaw(),
      mockDerivativeMarketRaw({
        marketId: '0x' + 'b'.repeat(64),
        ticker: 'ETH/USDT PERP',
        oracleBase: 'ETH',
      }),
    ]
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue(rawMarkets),
      },
    } as any)

    const result = await markets.list(testConfig(), 0) // ttl=0 to bypass cache
    expect(result).toHaveLength(2)
    expect(result[0]!.symbol).toBe('BTC')
    expect(result[0]!.marketId).toBe('0x' + 'a'.repeat(64))
    expect(result[0]!.ticker).toBe('BTC/USDT PERP')
    expect(result[0]!.maintenanceMarginRatio).toBe('0.05')
    expect(result[0]!.quoteDecimals).toBe(6)
    expect(result[1]!.symbol).toBe('ETH')
  })

  it('filters out markets without initialMarginRatio', async () => {
    const rawMarkets = [
      mockDerivativeMarketRaw(),
      mockDerivativeMarketRaw({ initialMarginRatio: undefined } as any),
    ]
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue(rawMarkets),
      },
    } as any)

    const result = await markets.list(testConfig(), 0)
    expect(result).toHaveLength(1)
    expect(result[0]!.symbol).toBe('BTC')
  })

  it('filters out markets without maintenanceMarginRatio', async () => {
    const rawMarkets = [
      mockDerivativeMarketRaw({ maintenanceMarginRatio: undefined } as any),
    ]
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue(rawMarkets),
      },
    } as any)

    const result = await markets.list(testConfig(), 0)
    expect(result).toHaveLength(0)
  })

  it('extracts symbol from ticker correctly', async () => {
    const rawMarkets = [
      mockDerivativeMarketRaw({ ticker: 'SOL/USDT PERP' }),
    ]
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue(rawMarkets),
      },
    } as any)

    const result = await markets.list(testConfig(), 0)
    expect(result[0]!.symbol).toBe('SOL')
  })

  it('uses fallback oracle values when fields are missing', async () => {
    const rawMarkets = [
      mockDerivativeMarketRaw({
        oracleBase: undefined,
        oracleQuote: undefined,
        oracleType: undefined,
      } as any),
    ]
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue(rawMarkets),
      },
    } as any)

    const result = await markets.list(testConfig(), 0)
    expect(result[0]!.oracleBase).toBe('BTC') // extracted from ticker
    expect(result[0]!.oracleQuote).toBe('USDT') // default
    expect(result[0]!.oracleType).toBe('bandibc') // default
  })

  it('caches results within TTL', async () => {
    const fetchMarkets = vi.fn().mockResolvedValue([mockDerivativeMarketRaw()])
    mockedCreateClient.mockReturnValue({
      derivativesApi: { fetchMarkets },
    } as any)

    // Use a long TTL to verify caching
    await markets.list(testConfig(), 60000)
    await markets.list(testConfig(), 60000)

    // Only called once due to caching
    expect(fetchMarkets).toHaveBeenCalledTimes(1)
  })

  it('handles empty market list', async () => {
    // Use a different config to avoid cache hits from previous tests
    const freshConfig = { ...testConfig(), network: 'mainnet' as const }
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue([]),
      },
    } as any)

    const result = await markets.list(freshConfig, 0)
    expect(result).toEqual([])
  })
})

describe('markets.resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves market by symbol (case-insensitive)', async () => {
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue([mockDerivativeMarketRaw()]),
      },
    } as any)

    const result = await markets.resolve(testConfig(), 'btc')
    expect(result.symbol).toBe('BTC')
    expect(result.marketId).toBe('0x' + 'a'.repeat(64))
  })

  it('resolves with uppercase symbol', async () => {
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue([mockDerivativeMarketRaw()]),
      },
    } as any)

    const result = await markets.resolve(testConfig(), 'BTC')
    expect(result.symbol).toBe('BTC')
  })

  it('throws MarketNotFound for unknown symbol', async () => {
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue([mockDerivativeMarketRaw()]),
      },
    } as any)

    await expect(markets.resolve(testConfig(), 'DOGE')).rejects.toThrow(MarketNotFound)
  })
})

describe('markets.getPrice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns oracle price as Decimal', async () => {
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue([mockDerivativeMarketRaw()]),
      },
      oracleApi: {
        fetchOraclePriceNoThrow: vi.fn().mockResolvedValue({ price: '65432.50' }),
      },
    } as any)

    const price = await markets.getPrice(testConfig(), '0x' + 'a'.repeat(64))
    expect(price).toBeInstanceOf(Decimal)
    expect(price.toFixed(2)).toBe('65432.50')
  })

  it('throws NoPriceAvailable when price is empty', async () => {
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue([mockDerivativeMarketRaw()]),
      },
      oracleApi: {
        fetchOraclePriceNoThrow: vi.fn().mockResolvedValue({ price: '' }),
      },
    } as any)

    await expect(
      markets.getPrice(testConfig(), '0x' + 'a'.repeat(64))
    ).rejects.toThrow(NoPriceAvailable)
  })

  it('throws NoPriceAvailable when price is "0"', async () => {
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue([mockDerivativeMarketRaw()]),
      },
      oracleApi: {
        fetchOraclePriceNoThrow: vi.fn().mockResolvedValue({ price: '0' }),
      },
    } as any)

    await expect(
      markets.getPrice(testConfig(), '0x' + 'a'.repeat(64))
    ).rejects.toThrow(NoPriceAvailable)
  })

  it('throws MarketNotFound for unknown market ID', async () => {
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchMarkets: vi.fn().mockResolvedValue([mockDerivativeMarketRaw()]),
      },
    } as any)

    await expect(
      markets.getPrice(testConfig(), '0x' + 'f'.repeat(64))
    ).rejects.toThrow(MarketNotFound)
  })
})
