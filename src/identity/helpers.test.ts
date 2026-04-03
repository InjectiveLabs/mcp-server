import { describe, it, expect } from 'vitest'
import { encodeStringMetadata, decodeStringMetadata, walletLinkDeadline, signWalletLink } from './helpers.js'
import { privateKeyToAccount } from 'viem/accounts'

describe('encodeStringMetadata', () => {
  it('encodes a string to ABI bytes', () => {
    const encoded = encodeStringMetadata('trading')
    expect(encoded).toMatch(/^0x/)
    expect(encoded.length).toBeGreaterThan(2)
  })

  it('round-trips with decodeStringMetadata', () => {
    const original = 'my-builder-code-123'
    const encoded = encodeStringMetadata(original)
    const decoded = decodeStringMetadata(encoded)
    expect(decoded).toBe(original)
  })

  it('handles empty string', () => {
    const encoded = encodeStringMetadata('')
    const decoded = decodeStringMetadata(encoded)
    expect(decoded).toBe('')
  })
})

describe('decodeStringMetadata', () => {
  it('returns empty string for 0x', () => {
    expect(decodeStringMetadata('0x')).toBe('')
  })

  it('returns empty string for empty/falsy input', () => {
    expect(decodeStringMetadata('' as any)).toBe('')
  })
})

describe('walletLinkDeadline', () => {
  it('returns a bigint in the future', () => {
    const deadline = walletLinkDeadline()
    const now = BigInt(Math.floor(Date.now() / 1000))
    expect(deadline).toBeGreaterThan(now)
    expect(deadline).toBeLessThanOrEqual(now + 700n)
  })

  it('accepts custom offset', () => {
    const deadline = walletLinkDeadline(120)
    const now = BigInt(Math.floor(Date.now() / 1000))
    expect(deadline).toBeGreaterThan(now)
    expect(deadline).toBeLessThanOrEqual(now + 130n)
  })
})

describe('signWalletLink', () => {
  it('produces a valid hex signature', async () => {
    const testKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
    const account = privateKeyToAccount(testKey)

    const sig = await signWalletLink({
      account,
      agentId: 42n,
      newWallet: account.address,
      ownerAddress: account.address,
      deadline: walletLinkDeadline(),
      chainId: 1439,
      verifyingContract: '0x19d1916ba1a2ac081b04893563a6ca0c92bc8c8e',
    })

    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i) // 65 bytes = 130 hex chars
  })
})
