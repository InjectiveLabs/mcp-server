import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters } from 'viem'
import type { Account, Hex } from 'viem'

const STRING_PARAM = parseAbiParameters('string')

export function encodeStringMetadata(value: string): Hex {
  return encodeAbiParameters(STRING_PARAM, [value])
}

export function decodeStringMetadata(raw: Hex): string {
  if (!raw || raw === '0x') return ''
  const [decoded] = decodeAbiParameters(STRING_PARAM, raw)
  return decoded
}

export function walletLinkDeadline(offsetSeconds = 600): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + offsetSeconds)
}

export interface SignWalletLinkParams {
  account: Account
  agentId: bigint
  newWallet: `0x${string}`
  ownerAddress: `0x${string}`
  deadline: bigint
  chainId: number
  verifyingContract: `0x${string}`
}

export async function signWalletLink(params: SignWalletLinkParams): Promise<Hex> {
  if (!params.account.signTypedData) {
    throw new Error('Account does not support signTypedData')
  }
  return params.account.signTypedData({
    domain: {
      name: 'ERC8004IdentityRegistry',
      version: '1',
      chainId: params.chainId,
      verifyingContract: params.verifyingContract,
    },
    types: {
      AgentWalletSet: [
        { name: 'agentId', type: 'uint256' },
        { name: 'newWallet', type: 'address' },
        { name: 'owner', type: 'address' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'AgentWalletSet',
    message: {
      agentId: params.agentId,
      newWallet: params.newWallet,
      owner: params.ownerAddress,
      deadline: params.deadline,
    },
  })
}
