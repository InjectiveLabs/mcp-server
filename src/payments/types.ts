/**
 * Payment types — shared interfaces for the x402-inspired payment gate.
 *
 * The payment gate enables tool-level fee-gating, allowing the MCP server
 * operator to charge micropayments (INJ, USDC, etc.) before executing
 * designated tools. This is the foundation for an agent-to-agent economy
 * on Injective.
 */
import type { NetworkName } from '../config/index.js'

// ─── Challenge & Proof ──────────────────────────────────────────────────────

/** Payment challenge issued to a client that must pay before tool access. */
export interface PaymentChallenge {
  /** Unique identifier for this challenge (crypto.randomUUID). */
  paymentId: string
  /** inj1... address that must receive the payment. */
  recipientAddress: string
  /** Human-readable amount required, e.g. "0.001". */
  amount: string
  /** Token denom, e.g. "inj" or "peggy0x...". */
  denom: string
  /** Unix timestamp (ms) when this challenge expires. */
  expiresAt: number
  /** The tool name this payment unlocks. */
  toolName: string
  /** Network the payment must be made on. */
  network: NetworkName
}

/** Proof submitted by the client after making an on-chain payment. */
export interface PaymentProof {
  /** Must match a pending challenge's paymentId. */
  paymentId: string
  /** On-chain transaction hash proving payment. */
  txHash: string
}

// ─── Configuration ─────────────────────────────────────────────────────────��

/** Fee configuration for a single tool or the global default. */
export interface FeeConfig {
  /** Human-readable fee amount, e.g. "0.001". */
  amount: string
  /** Token denom, e.g. "inj". */
  denom: string
  /** inj1... address to receive fees. */
  recipientAddress: string
}

/** Top-level payment gate configuration (loaded from env vars). */
export interface PaymentGateConfig {
  /** Whether the payment gate is active. */
  enabled: boolean
  /** Default fee applied to any gated tool without a specific override. */
  defaultFee?: FeeConfig
  /** Per-tool fee overrides (tool name → fee config). */
  toolFees: Record<string, FeeConfig>
  /** Tool names that are always free, even when the gate is enabled. */
  freeTools: string[]
}

// ─── Verification ───────────────────────────────────────────────────────────

/** Result of on-chain payment verification. */
export interface VerificationResult {
  verified: boolean
  reason?: string
}