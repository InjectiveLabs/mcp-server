import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bridges } from './index.js'
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
      if (denom.startsWith('ibc/')) return { symbol: 'ATOM', decimals: 6, tokenType: 'ibc' }
      return { symbol: denom, decimals: null, tokenType: 'unknown' }
    }),
    getBalances: vi.fn(async () => mockBalances()),
  },
}))

const mockBroadcast = vi.fn(async () => ({ txHash: 'BBCC' + '00'.repeat(30) }))

vi.mock('../client/index.js', () => ({
  createClient: vi.fn(() => ({})),
  createBroadcaster: vi.fn(() => ({ broadcast: mockBroadcast })),
}))

import { accounts } from '../accounts/index.js'

const config = testConfig()

// ─── bridges.withdrawToEth ──────────────────────────────────────────────────

describe('bridges.withdrawToEth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBroadcast.mockResolvedValue({ txHash: 'BBCC' + '00'.repeat(30) })
  })

  it('withdraws INJ to Ethereum with default bridge fee', async () => {
    const result = await bridges.withdrawToEth(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpass123',
      ethRecipient: '0x' + 'ab'.repeat(20),
      denom: 'inj',
      amount: '0.5',
    })

    expect(result.txHash).toBe('BBCC' + '00'.repeat(30))
    expect(result.from).toBe('inj1' + 'a'.repeat(38))
    expect(result.ethRecipient).toBe('0x' + 'ab'.repeat(20))
    expect(result.denom).toBe('inj')
    expect(result.amount).toBe('0.5')
    expect(result.bridgeFee).toBe('0.001')
    expect(result.estimatedArrival).toBe('~30 minutes')
  })

  it('withdraws USDT with custom bridge fee', async () => {
    const result = await bridges.withdrawToEth(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'testpass123',
      ethRecipient: '0x' + 'cd'.repeat(20),
      denom: 'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7',
      amount: '50',
      bridgeFee: '2',
    })

    expect(result.txHash).toBe('BBCC' + '00'.repeat(30))
    expect(result.denom).toBe('peggy0xdAC17F958D2ee523a2206206994597C13D831ec7')
    expect(result.amount).toBe('50')
    expect(result.bridgeFee).toBe('2')
  })

  it('throws InvalidBridgeDenom for non-peggy denoms', async () => {
    await expect(
      bridges.withdrawToEth(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        ethRecipient: '0x' + 'ab'.repeat(20),
        denom: 'ibc/ABC123',
        amount: '1',
      })
    ).rejects.toThrow('not bridgeable via Peggy')
  })

  it('throws InvalidBridgeDenom for erc20 denoms', async () => {
    await expect(
      bridges.withdrawToEth(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        ethRecipient: '0x' + 'ab'.repeat(20),
        denom: 'erc20:0x1234567890abcdef',
        amount: '1',
      })
    ).rejects.toThrow('not bridgeable via Peggy')
  })

  it('throws InvalidTransferAmount for zero amount', async () => {
    await expect(
      bridges.withdrawToEth(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        ethRecipient: '0x' + 'ab'.repeat(20),
        denom: 'inj',
        amount: '0',
      })
    ).rejects.toThrow('Amount must be greater than zero')
  })

  it('throws InsufficientBalance when balance too low for amount + fee', async () => {
    vi.mocked(accounts.getBalances).mockResolvedValueOnce({
      bank: [{ denom: 'inj', symbol: 'INJ', amount: '0.001000', decimals: 18, tokenType: 'native' }],
      subaccount: [],
    })

    await expect(
      bridges.withdrawToEth(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        ethRecipient: '0x' + 'ab'.repeat(20),
        denom: 'inj',
        amount: '1',
      })
    ).rejects.toThrow('Insufficient balance')
  })

  it('wraps broadcast errors in BroadcastFailed', async () => {
    mockBroadcast.mockRejectedValueOnce(new Error('peggy bridge temporarily unavailable'))

    await expect(
      bridges.withdrawToEth(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass123',
        ethRecipient: '0x' + 'ab'.repeat(20),
        denom: 'inj',
        amount: '0.001',
      })
    ).rejects.toThrow('Transaction broadcast failed')
  })
})
