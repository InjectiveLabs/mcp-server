import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { accounts, classifyDenom, clearDenomCache } from './index.js'
import type { TokenType } from './index.js'
import { testConfig, mockMarket, mockEthMarket, mockPortfolioResponse, mockPositionsResponse, mockBankApi } from '../test-utils/index.js'

// Mock the client module
vi.mock('../client/index.js', () => ({
  createClient: vi.fn(),
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}))

// Mock the markets module (used by getPositions)
vi.mock('../markets/index.js', () => ({
  markets: {
    list: vi.fn(),
  },
}))

import { createClient } from '../client/index.js'
import { markets } from '../markets/index.js'

const mockedCreateClient = vi.mocked(createClient)
const mockedMarketsList = vi.mocked(markets.list)

describe('classifyDenom', () => {
  it('classifies native inj', () => {
    expect(classifyDenom('inj')).toBe('native')
  })

  it('classifies peggy denoms', () => {
    expect(classifyDenom('peggy0xdAC17F958D2ee523a2206206994597C13D831ec7')).toBe('peggy')
  })

  it('classifies ibc denoms', () => {
    expect(classifyDenom('ibc/ABC123DEF456')).toBe('ibc')
  })

  it('classifies factory denoms', () => {
    expect(classifyDenom('factory/inj1abc/mytoken')).toBe('factory')
  })

  it('classifies erc20 denoms', () => {
    expect(classifyDenom('erc20:0xABCDEF1234567890')).toBe('erc20')
  })

  it('returns unknown for unrecognized denoms', () => {
    expect(classifyDenom('somethingelse')).toBe('unknown')
  })
})

describe('accounts.getBalances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDenomCache()
  })

  it('converts bank balances with correct decimals for known denoms', async () => {
    const mockPortfolio = mockPortfolioResponse()
    const bankApi = mockBankApi()  // No on-chain metadata needed — these are hardcoded
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue(mockPortfolio),
      },
      bankApi,
    } as any)

    const config = testConfig()
    const result = await accounts.getBalances(config, 'inj1' + 'a'.repeat(38))

    // INJ: 1000000000000000000 / 10^18 = 1.000000
    expect(result.bank).toHaveLength(2)
    const inj = result.bank.find(b => b.denom === 'inj')
    expect(inj).toBeDefined()
    expect(inj!.symbol).toBe('INJ')
    expect(inj!.amount).toBe('1.000000')
    expect(inj!.decimals).toBe(18)
    expect(inj!.tokenType).toBe('native')

    // Mainnet USDT peggy denom: 1000000000 / 10^6 = 1000.000000
    const usdt = result.bank.find(b => b.denom === 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7')
    expect(usdt).toBeDefined()
    expect(usdt!.symbol).toBe('USDT')
    expect(usdt!.amount).toBe('1000.000000')
    expect(usdt!.decimals).toBe(6)
    expect(usdt!.tokenType).toBe('peggy')
  })

  it('converts subaccount balances correctly', async () => {
    const mockPortfolio = mockPortfolioResponse()
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue(mockPortfolio),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))

    expect(result.subaccount).toHaveLength(1)
    expect(result.subaccount[0]!.symbol).toBe('USDT')
    expect(result.subaccount[0]!.total).toBe('500.000000')
    expect(result.subaccount[0]!.available).toBe('400.000000')
    expect(result.subaccount[0]!.decimals).toBe(6)
    expect(result.subaccount[0]!.tokenType).toBe('peggy')
    expect(result.subaccount[0]!.denom).toBe('peggy0xdAC17F958D2ee523a2206206994597C13D831ec7')
  })

  it('handles empty portfolio gracefully', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [],
          subaccountsList: [],
        }),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank).toEqual([])
    expect(result.subaccount).toEqual([])
  })

  it('handles null bankBalancesList and subaccountsList', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: null,
          subaccountsList: null,
        }),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank).toEqual([])
    expect(result.subaccount).toEqual([])
  })

  it('handles missing deposit fields in subaccount', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [],
          subaccountsList: [{
            subaccountId: '0xabc',
            denom: 'inj',
            deposit: null,
          }],
        }),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.subaccount).toHaveLength(1)
    // Should fallback to '0' for null deposit, scaled by INJ decimals (18)
    expect(result.subaccount[0]!.total).toBe('0.000000')
    expect(result.subaccount[0]!.available).toBe('0.000000')
    expect(result.subaccount[0]!.decimals).toBe(18)
    expect(result.subaccount[0]!.tokenType).toBe('native')
  })

  it('formats INJ denom correctly', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'inj', amount: '5000000000000000000' }],
          subaccountsList: [],
        }),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('INJ')
    expect(result.bank[0]!.amount).toBe('5.000000')
    expect(result.bank[0]!.decimals).toBe(18)
    expect(result.bank[0]!.tokenType).toBe('native')
  })

  it('formats mainnet USDT denom correctly', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7', amount: '5000000' }],
          subaccountsList: [],
        }),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('USDT')
    expect(result.bank[0]!.denom).toBe('peggy0xdAC17F958D2ee523a2206206994597C13D831ec7')
    expect(result.bank[0]!.amount).toBe('5.000000')
    expect(result.bank[0]!.decimals).toBe(6)
    expect(result.bank[0]!.tokenType).toBe('peggy')
  })

  it('formats testnet USDT denom correctly', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5', amount: '2500000' }],
          subaccountsList: [],
        }),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('USDT')
    expect(result.bank[0]!.amount).toBe('2.500000')
    expect(result.bank[0]!.decimals).toBe(6)
    expect(result.bank[0]!.tokenType).toBe('peggy')
  })

  it('returns raw amount for unknown denoms with no on-chain metadata (decimals null)', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'ibc/ABC123DEF456', amount: '999888777' }],
          subaccountsList: [],
        }),
      },
      bankApi: mockBankApi(),  // No metadata registered — will throw
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    // Unknown denom: decimals=null, amount is raw (unscaled)
    expect(result.bank[0]!.symbol).toBe('ibc:ABC123…')
    expect(result.bank[0]!.denom).toBe('ibc/ABC123DEF456')
    expect(result.bank[0]!.amount).toBe('999888777')
    expect(result.bank[0]!.decimals).toBeNull()
    expect(result.bank[0]!.tokenType).toBe('ibc')
  })

  it('formats unknown peggy denom with truncated address', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'peggy0x1234567890ABCDEF', amount: '100' }],
          subaccountsList: [],
        }),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    // Unknown peggy denom: pattern-based display name
    expect(result.bank[0]!.symbol).toBe('peggy:123456…')
    expect(result.bank[0]!.decimals).toBeNull()
    expect(result.bank[0]!.amount).toBe('100')  // raw, not scaled
    expect(result.bank[0]!.tokenType).toBe('peggy')
  })

  it('formats factory denom using last segment', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'factory/inj1abc/mytoken', amount: '42' }],
          subaccountsList: [],
        }),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('mytoken')
    expect(result.bank[0]!.decimals).toBeNull()
    expect(result.bank[0]!.amount).toBe('42')
    expect(result.bank[0]!.tokenType).toBe('factory')
  })

  it('formats erc20 denom with truncated address', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'erc20:0xABCDEF1234567890', amount: '500' }],
          subaccountsList: [],
        }),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('erc20:0xABCD…')
    expect(result.bank[0]!.decimals).toBeNull()
    expect(result.bank[0]!.amount).toBe('500')
    expect(result.bank[0]!.tokenType).toBe('erc20')
  })

  it('returns raw amount for unknown subaccount denoms', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [],
          subaccountsList: [{
            subaccountId: '0xabc',
            denom: 'factory/inj1xyz/usdc',
            deposit: {
              totalBalance: '999000',
              availableBalance: '888000',
            },
          }],
        }),
      },
      bankApi: mockBankApi(),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.subaccount[0]!.symbol).toBe('usdc')
    expect(result.subaccount[0]!.total).toBe('999000')      // raw, not scaled
    expect(result.subaccount[0]!.available).toBe('888000')   // raw, not scaled
    expect(result.subaccount[0]!.decimals).toBeNull()
    expect(result.subaccount[0]!.tokenType).toBe('factory')
  })

  // ─── Phase 4 tests: on-chain metadata resolution ─────────────────────────

  it('resolves erc20 denom via on-chain metadata', async () => {
    const erc20Denom = 'erc20:0xABCDEF1234567890ABCDEF1234567890ABCDEF12'
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: erc20Denom, amount: '1000000000000000000' }],
          subaccountsList: [],
        }),
      },
      bankApi: mockBankApi({
        [erc20Denom]: {
          symbol: 'WETH',
          denomUnits: [
            { denom: erc20Denom, exponent: 0 },
            { denom: 'WETH', exponent: 18 },
          ],
        },
      }),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('WETH')
    expect(result.bank[0]!.decimals).toBe(18)
    expect(result.bank[0]!.amount).toBe('1.000000')
    expect(result.bank[0]!.tokenType).toBe('erc20')
  })

  it('resolves ibc denom via on-chain metadata', async () => {
    const ibcDenom = 'ibc/C4CFF46FD6DE35CA4CF4CE031E643C8FDC9BA4B99AE598E9B0ED98FE3A2319F9'
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: ibcDenom, amount: '5000000' }],
          subaccountsList: [],
        }),
      },
      bankApi: mockBankApi({
        [ibcDenom]: {
          symbol: 'ATOM',
          denomUnits: [
            { denom: 'uatom', exponent: 0 },
            { denom: 'atom', exponent: 6 },
          ],
        },
      }),
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('ATOM')
    expect(result.bank[0]!.decimals).toBe(6)
    expect(result.bank[0]!.amount).toBe('5.000000')
    expect(result.bank[0]!.tokenType).toBe('ibc')
  })

  it('caches denom metadata across calls', async () => {
    const erc20Denom = 'erc20:0xCACHETEST0000000000000000000000000000CAFE'
    const bankApi = mockBankApi({
      [erc20Denom]: {
        symbol: 'CACHED',
        denomUnits: [
          { denom: erc20Denom, exponent: 0 },
          { denom: 'CACHED', exponent: 8 },
        ],
      },
    })

    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: erc20Denom, amount: '100000000' }],
          subaccountsList: [],
        }),
      },
      bankApi,
    } as any)

    // First call — should query on-chain
    const result1 = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result1.bank[0]!.symbol).toBe('CACHED')
    expect(bankApi.fetchDenomMetadata).toHaveBeenCalledTimes(1)

    // Second call — should use cache (no additional on-chain query)
    const result2 = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result2.bank[0]!.symbol).toBe('CACHED')
    expect(bankApi.fetchDenomMetadata).toHaveBeenCalledTimes(1)  // Still 1, not 2
  })

  it('resolves multiple unique denoms in parallel', async () => {
    const erc20A = 'erc20:0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const erc20B = 'erc20:0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    const bankApi = mockBankApi({
      [erc20A]: {
        symbol: 'TOKA',
        denomUnits: [{ denom: erc20A, exponent: 0 }, { denom: 'TOKA', exponent: 18 }],
      },
      [erc20B]: {
        symbol: 'TOKB',
        denomUnits: [{ denom: erc20B, exponent: 0 }, { denom: 'TOKB', exponent: 6 }],
      },
    })

    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [
            { denom: erc20A, amount: '1000000000000000000' },
            { denom: erc20B, amount: '5000000' },
          ],
          subaccountsList: [],
        }),
      },
      bankApi,
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank).toHaveLength(2)
    expect(result.bank[0]!.symbol).toBe('TOKA')
    expect(result.bank[0]!.amount).toBe('1.000000')
    expect(result.bank[1]!.symbol).toBe('TOKB')
    expect(result.bank[1]!.amount).toBe('5.000000')
  })
})

describe('accounts.getDenomMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearDenomCache()
  })

  it('returns hardcoded metadata for inj without on-chain query', async () => {
    const bankApi = mockBankApi()
    mockedCreateClient.mockReturnValue({ bankApi } as any)

    const meta = await accounts.getDenomMetadata(testConfig(), 'inj')
    expect(meta.symbol).toBe('INJ')
    expect(meta.decimals).toBe(18)
    expect(meta.tokenType).toBe('native')
    // Should not have queried on-chain
    expect(bankApi.fetchDenomMetadata).not.toHaveBeenCalled()
  })

  it('returns on-chain metadata for erc20 denom', async () => {
    const denom = 'erc20:0x1234567890ABCDEF1234567890ABCDEF12345678'
    const bankApi = mockBankApi({
      [denom]: {
        symbol: 'MTS_TOKEN',
        denomUnits: [
          { denom, exponent: 0 },
          { denom: 'MTS_TOKEN', exponent: 18 },
        ],
      },
    })
    mockedCreateClient.mockReturnValue({ bankApi } as any)

    const meta = await accounts.getDenomMetadata(testConfig(), denom)
    expect(meta.symbol).toBe('MTS_TOKEN')
    expect(meta.decimals).toBe(18)
    expect(meta.tokenType).toBe('erc20')
  })

  it('falls back to pattern-based for unknown denom without on-chain metadata', async () => {
    const denom = 'erc20:0xNOMETADATA000000000000000000000000000000'
    const bankApi = mockBankApi()  // No metadata registered
    mockedCreateClient.mockReturnValue({ bankApi } as any)

    const meta = await accounts.getDenomMetadata(testConfig(), denom)
    expect(meta.symbol).toBe('erc20:0xNOME…')
    expect(meta.decimals).toBeNull()
    expect(meta.tokenType).toBe('erc20')
  })
})

describe('accounts.getPositions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps position with correct P&L for long', async () => {
    const posResp = mockPositionsResponse({
      direction: 'long',
      entryPrice: '30000',
      markPrice: '31000',
      quantity: '1',
    })
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchPositionsV2: vi.fn().mockResolvedValue(posResp),
      },
    } as any)
    mockedMarketsList.mockResolvedValue([mockMarket()])

    const positions = await accounts.getPositions(testConfig(), 'inj1' + 'a'.repeat(38))

    expect(positions).toHaveLength(1)
    expect(positions[0]!.side).toBe('long')
    expect(positions[0]!.symbol).toBe('BTC')
    // Prices are chain-scaled (÷1e6), so PnL = (0.031000 - 0.030000) * 1 * 1 = 0.001000
    expect(positions[0]!.unrealizedPnl).toBe('0.001000')
  })

  it('calculates negative P&L for losing long', async () => {
    const posResp = mockPositionsResponse({
      direction: 'long',
      entryPrice: '30000',
      markPrice: '29000',
      quantity: '1',
    })
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchPositionsV2: vi.fn().mockResolvedValue(posResp),
      },
    } as any)
    mockedMarketsList.mockResolvedValue([mockMarket()])

    const positions = await accounts.getPositions(testConfig(), 'inj1' + 'a'.repeat(38))
    // Prices are chain-scaled (÷1e6), so PnL = (0.029000 - 0.030000) * 1 * 1 = -0.001000
    expect(positions[0]!.unrealizedPnl).toBe('-0.001000')
  })

  it('calculates P&L for short position', async () => {
    const posResp = mockPositionsResponse({
      direction: 'short',
      entryPrice: '30000',
      markPrice: '29000',
      quantity: '1',
    })
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchPositionsV2: vi.fn().mockResolvedValue(posResp),
      },
    } as any)
    mockedMarketsList.mockResolvedValue([mockMarket()])

    const positions = await accounts.getPositions(testConfig(), 'inj1' + 'a'.repeat(38))
    // Prices are chain-scaled (÷1e6), so short PnL = (0.029000 - 0.030000) * 1 * -1 = 0.001000
    expect(positions[0]!.unrealizedPnl).toBe('0.001000')
  })

  it('calculates negative P&L for losing short', async () => {
    const posResp = mockPositionsResponse({
      direction: 'short',
      entryPrice: '30000',
      markPrice: '31000',
      quantity: '1',
    })
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchPositionsV2: vi.fn().mockResolvedValue(posResp),
      },
    } as any)
    mockedMarketsList.mockResolvedValue([mockMarket()])

    const positions = await accounts.getPositions(testConfig(), 'inj1' + 'a'.repeat(38))
    // Prices are chain-scaled (÷1e6), so short PnL = (0.031000 - 0.030000) * 1 * -1 = -0.001000
    expect(positions[0]!.unrealizedPnl).toBe('-0.001000')
  })

  it('handles empty positions array', async () => {
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchPositionsV2: vi.fn().mockResolvedValue({ positions: [] }),
      },
    } as any)
    mockedMarketsList.mockResolvedValue([mockMarket()])

    const positions = await accounts.getPositions(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(positions).toEqual([])
  })

  it('falls back to marketId prefix when market not found', async () => {
    const unknownMarketId = '0x' + 'f'.repeat(64)
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchPositionsV2: vi.fn().mockResolvedValue({
          positions: [{
            direction: 'long',
            marketId: unknownMarketId,
            entryPrice: '100',
            markPrice: '110',
            quantity: '1',
            margin: '10',
            subaccountId: '0x' + 'c'.repeat(64),
          }],
        }),
      },
    } as any)
    mockedMarketsList.mockResolvedValue([mockMarket()]) // BTC market only, not matching

    const positions = await accounts.getPositions(testConfig(), 'inj1' + 'a'.repeat(38))
    // Symbol falls back to first 8 chars of marketId
    expect(positions[0]!.symbol).toBe('0xffffff')
  })

  it('handles safeDecimalStr fallback for undefined fields', async () => {
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchPositionsV2: vi.fn().mockResolvedValue({
          positions: [{
            direction: 'long',
            marketId: '0x' + 'a'.repeat(64),
            entryPrice: '',  // empty string
            markPrice: undefined,  // undefined
            quantity: '1',
            margin: '10',
            subaccountId: '0x' + 'c'.repeat(64),
          }],
        }),
      },
    } as any)
    mockedMarketsList.mockResolvedValue([mockMarket()])

    // Should not throw — safeDecimalStr handles empty/undefined
    const positions = await accounts.getPositions(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(positions).toHaveLength(1)
    // Both entry and mark fall back to '0', so pnl = (0 - 0) * 1 * 1 = 0
    expect(positions[0]!.unrealizedPnl).toBe('0.000000')
  })
})
