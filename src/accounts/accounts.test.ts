import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { accounts } from './index.js'
import { testConfig, mockMarket, mockEthMarket, mockPortfolioResponse, mockPositionsResponse } from '../test-utils/index.js'

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

describe('accounts.getBalances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('converts bank balances with correct decimals', async () => {
    const mockPortfolio = mockPortfolioResponse()
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue(mockPortfolio),
      },
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

    // Mainnet USDT peggy denom: 1000000000 / 10^6 = 1000.000000
    const usdt = result.bank.find(b => b.denom === 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7')
    expect(usdt).toBeDefined()
    expect(usdt!.symbol).toBe('USDT')
    expect(usdt!.amount).toBe('1000.000000')
    expect(usdt!.decimals).toBe(6)
  })

  it('converts subaccount balances correctly', async () => {
    const mockPortfolio = mockPortfolioResponse()
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue(mockPortfolio),
      },
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))

    expect(result.subaccount).toHaveLength(1)
    expect(result.subaccount[0]!.symbol).toBe('USDT')
    expect(result.subaccount[0]!.total).toBe('500.000000')
    expect(result.subaccount[0]!.available).toBe('400.000000')
    expect(result.subaccount[0]!.decimals).toBe(6)
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
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.subaccount).toHaveLength(1)
    // Should fallback to '0' for null deposit, scaled by INJ decimals (18)
    expect(result.subaccount[0]!.total).toBe('0.000000')
    expect(result.subaccount[0]!.available).toBe('0.000000')
    expect(result.subaccount[0]!.decimals).toBe(18)
  })

  it('formats INJ denom correctly', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'inj', amount: '5000000000000000000' }],
          subaccountsList: [],
        }),
      },
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('INJ')
    expect(result.bank[0]!.amount).toBe('5.000000')
    expect(result.bank[0]!.decimals).toBe(18)
  })

  it('formats mainnet USDT denom correctly', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7', amount: '5000000' }],
          subaccountsList: [],
        }),
      },
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('USDT')
    expect(result.bank[0]!.denom).toBe('peggy0xdAC17F958D2ee523a2206206994597C13D831ec7')
    expect(result.bank[0]!.amount).toBe('5.000000')
    expect(result.bank[0]!.decimals).toBe(6)
  })

  it('formats testnet USDT denom correctly', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5', amount: '2500000' }],
          subaccountsList: [],
        }),
      },
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('USDT')
    expect(result.bank[0]!.amount).toBe('2.500000')
    expect(result.bank[0]!.decimals).toBe(6)
  })

  it('returns raw amount for unknown denoms (decimals null)', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'ibc/ABC123DEF456', amount: '999888777' }],
          subaccountsList: [],
        }),
      },
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    // Unknown denom: decimals=null, amount is raw (unscaled)
    expect(result.bank[0]!.symbol).toBe('ibc:ABC123…')
    expect(result.bank[0]!.denom).toBe('ibc/ABC123DEF456')
    expect(result.bank[0]!.amount).toBe('999888777')
    expect(result.bank[0]!.decimals).toBeNull()
  })

  it('formats unknown peggy denom with truncated address', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'peggy0x1234567890ABCDEF', amount: '100' }],
          subaccountsList: [],
        }),
      },
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    // Unknown peggy denom: pattern-based display name
    expect(result.bank[0]!.symbol).toBe('peggy:123456…')
    expect(result.bank[0]!.decimals).toBeNull()
    expect(result.bank[0]!.amount).toBe('100')  // raw, not scaled
  })

  it('formats factory denom using last segment', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'factory/inj1abc/mytoken', amount: '42' }],
          subaccountsList: [],
        }),
      },
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('mytoken')
    expect(result.bank[0]!.decimals).toBeNull()
    expect(result.bank[0]!.amount).toBe('42')
  })

  it('formats erc20 denom with truncated address', async () => {
    mockedCreateClient.mockReturnValue({
      portfolioApi: {
        fetchAccountPortfolioBalances: vi.fn().mockResolvedValue({
          bankBalancesList: [{ denom: 'erc20:0xABCDEF1234567890', amount: '500' }],
          subaccountsList: [],
        }),
      },
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.bank[0]!.symbol).toBe('erc20:0xABCD…')
    expect(result.bank[0]!.decimals).toBeNull()
    expect(result.bank[0]!.amount).toBe('500')
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
    } as any)

    const result = await accounts.getBalances(testConfig(), 'inj1' + 'a'.repeat(38))
    expect(result.subaccount[0]!.symbol).toBe('usdc')
    expect(result.subaccount[0]!.total).toBe('999000')      // raw, not scaled
    expect(result.subaccount[0]!.available).toBe('888000')   // raw, not scaled
    expect(result.subaccount[0]!.decimals).toBeNull()
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
    // PnL = (31000 - 30000) * 1 * 1 = 1000
    expect(positions[0]!.pnl).toBe('1000.000000')
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
    // PnL = (29000 - 30000) * 1 * 1 = -1000
    expect(positions[0]!.pnl).toBe('-1000.000000')
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
    // Short PnL = (29000 - 30000) * 1 * -1 = 1000
    expect(positions[0]!.pnl).toBe('1000.000000')
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
    // Short PnL = (31000 - 30000) * 1 * -1 = -1000
    expect(positions[0]!.pnl).toBe('-1000.000000')
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
    expect(positions[0]!.pnl).toBe('0.000000')
  })
})
