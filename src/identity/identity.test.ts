import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testConfig } from '../test-utils/index.js'
import { IdentityTxFailed, DeregisterNotConfirmed } from '../errors/index.js'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockWriteContract = vi.fn()
const mockWaitForTransactionReceipt = vi.fn()
const mockReadContract = vi.fn()

vi.mock('../wallets/index.js', () => ({
  wallets: {
    unlock: vi.fn(() => '0x' + 'ab'.repeat(32)),
  },
}))

vi.mock('./client.js', () => ({
  createIdentityWalletClient: vi.fn(() => ({
    writeContract: mockWriteContract,
    account: { address: '0x' + 'ff'.repeat(20) },
    chain: { id: 1439, name: 'Injective EVM Testnet' },
  })),
  createIdentityPublicClient: vi.fn(() => ({
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
    readContract: mockReadContract,
  })),
}))

import { identity } from './index.js'
import { wallets } from '../wallets/index.js'
import { createIdentityWalletClient, createIdentityPublicClient } from './client.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const config = testConfig()
const TEST_ADDRESS = 'inj1' + 'a'.repeat(38)
const TEST_PASSWORD = 'testpass123'
const TEST_TX_HASH = '0x' + 'dd'.repeat(32)
const TEST_AGENT_ID_HEX = '0x' + '00'.repeat(31) + '2a' // 42 in hex
const TEST_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001' // matches testnet config
const TEST_RECEIPT = {
  logs: [
    {
      address: TEST_REGISTRY_ADDRESS,
      topics: [
        '0x' + 'ee'.repeat(32), // Transfer event signature
        '0x' + '00'.repeat(32), // from = zero address (mint)
        '0x' + 'ff'.repeat(32), // to
        TEST_AGENT_ID_HEX,      // tokenId
      ],
    },
  ],
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function defaultRegisterParams() {
  return {
    address: TEST_ADDRESS,
    password: TEST_PASSWORD,
    name: 'MyAgent',
    type: 1,
    builderCode: '0x' + 'cc'.repeat(32),
    wallet: '0x' + 'bb'.repeat(20),
  }
}

// ─── register ───────────────────────────────────────────────────────────────

describe('identity.register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteContract.mockResolvedValue(TEST_TX_HASH)
    mockWaitForTransactionReceipt.mockResolvedValue(TEST_RECEIPT)
  })

  it('registers agent and returns agentId + txHash', async () => {
    const result = await identity.register(config, defaultRegisterParams())

    expect(result.agentId).toBe('42')
    expect(result.txHash).toBe(TEST_TX_HASH)
    expect(result.owner).toBe('0x' + 'ff'.repeat(20))
    expect(result.evmAddress).toBe('0x' + 'ff'.repeat(20))
  })

  it('calls wallets.unlock with correct address/password', async () => {
    await identity.register(config, defaultRegisterParams())

    expect(wallets.unlock).toHaveBeenCalledWith(TEST_ADDRESS, TEST_PASSWORD)
  })

  it('calls createIdentityWalletClient with correct network + key', async () => {
    await identity.register(config, defaultRegisterParams())

    expect(createIdentityWalletClient).toHaveBeenCalledWith('testnet', '0x' + 'ab'.repeat(32))
  })

  it('passes optional uri to writeContract', async () => {
    const params = { ...defaultRegisterParams(), uri: 'https://example.com/agent.json' }
    await identity.register(config, params)

    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'registerAgent',
        args: expect.arrayContaining(['https://example.com/agent.json']),
      }),
    )
  })

  it('passes empty string for uri when not provided', async () => {
    await identity.register(config, defaultRegisterParams())

    const callArgs = mockWriteContract.mock.calls[0]![0]
    expect(callArgs.args[3]).toBe('')
  })

  it('wraps errors in IdentityTxFailed', async () => {
    mockWriteContract.mockRejectedValue(new Error('revert: not authorized'))

    await expect(identity.register(config, defaultRegisterParams())).rejects.toThrow(IdentityTxFailed)
    await expect(identity.register(config, defaultRegisterParams())).rejects.toThrow(
      'Identity transaction failed: revert: not authorized',
    )
  })
})

// ─── update ─────────────────────────────────────────────────────────────────

describe('identity.update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteContract.mockResolvedValue(TEST_TX_HASH)
    mockWaitForTransactionReceipt.mockResolvedValue({})
    mockReadContract.mockResolvedValue(['OldName', 0, '0x' + '00'.repeat(32)])
  })

  it('updates only metadata when name provided (1 tx)', async () => {
    await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      name: 'NewName',
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'updateMetadata' }),
    )
  })

  it('sends separate tx for URI update (1 tx)', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      uri: 'https://new-uri.com',
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'setTokenURI' }),
    )
    expect(result.txHashes).toHaveLength(1)
  })

  it('sends separate tx for wallet update (1 tx)', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      wallet: '0x' + 'aa'.repeat(20),
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'setLinkedWallet' }),
    )
    expect(result.txHashes).toHaveLength(1)
  })

  it('sends 3 txs when updating name + uri + wallet', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      name: 'NewName',
      uri: 'https://new-uri.com',
      wallet: '0x' + 'aa'.repeat(20),
    })

    expect(mockWriteContract).toHaveBeenCalledTimes(3)
    expect(result.txHashes).toHaveLength(3)

    // Verify order: updateMetadata, setTokenURI, setLinkedWallet
    expect(mockWriteContract.mock.calls[0]![0].functionName).toBe('updateMetadata')
    expect(mockWriteContract.mock.calls[1]![0].functionName).toBe('setTokenURI')
    expect(mockWriteContract.mock.calls[2]![0].functionName).toBe('setLinkedWallet')
  })

  it('reads current metadata before updating (to merge unchanged fields)', async () => {
    mockReadContract.mockResolvedValue(['OldName', 5, '0x' + 'ab'.repeat(32)])

    await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      name: 'NewName',
    })

    // Should have read current metadata
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'getMetadata',
        args: [42n],
      }),
    )

    // Should merge: new name, but keep old type (5) and old builderCode
    const writeCall = mockWriteContract.mock.calls[0]![0]
    expect(writeCall.args[1]).toBe('NewName')
    expect(writeCall.args[2]).toBe(5)
    expect(writeCall.args[3]).toBe('0x' + 'ab'.repeat(32))
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
