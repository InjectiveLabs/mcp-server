import { getEthereumAddress, getInjectiveAddress } from '@injectivelabs/sdk-ts'
import { isAddress } from 'ethers'

export type AddressInputType = 'injective' | 'ethereum'

export interface NormalizedAddress {
  input: string
  inputType: AddressInputType
  injAddress: string
  ethAddress: string
}

const INJ_ADDRESS_RE = /^inj1[02-9ac-hj-np-z]{38}$/

export function normalizeAddress(input: string): NormalizedAddress {
  const value = input.trim()

  if (INJ_ADDRESS_RE.test(value)) {
    try {
      return {
        input: value,
        inputType: 'injective',
        injAddress: value,
        ethAddress: getEthereumAddress(value).toLowerCase(),
      }
    } catch {
      throw new Error('Invalid Injective address')
    }
  }

  if (isAddress(value)) {
    try {
      return {
        input: value,
        inputType: 'ethereum',
        injAddress: getInjectiveAddress(value),
        ethAddress: value.toLowerCase(),
      }
    } catch {
      throw new Error('Invalid Ethereum address')
    }
  }

  throw new Error('Expected an inj1... Injective address or 0x... Ethereum address')
}

export const addresses = {
  normalize: normalizeAddress,
}
