import { describe, it, expect, vi, beforeEach } from 'vitest'
import { keccak256, toHex } from 'viem'
import { testConfig } from '../test-utils/index.js'
import { IdentityTxFailed, DeregisterNotConfirmed } from '../errors/index.js'
import { encodeStringMetadata } from './helpers.js'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockWriteContract = vi.fn()
const mockWaitForTransactionReceipt = vi.fn()
const mockReadContract = vi.fn()
const mockSignTypedData = vi.fn()

const mockUploadJSON = vi.fn().mockResolvedValue('ipfs://QmTestCard123')

const TEST_ACCOUNT_ADDRESS = '0x' + 'ff'.repeat(20) as `0x${string}`

vi.mock('../wallets/index.js', () => ({
  wallets: {
    unlock: vi.fn(() => '0x' + 'ab'.repeat(32)),
  },
}))

vi.mock('./client.js', () => ({
  createIdentityWalletClient: vi.fn(() => ({
    writeContract: mockWriteContract,
    account: {
      address: TEST_ACCOUNT_ADDRESS,
      signTypedData: mockSignTypedData,
    },
    chain: { id: 1439, name: 'Injective EVM Testnet' },
  })),
  createIdentityPublicClient: vi.fn(() => ({
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
    readContract: mockReadContract,
  })),
}))

// Mock walletLinkDeadline to return a deterministic value
vi.mock('./helpers.js', async () => {
  const actual = await vi.importActual<typeof import('./helpers.js')>('./helpers.js')
  return {
    ...actual,
    walletLinkDeadline: vi.fn(() => 1700000000n),
  }
})

vi.mock('./storage.js', () => ({
  PinataStorage: vi.fn().mockImplementation(() => ({
    uploadJSON: mockUploadJSON,
  })),
  StorageError: class extends Error { code = 'STORAGE_ERROR' },
}))

vi.mock('./card.js', () => ({
  generateAgentCard: vi.fn().mockReturnValue({ type: 'test', name: 'TestBot' }),
  validateImageUrl: vi.fn(),
  fetchAgentCard: vi.fn().mockResolvedValue(null),
  mergeAgentCard: vi.fn().mockReturnValue({ type: 'test', name: 'MergedBot' }),
}))

vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js')
  return {
    ...actual,
    getPinataJwt: vi.fn(() => 'mock-jwt'),
  }
})

import { identity } from './index.js'
import { wallets } from '../wallets/index.js'
import { createIdentityWalletClient, createIdentityPublicClient } from './client.js'
import { generateAgentCard, validateImageUrl, fetchAgentCard, mergeAgentCard } from './card.js'
import { getPinataJwt } from './config.js'
import { PinataStorage } from './storage.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const config = testConfig()
const TEST_ADDRESS = 'inj1' + 'a'.repeat(38)
const TEST_PASSWORD = 'testpass123'
const TEST_TX_HASH = '0x' + 'dd'.repeat(32)
const TEST_WALLET_TX_HASH = '0x' + 'ee'.repeat(32)
const TEST_AGENT_ID_HEX = '0x' + '00'.repeat(31) + '2a' // 42 in hex
const TEST_REGISTRY_ADDRESS = '0x19d1916ba1a2ac081b04893563a6ca0c92bc8c8e' // matches testnet config
const TEST_SIGNATURE = '0x' + 'ab'.repeat(65) as `0x${string}`

const TEST_RECEIPT = {
  logs: [
    {
      address: TEST_REGISTRY_ADDRESS,
      topics: [
        '0x' + 'ee'.repeat(32),  // event signature (any value for mock)
        TEST_AGENT_ID_HEX,        // indexed agentId
        '0x' + '00'.repeat(12) + 'ff'.repeat(20), // indexed owner (padded)
      ],
      data: '0x', // non-indexed agentURI (not parsed by handler)
    },
  ],
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function defaultRegisterParams() {
  return {
    address: TEST_ADDRESS,
    password: TEST_PASSWORD,
    name: 'MyAgent',
    type: 'trading',
    builderCode: 'builder-xyz',
  }
}

// ─── register ───────────────────────────────────────────────────────────────

describe('identity.register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteContract.mockResolvedValue(TEST_TX_HASH)
    mockWaitForTransactionReceipt.mockResolvedValue(TEST_RECEIPT)
    mockSignTypedData.mockResolvedValue(TEST_SIGNATURE)
  })

  it('registers agent with metadata and returns agentId from Registered event', async () => {
    const result = await identity.register(config, defaultRegisterParams())

    expect(result.agentId).toBe('42')
    expect(result.txHash).toBe(TEST_TX_HASH)
    expect(result.owner).toBe(TEST_ACCOUNT_ADDRESS)
    expect(result.evmAddress).toBe(TEST_ACCOUNT_ADDRESS)
    expect(result.cardUri).toBe('ipfs://QmTestCard123')

    // Verify register was called with correct function and metadata tuple array
    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'register',
        args: [
          'ipfs://QmTestCard123',
          [
            { metadataKey: 'name', metadataValue: encodeStringMetadata('MyAgent') },
            { metadataKey: 'agentType', metadataValue: encodeStringMetadata('trading') },
            { metadataKey: 'builderCode', metadataValue: encodeStringMetadata('builder-xyz') },
          ],
        ],
      }),
    )
  })

  it('passes optional uri to register call and skips card generation', async () => {
    const params = { ...defaultRegisterParams(), uri: 'https://example.com/agent.json' }
    const result = await identity.register(config, params)

    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'register',
        args: [
          'https://example.com/agent.json',
          expect.any(Array),
        ],
      }),
    )
    expect(result.cardUri).toBe('https://example.com/agent.json')
    expect(generateAgentCard).not.toHaveBeenCalled()
    expect(mockUploadJSON).not.toHaveBeenCalled()
  })

  it('uses IPFS URI from card upload when uri not provided', async () => {
    await identity.register(config, defaultRegisterParams())

    const callArgs = mockWriteContract.mock.calls[0]![0]
    expect(callArgs.args[0]).toBe('ipfs://QmTestCard123')
  })

  it('calls wallets.unlock with correct address/password', async () => {
    await identity.register(config, defaultRegisterParams())

    expect(wallets.unlock).toHaveBeenCalledWith(TEST_ADDRESS, TEST_PASSWORD)
  })

  it('calls createIdentityWalletClient with correct network + key', async () => {
    await identity.register(config, defaultRegisterParams())

    expect(createIdentityWalletClient).toHaveBeenCalledWith('testnet', '0x' + 'ab'.repeat(32))
  })

  it('calls setAgentWallet with EIP-712 signature for self-link wallet', async () => {
    mockWriteContract
      .mockResolvedValueOnce(TEST_TX_HASH)        // register
      .mockResolvedValueOnce(TEST_WALLET_TX_HASH)  // setAgentWallet

    const params = {
      ...defaultRegisterParams(),
      wallet: TEST_ACCOUNT_ADDRESS, // same as account address → self-link
    }
    const result = await identity.register(config, params)

    // register + setAgentWallet = 2 calls
    expect(mockWriteContract).toHaveBeenCalledTimes(2)
    expect(mockWriteContract.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        functionName: 'setAgentWallet',
        args: [42n, TEST_ACCOUNT_ADDRESS, 1700000000n, TEST_SIGNATURE],
      }),
    )
    expect(result.walletTxHash).toBe(TEST_WALLET_TX_HASH)
    expect(result.walletLinkSkipped).toBeUndefined()
  })

  it('skips wallet link when wallet differs from signer', async () => {
    const differentWallet = '0x' + 'aa'.repeat(20)
    const params = {
      ...defaultRegisterParams(),
      wallet: differentWallet,
    }
    const result = await identity.register(config, params)

    // Only the register call, no setAgentWallet
    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(result.walletLinkSkipped).toBe(true)
    expect(result.walletLinkReason).toContain('Wallet differs from signer')
  })

  it('does not attempt wallet link when wallet is not provided', async () => {
    const result = await identity.register(config, defaultRegisterParams())

    expect(mockWriteContract).toHaveBeenCalledTimes(1) // only register
    expect(result.walletTxHash).toBeUndefined()
    expect(result.walletLinkSkipped).toBeUndefined()
  })

  it('wraps errors in IdentityTxFailed', async () => {
    mockWriteContract.mockRejectedValue(new Error('revert: not authorized'))

    await expect(identity.register(config, defaultRegisterParams())).rejects.toThrow(IdentityTxFailed)
    await expect(identity.register(config, defaultRegisterParams())).rejects.toThrow(
      'Identity transaction failed: revert: not authorized',
    )
  })

  it('register without uri builds card, uploads to Pinata, returns cardUri', async () => {
    const result = await identity.register(config, defaultRegisterParams())

    expect(generateAgentCard).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'MyAgent',
        agentType: 'trading',
        builderCode: 'builder-xyz',
        operatorAddress: TEST_ACCOUNT_ADDRESS,
      }),
    )
    expect(PinataStorage).toHaveBeenCalledWith('mock-jwt')
    expect(mockUploadJSON).toHaveBeenCalledWith(
      { type: 'test', name: 'TestBot' },
      'agent-card-MyAgent',
    )
    expect(result.cardUri).toBe('ipfs://QmTestCard123')
  })

  it('register without uri and without PINATA_JWT throws clear error', async () => {
    vi.mocked(getPinataJwt).mockReturnValueOnce(undefined)

    await expect(identity.register(config, defaultRegisterParams())).rejects.toThrow(
      'IPFS storage not configured',
    )
  })

  it('register with invalid image URL throws validation error', async () => {
    vi.mocked(generateAgentCard).mockImplementationOnce(() => {
      throw new Error('Image must be a URL (https://, http://, or ipfs://). Local file paths are not supported in MCP.')
    })

    const params = { ...defaultRegisterParams(), image: '/local/path.png' }
    await expect(identity.register(config, params)).rejects.toThrow('Image must be a URL')
  })
})

// ─── update ─────────────────────────────────────────────────────────────────

describe('identity.update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteContract.mockResolvedValue(TEST_TX_HASH)
    mockWaitForTransactionReceipt.mockResolvedValue({})
    mockSignTypedData.mockResolvedValue(TEST_SIGNATURE)
  })

  it('calls setMetadata for name update', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      name: 'NewName',
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'setMetadata',
        args: [42n, 'name', encodeStringMetadata('NewName')],
      }),
    )
    expect(result.txHashes).toHaveLength(1)
  })

  it('calls setMetadata for agentType update', async () => {
    await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      type: 'analytics',
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'setMetadata',
        args: [42n, 'agentType', encodeStringMetadata('analytics')],
      }),
    )
  })

  it('calls setMetadata for builderCode update', async () => {
    await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      builderCode: 'new-builder',
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'setMetadata',
        args: [42n, 'builderCode', encodeStringMetadata('new-builder')],
      }),
    )
  })

  it('calls setAgentURI for URI update', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      uri: 'https://new-uri.com',
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'setAgentURI',
        args: [42n, 'https://new-uri.com'],
      }),
    )
    expect(result.txHashes).toHaveLength(1)
  })

  it('sends multiple txs when updating name + type + uri', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      name: 'NewName',
      type: 'analytics',
      uri: 'https://new-uri.com',
    })

    // 2 metadata calls (name, agentType) + 1 setAgentURI = 3 txs
    expect(mockWriteContract).toHaveBeenCalledTimes(3)
    expect(result.txHashes).toHaveLength(3)

    // Verify order: setMetadata(name), setMetadata(agentType), setAgentURI
    expect(mockWriteContract.mock.calls[0]![0].functionName).toBe('setMetadata')
    expect(mockWriteContract.mock.calls[0]![0].args[1]).toBe('name')
    expect(mockWriteContract.mock.calls[1]![0].functionName).toBe('setMetadata')
    expect(mockWriteContract.mock.calls[1]![0].args[1]).toBe('agentType')
    expect(mockWriteContract.mock.calls[2]![0].functionName).toBe('setAgentURI')
  })

  it('calls setAgentWallet with EIP-712 signature for self-link wallet update', async () => {
    mockWriteContract
      .mockResolvedValueOnce(TEST_TX_HASH)          // setAgentWallet
    mockWaitForTransactionReceipt.mockResolvedValue({})

    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      wallet: TEST_ACCOUNT_ADDRESS,
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'setAgentWallet',
        args: [42n, TEST_ACCOUNT_ADDRESS, 1700000000n, TEST_SIGNATURE],
      }),
    )
    expect(result.walletTxHash).toBe(TEST_TX_HASH)
  })

  it('skips wallet link when wallet differs from signer', async () => {
    const differentWallet = '0x' + 'aa'.repeat(20)
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      wallet: differentWallet,
    })

    // No writeContract calls for wallet link
    expect(mockWriteContract).not.toHaveBeenCalled()
    expect(result.walletLinkSkipped).toBe(true)
    expect(result.walletLinkReason).toContain('Wallet differs from signer')
  })

  it('returns agentId in result', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      uri: 'https://example.com',
    })

    expect(result.agentId).toBe('42')
  })

  it('throws when no updatable fields provided', async () => {
    await expect(
      identity.update(config, {
        address: TEST_ADDRESS,
        password: TEST_PASSWORD,
        agentId: '42',
      }),
    ).rejects.toThrow('No fields provided to update')

    // Should NOT have called wallets.unlock
    expect(wallets.unlock).not.toHaveBeenCalled()
  })

  it('wraps errors in IdentityTxFailed', async () => {
    mockWriteContract.mockRejectedValue(new Error('revert: not owner'))

    await expect(
      identity.update(config, {
        address: TEST_ADDRESS,
        password: TEST_PASSWORD,
        agentId: '42',
        name: 'Fail',
      }),
    ).rejects.toThrow(IdentityTxFailed)
  })

  it('update image fetches card, merges, uploads, calls setAgentURI', async () => {
    vi.mocked(fetchAgentCard).mockResolvedValueOnce({
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'OldBot',
      image: '',
      services: [],
      x402Support: false,
      metadata: { chain: 'injective', chainId: '1439', agentType: 'trading', builderCode: 'b', operatorAddress: '0x1' },
    })
    mockReadContract.mockResolvedValueOnce('ipfs://QmExisting')

    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      image: 'https://example.com/img.png',
    })

    expect(fetchAgentCard).toHaveBeenCalledWith('ipfs://QmExisting', expect.stringContaining('ipfs'))
    expect(mergeAgentCard).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'OldBot' }),
      expect.objectContaining({ image: 'https://example.com/img.png' }),
    )
    expect(mockUploadJSON).toHaveBeenCalled()
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'setAgentURI',
        args: [42n, 'ipfs://QmTestCard123'],
      }),
    )
    expect(result.cardUri).toBe('ipfs://QmTestCard123')
  })

  it('update description fetches card, merges, uploads, calls setAgentURI', async () => {
    vi.mocked(fetchAgentCard).mockResolvedValueOnce({
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'OldBot',
      image: '',
      services: [],
      x402Support: false,
      metadata: { chain: 'injective', chainId: '1439', agentType: 'trading', builderCode: 'b', operatorAddress: '0x1' },
    })
    mockReadContract.mockResolvedValueOnce('ipfs://QmExisting')

    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      description: 'A new description',
    })

    expect(mergeAgentCard).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'OldBot' }),
      expect.objectContaining({ description: 'A new description' }),
    )
    expect(result.cardUri).toBe('ipfs://QmTestCard123')
  })

  it('update only name (metadata-only) does not trigger card operations', async () => {
    await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      name: 'NewName',
    })

    expect(fetchAgentCard).not.toHaveBeenCalled()
    expect(mergeAgentCard).not.toHaveBeenCalled()
    expect(mockUploadJSON).not.toHaveBeenCalled()
    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'setMetadata' }),
    )
  })

  it('update card field when no existing card builds from scratch', async () => {
    vi.mocked(fetchAgentCard).mockResolvedValueOnce(null)
    mockReadContract.mockResolvedValueOnce('')

    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      image: 'https://example.com/new.png',
    })

    expect(generateAgentCard).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorAddress: TEST_ACCOUNT_ADDRESS,
        image: 'https://example.com/new.png',
      }),
    )
    expect(result.cardUri).toBe('ipfs://QmTestCard123')
  })
})

// ─── deregister ─────────────────────────────────────────────────────────────

describe('identity.deregister', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteContract.mockResolvedValue(TEST_TX_HASH)
    mockWaitForTransactionReceipt.mockResolvedValue({})
  })

  it('deregisters when confirm=true, returns txHash', async () => {
    const result = await identity.deregister(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      confirm: true,
    })

    expect(result.agentId).toBe('42')
    expect(result.txHash).toBe(TEST_TX_HASH)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'deregister',
        args: [42n],
      }),
    )
  })

  it('throws DeregisterNotConfirmed when confirm=false', async () => {
    await expect(
      identity.deregister(config, {
        address: TEST_ADDRESS,
        password: TEST_PASSWORD,
        agentId: '42',
        confirm: false,
      }),
    ).rejects.toThrow(DeregisterNotConfirmed)
  })

  it('does NOT call wallets.unlock when confirm=false', async () => {
    try {
      await identity.deregister(config, {
        address: TEST_ADDRESS,
        password: TEST_PASSWORD,
        agentId: '42',
        confirm: false,
      })
    } catch {
      // expected
    }

    expect(wallets.unlock).not.toHaveBeenCalled()
  })

  it('wraps errors in IdentityTxFailed', async () => {
    mockWriteContract.mockRejectedValue(new Error('revert: token does not exist'))

    await expect(
      identity.deregister(config, {
        address: TEST_ADDRESS,
        password: TEST_PASSWORD,
        agentId: '99',
        confirm: true,
      }),
    ).rejects.toThrow(IdentityTxFailed)
  })
})

// ─── giveFeedback ──────────────────────────────────────────────────────────

const TEST_REPUTATION_REGISTRY = '0x019b24a73d493d86c61cc5dfea32e4865eecb922'

const FEEDBACK_RECEIPT = {
  logs: [
    {
      address: TEST_REPUTATION_REGISTRY,
      topics: [
        keccak256(toHex('NewFeedback(uint256,address,uint256,uint256,uint8,string,string)')),  // event signature
        '0x' + '00'.repeat(31) + '2a', // indexed agentId (42)
        '0x' + '00'.repeat(12) + 'ff'.repeat(20), // indexed client
      ],
      data: '0x' + '00'.repeat(31) + '07', // feedbackIndex = 7
    },
  ],
}

describe('identity.giveFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteContract.mockResolvedValue(TEST_TX_HASH)
    mockWaitForTransactionReceipt.mockResolvedValue(FEEDBACK_RECEIPT)
  })

  it('calls giveFeedback on ReputationRegistry with correct args', async () => {
    await identity.giveFeedback(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      value: 85,
      valueDecimals: 1,
      tag1: 'accuracy',
      tag2: 'v2',
      endpoint: 'https://api.example.com',
      feedbackURI: 'ipfs://QmFeedback',
      feedbackHash: '0x' + 'ab'.repeat(32),
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TEST_REPUTATION_REGISTRY,
        functionName: 'giveFeedback',
        args: [
          42n,
          85n,
          1,
          'accuracy',
          'v2',
          'https://api.example.com',
          'ipfs://QmFeedback',
          '0x' + 'ab'.repeat(32),
        ],
      }),
    )
  })

  it('returns txHash and feedbackIndex', async () => {
    const result = await identity.giveFeedback(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      value: 5,
    })

    expect(result.txHash).toBe(TEST_TX_HASH)
    expect(result.agentId).toBe('42')
    expect(result.feedbackIndex).toBe('7')
  })

  it('uses defaults for optional params', async () => {
    await identity.giveFeedback(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      value: 10,
    })

    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'giveFeedback',
        args: [
          42n,
          10n,
          0,
          '',
          '',
          '',
          '',
          '0x' + '00'.repeat(32),
        ],
      }),
    )
  })
})

// ─── revokeFeedback ────────────────────────────────────────────────────────

describe('identity.revokeFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteContract.mockResolvedValue(TEST_TX_HASH)
    mockWaitForTransactionReceipt.mockResolvedValue({})
  })

  it('calls revokeFeedback with correct args', async () => {
    await identity.revokeFeedback(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      feedbackIndex: 3,
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: TEST_REPUTATION_REGISTRY,
        functionName: 'revokeFeedback',
        args: [42n, 3n],
      }),
    )
  })

  it('returns txHash and agentId', async () => {
    const result = await identity.revokeFeedback(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      feedbackIndex: 3,
    })

    expect(result.txHash).toBe(TEST_TX_HASH)
    expect(result.agentId).toBe('42')
  })

  it('wraps errors in IdentityTxFailed', async () => {
    mockWriteContract.mockRejectedValue(new Error('revert: not authorized'))

    await expect(
      identity.revokeFeedback(config, {
        address: TEST_ADDRESS,
        password: TEST_PASSWORD,
        agentId: '42',
        feedbackIndex: 0,
      }),
    ).rejects.toThrow(IdentityTxFailed)
  })
})
