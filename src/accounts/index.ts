import Decimal from 'decimal.js'
import { Config } from '../config/index.js'
import { createClient, withRetry } from '../client/index.js'
import { markets } from '../markets/index.js'
import type { InjectiveClient } from '../client/index.js'

// ─── Token type classification ──────────────────────────────────────────────

export type TokenType = 'native' | 'peggy' | 'ibc' | 'factory' | 'erc20' | 'unknown'

export interface BankBalance {
  denom: string
  symbol: string
  amount: string           // human-readable if decimals known, raw string if not
  decimals: number | null  // null when denom is unknown — amount is unscaled
  tokenType: TokenType     // derived from denom prefix
}

export interface SubaccountBalance {
  subaccountId: string
  denom: string
  symbol: string
  total: string
  available: string
  decimals: number | null  // null when denom is unknown — amounts are unscaled
  tokenType: TokenType     // derived from denom prefix
}

export interface Position {
  symbol: string
  marketId: string
  subaccountId: string
  side: 'long' | 'short'
  quantity: string
  entryPrice: string
  markPrice: string
  margin: string
  pnl: string  // unrealized
}

export interface Balances {
  bank: BankBalance[]
  subaccount: SubaccountBalance[]
}

// ─── Denom metadata resolution ──────────────────────────────────────────────

export interface DenomMeta {
  symbol: string
  decimals: number | null
  tokenType: TokenType
}

// Hardcoded fast-path for well-known denoms. These never need an on-chain query.
const KNOWN_DENOMS: Record<string, DenomMeta> = {
  'inj': { symbol: 'INJ', decimals: 18, tokenType: 'native' },
  'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7': { symbol: 'USDT', decimals: 6, tokenType: 'peggy' },
  'peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5': { symbol: 'USDT', decimals: 6, tokenType: 'peggy' },
}

/**
 * Classify a denom string into a token type based on its prefix.
 */
export function classifyDenom(denom: string): TokenType {
  if (denom === 'inj') return 'native'
  if (denom.startsWith('peggy')) return 'peggy'
  if (denom.startsWith('ibc/')) return 'ibc'
  if (denom.startsWith('factory/')) return 'factory'
  if (denom.startsWith('erc20:')) return 'erc20'
  return 'unknown'
}

/**
 * Generate a human-readable fallback symbol from the denom prefix and address.
 */
function fallbackSymbol(denom: string, tokenType: TokenType): string {
  switch (tokenType) {
    case 'peggy':
      return denom.startsWith('peggy0x') ? `peggy:${denom.slice(7, 13)}…` : denom
    case 'factory': {
      const parts = denom.split('/')
      return parts[parts.length - 1] ?? denom
    }
    case 'ibc':
      return `ibc:${denom.slice(4, 10)}…`
    case 'erc20':
      return `erc20:${denom.slice(6, 12)}…`
    default:
      return denom
  }
}

/**
 * Extract decimals from Cosmos SDK denom metadata.
 * The decimals are the maximum exponent in the denomUnits array.
 */
function extractDecimals(denomUnits: { exponent: number }[]): number | null {
  if (!denomUnits || denomUnits.length === 0) return null
  let max = 0
  for (const unit of denomUnits) {
    if (unit.exponent > max) max = unit.exponent
  }
  return max > 0 ? max : null
}

// ─── Denom resolver with caching ────────────────────────────────────────────
// Cache is module-level and shared across calls. Denom metadata does not change,
// so entries never expire. The cache is cleared on module reload (dev/test).

const denomCache = new Map<string, DenomMeta>()

// Pre-populate cache with hardcoded entries
for (const [denom, meta] of Object.entries(KNOWN_DENOMS)) {
  denomCache.set(denom, meta)
}

/**
 * Resolve a single denom to its metadata (symbol, decimals, tokenType).
 *
 * Resolution order:
 *  1. In-memory cache (includes hardcoded well-known denoms)
 *  2. On-chain metadata via ChainGrpcBankApi.fetchDenomMetadata()
 *  3. Pattern-based fallback for known prefixes
 */
async function resolveDenom(bankApi: InjectiveClient['bankApi'], denom: string): Promise<DenomMeta> {
  // 1. Cache hit (covers hardcoded denoms too)
  const cached = denomCache.get(denom)
  if (cached) return cached

  const tokenType = classifyDenom(denom)

  // 2. On-chain metadata query
  try {
    const meta = await bankApi.fetchDenomMetadata(denom)
    if (meta && (meta.symbol || meta.name)) {
      const decimals = extractDecimals(meta.denomUnits)
      const resolved: DenomMeta = {
        symbol: meta.symbol || meta.name || meta.display || fallbackSymbol(denom, tokenType),
        decimals,
        tokenType,
      }
      denomCache.set(denom, resolved)
      return resolved
    }
  } catch {
    // Denom may not have on-chain metadata registered — fall through to pattern-based
  }

  // 3. Pattern-based fallback
  const result: DenomMeta = {
    symbol: fallbackSymbol(denom, tokenType),
    decimals: null,
    tokenType,
  }
  denomCache.set(denom, result)
  return result
}

/**
 * Resolve all unique denoms in parallel. Returns a map of denom → DenomMeta.
 */
async function resolveAllDenoms(
  bankApi: InjectiveClient['bankApi'],
  denoms: string[],
): Promise<Map<string, DenomMeta>> {
  const unique = [...new Set(denoms)]
  const results = await Promise.all(unique.map(d => resolveDenom(bankApi, d)))
  const map = new Map<string, DenomMeta>()
  for (let i = 0; i < unique.length; i++) {
    map.set(unique[i]!, results[i]!)
  }
  return map
}

/**
 * Clear the denom metadata cache. Exposed for testing.
 */
export function clearDenomCache(): void {
  denomCache.clear()
  // Re-populate hardcoded entries
  for (const [denom, meta] of Object.entries(KNOWN_DENOMS)) {
    denomCache.set(denom, meta)
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeDecimalStr(value: unknown, fallback = '0'): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function toHuman(raw: string, decimals: number): string {
  return new Decimal(raw).div(new Decimal(10).pow(decimals)).toFixed(6)
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const accounts = {
  /**
   * Resolve a single denom to its metadata. Used by the token_metadata MCP tool.
   */
  async getDenomMetadata(config: Config, denom: string): Promise<DenomMeta> {
    const client = createClient(config)
    return resolveDenom(client.bankApi, denom)
  },

  async getBalances(config: Config, address: string): Promise<Balances> {
    const client = createClient(config)
    const portfolio = await withRetry(() =>
      client.portfolioApi.fetchAccountPortfolioBalances(address)
    )

    // Collect all unique denoms and resolve metadata in parallel
    const bankDenoms = (portfolio.bankBalancesList ?? []).map(c => c.denom)
    const subDenoms = (portfolio.subaccountsList ?? []).map(s => s.denom)
    const denomMap = await resolveAllDenoms(client.bankApi, [...bankDenoms, ...subDenoms])

    const bank: BankBalance[] = (portfolio.bankBalancesList ?? []).map(coin => {
      const meta = denomMap.get(coin.denom) ?? { symbol: coin.denom, decimals: null, tokenType: 'unknown' as TokenType }
      return {
        denom: coin.denom,
        symbol: meta.symbol,
        amount: meta.decimals !== null ? toHuman(coin.amount, meta.decimals) : coin.amount,
        decimals: meta.decimals,
        tokenType: meta.tokenType,
      }
    })

    const subaccount: SubaccountBalance[] = (portfolio.subaccountsList ?? []).map(sub => {
      const meta = denomMap.get(sub.denom) ?? { symbol: sub.denom, decimals: null, tokenType: 'unknown' as TokenType }
      return {
        subaccountId: sub.subaccountId,
        denom: sub.denom,
        symbol: meta.symbol,
        total: meta.decimals !== null
          ? toHuman(sub.deposit?.totalBalance ?? '0', meta.decimals)
          : (sub.deposit?.totalBalance ?? '0'),
        available: meta.decimals !== null
          ? toHuman(sub.deposit?.availableBalance ?? '0', meta.decimals)
          : (sub.deposit?.availableBalance ?? '0'),
        decimals: meta.decimals,
        tokenType: meta.tokenType,
      }
    })

    return { bank, subaccount }
  },

  async getPositions(config: Config, address: string): Promise<Position[]> {
    const client = createClient(config)
    const allMarkets = await markets.list(config)

    const { positions } = await withRetry(() =>
      client.derivativesApi.fetchPositionsV2({ address })
    )

    return positions.map(pos => {
      const market = allMarkets.find(m => m.marketId === pos.marketId)
      const symbol = market?.symbol ?? pos.marketId.slice(0, 8)

      const entry = new Decimal(safeDecimalStr(pos.entryPrice))
      const mark = new Decimal(safeDecimalStr(pos.markPrice))
      const qty = new Decimal(safeDecimalStr(pos.quantity))
      const isLong = pos.direction === 'long'
      const direction = isLong ? 1 : -1

      // pnl = (markPrice - entryPrice) × quantity × direction
      const pnl = mark.minus(entry).mul(qty).mul(direction)

      return {
        symbol,
        marketId: pos.marketId,
        subaccountId: pos.subaccountId,
        side: isLong ? 'long' : 'short',
        quantity: pos.quantity,
        entryPrice: pos.entryPrice,
        markPrice: pos.markPrice,
        margin: pos.margin,
        pnl: pnl.toFixed(6),
      } satisfies Position
    })
  },
}
