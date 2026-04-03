import { describe, it, expect } from 'vitest'
import { createIdentityPublicClient, createIdentityWalletClient } from './client.js'

// Well-known Hardhat test key — never holds real funds.
const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

describe('identity viem client factory', () => {
  it('createIdentityPublicClient("testnet") has chain id 1439', () => {
    const client = createIdentityPublicClient('testnet')
    expect(client.chain?.id).toBe(1439)
  })

  it('createIdentityPublicClient("mainnet") has chain id 2525', () => {
    const client = createIdentityPublicClient('mainnet')
    expect(client.chain?.id).toBe(2525)
  })

  it('createIdentityWalletClient creates wallet with valid address and chain id', () => {
    const client = createIdentityWalletClient('testnet', TEST_KEY)
    expect(client.chain?.id).toBe(1439)
    expect(client.account?.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  it('createIdentityWalletClient accepts key without 0x prefix', () => {
    const bareKey = TEST_KEY.slice(2)
    const client = createIdentityWalletClient('testnet', bareKey)
    expect(client.account?.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})
