/**
 * Shared test utilities for the Injective MCP server test suite.
 *
 * Integration tests expect one of these env vars:
 *   INJECTIVE_PRIVATE_KEY  — hex private key (0x-prefixed or bare)
 *   INJECTIVE_NETWORK      — 'mainnet' | 'testnet' (defaults to 'testnet')
 *
 * Unit tests use the mock factories below and never hit real APIs.
 */
import { vi } from 'vitest'
import Decimal from 'decimal.js'
import type { Config, NetworkName } from '../config/index.js'
import type { PerpMarket } from '../markets/index.js'
import type { Position, Balances, BankBalance, SubaccountBalance, TokenType } from '../accounts/index.js'

// ─── Config helpers ──────────────────────────────────────────────────────────

export function testConfig(network: NetworkName = 'testnet'): Config {
  return {
    network,
    endpoints: {
      indexer: 'https://testnet.indexer.injective.network',
      grpc: 'https://testnet.grpc.injective.network',
      rest: 'https://testnet.rest.injective.network',
    },
    chainId: network === 'mainnet' ? 'injective-1' : 'injective-888',
    ethereumChainId: network === 'mainnet' ? 1776 : 1439,
  }
}

// ─── Market fixtures ─────────────────────────────────────────────────────────

export function mockMarket(overrides: Partial<PerpMarket> = {}): PerpMarket {
  return {
    symbol: 'BTC',
    marketId: '0x' + 'a'.repeat(64),
    ticker: 'BTC/USDT PERP',
    tickSize: '1',
    minQuantityTick: '0.001',
    minNotional: '1',
    initialMarginRatio: '0.095',
    maintenanceMarginRatio: '0.05',
    takerFeeRate: '0.001',
    quoteDecimals: 6,
    oracleBase: 'BTC',
    oracleQuote: 'USDT',
    oracleType: 'bandibc',
    ...overrides,
  }
}

export function mockEthMarket(overrides: Partial<PerpMarket> = {}): PerpMarket {
  return mockMarket({
    symbol: 'ETH',
    marketId: '0x' + 'b'.repeat(64),
    ticker: 'ETH/USDT PERP',
    tickSize: '0.01',
    minQuantityTick: '0.01',
    oracleBase: 'ETH',
    ...overrides,
  })
}

// ─── Orderbook fixtures ──────────────────────────────────────────────────────

export function mockOrderbookLevels(basePrice: number, count: number, spread: number = 100) {
  return Array.from({ length: count }, (_, i) => ({
    price: new Decimal(basePrice + i * spread),
    quantity: new Decimal(1 + i * 0.5),
  }))
}

export function mockRawOrderbookResponse(basePrice: number = 30000) {
  return {
    sells: [
      { price: String(basePrice + 10), quantity: '2' },
      { price: String(basePrice + 50), quantity: '5' },
      { price: String(basePrice + 100), quantity: '10' },
    ],
    buys: [
      { price: String(basePrice - 10), quantity: '2' },
      { price: String(basePrice - 50), quantity: '5' },
      { price: String(basePrice - 100), quantity: '10' },
    ],
  }
}

// ─── Position fixtures ───────────────────────────────────────────────────────

export function mockPosition(overrides: Partial<Position> = {}): Position {
  return {
    symbol: 'BTC',
    marketId: '0x' + 'a'.repeat(64),
    subaccountId: '0x' + 'c'.repeat(64),
    side: 'long',
    quantity: '0.01',
    entryPrice: '30000',
    markPrice: '30500',
    margin: '30',
    unrealizedPnl: '5.000000',
    ...overrides,
  }
}

// ─── Balance fixtures ────────────────────────────────────────────────────────

export function mockBalances(overrides: Partial<Balances> = {}): Balances {
  return {
    bank: overrides.bank ?? [
      { denom: 'inj', symbol: 'INJ', amount: '1.000000', decimals: 18, tokenType: 'native' as TokenType },
      { denom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', amount: '1000.000000', decimals: 6, tokenType: 'peggy' as TokenType },
    ],
    subaccount: overrides.subaccount ?? [
      {
        subaccountId: '0x' + 'c'.repeat(64),
        denom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
        symbol: 'USDT',
        total: '500.000000',
        available: '400.000000',
        decimals: 6,
        tokenType: 'peggy' as TokenType,
      },
    ],
  }
}

// ─── Bank API mock ──────────────────────────────────────────────────────────

/**
 * Create a mock bankApi.fetchDenomMetadata that returns empty metadata
 * (simulating denoms with no on-chain metadata registered).
 * Override for specific denoms as needed in tests.
 */
export function mockBankApi(metadataMap: Record<string, { symbol?: string; name?: string; denomUnits?: { denom: string; exponent: number }[] }> = {}) {
  return {
    fetchDenomMetadata: vi.fn(async (denom: string) => {
      const meta = metadataMap[denom]
      if (meta) {
        return {
          description: '',
          denomUnits: meta.denomUnits ?? [],
          base: denom,
          display: meta.symbol ?? '',
          name: meta.name ?? '',
          symbol: meta.symbol ?? '',
          uri: '',
          uriHash: '',
        }
      }
      // No metadata registered — throw like the real API does
      throw new Error(`denom metadata not found for ${denom}`)
    }),
  }
}

// ─── Raw SDK response mocks ──────────────────────────────────────────────────

export function mockPortfolioResponse() {
  return {
    bankBalancesList: [
      { denom: 'inj', amount: '1000000000000000000' },
      { denom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7', amount: '1000000000' },
    ],
    subaccountsList: [
      {
        subaccountId: '0x' + 'c'.repeat(64),
        denom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
        deposit: {
          totalBalance: '500000000',
          availableBalance: '400000000',
        },
      },
    ],
  }
}

export function mockPositionsResponse(overrides: Partial<{
  direction: string
  marketId: string
  entryPrice: string
  markPrice: string
  quantity: string
  margin: string
  subaccountId: string
}> = {}) {
  return {
    positions: [
      {
        direction: overrides.direction ?? 'long',
        marketId: overrides.marketId ?? '0x' + 'a'.repeat(64),
        entryPrice: overrides.entryPrice ?? '30000',
        markPrice: overrides.markPrice ?? '30500',
        quantity: overrides.quantity ?? '0.01',
        margin: overrides.margin ?? '30',
        subaccountId: overrides.subaccountId ?? '0x' + 'c'.repeat(64),
      },
    ],
  }
}

export function mockDerivativeMarketRaw(overrides: Record<string, unknown> = {}) {
  return {
    marketId: '0x' + 'a'.repeat(64),
    ticker: 'BTC/USDT PERP',
    initialMarginRatio: '0.095',
    maintenanceMarginRatio: '0.05',
    takerFeeRate: '0.001',
    minPriceTickSize: '1',
    minQuantityTickSize: '0.001',
    minNotional: '1',
    oracleBase: 'BTC',
    oracleQuote: 'USDT',
    oracleType: 'bandibc',
    ...overrides,
  }
}

// ─── Env helpers for integration tests ───────────────────────────────────────

export function getTestPrivateKey(): string {
  const key = process.env['INJECTIVE_PRIVATE_KEY']
  if (!key) {
    throw new Error(
      'INJECTIVE_PRIVATE_KEY env var is required for integration tests. ' +
      'Set it to a hex private key (0x-prefixed or bare) for testnet or mainnet.'
    )
  }
  return key.startsWith('0x') ? key : `0x${key}`
}

export function getTestNetwork(): NetworkName {
  const net = process.env['INJECTIVE_NETWORK'] ?? 'testnet'
  if (net !== 'mainnet' && net !== 'testnet') {
    throw new Error(`Invalid INJECTIVE_NETWORK="${net}" — must be "mainnet" or "testnet"`)
  }
  return net
}

// ─── Validation helpers ──────────────────────────────────────────────────────

export const INJ_ADDRESS_RE = /^inj1[a-z0-9]{38}$/
export const TX_HASH_RE = /^[A-F0-9]{64}$/i
export const HEX_RE = /^0x[0-9a-f]+$/i
