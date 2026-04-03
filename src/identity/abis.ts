export const IDENTITY_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerAgent',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'agentType', type: 'uint8' },
      { name: 'metadataHash', type: 'bytes32' },
      { name: 'tokenURI', type: 'string' },
      { name: 'linkedWallet', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateMetadata',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'name', type: 'string' },
      { name: 'agentType', type: 'uint8' },
      { name: 'metadataHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setTokenURI',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'uri', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setLinkedWallet',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'wallet', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'deregister',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getMetadata',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'agentType', type: 'uint8' },
      { name: 'metadataHash', type: 'bytes32' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLinkedWallet',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'wallet', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'owner', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: 'uri', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const

export const REPUTATION_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getReputation',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'score', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const
