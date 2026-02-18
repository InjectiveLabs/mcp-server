import { describe, it, expect } from 'vitest'
import { createConfig, validateNetwork } from './index.js'

describe('validateNetwork', () => {
  it('accepts "testnet"', () => {
    expect(validateNetwork('testnet')).toBe('testnet')
  })

  it('accepts "mainnet"', () => {
    expect(validateNetwork('mainnet')).toBe('mainnet')
  })

  it('rejects empty string', () => {
    expect(() => validateNetwork('')).toThrow('Invalid network')
  })

  it('rejects arbitrary string', () => {
    expect(() => validateNetwork('devnet')).toThrow('Invalid network "devnet"')
  })

  it('rejects "Testnet" (case-sensitive)', () => {
    expect(() => validateNetwork('Testnet')).toThrow('Invalid network')
  })

  it('rejects "mainnet " with trailing space', () => {
    expect(() => validateNetwork('mainnet ')).toThrow('Invalid network')
  })
})

describe('createConfig', () => {
  it('creates testnet config by default', () => {
    const config = createConfig()
    expect(config.network).toBe('testnet')
    expect(config.chainId).toBeTruthy()
    expect(config.endpoints.indexer).toBeTruthy()
    expect(config.endpoints.grpc).toBeTruthy()
    expect(config.endpoints.rest).toBeTruthy()
    expect(typeof config.ethereumChainId).toBe('number')
  })

  it('creates testnet config explicitly', () => {
    const config = createConfig('testnet')
    expect(config.network).toBe('testnet')
    expect(config.chainId).toContain('injective')
  })

  it('creates mainnet config', () => {
    const config = createConfig('mainnet')
    expect(config.network).toBe('mainnet')
    expect(config.chainId).toContain('injective')
  })

  it('testnet and mainnet have different chain IDs', () => {
    const testnet = createConfig('testnet')
    const mainnet = createConfig('mainnet')
    expect(testnet.chainId).not.toBe(mainnet.chainId)
  })

  it('testnet and mainnet have different endpoints', () => {
    const testnet = createConfig('testnet')
    const mainnet = createConfig('mainnet')
    expect(testnet.endpoints.indexer).not.toBe(mainnet.endpoints.indexer)
  })

  it('all endpoints are valid URLs', () => {
    const config = createConfig('testnet')
    for (const endpoint of [config.endpoints.indexer, config.endpoints.grpc, config.endpoints.rest]) {
      expect(endpoint).toMatch(/^https?:\/\//)
    }
  })

  it('ethereumChainId is a non-negative number', () => {
    const config = createConfig('testnet')
    expect(config.ethereumChainId).toBeGreaterThanOrEqual(0)
  })
})
