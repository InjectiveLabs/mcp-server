import { describe, it, expect, vi, beforeEach } from 'vitest'
import { testConfig } from '../test-utils/index.js'
import { IdentityTxFailed, DeregisterNotConfirmed } from '../errors/index.js'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockRegister = vi.fn()
const mockUpdate = vi.fn()
const mockDeregister = vi.fn()
const mockGiveFeedback = vi.fn()
const mockRevokeFeedback = vi.fn()
const mockGetStatus = vi.fn()
let capturedConfig: any = {}

vi.mock('@injective/agent-sdk', () => ({
  AgentClient: vi.fn().mockImplementation((config) => {
    capturedConfig = config
    return {
      address: '0x' + 'ab'.repeat(20),
      injAddress: 'inj1' + 'a'.repeat(38),
      config: { chainId: 1439, identityRegistry: '0x19d1916ba1a2ac081b04893563a6ca0c92bc8c8e' },
      register: mockRegister,
      update: mockUpdate,
      deregister: mockDeregister,
      giveFeedback: mockGiveFeedback,
      revokeFeedback: mockRevokeFeedback,
      getStatus: mockGetStatus,
    }
  }),
  PinataStorage: vi.fn(),
}))

vi.mock('../wallets/index.js', () => ({
  wallets: { unlock: vi.fn().mockReturnValue('0x' + 'ab'.repeat(32)) },
}))

import { identity } from './index.js'
import { wallets } from '../wallets/index.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const config = testConfig()
const SIGNER_ADDRESS = '0x' + 'ab'.repeat(20) // matches mock AgentClient.address
const TEST_ADDRESS = 'inj1' + 'a'.repeat(38)
const TEST_PASSWORD = 'testpass123'
const TEST_TX_HASH = '0x' + 'dd'.repeat(32) as `0x${string}`
const TEST_WALLET_TX_HASH = '0x' + 'ee'.repeat(32) as `0x${string}`

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
    delete process.env['PINATA_JWT']
    mockRegister.mockResolvedValue({
      agentId: 42n,
      cardUri: 'ipfs://QmTestCard123',
      txHashes: [TEST_TX_HASH],
      identityTuple: '...',
      scanUrl: 'https://scan.example.com/tx/0x...',
    })
  })

  it('happy path: delegates to SDK and formats result', async () => {
    process.env['PINATA_JWT'] = 'mock-jwt'
    const result = await identity.register(config, defaultRegisterParams())

    expect(result.agentId).toBe('42')
    expect(typeof result.txHash).toBe('string')
    expect(result.txHash).toBe(TEST_TX_HASH)
    expect(result.owner).toBe(SIGNER_ADDRESS)
    expect(result.evmAddress).toBe(SIGNER_ADDRESS)
    expect(result.cardUri).toBe('ipfs://QmTestCard123')
  })

  it('calls wallets.unlock with address/password', async () => {
    process.env['PINATA_JWT'] = 'mock-jwt'
    await identity.register(config, defaultRegisterParams())

    expect(wallets.unlock).toHaveBeenCalledWith(TEST_ADDRESS, TEST_PASSWORD)
  })

  it('throws IdentityTxFailed when no PINATA_JWT and no uri', async () => {
    await expect(
      identity.register(config, defaultRegisterParams()),
    ).rejects.toThrow(IdentityTxFailed)

    await expect(
      identity.register(config, defaultRegisterParams()),
    ).rejects.toThrow('IPFS storage not configured')
  })

  it('succeeds with uri even without PINATA_JWT', async () => {
    const params = { ...defaultRegisterParams(), uri: 'https://example.com/agent.json' }
    const result = await identity.register(config, params)

    expect(result.agentId).toBe('42')
    expect(result.cardUri).toBe('ipfs://QmTestCard123')
  })

  it('wallet !== signer: result has walletLinkSkipped', async () => {
    process.env['PINATA_JWT'] = 'mock-jwt'
    const differentWallet = '0x' + 'aa'.repeat(20)
    const params = { ...defaultRegisterParams(), wallet: differentWallet }
    const result = await identity.register(config, params)

    expect(result.walletLinkSkipped).toBe(true)
    expect(result.walletLinkReason).toContain('does not match signer')
  })

  it('wallet === signer with 2 txHashes: result has walletTxHash', async () => {
    process.env['PINATA_JWT'] = 'mock-jwt'
    mockRegister.mockResolvedValue({
      agentId: 42n,
      cardUri: 'ipfs://QmTestCard123',
      txHashes: [TEST_TX_HASH, TEST_WALLET_TX_HASH],
    })

    const params = { ...defaultRegisterParams(), wallet: SIGNER_ADDRESS }
    const result = await identity.register(config, params)

    expect(result.walletTxHash).toBe(TEST_WALLET_TX_HASH)
    expect(result.walletLinkSkipped).toBeUndefined()
  })

  it('wraps SDK errors in IdentityTxFailed', async () => {
    process.env['PINATA_JWT'] = 'mock-jwt'
    mockRegister.mockRejectedValue(new Error('revert: not authorized'))

    await expect(
      identity.register(config, defaultRegisterParams()),
    ).rejects.toThrow(IdentityTxFailed)
  })

  it('does not attempt wallet link when wallet is not provided', async () => {
    process.env['PINATA_JWT'] = 'mock-jwt'
    const result = await identity.register(config, defaultRegisterParams())

    expect(result.walletTxHash).toBeUndefined()
    expect(result.walletLinkSkipped).toBeUndefined()
  })
})

// ─── update ─────────────────────────────────────────────────────────────────

describe('identity.update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env['PINATA_JWT']
    mockUpdate.mockResolvedValue({
      txHashes: [TEST_TX_HASH],
    })
    mockGetStatus.mockResolvedValue({
      tokenUri: 'ipfs://QmUpdatedCard',
    })
  })

  it('happy path: delegates to SDK and formats result', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      name: 'NewName',
    })

    expect(result.agentId).toBe('42')
    expect(result.txHashes).toEqual([TEST_TX_HASH])
    expect(mockUpdate).toHaveBeenCalledWith(42n, expect.objectContaining({ name: 'NewName' }))
  })

  it('throws IdentityTxFailed when no fields provided', async () => {
    mockUpdate.mockRejectedValue(new Error('No fields provided to update'))

    await expect(
      identity.update(config, {
        address: TEST_ADDRESS,
        password: TEST_PASSWORD,
        agentId: '42',
      }),
    ).rejects.toThrow(IdentityTxFailed)
  })

  it('card update without PINATA_JWT throws IdentityTxFailed', async () => {
    await expect(
      identity.update(config, {
        address: TEST_ADDRESS,
        password: TEST_PASSWORD,
        agentId: '42',
        description: 'New description',
      }),
    ).rejects.toThrow(IdentityTxFailed)

    await expect(
      identity.update(config, {
        address: TEST_ADDRESS,
        password: TEST_PASSWORD,
        agentId: '42',
        description: 'New description',
      }),
    ).rejects.toThrow('IPFS storage not configured')
  })

  it('card update with uri succeeds without PINATA_JWT', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      uri: 'https://example.com/card.json',
    })

    expect(result.agentId).toBe('42')
    expect(result.cardUri).toBe('https://example.com/card.json') // uri supplied directly, no RPC needed
  })

  it('wallet === signer with 2 txHashes: result has walletTxHash', async () => {
    mockUpdate.mockResolvedValue({
      txHashes: [TEST_TX_HASH, TEST_WALLET_TX_HASH],
    })

    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      name: 'NewName',
      wallet: SIGNER_ADDRESS,
    })

    expect(result.walletTxHash).toBe(TEST_WALLET_TX_HASH)
  })

  it('wallet !== signer: result has walletLinkSkipped', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      name: 'NewName',
      wallet: '0x' + 'cc'.repeat(20),
    })

    expect(result.walletLinkSkipped).toBe(true)
  })

  it('metadata-only update does not fetch cardUri', async () => {
    const result = await identity.update(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      name: 'NewName',
    })

    expect(result.cardUri).toBeUndefined()
    expect(mockGetStatus).not.toHaveBeenCalled()
  })
})

// ─── deregister ─────────────────────────────────────────────────────────────

describe('identity.deregister', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeregister.mockResolvedValue({ txHash: TEST_TX_HASH })
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

  it('delegates to SDK when confirm=true and returns formatted result', async () => {
    const result = await identity.deregister(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      confirm: true,
    })

    expect(result.agentId).toBe('42')
    expect(result.txHash).toBe(TEST_TX_HASH)
    expect(mockDeregister).toHaveBeenCalledWith(42n)
  })

  it('wraps SDK errors in IdentityTxFailed', async () => {
    mockDeregister.mockRejectedValue(new Error('revert: token does not exist'))

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

describe('identity.giveFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGiveFeedback.mockResolvedValue({
      txHash: TEST_TX_HASH,
      feedbackIndex: 7n,
    })
  })

  it('happy path: value converted to bigint, feedbackIndex returned as string', async () => {
    const result = await identity.giveFeedback(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      value: 85,
      tag1: 'accuracy',
      tag2: 'v2',
    })

    expect(result.txHash).toBe(TEST_TX_HASH)
    expect(result.agentId).toBe('42')
    expect(result.feedbackIndex).toBe('7')

    // Verify value was converted to bigint
    expect(mockGiveFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 42n,
        value: 85n,
        tag1: 'accuracy',
        tag2: 'v2',
      }),
    )
  })

  it('wraps SDK errors in IdentityTxFailed', async () => {
    mockGiveFeedback.mockRejectedValue(new Error('revert: not authorized'))

    await expect(
      identity.giveFeedback(config, {
        address: TEST_ADDRESS,
        password: TEST_PASSWORD,
        agentId: '42',
        value: 5,
      }),
    ).rejects.toThrow(IdentityTxFailed)
  })
})

// ─── revokeFeedback ────────────────────────────────────────────────────────

describe('identity.revokeFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRevokeFeedback.mockResolvedValue({
      txHash: TEST_TX_HASH,
    })
  })

  it('happy path: feedbackIndex converted to bigint, result formatted', async () => {
    const result = await identity.revokeFeedback(config, {
      address: TEST_ADDRESS,
      password: TEST_PASSWORD,
      agentId: '42',
      feedbackIndex: 3,
    })

    expect(result.txHash).toBe(TEST_TX_HASH)
    expect(result.agentId).toBe('42')

    // Verify feedbackIndex was converted to bigint
    expect(mockRevokeFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 42n,
        feedbackIndex: 3n,
      }),
    )
  })

  it('wraps SDK errors in IdentityTxFailed', async () => {
    mockRevokeFeedback.mockRejectedValue(new Error('revert: not authorized'))

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
