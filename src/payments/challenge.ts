/**
 * Challenge management — generation, storage, and lifecycle of payment challenges.
 *
 * Challenges are single-use tokens issued when a gated tool is called without
 * payment. The client must pay on-chain and return the paymentId + txHash.
 * Challenges expire after 5 minutes and are consumed on first retrieval
 * to prevent replay attacks.
 */
import type { PaymentChallenge, FeeConfig } from './types.js'
import type { NetworkName } from '../config/index.js'

// ─── Constants ──────────────────────────────────────────────────────────────

const CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ─── In-Memory Store ────────────────────────────────────────────────────────

/** Pending payment challenges, keyed by paymentId. */
const pendingChallenges = new Map<string, PaymentChallenge>()

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a new payment challenge for a tool call.
 * Does NOT store the challenge — call storeChallenge() separately.
 */
export function generateChallenge(
  toolName: string,
  feeConfig: FeeConfig,
  network: NetworkName,
): PaymentChallenge {
  return {
    paymentId: crypto.randomUUID(),
    recipientAddress: feeConfig.recipientAddress,
    amount: feeConfig.amount,
    denom: feeConfig.denom,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
    toolName,
    network,
  }
}

/**
 * Store a challenge in the pending map for later retrieval.
 */
export function storeChallenge(challenge: PaymentChallenge): void {
  pendingChallenges.set(challenge.paymentId, challenge)
}

/**
 * Retrieve and consume a challenge (single-use).
 * Returns null if the paymentId is not found or was already consumed.
 */
export function retrieveChallenge(paymentId: string): PaymentChallenge | null {
  const challenge = pendingChallenges.get(paymentId) ?? null
  if (challenge) {
    pendingChallenges.delete(paymentId)
  }
  return challenge
}

/**
 * Remove all expired challenges from the in-memory store.
 * Called periodically by the payment gate to prevent unbounded growth.
 */
export function cleanupExpired(): void {
  const now = Date.now()
  for (const [id, challenge] of pendingChallenges) {
    if (challenge.expiresAt <= now) {
      pendingChallenges.delete(id)
    }
  }
}

/**
 * Get the current number of pending challenges (for testing/monitoring).
 */
export function pendingCount(): number {
  return pendingChallenges.size
}