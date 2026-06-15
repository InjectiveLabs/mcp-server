import { describe, expect, it } from 'vitest'
import { normalizeAddress } from './index.js'

const ethAddress = '0x1111111111111111111111111111111111111111'
const injAddress = 'inj1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3t5qxqh'

describe('addresses', () => {
  it('normalizes an Ethereum address to both encodings', () => {
    const result = normalizeAddress(ethAddress)

    expect(result).toEqual({
      input: ethAddress,
      inputType: 'ethereum',
      injAddress,
      ethAddress,
    })
  })

  it('normalizes an Injective address to both encodings', () => {
    const result = normalizeAddress(injAddress)

    expect(result).toEqual({
      input: injAddress,
      inputType: 'injective',
      injAddress,
      ethAddress,
    })
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeAddress(`  ${ethAddress}  `).ethAddress).toBe(ethAddress)
  })

  it('rejects malformed input', () => {
    expect(() => normalizeAddress('not-an-address')).toThrow(
      'Expected an inj1... Injective address or 0x... Ethereum address'
    )
  })
})
