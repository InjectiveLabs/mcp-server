import Decimal from 'decimal.js'
import { Config } from '../config/index.js'
import { createClient, withRetry } from '../client/index.js'
import { markets } from '../markets/index.js'

export interface BankBalance {
  denom: string
  symbol: string
  amount: string      // human-readable if decimals known, raw string if not
  decimals: number | null  // null when denom is unknown — amount is unscaled
}

export interface SubaccountBalance {
  subaccountId: string
  denom: string
  symbol: string
  total: string
  available: string
  decimals: number | null  // null when denom is unknown — amounts are unscaled
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

// ─── Known denom → symbol mapping ────────────────────────────────────────────
// Exact match on the full denom string. The peggy USDT denom is a hex address
// that does NOT contain the letters "usdt", so substring matching doesn't work.
const KNOWN_SYMBOLS: Record<string, string> = {
  'inj': 'INJ',
  'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',  // mainnet
  'peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5': 'USDT',  // testnet
}

// ─── Known denom → decimals mapping ─────────────────────────────────────────
// Returns null for unknown denoms — callers should return the raw amount string.
const KNOWN_DECIMALS: Record<string, number> = {
  'inj': 18,
  'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7': 6,  // mainnet USDT
  'peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5': 6,  // testnet USDT
}

/**
 * Resolve a denom to a human-readable symbol.
 *
 * Priority:
 *  1. Exact match in KNOWN_SYMBOLS (INJ, mainnet USDT, testnet USDT)
 *  2. Pattern-based display name for known prefixes (peggy, factory, ibc, erc20)
 *  3. Raw denom string as fallback
 */
function formatDenom(denom: string): string {
  // 1. Exact match (covers INJ + both USDT variants)
  const known = KNOWN_SYMBOLS[denom]
  if (known) return known

  // 2. Pattern-based display names
  if (denom.startsWith('peggy0x')) return `peggy:${denom.slice(7, 13)}…`
  if (denom.startsWith('factory/')) {
    const parts = denom.split('/')
    return parts[parts.length - 1] ?? denom
  }
  if (denom.startsWith('ibc/')) return `ibc:${denom.slice(4, 10)}…`
  if (denom.startsWith('erc20:')) return `erc20:${denom.slice(6, 12)}…`

  // 3. Fallback — return the raw denom
  return denom
}

/**
 * Get the number of decimals for a denom, or null if unknown.
 * When null, callers should return the raw (unscaled) amount string.
 */
function getDecimals(denom: string): number | null {
  return KNOWN_DECIMALS[denom] ?? null
}

function safeDecimalStr(value: unknown, fallback = '0'): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function toHuman(raw: string, decimals: number): string {
  return new Decimal(raw).div(new Decimal(10).pow(decimals)).toFixed(6)
}

export const accounts = {
  async getBalances(config: Config, address: string): Promise<Balances> {
    const client = createClient(config)
    const portfolio = await withRetry(() =>
      client.portfolioApi.fetchAccountPortfolioBalances(address)
    )

    const bank: BankBalance[] = (portfolio.bankBalancesList ?? []).map(coin => {
      const decimals = getDecimals(coin.denom)
      return {
        denom: coin.denom,
        symbol: formatDenom(coin.denom),
        amount: decimals !== null ? toHuman(coin.amount, decimals) : coin.amount,
        decimals,
      }
    })

    const subaccount: SubaccountBalance[] = (portfolio.subaccountsList ?? []).map(sub => {
      const decimals = getDecimals(sub.denom)
      return {
        subaccountId: sub.subaccountId,
        denom: sub.denom,
        symbol: formatDenom(sub.denom),
        total: decimals !== null
          ? toHuman(sub.deposit?.totalBalance ?? '0', decimals)
          : (sub.deposit?.totalBalance ?? '0'),
        available: decimals !== null
          ? toHuman(sub.deposit?.availableBalance ?? '0', decimals)
          : (sub.deposit?.availableBalance ?? '0'),
        decimals,
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
