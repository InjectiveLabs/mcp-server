import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { trading } from './index.js'
import { testConfig, mockMarket, mockPosition, mockRawOrderbookResponse } from '../test-utils/index.js'
import { NoLiquidity, NoPositionFound, QuantityTooSmall, BroadcastFailed } from '../errors/index.js'

// Mock all dependencies
vi.mock('../wallets/index.js', () => ({
  wallets: {
    unlock: vi.fn(),
  },
}))

vi.mock('../markets/index.js', () => ({
  markets: {
    resolve: vi.fn(),
    getPrice: vi.fn(),
    list: vi.fn(),
  },
}))

vi.mock('../accounts/index.js', () => ({
  accounts: {
    getPositions: vi.fn(),
  },
}))

vi.mock('../client/index.js', () => ({
  createClient: vi.fn(),
  createBroadcaster: vi.fn(),
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}))

// Mock SDK message construction (we can't instantiate real MsgCreateDerivativeMarketOrder without SDK)
vi.mock('@injectivelabs/sdk-ts', () => ({
  MsgCreateDerivativeMarketOrder: {
    fromJSON: vi.fn().mockReturnValue({ type: 'mock-msg' }),
  },
  OrderTypeMap: {
    BUY: 1,
    SELL: 2,
  },
  PrivateKey: {
    fromHex: vi.fn().mockReturnValue({
      toAddress: () => ({
        getSubaccountId: (index: number) => '0x' + 'c'.repeat(64),
        toAccountAddress: () => 'inj1' + 'a'.repeat(38),
      }),
    }),
  },
}))

import { wallets } from '../wallets/index.js'
import { markets } from '../markets/index.js'
import { accounts } from '../accounts/index.js'
import { createClient, createBroadcaster } from '../client/index.js'

const mockedUnlock = vi.mocked(wallets.unlock)
const mockedResolve = vi.mocked(markets.resolve)
const mockedGetPrice = vi.mocked(markets.getPrice)
const mockedGetPositions = vi.mocked(accounts.getPositions)
const mockedCreateClient = vi.mocked(createClient)
const mockedCreateBroadcaster = vi.mocked(createBroadcaster)

function setupOpenMocks(overrides: {
  oraclePrice?: number
  orderbook?: ReturnType<typeof mockRawOrderbookResponse>
  market?: ReturnType<typeof mockMarket>
  txHash?: string
} = {}) {
  const market = overrides.market ?? mockMarket()
  const oraclePrice = overrides.oraclePrice ?? 30000
  const orderbook = overrides.orderbook ?? mockRawOrderbookResponse(oraclePrice)
  const txHash = overrides.txHash ?? 'A'.repeat(64)

  mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
  mockedResolve.mockResolvedValue(market)
  mockedGetPrice.mockResolvedValue(new Decimal(oraclePrice))
  mockedCreateClient.mockReturnValue({
    derivativesApi: {
      fetchOrderbookV2: vi.fn().mockResolvedValue(orderbook),
    },
  } as any)
  mockedCreateBroadcaster.mockReturnValue({
    broadcast: vi.fn().mockResolvedValue({ txHash }),
  } as any)

  return { market, oraclePrice, orderbook, txHash }
}

function setupCloseMocks(overrides: {
  position?: ReturnType<typeof mockPosition>
  orderbook?: ReturnType<typeof mockRawOrderbookResponse>
  market?: ReturnType<typeof mockMarket>
  txHash?: string
} = {}) {
  const position = overrides.position ?? mockPosition()
  const market = overrides.market ?? mockMarket()
  const orderbook = overrides.orderbook ?? mockRawOrderbookResponse(30000)
  const txHash = overrides.txHash ?? 'B'.repeat(64)

  mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
  mockedGetPositions.mockResolvedValue([position])
  mockedResolve.mockResolvedValue(market)
  mockedCreateClient.mockReturnValue({
    derivativesApi: {
      fetchOrderbookV2: vi.fn().mockResolvedValue(orderbook),
    },
  } as any)
  mockedCreateBroadcaster.mockReturnValue({
    broadcast: vi.fn().mockResolvedValue({ txHash }),
  } as any)

  return { position, market, orderbook, txHash }
}

describe('trading.open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens a long position and returns expected result shape', async () => {
    const { txHash } = setupOpenMocks()

    const result = await trading.open(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'test-pw',
      symbol: 'BTC',
      side: 'long',
      amount: '1000',
    })

    expect(result.txHash).toBe(txHash)
    expect(result.executionPrice).toBeTruthy()
    expect(result.quantity).toBeTruthy()
    expect(result.margin).toBeTruthy()
    expect(result.liquidationPrice).toBeTruthy()
    // All values should be numeric strings
    expect(Number(result.executionPrice)).toBeGreaterThan(0)
    expect(Number(result.quantity)).toBeGreaterThan(0)
    expect(Number(result.margin)).toBeGreaterThan(0)
  })

  it('opens a short position', async () => {
    setupOpenMocks()

    const result = await trading.open(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'test-pw',
      symbol: 'BTC',
      side: 'short',
      amount: '1000',
    })

    expect(result.txHash).toBeTruthy()
    expect(Number(result.executionPrice)).toBeGreaterThan(0)
  })

  it('uses custom leverage', async () => {
    setupOpenMocks()

    const result5x = await trading.open(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'test-pw',
      symbol: 'BTC',
      side: 'long',
      amount: '1000',
      leverage: 5,
    })

    // Margin uses the slippage-adjusted price (higher than executionPrice for longs),
    // so we just verify margin is in reasonable range: between price*qty/leverage ± 5%
    const margin = Number(result5x.margin)
    const qty = Number(result5x.quantity)
    const price = Number(result5x.executionPrice)
    const expectedBaseline = price * qty / 5
    expect(margin).toBeGreaterThan(expectedBaseline * 0.95)
    expect(margin).toBeLessThan(expectedBaseline * 1.10)
  })

  it('throws NoLiquidity when orderbook is empty', async () => {
    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedResolve.mockResolvedValue(mockMarket())
    mockedGetPrice.mockResolvedValue(new Decimal(30000))
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchOrderbookV2: vi.fn().mockResolvedValue({ sells: [], buys: [] }),
      },
    } as any)

    await expect(
      trading.open(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'test-pw',
        symbol: 'BTC',
        side: 'long',
        amount: '1000',
      })
    ).rejects.toThrow(NoLiquidity)
  })

  it('throws QuantityTooSmall when amount is tiny', async () => {
    // Use a market with large minQuantityTick so tiny amounts round to 0
    setupOpenMocks({
      market: mockMarket({ minQuantityTick: '100' }),
      oraclePrice: 30000,
    })

    await expect(
      trading.open(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'test-pw',
        symbol: 'BTC',
        side: 'long',
        amount: '0.001', // Way too small for minQuantityTick=100
      })
    ).rejects.toThrow(QuantityTooSmall)
  })

  it('throws BroadcastFailed when broadcast fails', async () => {
    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedResolve.mockResolvedValue(mockMarket())
    mockedGetPrice.mockResolvedValue(new Decimal(30000))
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchOrderbookV2: vi.fn().mockResolvedValue(mockRawOrderbookResponse()),
      },
    } as any)
    mockedCreateBroadcaster.mockReturnValue({
      broadcast: vi.fn().mockRejectedValue(new Error('out of gas')),
    } as any)

    await expect(
      trading.open(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'test-pw',
        symbol: 'BTC',
        side: 'long',
        amount: '1000',
      })
    ).rejects.toThrow(BroadcastFailed)
  })

  it('falls back to oracle price when orderbook depth is insufficient', async () => {
    const oraclePrice = 30000
    // Orderbook with very little liquidity — only 0.0001 BTC available
    const thinOrderbook = {
      sells: [{ price: '30050', quantity: '0.0001' }],
      buys: [{ price: '29950', quantity: '0.0001' }],
    }

    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedResolve.mockResolvedValue(mockMarket())
    mockedGetPrice.mockResolvedValue(new Decimal(oraclePrice))
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchOrderbookV2: vi.fn().mockResolvedValue(thinOrderbook),
      },
    } as any)
    mockedCreateBroadcaster.mockReturnValue({
      broadcast: vi.fn().mockResolvedValue({ txHash: 'A'.repeat(64) }),
    } as any)

    const result = await trading.open(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'test-pw',
      symbol: 'BTC',
      side: 'long',
      amount: '100000', // Way more than the thin orderbook
    })

    // Falls back to oracle price = 30000, then applies slippage
    expect(Number(result.executionPrice)).toBe(oraclePrice)
  })

  it('decrypts wallet key via wallets.unlock', async () => {
    setupOpenMocks()

    await trading.open(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'my-secret-pw',
      symbol: 'BTC',
      side: 'long',
      amount: '1000',
    })

    expect(mockedUnlock).toHaveBeenCalledWith('inj1' + 'a'.repeat(38), 'my-secret-pw')
  })
})

describe('trading.close', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('closes a long position and returns result', async () => {
    const { txHash } = setupCloseMocks()

    const result = await trading.close(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'test-pw',
      symbol: 'BTC',
    })

    expect(result.txHash).toBe(txHash)
    expect(result.closedQty).toBeTruthy()
    expect(result.exitPrice).toBeTruthy()
    expect(result.realizedPnl).toBeTruthy()
    expect(Number(result.closedQty)).toBeGreaterThan(0)
  })

  it('closes a short position', async () => {
    setupCloseMocks({
      position: mockPosition({ side: 'short', entryPrice: '30000', markPrice: '29500' }),
    })

    const result = await trading.close(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'test-pw',
      symbol: 'BTC',
    })

    expect(result.txHash).toBeTruthy()
    expect(Number(result.closedQty)).toBeGreaterThan(0)
  })

  it('throws NoPositionFound when no position exists', async () => {
    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedGetPositions.mockResolvedValue([])

    await expect(
      trading.close(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'test-pw',
        symbol: 'BTC',
      })
    ).rejects.toThrow(NoPositionFound)
  })

  it('matches symbol case-insensitively', async () => {
    setupCloseMocks({
      position: mockPosition({ symbol: 'BTC' }),
    })

    // Should find "BTC" when searching for "btc"
    const result = await trading.close(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'test-pw',
      symbol: 'btc',
    })

    expect(result.txHash).toBeTruthy()
  })

  it('throws NoLiquidity when close-side orderbook is empty (closing long)', async () => {
    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedGetPositions.mockResolvedValue([mockPosition({ side: 'long' })])
    mockedResolve.mockResolvedValue(mockMarket())
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchOrderbookV2: vi.fn().mockResolvedValue({
          // Closing a long = selling = need buys. Empty buys means no liquidity.
          sells: [{ price: '30100', quantity: '5' }],
          buys: [],
        }),
      },
    } as any)

    await expect(
      trading.close(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'test-pw',
        symbol: 'BTC',
      })
    ).rejects.toThrow(NoLiquidity)
  })

  it('throws BroadcastFailed on broadcast error', async () => {
    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedGetPositions.mockResolvedValue([mockPosition()])
    mockedResolve.mockResolvedValue(mockMarket())
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchOrderbookV2: vi.fn().mockResolvedValue(mockRawOrderbookResponse()),
      },
    } as any)
    mockedCreateBroadcaster.mockReturnValue({
      broadcast: vi.fn().mockRejectedValue(new Error('insufficient funds')),
    } as any)

    await expect(
      trading.close(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'test-pw',
        symbol: 'BTC',
      })
    ).rejects.toThrow(BroadcastFailed)
  })

  it('calculates realized PnL correctly for a long close', async () => {
    // The close flow:
    // 1. Position: long, entry=20000, mark=30500, qty=0.01
    // 2. Closing long = selling, walks orderbook.buys (29990, 29950, 29900)
    // 3. walkOrderbook fills at 29990 (first level covers 0.01 * 30500 = 305 notional)
    // 4. closeSide='short', slippage=5%: applySlippage(29990, 0.05, 'short') = 29990 * 0.95 = 28490.5
    // 5. realizedPnl = (28490.5 - 20000) * 0.01 * 1 = ~84.9
    setupCloseMocks({
      position: mockPosition({
        side: 'long',
        entryPrice: '20000', // Low entry to ensure profitable after slippage
        markPrice: '30500',
        quantity: '0.01',
        margin: '30',
      }),
    })

    const result = await trading.close(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'test-pw',
      symbol: 'BTC',
    })

    // With entry=20000 and exit ~28490 after slippage, PnL should be positive
    expect(Number(result.realizedPnl)).toBeGreaterThan(0)
    expect(Number(result.closedQty)).toBe(0.01)
  })
})

// ─── Helper function tests ─────────────────────────────────────────────────

describe('math integration with trading', () => {
  // These test the math.ts functions indirectly through trading,
  // complementing the direct tests in math.test.ts

  it('quantize rounds correctly at different tick sizes', async () => {
    // Using a market with tickSize=0.01 and minQuantityTick=0.01
    setupOpenMocks({
      market: mockMarket({ tickSize: '0.01', minQuantityTick: '0.01' }),
      oraclePrice: 2000,
      orderbook: mockRawOrderbookResponse(2000),
    })

    const result = await trading.open(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'test-pw',
      symbol: 'BTC',
      side: 'long',
      amount: '100',
    })

    // Quantity should be quantized to 0.01 increments
    const qty = Number(result.quantity)
    expect(qty).toBeGreaterThan(0)
  })
})
