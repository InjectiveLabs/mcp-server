import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { testConfig } from '../test-utils/index.js'

const mocks = vi.hoisted(() => ({
  mockUnlock: vi.fn(() => '0x' + '11'.repeat(32)),
  mockGetDenomMetadata: vi.fn(async (_config: unknown, denom: string) => {
    if (denom === 'inj') return { symbol: 'INJ', decimals: 18, tokenType: 'native' }
    if (denom.startsWith('erc20:')) return { symbol: 'USDT', decimals: 6, tokenType: 'erc20' }
    return { symbol: denom, decimals: null, tokenType: 'unknown' }
  }),
  mockBroadcastEvmTx: vi.fn(async () => ({
    txHash: 'CC'.repeat(32),
    from: '0x' + 'aa'.repeat(20),
    nonce: 1,
    gasPrice: '1',
    gasLimit: '300000',
    value: '0',
    chainId: 1738,
    data: '0x',
  })),
  mockInjAddressToEth: vi.fn(() => '0x' + 'aa'.repeat(20)),
  mockExtractErc20Address: vi.fn((denom: string) => denom.replace('erc20:', '')),
  mockEncodeErc20Approve: vi.fn(() => '0x095ea7b3'),
}))

vi.mock('../wallets/index.js', () => ({
  wallets: {
    unlock: mocks.mockUnlock,
  },
}))

vi.mock('../accounts/index.js', () => ({
  accounts: {
    getDenomMetadata: mocks.mockGetDenomMetadata,
  },
}))

vi.mock('../evm/index.js', () => ({
  evm: {
    broadcastEvmTx: mocks.mockBroadcastEvmTx,
  },
  injAddressToEth: mocks.mockInjAddressToEth,
  extractErc20Address: mocks.mockExtractErc20Address,
  encodeErc20Approve: mocks.mockEncodeErc20Approve,
}))

import { wallets } from '../wallets/index.js'
import { accounts } from '../accounts/index.js'
import { evm } from '../evm/index.js'
import {
  debridge,
  resolveDstChainId,
  getQuote,
  sendBridge,
  fetchDeBridgeApi,
  DEBRIDGE_INJECTIVE_CHAIN_ID,
} from './debridge.js'

const fetchMock = vi.fn()
const config = testConfig()

describe('debridge helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('resolves named destination chains', () => {
    expect(resolveDstChainId('ethereum')).toBe(1)
    expect(resolveDstChainId('bsc')).toBe(56)
    expect(resolveDstChainId('base')).toBe(8453)
    expect(resolveDstChainId('solana')).toBe(7565164)
  })

  it('resolves numeric destination chain IDs', () => {
    expect(resolveDstChainId(42161)).toBe(42161)
    expect(resolveDstChainId('10')).toBe(10)
  })

  it('throws for unsupported chain names', () => {
    expect(() => resolveDstChainId('moonbeam')).toThrow('Unsupported bridge destination chain')
  })

  it('fetchDeBridgeApi returns parsed json on success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))

    const data = await fetchDeBridgeApi('https://dln.debridge.finance/v1.0/dln/order/create-tx?x=1')
    expect(data['ok']).toBe(true)
  })

  it('fetchDeBridgeApi throws on non-200 responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'bad request' }), { status: 400 }))
    await expect(
      fetchDeBridgeApi('https://dln.debridge.finance/v1.0/dln/order/create-tx?x=1')
    ).rejects.toThrow('HTTP 400')
  })

  it('fetchDeBridgeApi blocks non-allowlisted hosts', async () => {
    await expect(
      fetchDeBridgeApi('https://example.com/dln/order/create-tx')
    ).rejects.toThrow('Blocked outbound URL')
  })
})

describe('debridge.getQuote', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('quotes INJ bridge with native token address', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      estimation: { dstChainTokenOut: '995000000000000000' },
    }), { status: 200 }))

    const result = await getQuote(config, {
      srcDenom: 'inj',
      amount: '1',
      dstChain: 'ethereum',
      dstTokenAddress: '0x' + 'bb'.repeat(20),
      recipient: '0x' + 'cc'.repeat(20),
    })

    expect(result.srcChainId).toBe(DEBRIDGE_INJECTIVE_CHAIN_ID)
    expect(result.dstChainId).toBe(1)
    expect(result.srcAmountBase).toBe('1000000000000000000')
    expect(result.estimation).toEqual({ dstChainTokenOut: '995000000000000000' })
    expect(accounts.getDenomMetadata).toHaveBeenCalledWith(config, 'inj')

    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? '')
    expect(calledUrl).toContain('srcChainId=100000029')
    expect(calledUrl).toContain('srcChainTokenIn=0x0000000000000000000000000000000000000000')
    expect(calledUrl).toContain('srcChainTokenInAmount=1000000000000000000')
    expect(calledUrl).toContain('dstChainId=1')
  })

  it('quotes ERC20 bridge using extracted token address', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      estimation: { dstChainTokenOut: '1000000' },
    }), { status: 200 }))

    const result = await getQuote(config, {
      srcDenom: 'erc20:0x' + 'dd'.repeat(20),
      amount: '2.5',
      dstChain: 'base',
      dstTokenAddress: '0x' + 'ee'.repeat(20),
      recipient: '0x' + 'ff'.repeat(20),
    })

    expect(result.dstChainId).toBe(8453)
    expect(result.srcAmountBase).toBe('2500000')
    expect(mocks.mockExtractErc20Address).toHaveBeenCalled()
  })

  it('throws UnknownDecimals when source denom metadata has no decimals', async () => {
    mocks.mockGetDenomMetadata.mockResolvedValueOnce({ symbol: 'UNK', decimals: null, tokenType: 'unknown' })
    await expect(
      getQuote(config, {
        srcDenom: 'erc20:0x' + 'ab'.repeat(20),
        amount: '1',
        dstChain: 'ethereum',
        dstTokenAddress: '0x' + 'aa'.repeat(20),
        recipient: '0x' + 'bb'.repeat(20),
      })
    ).rejects.toThrow('decimals unknown')
  })
})

describe('debridge.sendBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('orchestrates API call + EVM broadcast and returns txHash/orderId', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      orderId: 'order-123',
      estimation: { dstChainTokenOut: '995000000000000000' },
      tx: {
        to: '0x' + 'ab'.repeat(20),
        data: '0x1234',
        value: '1000',
      },
    }), { status: 200 }))

    const result = await sendBridge(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'secret-pass',
      srcDenom: 'inj',
      amount: '1',
      dstChain: 'base',
      dstTokenAddress: '0x' + 'bc'.repeat(20),
      recipient: '0x' + 'cd'.repeat(20),
    })

    expect(result.txHash).toBe('CC'.repeat(32))
    expect(result.orderId).toBe('order-123')
    expect(result.dstChainId).toBe(8453)
    expect(wallets.unlock).toHaveBeenCalledWith('inj1' + 'a'.repeat(38), 'secret-pass')
    expect(mocks.mockInjAddressToEth).toHaveBeenCalledWith('inj1' + 'a'.repeat(38))
    expect(evm.broadcastEvmTx).toHaveBeenCalledTimes(1)
  })

  it('sends ERC20 approve tx before bridge tx', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      orderId: 'order-erc20',
      tx: {
        to: '0x' + 'ab'.repeat(20),
        data: '0x1234',
        value: '0',
      },
    }), { status: 200 }))

    const result = await sendBridge(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'secret-pass',
      srcDenom: 'erc20:0x' + 'dd'.repeat(20),
      amount: '2.5',
      dstChain: 'base',
      dstTokenAddress: '0x' + 'bc'.repeat(20),
      recipient: '0x' + 'cd'.repeat(20),
    })

    expect(result.approvalTxHash).toBe('CC'.repeat(32))
    expect(mocks.mockEncodeErc20Approve).toHaveBeenCalledWith('0x' + 'ab'.repeat(20), '2500000')
    expect(evm.broadcastEvmTx).toHaveBeenCalledTimes(2)

    const firstCall = vi.mocked(evm.broadcastEvmTx).mock.calls[0]?.[1]
    const secondCall = vi.mocked(evm.broadcastEvmTx).mock.calls[1]?.[1]
    expect(firstCall?.to).toBe('0x' + 'dd'.repeat(20))
    expect(secondCall?.to).toBe('0x' + 'ab'.repeat(20))
    expect(secondCall?.nonce).toBe(2)
  })

  it('uses dstAuthorityAddress override when provided', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      orderId: 'order-456',
      tx: {
        to: '0x' + 'ab'.repeat(20),
        data: '0x1234',
        value: '0',
      },
    }), { status: 200 }))

    await sendBridge(config, {
      address: 'inj1' + 'a'.repeat(38),
      password: 'secret-pass',
      srcDenom: 'inj',
      amount: '0.5',
      dstChain: 'ethereum',
      dstTokenAddress: '0x' + 'bc'.repeat(20),
      recipient: '0x' + 'cd'.repeat(20),
      dstAuthorityAddress: '0x' + 'ef'.repeat(20),
    })

    const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? '')
    expect(calledUrl).toContain(`dstChainOrderAuthorityAddress=${encodeURIComponent('0x' + 'ef'.repeat(20))}`)
  })

  it('throws when deBridge response misses tx payload', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      orderId: 'order-789',
    }), { status: 200 }))

    await expect(
      sendBridge(config, {
        address: 'inj1' + 'a'.repeat(38),
        password: 'secret-pass',
        srcDenom: 'inj',
        amount: '1',
        dstChain: 'ethereum',
        dstTokenAddress: '0x' + 'bc'.repeat(20),
        recipient: '0x' + 'cd'.repeat(20),
      })
    ).rejects.toThrow('Missing tx object')
  })
})

describe('debridge namespace export', () => {
  it('exposes quote/send functions', () => {
    expect(typeof debridge.getQuote).toBe('function')
    expect(typeof debridge.sendBridge).toBe('function')
    expect(typeof debridge.resolveDstChainId).toBe('function')
  })
})
