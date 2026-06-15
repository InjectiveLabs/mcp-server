import { afterEach, describe, expect, it, vi } from 'vitest'
import { testConfig } from '../test-utils/index.js'
import {
  encodeReceiveMessage,
  getAttestationStatus,
  nativeInfo,
  supportedChains,
} from './index.js'

const config = testConfig('mainnet')

describe('usdc native info', () => {
  it('returns mainnet native USDC metadata', () => {
    const info = nativeInfo(config)

    expect(info.evmChainId).toBe(1776)
    expect(info.cctpDomain).toBe(29)
    expect(info.evmAddress).toBe('0xa00C59fF5a080D2b954d0c75e46E22a0c371235a')
    expect(info.denom).toBe('erc20:0xa00c59ff5a080d2b954d0c75e46e22a0c371235a')
    expect(info.decimals).toBe(6)
  })

  it('returns common source-chain CCTP configs for mainnet', () => {
    const chains = supportedChains(config)

    expect(chains.sourceChains.map(chain => chain.slug)).toContain('arbitrum')
    expect(chains.aliases.arb).toBe('arbitrum')
    expect(chains.standardTransfer.destinationCaller).toBe(`0x${'0'.repeat(64)}`)
    expect(chains.standardTransfer.minFinalityThreshold).toBe(2000)
  })
})

describe('CCTP attestation status', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('marks complete Iris messages as mintable', async () => {
    const response = {
      messages: [{
        status: 'complete',
        message: '0x1234',
        attestation: '0xabcd',
      }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify(response),
    })))

    const status = await getAttestationStatus({
      sourceDomain: 3,
      burnTxHash: '0x' + '11'.repeat(32),
    })

    expect(status.mintable).toBe(true)
    expect(status.status).toBe('complete')
    expect(status.message).toBe('0x1234')
    expect(status.attestation).toBe('0xabcd')
    expect(status.url).toContain('/v2/messages/3?transactionHash=0x')
  })

  it('does not mark pending attestations as mintable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        messages: [{
          status: 'complete',
          message: '0x1234',
          attestation: 'PENDING',
        }],
      }),
    })))

    const status = await getAttestationStatus({
      sourceDomain: 3,
      burnTxHash: '0x' + '11'.repeat(32),
    })

    expect(status.mintable).toBe(false)
  })

  it('rejects non-hex burn hashes', async () => {
    await expect(
      getAttestationStatus({ sourceDomain: 3, burnTxHash: 'not-a-hash' })
    ).rejects.toThrow('burnTxHash must be non-empty, even-length 0x-prefixed hex')
  })

  it('rejects empty, odd-length, and incorrectly sized burn hashes', async () => {
    const invalidHashes = [
      {
        burnTxHash: '0x',
        message: 'burnTxHash must be non-empty, even-length 0x-prefixed hex',
      },
      {
        burnTxHash: '0x123',
        message: 'burnTxHash must be non-empty, even-length 0x-prefixed hex',
      },
      {
        burnTxHash: '0x' + '11'.repeat(31),
        message: 'burnTxHash must be 32 bytes',
      },
    ]

    for (const { burnTxHash, message } of invalidHashes) {
      await expect(
        getAttestationStatus({ sourceDomain: 3, burnTxHash })
      ).rejects.toThrow(message)
    }
  })
})

describe('receiveMessage encoding', () => {
  it('encodes CCTP receiveMessage calldata', () => {
    const data = encodeReceiveMessage('0x1234', '0xabcd')

    expect(data.startsWith('0x57ecfd28')).toBe(true)
  })

  it('rejects invalid message bytes', () => {
    expect(() => encodeReceiveMessage('1234', '0xabcd')).toThrow(
      'message must be non-empty, even-length 0x-prefixed hex'
    )
    expect(() => encodeReceiveMessage('0x123', '0xabcd')).toThrow(
      'message must be non-empty, even-length 0x-prefixed hex'
    )
  })
})
