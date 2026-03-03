/**
 * Payment verification — confirms on-chain payments match pending challenges.
 *
 * Uses the Injective REST API (Cosmos LCD) to query transaction details
 * and verify that a MsgSend was executed with the correct recipient,
 * amount, and denom. No heavy gRPC dependencies required.
 */
import Decimal from 'decimal.js'
import type { Config } from '../config/index.js'
import type { PaymentProof, PaymentChallenge, VerificationResult } from './types.js'

// ─── Constants ──────────────────────────────────────────────────────────────

const VERIFY_TIMEOUT_MS = 10_000 // 10 seconds

/** Known decimals for common fee denoms. */
const DENOM_DECIMALS: Record<string, number> = {
  'inj': 18,
  'peggy0xdAC17F958D2ee523a2206206994597C13D831ec7': 6, // USDT mainnet
  'peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5': 6, // USDT testnet
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDecimals(denom: string): number {
  return DENOM_DECIMALS[denom] ?? 18
}

function toBaseUnits(amount: string, decimals: number): Decimal {
  return new Decimal(amount).mul(new Decimal(10).pow(decimals))
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Verify an on-chain payment matches a pending challenge.
 *
 * Steps:
 * 1. Check challenge hasn't expired
 * 2. Query tx from Injective REST API
 * 3. Verify tx success (code === 0)
 * 4. Find MsgSend in the tx body
 * 5. Verify recipient, denom, and amount
 */
export async function verifyPayment(
  config: Config,
  proof: PaymentProof,
  challenge: PaymentChallenge,
): Promise<VerificationResult> {
  // 1. Check expiry
  if (Date.now() > challenge.expiresAt) {
    return { verified: false, reason: `Payment challenge expired (id: ${challenge.paymentId})` }
  }

  // 2. Query tx from REST API with timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)

  try {
    const url = `${config.endpoints.rest}/cosmos/tx/v1beta1/txs/${proof.txHash}`
    const response = await fetch(url, { signal: controller.signal })

    if (!response.ok) {
      return { verified: false, reason: `Transaction not found: HTTP ${response.status}` }
    }

    const data = await response.json() as Record<string, unknown>

    // 3. Check tx success
    const txResponse = data['tx_response'] as Record<string, unknown> | undefined
    if (!txResponse || txResponse['code'] !== 0) {
      const code = txResponse?.['code'] ?? 'unknown'
      return { verified: false, reason: `Transaction failed on-chain (code: ${code})` }
    }

    // 4. Find MsgSend in the tx body
    const tx = data['tx'] as Record<string, unknown> | undefined
    const body = tx?.['body'] as Record<string, unknown> | undefined
    const messages = (body?.['messages'] ?? []) as Array<Record<string, unknown>>

    const msgSend = messages.find(
      (m) => m['@type'] === '/cosmos.bank.v1beta1.MsgSend',
    )

    if (!msgSend) {
      return { verified: false, reason: 'No MsgSend found in transaction' }
    }

    // 5. Verify recipient
    if (msgSend['to_address'] !== challenge.recipientAddress) {
      return {
        verified: false,
        reason: `Recipient mismatch: expected ${challenge.recipientAddress}, got ${msgSend['to_address']}`,
      }
    }

    // 6. Verify denom and amount
    const amounts = (msgSend['amount'] ?? []) as Array<Record<string, string>>
    const sentCoin = amounts.find((c) => c['denom'] === challenge.denom)

    if (!sentCoin) {
      return { verified: false, reason: `Denom mismatch: expected ${challenge.denom}` }
    }

    const decimals = getDecimals(challenge.denom)
    const requiredBase = toBaseUnits(challenge.amount, decimals)
    const sentBase = new Decimal(sentCoin['amount'])

    if (sentBase.lt(requiredBase)) {
      const sentHuman = sentBase.div(new Decimal(10).pow(decimals)).toFixed()
      return {
        verified: false,
        reason: `Insufficient payment: required ${challenge.amount} ${challenge.denom}, sent ${sentHuman}`,
      }
    }

    return { verified: true }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { verified: false, reason: `Transaction verification timed out after ${VERIFY_TIMEOUT_MS}ms` }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { verified: false, reason: `Transaction verification failed: ${message}` }
  } finally {
    clearTimeout(timeout)
  }
}