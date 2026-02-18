import Decimal from 'decimal.js'
import { Config } from '../config/index.js'
import { createClient, withRetry } from '../client/index.js'
import { MarketNotFound, NoPriceAvailable } from '../errors/index.js'

export interface PerpMarket {
  symbol: string              // "BTC"
  marketId: string            // hex
  ticker: string              // "BTC/USDT PERP"
  tickSize: string            // human-readable min price increment
  minQuantityTick: string     // min quantity increment
  minNotional: string
  initialMarginRatio: string
  maintenanceMarginRatio: string
  takerFeeRate: string
  quoteDecimals: number
  oracleBase: string
  oracleQuote: string
  oracleType: string
}

const CACHE_DEFAULT_TTL_MS = 60_000 // 60 seconds

interface Cache {
  markets: PerpMarket[]
  expiresAt: number
}

const caches = new Map<string, Cache>()

function getCacheKey(config: Config): string {
  return config.network
}

function extractSymbol(ticker: string): string {
  // "BTC/USDT PERP" -> "BTC"
  return ticker.split('/')[0]?.trim() ?? ticker
}

export const markets = {
  async list(config: Config, ttlMs = CACHE_DEFAULT_TTL_MS): Promise<PerpMarket[]> {
    const key = getCacheKey(config)
    const cached = caches.get(key)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.markets
    }

    const client = createClient(config)
    const rawMarkets = await withRetry(() =>
      client.derivativesApi.fetchMarkets({ marketStatus: 'active' })
    )

    // Filter to perpetual markets only (have initialMarginRatio)
    const perpMarkets: PerpMarket[] = rawMarkets
      .filter(m => 'initialMarginRatio' in m && m.initialMarginRatio)
      .filter(m => {
        // Runtime checks: skip markets missing required fields
        const hasMMR = 'maintenanceMarginRatio' in m && typeof m.maintenanceMarginRatio === 'string'
        if (!hasMMR) return false
        return true
      })
      .map(m => {
        const raw = m as unknown as Record<string, unknown>
        const mmr = raw.maintenanceMarginRatio as string
        const imr = raw.initialMarginRatio as string
        const oBase = typeof raw.oracleBase === 'string' ? raw.oracleBase : extractSymbol(m.ticker)
        const oQuote = typeof raw.oracleQuote === 'string' ? raw.oracleQuote : 'USDT'
        const oType = typeof raw.oracleType === 'string' ? raw.oracleType : 'bandibc'

        return {
          symbol: extractSymbol(m.ticker),
          marketId: m.marketId,
          ticker: m.ticker,
          tickSize: String(m.minPriceTickSize),
          minQuantityTick: String(m.minQuantityTickSize),
          minNotional: String(m.minNotional),
          initialMarginRatio: imr,
          maintenanceMarginRatio: mmr,
          takerFeeRate: m.takerFeeRate,
          quoteDecimals: 6, // USDT on Injective uses 6 decimals
          oracleBase: oBase,
          oracleQuote: oQuote,
          oracleType: oType,
        }
      })

    caches.set(key, { markets: perpMarkets, expiresAt: Date.now() + ttlMs })
    return perpMarkets
  },

  async resolve(config: Config, symbol: string): Promise<PerpMarket> {
    const all = await markets.list(config)
    const upper = symbol.toUpperCase()
    const found = all.find(m => m.symbol.toUpperCase() === upper)
    if (!found) throw new MarketNotFound(symbol)
    return found
  },

  async getPrice(config: Config, marketId: string): Promise<Decimal> {
    // Find the market to get oracle parameters
    const all = await markets.list(config)
    const market = all.find(m => m.marketId === marketId)
    if (!market) throw new MarketNotFound(marketId)

    const client = createClient(config)
    const result = await withRetry(() =>
      client.oracleApi.fetchOraclePriceNoThrow({
        baseSymbol: market.oracleBase,
        quoteSymbol: market.oracleQuote,
        oracleType: market.oracleType,
      })
    )

    if (!result.price || result.price === '0') {
      throw new NoPriceAvailable(marketId)
    }

    return new Decimal(result.price)
  },
}
