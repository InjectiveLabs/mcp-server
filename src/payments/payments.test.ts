/**
 * Payment module tests — challenge lifecycle, verification, and gate middleware.
 *
 * All tests are offline (mocked fetch). No real network calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  generateChallenge,
  storeChallenge,
  retrieveChallenge,
  cleanupExpired,
  pendingCount,
} from './challenge.js'
import { verifyPayment } from './verify.js'
import { loadPaymentGateConfig, createPaymentGatedHandler } from './gate.js'
import { testConfig } from '../test-utils/index.js'
import type { FeeConfig, PaymentChallenge } from './types.js'

// ─── Fixtures ───────────────────────────────────────────────────────────────

const testFee: FeeConfig = {
  amount: '0.001',
  denom: 'inj',
  recipientAddress: 'inj1' + 'a'.repeat(38),
}

const config = testConfig()

// ─── Challenge Tests ────────────────────────────────────────────────────────

describe('generateChallenge', () => {
  it('produces a valid UUID paymentId', () => {
    const challenge = generateChallenge('trade_open', testFee, 'testnet')
    expect(challenge.paymentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('sets correct expiry (~5 minutes from now)', () => {
    const before = Date.now()
    const challenge = generateChallenge('trade_open', testFee, 'testnet')
    const after = Date.now()
    const fiveMin = 5 * 60 * 1000

    expect(challenge.expiresAt).toBeGreaterThanOrEqual(before + fiveMin)
    expect(challenge.expiresAt).toBeLessThanOrEqual(after + fiveMin)
  })

  it('copies fee config and tool name correctly', () => {
    const challenge = generateChallenge('market_price', testFee, 'mainnet')
    expect(challenge.recipientAddress).toBe(testFee.recipientAddress)
    expect(challenge.amount).toBe('0.001')
    expect(challenge.denom).toBe('inj')
    expect(challenge.toolName).toBe('market_price')
    expect(challenge.network).toBe('mainnet')
  })
})

describe('storeChallenge / retrieveChallenge', () => {
  beforeEach(() => {
    // Clear any leftover challenges by retrieving them
    cleanupExpired()
  })

  it('stores and retrieves a challenge', () => {
    const challenge = generateChallenge('trade_open', testFee, 'testnet')
    storeChallenge(challenge)

    const retrieved = retrieveChallenge(challenge.paymentId)
    expect(retrieved).toEqual(challenge)
  })

  it('returns null on second retrieval (single-use)', () => {
    const challenge = generateChallenge('trade_open', testFee, 'testnet')
    storeChallenge(challenge)

    retrieveChallenge(challenge.paymentId)
    const second = retrieveChallenge(challenge.paymentId)
    expect(second).toBeNull()
  })

  it('returns null for unknown paymentId', () => {
    expect(retrieveChallenge('nonexistent-id')).toBeNull()
  })
})

describe('cleanupExpired', () => {
  it('removes expired challenges', () => {
    const expired: PaymentChallenge = {
      paymentId: 'expired-1',
      recipientAddress: testFee.recipientAddress,
      amount: '0.001',
      denom: 'inj',
      expiresAt: Date.now() - 1000, // already expired
      toolName: 'trade_open',
      network: 'testnet',
    }
    storeChallenge(expired)
    expect(pendingCount()).toBeGreaterThanOrEqual(1)

    cleanupExpired()
    expect(retrieveChallenge('expired-1')).toBeNull()
  })

  it('keeps non-expired challenges', () => {
    const valid = generateChallenge('trade_open', testFee, 'testnet')
    storeChallenge(valid)

    cleanupExpired()
    expect(retrieveChallenge(valid.paymentId)).toEqual(valid)
  })
})

// ─── Config Loader Tests ────────────────────────────────────────────────────

describe('loadPaymentGateConfig', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('defaults to disabled', () => {
    delete process.env['PAYMENT_GATE_ENABLED']
    const cfg = loadPaymentGateConfig()
    expect(cfg.enabled).toBe(false)
    expect(cfg.defaultFee).toBeUndefined()
  })

  it('enables with correct env vars', () => {
    process.env['PAYMENT_GATE_ENABLED'] = 'true'
    process.env['PAYMENT_GATE_RECIPIENT'] = 'inj1' + 'b'.repeat(38)
    process.env['PAYMENT_GATE_DEFAULT_AMOUNT'] = '0.01'
    process.env['PAYMENT_GATE_DEFAULT_DENOM'] = 'inj'

    const cfg = loadPaymentGateConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.defaultFee).toEqual({
      amount: '0.01',
      denom: 'inj',
      recipientAddress: 'inj1' + 'b'.repeat(38),
    })
  })

  it('uses default free tools list when env var not set', () => {
    const cfg = loadPaymentGateConfig()
    expect(cfg.freeTools).toContain('wallet_list')
    expect(cfg.freeTools).toContain('market_list')
    expect(cfg.freeTools).toContain('payment_config')
  })

  it('overrides free tools from env var', () => {
    process.env['PAYMENT_GATE_FREE_TOOLS'] = 'tool_a, tool_b'
    const cfg = loadPaymentGateConfig()
    expect(cfg.freeTools).toEqual(['tool_a', 'tool_b'])
  })
})

// ─── Verification Tests ─────────────────────────────────────────────────────

describe('verifyPayment', () => {
  const mockChallenge: PaymentChallenge = {
    paymentId: 'test-payment-id',
    recipientAddress: 'inj1' + 'a'.repeat(38),
    amount: '0.001',
    denom: 'inj',
    expiresAt: Date.now() + 300_000,
    toolName: 'trade_open',
    network: 'testnet',
  }

  const validTxResponse = {
    tx: {
      body: {
        messages: [
          {
            '@type': '/cosmos.bank.v1beta1.MsgSend',
            from_address: 'inj1' + 'b'.repeat(38),
            to_address: 'inj1' + 'a'.repeat(38),
            amount: [{ denom: 'inj', amount: '1000000000000000' }], // 0.001 INJ
          },
        ],
      },
    },
    tx_response: { code: 0, txhash: 'ABC123' },
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns verified for valid matching tx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => validTxResponse,
    })))

    const result = await verifyPayment(config, { paymentId: 'test', txHash: 'ABC' }, mockChallenge)
    expect(result.verified).toBe(true)
  })

  it('rejects expired challenge', async () => {
    const expired = { ...mockChallenge, expiresAt: Date.now() - 1000 }
    const result = await verifyPayment(config, { paymentId: 'test', txHash: 'ABC' }, expired)
    expect(result.verified).toBe(false)
    expect(result.reason).toContain('expired')
  })

  it('rejects wrong recipient', async () => {
    const wrongRecipient = {
      ...validTxResponse,
      tx: {
        body: {
          messages: [
            {
              ...validTxResponse.tx.body.messages[0],
              to_address: 'inj1' + 'c'.repeat(38),
            },
          ],
        },
      },
    }

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => wrongRecipient,
    })))

    const result = await verifyPayment(config, { paymentId: 'test', txHash: 'ABC' }, mockChallenge)
    expect(result.verified).toBe(false)
    expect(result.reason).toContain('Recipient mismatch')
  })

  it('rejects insufficient amount', async () => {
    const lowAmount = {
      ...validTxResponse,
      tx: {
        body: {
          messages: [
            {
              ...validTxResponse.tx.body.messages[0],
              amount: [{ denom: 'inj', amount: '1' }], // way too little
            },
          ],
        },
      },
    }

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => lowAmount,
    })))

    const result = await verifyPayment(config, { paymentId: 'test', txHash: 'ABC' }, mockChallenge)
    expect(result.verified).toBe(false)
    expect(result.reason).toContain('Insufficient payment')
  })

  it('rejects wrong denom', async () => {
    const wrongDenom = {
      ...validTxResponse,
      tx: {
        body: {
          messages: [
            {
              ...validTxResponse.tx.body.messages[0],
              amount: [{ denom: 'peggy0xBAD', amount: '1000000000000000' }],
            },
          ],
        },
      },
    }

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => wrongDenom,
    })))

    const result = await verifyPayment(config, { paymentId: 'test', txHash: 'ABC' }, mockChallenge)
    expect(result.verified).toBe(false)
    expect(result.reason).toContain('Denom mismatch')
  })

  it('rejects failed tx (code !== 0)', async () => {
    const failedTx = {
      ...validTxResponse,
      tx_response: { code: 5, txhash: 'ABC123' },
    }

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => failedTx,
    })))

    const result = await verifyPayment(config, { paymentId: 'test', txHash: 'ABC' }, mockChallenge)
    expect(result.verified).toBe(false)
    expect(result.reason).toContain('failed on-chain')
  })

  it('handles HTTP 404 gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))

    const result = await verifyPayment(config, { paymentId: 'test', txHash: 'NOTFOUND' }, mockChallenge)
    expect(result.verified).toBe(false)
    expect(result.reason).toContain('not found')
  })

  it('handles fetch errors gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))

    const result = await verifyPayment(config, { paymentId: 'test', txHash: 'ABC' }, mockChallenge)
    expect(result.verified).toBe(false)
    expect(result.reason).toContain('ECONNREFUSED')
  })
})

// ─── Gate Middleware Tests ───────────────────────────────────────────────────

describe('createPaymentGatedHandler', () => {
  const mockHandler = vi.fn(async () => ({
    content: [{ type: 'text' as const, text: '{"result":"success"}' }],
  }))

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns PAYMENT_REQUIRED when no proof provided', async () => {
    const gated = createPaymentGatedHandler('trade_open', testFee, config, mockHandler)
    const result = await gated({ symbol: 'BTC' })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe('PAYMENT_REQUIRED')
    expect(parsed.challenge.amount).toBe('0.001')
    expect(parsed.challenge.denom).toBe('inj')
    expect(parsed.challenge.toolName).toBe('trade_open')
    expect(mockHandler).not.toHaveBeenCalled()
  })

  it('returns PAYMENT_FAILED for unknown paymentId', async () => {
    const gated = createPaymentGatedHandler('trade_open', testFee, config, mockHandler)
    const result = await gated({
      symbol: 'BTC',
      _paymentProof: { paymentId: 'unknown-id', txHash: 'abc' },
    })

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe('PAYMENT_FAILED')
    expect(parsed.reason).toContain('Invalid or expired')
    expect(mockHandler).not.toHaveBeenCalled()
  })
})