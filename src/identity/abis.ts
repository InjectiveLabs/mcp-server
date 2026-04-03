/**
 * ABI subset for the deployed IdentityRegistryUpgradeable contract.
 * Verified against live testnet contract at 0x19d1916ba1a2ac081b04893563a6ca0c92bc8c8e.
 * Only includes functions called by the identity module.
 */

export const IDENTITY_REGISTRY_ABI = [
  // ── Registration (3 overloads) ──
  {
    type: 'function',
    name: 'register',
    inputs: [],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'register',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'register',
    inputs: [
      { name: 'agentURI', type: 'string' },
      {
        name: 'metadataEntries',
        type: 'tuple[]',
        components: [
          { name: 'metadataKey', type: 'string' },
          { name: 'metadataValue', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  // ── Metadata (per-key) ──
  {
    type: 'function',
    name: 'setMetadata',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'metadataKey', type: 'string' },
      { name: 'metadataValue', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── URI ──
  {
    type: 'function',
    name: 'setAgentURI',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newURI', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── Wallet linking (requires EIP-712 signature) ──
  {
    type: 'function',
    name: 'setAgentWallet',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newWallet', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── Deregister ──
  {
    type: 'function',
    name: 'deregister',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── Read: metadata (per-key) ──
  {
    type: 'function',
    name: 'getMetadata',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'metadataKey', type: 'string' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'view',
  },
  // ── Read: wallet ──
  {
    type: 'function',
    name: 'getAgentWallet',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  // ── Read: reverse wallet lookup ──
  {
    type: 'function',
    name: 'getAgentByWallet',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  // ── Read: standard ERC-721 ──
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  // ── Events ──
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
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
  // ── Summary ──
  {
    type: 'function',
    name: 'getSummary',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
    ],
    outputs: [
      { name: 'count', type: 'uint64' },
      { name: 'summaryValue', type: 'int128' },
      { name: 'summaryValueDecimals', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  // ── Give feedback ──
  {
    type: 'function',
    name: 'giveFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' },
      { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── Read all feedback ──
  {
    type: 'function',
    name: 'readAllFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'clientAddresses', type: 'address[]' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'includeRevoked', type: 'bool' },
    ],
    outputs: [
      { name: 'clients', type: 'address[]' },
      { name: 'feedbackIndices', type: 'uint64[]' },
      { name: 'values', type: 'int128[]' },
      { name: 'valueDecimals', type: 'uint8[]' },
      { name: 'tag1s', type: 'string[]' },
      { name: 'tag2s', type: 'string[]' },
      { name: 'revokedArr', type: 'bool[]' },
    ],
    stateMutability: 'view',
  },
  // ── Read single feedback ──
  {
    type: 'function',
    name: 'readFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'client', type: 'address' },
      { name: 'feedbackIndex', type: 'uint64' },
    ],
    outputs: [
      { name: 'value', type: 'int128' },
      { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' },
      { name: 'tag2', type: 'string' },
      { name: 'revoked', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  // ── Get client addresses ──
  {
    type: 'function',
    name: 'getClients',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  // ── Revoke feedback ──
  {
    type: 'function',
    name: 'revokeFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'feedbackIndex', type: 'uint64' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // ── Events ──
  {
    type: 'event',
    name: 'NewFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'feedbackIndex', type: 'uint64', indexed: false },
    ],
  },
  // ── Metadata ──
  {
    type: 'function',
    name: 'getVersion',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
] as const
