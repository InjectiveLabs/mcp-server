/**
 * Unit tests for EIP-712 trading module.
 * Network calls are mocked — no testnet required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testConfig } from '../test-utils/index.js'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../wallets/index.js', () => ({
  wallets: {
    unlock: vi.fn().mockReturnValue('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
  },
}))

vi.mock('../markets/index.js', () => ({
  markets: {
    resolve: vi.fn().mockResolvedValue({
      marketId: '0xbtcmarket',
      symbol: 'BTC',
      tickSize: '1000',
      minQuantityTick: '0.001',
      maintenanceMarginRatio: '0.05',
      oracleBase: 'BTC',
      oracleQuote: 'USDT',
      oracleType: 'bandibc',
    }),
    getPrice: vi.fn().mockResolvedValue({ toFixed: () => '50000', mul: (x: any) => ({ div: () => ({ toFixed: () => '0.002' }) }), eq: () => false, div: () => ({ toFixed: () => '0.002' }) }),
  },
}))

vi.mock('../accounts/index.js', () => ({
  accounts: {
    getPositions: vi.fn().mockResolvedValue([{
      symbol: 'BTC',
      side: 'long',
      quantity: '0.002',
      entryPrice: '50000',
      markPrice: '51000',
      unrealizedPnl: '2',
    }]),
  },
}))

vi.mock('../client/index.js', () => ({
  createClient: vi.fn().mockReturnValue({
    derivativesApi: {
      fetchOrderbookV2: vi.fn().mockResolvedValue({
        sells: [{ price: '50500000000', quantity: '1' }],
        buys: [{ price: '49500000000', quantity: '1' }],
      }),
    },
    txApi: {
      broadcast: vi.fn().mockResolvedValue({ code: 0, txHash: '0xabc123', rawLog: '' }),
    },
  }),
}))

vi.mock('@injectivelabs/sdk-ts', async () => {
  const actual = await vi.importActual('@injectivelabs/sdk-ts') as Record<string, unknown>
  return {
    ...actual,
    MsgCreateDerivativeMarketOrder: {
      fromJSON: vi.fn().mockReturnValue({ toAmino: () => ({}) }),
    },
    getEip712TypedData: vi.fn().mockReturnValue({
      domain: { name: 'Injective', version: '1.0', chainId: '0x6f0' },
      types: {
        EIP712Domain: [{ name: 'name', type: 'string' }],
        MsgValue: [{ name: 'market_id', type: 'string' }],
      },
      primaryType: 'MsgValue',
      message: { market_id: '0xbtcmarket' },
    }),
    createTxRawEIP712: vi.fn().mockReturnValue({ signatures: [] }),
    createWeb3Extension: vi.fn().mockReturnValue({}),
    createTransaction: vi.fn().mockReturnValue({ txRaw: {} }),
    ChainRestAuthApi: vi.fn().mockImplementation(() => ({
      fetchAccount: vi.fn().mockResolvedValue({
        account: {
          base_account: {
            account_number: '42',
            sequence: '7',
            pub_key: { key: 'AAAA' },
          },
        },
      }),
    })),
    ChainRestTendermintApi: vi.fn().mockImplementation(() => ({
      fetchLatestBlock: vi.fn().mockResolvedValue({
        header: { height: '12345678' },
      }),
    })),
    Address: {
      fromHex: vi.fn().mockReturnValue({
        getSubaccountId: vi.fn().mockReturnValue('0xsub000'),
      }),
    },
    OrderTypeMap: { BUY: 1, SELL: 2 },
    SIGN_AMINO: 1,
  }
})

vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers') as Record<string, unknown>
  return {
    ...actual,
    Wallet: vi.fn().mockImplementation(() => ({
      address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      signTypedData: vi.fn().mockResolvedValue(
        '0x' + 'ab'.repeat(65)
      ),
    })),
  }
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('eip712', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('eip712.open', () => {
    it('returns txHash and trade details on success', async () => {
      const { eip712 } = await import('./eip712.js')
      const result = await eip712.open(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass',
        symbol: 'BTC',
        side: 'long',
        amount: '100',
        leverage: 10,
      })

      expect(result.txHash).toBe('0xabc123')
      expect(result).toHaveProperty('executionPrice')
      expect(result).toHaveProperty('quantity')
      expect(result).toHaveProperty('margin')
      expect(result).toHaveProperty('liquidationPrice')
    })

    it('signs with ethers.Wallet.signTypedData', async () => {
      const { Wallet } = await import('ethers')
      const { eip712 } = await import('./eip712.js')

      await eip712.open(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass',
        symbol: 'BTC',
        side: 'long',
        amount: '100',
      })

      const walletInstance = vi.mocked(Wallet).mock.results[0]?.value
      expect(walletInstance?.signTypedData).toHaveBeenCalled()
      // EIP712Domain must be stripped from types passed to signTypedData
      const [_domain, types] = walletInstance?.signTypedData.mock.calls[0]
      expect(types).not.toHaveProperty('EIP712Domain')
    })

    it('throws BroadcastFailed when chain returns non-zero code', async () => {
      const { createClient } = await import('../client/index.js')
      vi.mocked(createClient).mockReturnValueOnce({
        derivativesApi: {
          fetchOrderbookV2: vi.fn().mockResolvedValue({
            sells: [{ price: '50500000000', quantity: '1' }],
            buys: [],
          }),
        },
        txApi: {
          broadcast: vi.fn().mockResolvedValue({ code: 12, txHash: '', rawLog: 'insufficient funds' }),
        },
      } as any)

      const { eip712 } = await import('./eip712.js')
      await expect(
        eip712.open(testConfig(), {
          address: 'inj1' + 'a'.repeat(38),
          password: 'testpass',
          symbol: 'BTC',
          side: 'long',
          amount: '100',
        })
      ).rejects.toThrow('broadcast failed')
    })

    it('throws NoLiquidity when orderbook is empty', async () => {
      const { createClient } = await import('../client/index.js')
      vi.mocked(createClient).mockReturnValueOnce({
        derivativesApi: {
          fetchOrderbookV2: vi.fn().mockResolvedValue({ sells: [], buys: [] }),
        },
        txApi: { broadcast: vi.fn() },
      } as any)

      const { eip712 } = await import('./eip712.js')
      await expect(
        eip712.open(testConfig(), {
          address: 'inj1' + 'a'.repeat(38),
          password: 'testpass',
          symbol: 'BTC',
          side: 'long',
          amount: '100',
        })
      ).rejects.toThrow('no liquidity')
    })
  })

  describe('eip712.close', () => {
    it('returns txHash and close details on success', async () => {
      const { eip712 } = await import('./eip712.js')
      const result = await eip712.close(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass',
        symbol: 'BTC',
      })

      expect(result.txHash).toBe('0xabc123')
      expect(result).toHaveProperty('closedQty')
      expect(result).toHaveProperty('exitPrice')
      expect(result).toHaveProperty('realizedPnl')
    })

    it('throws NoPositionFound when no open position exists', async () => {
      const { accounts } = await import('../accounts/index.js')
      vi.mocked(accounts.getPositions).mockResolvedValueOnce([])

      const { eip712 } = await import('./eip712.js')
      await expect(
        eip712.close(testConfig(), {
          address: 'inj1' + 'a'.repeat(38),
          password: 'testpass',
          symbol: 'ETH',
        })
      ).rejects.toThrow('No open position found')
    })

    it('strips EIP712Domain from types before signing', async () => {
      const { Wallet } = await import('ethers')
      const { eip712 } = await import('./eip712.js')

      await eip712.close(testConfig(), {
        address: 'inj1' + 'a'.repeat(38),
        password: 'testpass',
        symbol: 'BTC',
      })

      const walletInstance = vi.mocked(Wallet).mock.results[0]?.value
      const [_domain, types] = walletInstance?.signTypedData.mock.calls[0]
      expect(types).not.toHaveProperty('EIP712Domain')
      expect(types).toHaveProperty('MsgValue')
    })
  })
})
