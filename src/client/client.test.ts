import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withRetry, createClient } from './index.js'
import { testConfig } from '../test-utils/index.js'

describe('withRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns result on first successful call', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on transient ECONNRESET error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue('recovered')

    const result = await withRetry(fn, 3, 1) // 1ms delay for fast test
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on ECONNREFUSED', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('econnrefused'))
      .mockResolvedValue('ok')

    const result = await withRetry(fn, 3, 1)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on timeout error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Request timeout'))
      .mockResolvedValue('ok')

    const result = await withRetry(fn, 3, 1)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries on unavailable error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('service unavailable'))
      .mockResolvedValue('ok')

    const result = await withRetry(fn, 3, 1)
    expect(result).toBe('ok')
  })

  it('retries on stream removed error', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('stream removed'))
      .mockResolvedValue('ok')

    const result = await withRetry(fn, 3, 1)
    expect(result).toBe('ok')
  })

  it('throws immediately on non-transient error', async () => {
    const fn = vi.fn()
      .mockRejectedValue(new Error('Invalid argument: bad marketId'))

    await expect(withRetry(fn, 3, 1)).rejects.toThrow('Invalid argument')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws immediately on non-Error rejection', async () => {
    const fn = vi.fn().mockRejectedValue('string error')

    await expect(withRetry(fn, 3, 1)).rejects.toBe('string error')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('throws after exhausting max attempts on transient errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET forever'))

    await expect(withRetry(fn, 3, 1)).rejects.toThrow('ECONNRESET forever')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('respects custom maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'))

    await expect(withRetry(fn, 5, 1)).rejects.toThrow('timeout')
    expect(fn).toHaveBeenCalledTimes(5)
  })

  it('handles maxAttempts = 1 (no retries)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'))

    await expect(withRetry(fn, 1, 1)).rejects.toThrow('ECONNRESET')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries multiple times before succeeding', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue('finally')

    const result = await withRetry(fn, 3, 1)
    expect(result).toBe('finally')
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

describe('createClient', () => {
  it('returns an InjectiveClient with expected shape', () => {
    const config = testConfig()
    const client = createClient(config)

    expect(client).toHaveProperty('derivativesApi')
    expect(client).toHaveProperty('oracleApi')
    expect(client).toHaveProperty('portfolioApi')
    expect(client).toHaveProperty('accountApi')
    expect(client).toHaveProperty('bankApi')
    expect(client).toHaveProperty('peggyApi')
    expect(client).toHaveProperty('evmApi')
    expect(client).toHaveProperty('txApi')
    expect(client).toHaveProperty('endpoints')
    expect(client).toHaveProperty('chainId')
    expect(client).toHaveProperty('network')
    expect(client.network).toBe('testnet')
    expect(client.chainId).toBe('injective-888')
  })

  it('returns same instance when called twice with same config (singleton cache)', () => {
    const config = testConfig()
    const client1 = createClient(config)
    const client2 = createClient(config)
    expect(client1).toBe(client2)
  })

  it('creates new instance when config changes', () => {
    const config1 = testConfig('testnet')
    const client1 = createClient(config1)

    const config2 = testConfig('mainnet')
    const client2 = createClient(config2)

    expect(client1).not.toBe(client2)
    expect(client2.network).toBe('mainnet')
  })
})
