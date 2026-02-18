import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testConfig } from '../test-utils/index.js'
import { TxBody, TxRaw, AuthInfo } from '@injectivelabs/core-proto-ts-v2/generated/cosmos/tx/v1beta1/tx_pb'
import { MsgEthereumTx } from '@injectivelabs/core-proto-ts-v2/generated/injective/evm/v1/tx_pb'

const mockFetchAccount = vi.fn(async () => ({
  balance: '1000000000000000000',
  nonce: '12',
  codeHash: '0x' + 'ab'.repeat(32),
}))

const mockFetchBaseFee = vi.fn(async () => '2000000000')
const mockBroadcast = vi.fn(async () => ({
  txHash: 'A1'.repeat(32),
  code: 0,
  rawLog: '',
}))

vi.mock('../client/index.js', () => ({
  createClient: vi.fn(() => ({
    evmApi: {
      fetchAccount: mockFetchAccount,
      fetchBaseFee: mockFetchBaseFee,
    },
    txApi: {
      broadcast: mockBroadcast,
    },
  })),
}))

import {
  broadcastEvmTx,
  getEvmAccount,
  getBaseFee,
  encodeErc20Transfer,
  encodeErc20Approve,
  extractErc20Address,
  injAddressToEth,
  ethAddressToInj,
} from './index.js'

const config = testConfig()
const privateKeyHex = '0x' + '11'.repeat(32)
const to = '0x' + '22'.repeat(20)

describe('evm helpers', () => {
  it('encodes ERC20 transfer calldata', () => {
    const data = encodeErc20Transfer(to, '1000')
    expect(data.startsWith('0xa9059cbb')).toBe(true)
  })

  it('encodes ERC20 approve calldata', () => {
    const data = encodeErc20Approve(to, 42n)
    expect(data.startsWith('0x095ea7b3')).toBe(true)
  })

  it('rejects negative ERC20 transfer amount', () => {
    expect(() => encodeErc20Transfer(to, '-1')).toThrow('must be >=')
  })

  it('extracts ERC20 address from denom', () => {
    const address = extractErc20Address(`erc20:${to}`)
    expect(address.toLowerCase()).toBe(to.toLowerCase())
  })

  it('throws for invalid ERC20 denom format', () => {
    expect(() => extractErc20Address('inj')).toThrow('Not an ERC20 denom')
  })

  it('converts eth -> inj -> eth', () => {
    const inj = ethAddressToInj(to)
    const eth = injAddressToEth(inj)
    expect(eth.toLowerCase()).toBe(to.toLowerCase())
  })
})

describe('evm grpc helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchAccount.mockResolvedValue({
      balance: '1000000000000000000',
      nonce: '12',
      codeHash: '0x' + 'ab'.repeat(32),
    })
    mockFetchBaseFee.mockResolvedValue('2000000000')
    mockBroadcast.mockResolvedValue({
      txHash: 'A1'.repeat(32),
      code: 0,
      rawLog: '',
    })
  })

  it('fetches EVM account details', async () => {
    const account = await getEvmAccount(config, to)
    expect(account.nonce).toBe('12')
    expect(account.balance).toBe('1000000000000000000')
    expect(mockFetchAccount).toHaveBeenCalledWith(to)
  })

  it('throws for invalid EVM account address', async () => {
    await expect(getEvmAccount(config, 'not-an-address')).rejects.toThrow('Invalid Ethereum address')
  })

  it('fetches current base fee', async () => {
    const baseFee = await getBaseFee(config)
    expect(baseFee).toBe('2000000000')
    expect(mockFetchBaseFee).toHaveBeenCalledTimes(1)
  })
})

describe('broadcastEvmTx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchAccount.mockResolvedValue({
      balance: '1000000000000000000',
      nonce: '12',
      codeHash: '0x' + 'ab'.repeat(32),
    })
    mockFetchBaseFee.mockResolvedValue('2000000000')
    mockBroadcast.mockResolvedValue({
      txHash: 'A1'.repeat(32),
      code: 0,
      rawLog: '',
    })
  })

  it('signs and broadcasts EVM tx with chain-derived nonce and gas price', async () => {
    const result = await broadcastEvmTx(config, {
      privateKeyHex,
      to,
      data: '0x1234',
      value: '0',
      memo: 'evm test',
    })

    expect(result.txHash).toBe('A1'.repeat(32))
    expect(result.to?.toLowerCase()).toBe(to.toLowerCase())
    expect(result.nonce).toBe(12)
    expect(result.gasPrice).toBe('2000000000')
    expect(mockFetchAccount).toHaveBeenCalledTimes(1)
    expect(mockFetchBaseFee).toHaveBeenCalledTimes(1)

    const [txRawArg, options] = mockBroadcast.mock.calls[0] ?? []
    expect(options).toEqual({ txTimeout: undefined })
    const txRaw = txRawArg as TxRaw

    const body = TxBody.fromBinary(txRaw.bodyBytes)
    expect(body.memo).toBe('evm test')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0]?.typeUrl).toBe('/injective.evm.v1.MsgEthereumTx')
    expect(body.extensionOptions[0]?.typeUrl).toBe('/injective.evm.v1.ExtensionOptionsEthereumTx')

    const evmMsg = MsgEthereumTx.fromBinary(body.messages[0]!.value)
    expect(evmMsg.raw.length).toBeGreaterThan(0)

    const authInfo = AuthInfo.fromBinary(txRaw.authInfoBytes)
    expect(authInfo.signerInfos).toHaveLength(0)
    expect(txRaw.signatures).toHaveLength(0)
  })

  it('uses caller-provided nonce and gas params without extra chain queries', async () => {
    await broadcastEvmTx(config, {
      privateKeyHex,
      to,
      value: '1',
      nonce: 7,
      gasPrice: '3000000000',
      gasLimit: 250000,
    })

    expect(mockFetchAccount).not.toHaveBeenCalled()
    expect(mockFetchBaseFee).not.toHaveBeenCalled()
  })

  it('throws on invalid destination address', async () => {
    await expect(
      broadcastEvmTx(config, {
        privateKeyHex,
        to: '0x1234',
      })
    ).rejects.toThrow('Invalid destination address')
  })

  it('rejects negative value', async () => {
    await expect(
      broadcastEvmTx(config, {
        privateKeyHex,
        to,
        value: '-1',
      })
    ).rejects.toThrow('Invalid value')
  })

  it('rejects gasLimit <= 0', async () => {
    await expect(
      broadcastEvmTx(config, {
        privateKeyHex,
        to,
        gasLimit: 0,
      })
    ).rejects.toThrow('Invalid gasLimit')
  })

  it('wraps thrown broadcast errors as EvmTxFailed', async () => {
    mockBroadcast.mockRejectedValueOnce(new Error('grpc unavailable'))

    await expect(
      broadcastEvmTx(config, {
        privateKeyHex,
        to,
      })
    ).rejects.toThrow('grpc unavailable')
  })
})
