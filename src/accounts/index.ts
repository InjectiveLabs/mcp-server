import Decimal from 'decimal.js'
import { Config } from '../config/index.js'
import { createClient, withRetry } from '../client/index.js'
import { markets } from '../markets/index.js'

export interface BankBalance {
  denom: string
  symbol: string
  amount: string  // human-readable
}

export interface SubaccountBalance {
  subaccountId: string
  denom: string
  symbol: string
  total: string
  available: string
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

const USDT_DENOM = 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7'
const INJ_DENOM = 'inj'
const USDT_DECIMALS = 6
const INJ_DECIMALS = 18

function formatDenom(denom: string): string {
  if (denom === INJ_DENOM) return 'INJ'
  if (denom.toLowerCase().includes('usdt')) return 'USDT'
  return denom
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

    const bank: BankBalance[] = (portfolio.bankBalancesList ?? []).map(coin => ({
      denom: coin.denom,
      symbol: formatDenom(coin.denom),
      amount: coin.denom === INJ_DENOM
        ? toHuman(coin.amount, INJ_DECIMALS)
        : toHuman(coin.amount, USDT_DECIMALS),
    }))

    const subaccount: SubaccountBalance[] = (portfolio.subaccountsList ?? []).map(sub => ({
      subaccountId: sub.subaccountId,
      denom: sub.denom,
      symbol: formatDenom(sub.denom),
      total: sub.denom === INJ_DENOM
        ? toHuman(sub.deposit?.totalBalance ?? '0', INJ_DECIMALS)
        : toHuman(sub.deposit?.totalBalance ?? '0', USDT_DECIMALS),
      available: sub.denom === INJ_DENOM
        ? toHuman(sub.deposit?.availableBalance ?? '0', INJ_DECIMALS)
        : toHuman(sub.deposit?.availableBalance ?? '0', USDT_DECIMALS),
    }))

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
