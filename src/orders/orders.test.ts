import { describe, it, expect, vi, beforeEach } from 'vitest'
import { orders } from './index.js'
import { testConfig, mockMarket } from '../test-utils/index.js'
import { BroadcastFailed, InvalidOrderStatesQuery, InvalidOrderParameters } from '../errors/index.js'
import { MsgCreateDerivativeLimitOrder } from '@injectivelabs/sdk-ts'

vi.mock('../markets/index.js', () => ({
  markets: {
    resolve: vi.fn(),
  },
}))

vi.mock('../wallets/index.js', () => ({
  wallets: {
    unlock: vi.fn(),
  },
}))

vi.mock('../client/index.js', () => ({
  createClient: vi.fn(),
  createBroadcaster: vi.fn(),
  withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}))

vi.mock('@injectivelabs/sdk-ts', () => ({
  MsgCreateDerivativeLimitOrder: {
    fromJSON: vi.fn().mockReturnValue({ type: 'mock-limit-open' }),
  },
  MsgCancelDerivativeOrder: {
    fromJSON: vi.fn().mockReturnValue({ type: 'mock-limit-close' }),
  },
  OrderTypeMap: {
    BUY: 1,
    SELL: 2,
    BUY_PO: 7,
    SELL_PO: 8,
  },
  getEthereumAddress: vi.fn().mockReturnValue('0x' + '1'.repeat(40)),
}))

import { markets } from '../markets/index.js'
import { wallets } from '../wallets/index.js'
import { createClient, createBroadcaster } from '../client/index.js'

const mockedResolve = vi.mocked(markets.resolve)
const mockedUnlock = vi.mocked(wallets.unlock)
const mockedCreateClient = vi.mocked(createClient)
const mockedCreateBroadcaster = vi.mocked(createBroadcaster)
const mockedMsgCreateDerivativeLimitOrder = vi.mocked(MsgCreateDerivativeLimitOrder.fromJSON)

describe('orders.tradeLimitOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens a limit order and returns normalized response', async () => {
    mockedResolve.mockResolvedValue(mockMarket())
    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedCreateBroadcaster.mockReturnValue({
      broadcast: vi.fn().mockResolvedValue({ txHash: 'A'.repeat(64) }),
    } as any)

    const result = await orders.tradeLimitOpen(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'secret-pw',
      symbol: 'BTC',
      side: 'buy',
      price: '32000',
      quantity: '0.01',
      margin: '20',
      postOnly: true,
    })

    expect(result.txHash).toBe('A'.repeat(64))
    expect(result.symbol).toBe('BTC')
    expect(result.side).toBe('buy')
    expect(result.postOnly).toBe(true)
  })

  it('wraps broadcast failures in BroadcastFailed', async () => {
    mockedResolve.mockResolvedValue(mockMarket())
    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedCreateBroadcaster.mockReturnValue({
      broadcast: vi.fn().mockRejectedValue(new Error('out of gas')),
    } as any)

    await expect(
      orders.tradeLimitOpen(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'secret-pw',
        symbol: 'BTC',
        side: 'buy',
        price: '32000',
        quantity: '0.01',
        margin: '20',
      })
    ).rejects.toThrow(BroadcastFailed)
  })

  it('allows reduce-only limit orders with zero margin', async () => {
    mockedResolve.mockResolvedValue(mockMarket())
    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedCreateBroadcaster.mockReturnValue({
      broadcast: vi.fn().mockResolvedValue({ txHash: 'C'.repeat(64) }),
    } as any)

    const result = await orders.tradeLimitOpen(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'secret-pw',
      symbol: 'BTC',
      side: 'sell',
      price: '33000',
      quantity: '0.01',
      margin: '0',
      reduceOnly: true,
    })

    expect(result.reduceOnly).toBe(true)
    expect(result.margin).toBe('0')
    expect(mockedMsgCreateDerivativeLimitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        margin: '0',
        isReduceOnly: true,
      })
    )
  })

  it('rejects reduce-only limit orders with non-zero margin', async () => {
    mockedResolve.mockResolvedValue(mockMarket())

    await expect(
      orders.tradeLimitOpen(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'secret-pw',
        symbol: 'BTC',
        side: 'sell',
        price: '33000',
        quantity: '0.01',
        margin: '10',
        reduceOnly: true,
      })
    ).rejects.toThrow(new InvalidOrderParameters('margin must be "0" when reduceOnly is true'))
  })

  it('rejects non-reduce-only limit orders with zero margin', async () => {
    mockedResolve.mockResolvedValue(mockMarket())

    await expect(
      orders.tradeLimitOpen(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'secret-pw',
        symbol: 'BTC',
        side: 'buy',
        price: '32000',
        quantity: '0.01',
        margin: '0',
      })
    ).rejects.toThrow(new InvalidOrderParameters('margin must be greater than zero'))
  })
})

describe('orders.tradeLimitOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns normalized open orders list', async () => {
    mockedResolve.mockResolvedValue(mockMarket())
    mockedCreateClient.mockReturnValue({
      derivativesApi: {
        fetchSubaccountOrdersList: vi.fn().mockResolvedValue({
          orders: [{
            orderHash: '0x' + 'a'.repeat(64),
            marketId: '0x' + 'a'.repeat(64),
            subaccountId: '0x' + '1'.repeat(64),
            orderType: 'buy',
            price: '32000000000',
            quantity: '0.01',
            fillable: '0.01',
          }],
        }),
      },
      accountApi: null,
    } as any)

    const result = await orders.tradeLimitOrders(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      symbol: 'BTC',
    })

    expect(result).toHaveLength(1)
    expect(result[0]!.orderHash).toMatch(/^0x/)
    expect(result[0]!.side).toBe('buy')
    expect(result[0]!.price).toBe('32000.000000')
    expect(result[0]!.quantity).toBe('0.01')
    expect(result[0]!.fillable).toBe('0.01')
  })
})

describe('orders.tradeLimitClose', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('cancels by order hash', async () => {
    mockedResolve.mockResolvedValue(mockMarket())
    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedCreateBroadcaster.mockReturnValue({
      broadcast: vi.fn().mockResolvedValue({ txHash: 'B'.repeat(64) }),
    } as any)

    const result = await orders.tradeLimitClose(testConfig(), {
      address: 'inj1' + 'a'.repeat(38),
      password: 'secret-pw',
      symbol: 'BTC',
      orderHash: '0x' + 'b'.repeat(64),
    })

    expect(result.txHash).toBe('B'.repeat(64))
    expect(result.orderHash).toMatch(/^0x/)
  })

  it('throws InvalidOrderParameters when orderHash is missing', async () => {
    await expect(
      orders.tradeLimitClose(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'secret-pw',
        symbol: 'BTC',
        // Deliberately invalid shape to exercise runtime guard.
        orderHash: '' as unknown as string,
      } as any)
    ).rejects.toThrow(InvalidOrderParameters)
  })

  it('wraps broadcast failures in BroadcastFailed', async () => {
    mockedResolve.mockResolvedValue(mockMarket())
    mockedUnlock.mockReturnValue('0x' + 'f'.repeat(64))
    mockedCreateBroadcaster.mockReturnValue({
      broadcast: vi.fn().mockRejectedValue(new Error('failed cancel')),
    } as any)

    await expect(
      orders.tradeLimitClose(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'secret-pw',
        symbol: 'BTC',
        orderHash: '0x' + 'd'.repeat(64),
      })
    ).rejects.toThrow(BroadcastFailed)
  })
})

describe('orders.tradeLimitStates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws InvalidOrderStatesQuery for empty hash list', async () => {
    await expect(
      orders.tradeLimitStates(testConfig(), { derivativeOrderHashes: [] })
    ).rejects.toThrow(InvalidOrderStatesQuery)
  })

  it('normalizes returned order states', async () => {
    mockedCreateClient.mockReturnValue({
      derivativesApi: {},
      accountApi: {
        fetchOrderStates: vi.fn().mockResolvedValue({
          orderStates: [
            { orderHash: '0x1', status: 'booked' },
            { orderHash: '0x2', status: 'partially_filled' },
            { orderHash: '0x3', status: 'filled' },
            { orderHash: '0x4', status: 'canceled' },
          ],
        }),
      },
    } as any)

    const result = await orders.tradeLimitStates(testConfig(), {
      derivativeOrderHashes: ['0x1', '0x2', '0x3', '0x4'],
    })

    expect(result).toHaveLength(4)
    expect(result[0]!.status).toBe('booked')
    expect(result[1]!.status).toBe('partial')
    expect(result[2]!.status).toBe('filled')
    expect(result[3]!.status).toBe('canceled')
  })
})
