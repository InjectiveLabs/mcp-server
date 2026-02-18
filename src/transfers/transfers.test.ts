import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transfers } from './index.js'
import { testConfig, mockBalances } from '../test-utils/index.js'
import type { Config } from '../config/index.js'

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../wallets/index.js', () => ({
  wallets: {
    unlock: vi.fn(() => '0x' + 'ab'.repeat(32)),
  },
}))

vi.mock('../accounts/index.js', () => ({
  accounts: {
    getDenomMetadata: vi.fn(async (_config: Config, denom: string) => {
      if (denom === 'inj') return { symbol: 'INJ', decimals: 18, tokenType: 'native' }
      if (denom.startsWith('peggy0x')) return { symbol: 'USDT', decimals: 6, tokenType: 'peggy' }
      return { symbol: denom, decimals: null, tokenType: 'unknown' }
    }),
    getBalances: vi.fn(async () => mockBalances()),
  },
}))

const mockBroadcast = vi.fn(async () => ({ txHash: 'AABB' + '00'.repeat(30) }))

vi.mock('../client/index.js', () => ({
  createClient: vi.fn(() => ({})),
  createBroadcaster: vi.fn(() => ({ broadcast: mockBroadcast })),
}))

// Re-import mocks for assertion access
import { wallets } from '../wallets/index.js'
import { accounts } from '../accounts/index.js'

const config = testConfig()

// ─── transfers.send ─────────────────────────────────────────────────────────

describe('transfers.send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBroadcast.mockResolvedValue({ txHash: 'AABB' + '00'.repeat(30) })
  })

  it('sends INJ successfully', async () => {
    const result = await transfers.send(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpass123',
      recipient: 'inj1' + 'b'.repeat(38),
      denom: 'inj',
      amount: '0.5',
    })

    expect(result.txHash).toBe('AABB' + '00'.repeat(30))
    expect(result.from).toBe('inj1' + 'a'.repeat(38))
    expect(result.to).toBe('inj1' + 'b'.repeat(38))
    expect(result.denom).toBe('inj')
    expect(result.amount).toBe('0.5')
    expect(wallets.unlock).toHaveBeenCalledWith('inj1' + 'a'.repeat(38), 'testpass123')
  })

  it('sends USDT (peggy) successfully', async () => {
    const result = await transfers.send(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpass123',
      recipient: 'inj1' + 'b'.repeat(38),
      denom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
      amount: '100',
    })

    expect(result.txHash).toBe('AABB' + '00'.repeat(30))
    expect(result.denom).toBe('peggy0xdAC17F958D2ee523a2206206994597C13D831ec7')
    expect(result.amount).toBe('100')
  })

  it('throws SelfTransferBlocked when sender == recipient', async () => {
    const addr = 'inj1' + 'a'.repeat(38)
    await expect(
      transfers.send(config, {
        address: addr,
        password: 'testpass123',
        recipient: addr,
        denom: 'inj',
        amount: '1',
      })
    ).rejects.toThrow('Cannot send tokens to yourself')
  })

  it('throws InvalidTransferAmount for zero amount', async () => {
    await expect(
      transfers.send(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        recipient: 'inj1' + 'b'.repeat(38),
        denom: 'inj',
        amount: '0',
      })
    ).rejects.toThrow('Amount must be greater than zero')
  })

  it('throws UnknownDecimals for unknown denom', async () => {
    await expect(
      transfers.send(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        recipient: 'inj1' + 'b'.repeat(38),
        denom: 'unknowndenom',
        amount: '1',
      })
    ).rejects.toThrow('decimals unknown')
  })

  it('throws InsufficientBalance when balance too low', async () => {
    // Mock balances with very low INJ balance
    vi.mocked(accounts.getBalances).mockResolvedValueOnce({
      bank: [{ denom: 'inj', symbol: 'INJ', amount: '0.001000', decimals: 18, tokenType: 'native' }],
      subaccount: [],
    })

    await expect(
      transfers.send(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        recipient: 'inj1' + 'b'.repeat(38),
        denom: 'inj',
        amount: '100',
      })
    ).rejects.toThrow('Insufficient balance')
  })

  it('wraps broadcast errors in BroadcastFailed', async () => {
    mockBroadcast.mockRejectedValueOnce(new Error('gas estimation failed'))

    await expect(
      transfers.send(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        recipient: 'inj1' + 'b'.repeat(38),
        denom: 'inj',
        amount: '0.001',
      })
    ).rejects.toThrow('Transaction broadcast failed')
  })
})

// ─── transfers.deposit ──────────────────────────────────────────────────────

describe('transfers.deposit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBroadcast.mockResolvedValue({ txHash: 'CCDD' + '00'.repeat(30) })
  })

  it('deposits USDT to default subaccount (0)', async () => {
    const result = await transfers.deposit(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpass123',
      denom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
      amount: '100',
    })

    expect(result.txHash).toBe('CCDD' + '00'.repeat(30))
    expect(result.address).toBe('inj1' + 'a'.repeat(38))
    expect(result.subaccountId).toBeTruthy()
    expect(result.denom).toBe('peggy0xdAC17F958D2ee523a2206206994597C13D831ec7')
    expect(result.amount).toBe('100')
  })

  it('deposits to custom subaccount index', async () => {
    const result = await transfers.deposit(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpass123',
      denom: 'inj',
      amount: '1',
      subaccountIndex: 5,
    })

    expect(result.txHash).toBe('CCDD' + '00'.repeat(30))
    expect(result.subaccountId).toBeTruthy()
  })

  it('throws InvalidTransferAmount for zero amount', async () => {
    await expect(
      transfers.deposit(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        denom: 'inj',
        amount: '0',
      })
    ).rejects.toThrow('Amount must be greater than zero')
  })

  it('throws UnknownDecimals for unknown denom', async () => {
    await expect(
      transfers.deposit(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        denom: 'unknowndenom',
        amount: '1',
      })
    ).rejects.toThrow('decimals unknown')
  })

  it('wraps broadcast errors in BroadcastFailed', async () => {
    mockBroadcast.mockRejectedValueOnce(new Error('sequence mismatch'))

    await expect(
      transfers.deposit(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        denom: 'inj',
        amount: '1',
      })
    ).rejects.toThrow('Transaction broadcast failed')
  })
})

// ─── transfers.withdraw ─────────────────────────────────────────────────────

describe('transfers.withdraw', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBroadcast.mockResolvedValue({ txHash: 'EEFF' + '00'.repeat(30) })
  })

  it('withdraws INJ from default subaccount', async () => {
    const result = await transfers.withdraw(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpass123',
      denom: 'inj',
      amount: '5',
    })

    expect(result.txHash).toBe('EEFF' + '00'.repeat(30))
    expect(result.address).toBe('inj1' + 'a'.repeat(38))
    expect(result.subaccountId).toBeTruthy()
    expect(result.denom).toBe('inj')
    expect(result.amount).toBe('5')
  })

  it('withdraws from custom subaccount index', async () => {
    const result = await transfers.withdraw(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpass123',
      denom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
      amount: '50',
      subaccountIndex: 2,
    })

    expect(result.txHash).toBe('EEFF' + '00'.repeat(30))
    expect(result.subaccountId).toBeTruthy()
  })

  it('throws InvalidTransferAmount for zero amount', async () => {
    await expect(
      transfers.withdraw(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        denom: 'inj',
        amount: '0',
      })
    ).rejects.toThrow('Amount must be greater than zero')
  })

  it('throws UnknownDecimals for unknown denom', async () => {
    await expect(
      transfers.withdraw(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        denom: 'unknowndenom',
        amount: '1',
      })
    ).rejects.toThrow('decimals unknown')
  })

  it('wraps broadcast errors in BroadcastFailed', async () => {
    mockBroadcast.mockRejectedValueOnce(new Error('insufficient funds'))

    await expect(
      transfers.withdraw(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        denom: 'inj',
        amount: '1',
      })
    ).rejects.toThrow('Transaction broadcast failed')
  })
})
