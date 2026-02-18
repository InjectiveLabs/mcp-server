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
      .map(m => {
        const perp = m as typeof m & {
          initialMarginRatio: string
          maintenanceMarginRatio: string
          oracleBase?: string
          oracleQuote?: string
          oracleType?: string
        }
        return {
          symbol: extractSymbol(perp.ticker),
          marketId: perp.marketId,
          ticker: perp.ticker,
          tickSize: String(perp.minPriceTickSize),
          minQuantityTick: String(perp.minQuantityTickSize),
          minNotional: String(perp.minNotional),
          initialMarginRatio: perp.initialMarginRatio,
          maintenanceMarginRatio: perp.maintenanceMarginRatio,
          takerFeeRate: perp.takerFeeRate,
          quoteDecimals: 6, // USDT on Injective uses 6 decimals
          oracleBase: perp.oracleBase ?? extractSymbol(perp.ticker),
          oracleQuote: perp.oracleQuote ?? 'USDT',
          oracleType: perp.oracleType ?? 'bandibc',
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
