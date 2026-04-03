import { describe, it, expect } from 'vitest'
import { getIdentityConfig } from './config.js'

describe('identity config', () => {
  it('testnet has chainId 1439', () => {
    const cfg = getIdentityConfig('testnet')
    expect(cfg.chainId).toBe(1439)
  })

  it('testnet rpcUrl contains "testnet"', () => {
    const cfg = getIdentityConfig('testnet')
    expect(cfg.rpcUrl).toContain('testnet')
  })

  it('testnet addresses match hex pattern', () => {
    const cfg = getIdentityConfig('testnet')
    expect(cfg.identityRegistry).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(cfg.reputationRegistry).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  it('testnet deployBlock is bigint', () => {
    const cfg = getIdentityConfig('testnet')
    expect(typeof cfg.deployBlock).toBe('bigint')
  })

  it('mainnet has chainId 2525', () => {
    const cfg = getIdentityConfig('mainnet')
    expect(cfg.chainId).toBe(2525)
  })

  it('mainnet rpcUrl contains "json-rpc"', () => {
    const cfg = getIdentityConfig('mainnet')
    expect(cfg.rpcUrl).toContain('json-rpc')
  })

  it('different addresses per network', () => {
    const testnet = getIdentityConfig('testnet')
    const mainnet = getIdentityConfig('mainnet')
    expect(testnet.identityRegistry).not.toBe(mainnet.identityRegistry)
    expect(testnet.reputationRegistry).not.toBe(mainnet.reputationRegistry)
  })
})
