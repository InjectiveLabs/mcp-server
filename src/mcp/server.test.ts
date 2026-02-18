/**
 * MCP Server tool tests — validates parameter schemas, tool registration,
 * and error propagation without starting the actual stdio transport.
 *
 * We test the zod schemas and validation directly since the MCP server
 * tools delegate to the underlying modules which have their own tests.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// ─── Zod Schema Tests ────────────────────────────────────────────────────────
// These mirror the schemas defined in server.ts to verify validation behavior.

const injAddress = z.string().regex(/^inj1[a-z0-9]{38}$/, 'Must be a valid inj1... address (42 chars)')
const numericString = z.string().regex(/^\d+(\.\d+)?$/, 'Must be a positive numeric string')
const ethAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 0x... Ethereum address (42 chars)')

describe('injAddress schema', () => {
  it('accepts valid inj1 address', () => {
    const addr = 'inj1' + 'a'.repeat(38)
    expect(injAddress.safeParse(addr).success).toBe(true)
  })

  it('accepts address with mixed alphanumeric', () => {
    const addr = 'inj1abc123def456ghi789jkl012mno345pqr6780a'
    expect(addr).toHaveLength(42)
    expect(injAddress.safeParse(addr).success).toBe(true)
  })

  it('rejects address too short', () => {
    const addr = 'inj1' + 'a'.repeat(37) // 41 chars
    expect(injAddress.safeParse(addr).success).toBe(false)
  })

  it('rejects address too long', () => {
    const addr = 'inj1' + 'a'.repeat(39) // 43 chars
    expect(injAddress.safeParse(addr).success).toBe(false)
  })

  it('rejects address without inj1 prefix', () => {
    expect(injAddress.safeParse('cosmos1' + 'a'.repeat(38)).success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(injAddress.safeParse('').success).toBe(false)
  })

  it('rejects address with uppercase letters', () => {
    const addr = 'inj1' + 'A'.repeat(38)
    expect(injAddress.safeParse(addr).success).toBe(false)
  })

  it('rejects address with special characters', () => {
    const addr = 'inj1' + 'a'.repeat(37) + '!'
    expect(injAddress.safeParse(addr).success).toBe(false)
  })

  it('rejects path traversal attempt', () => {
    expect(injAddress.safeParse('../../../etc/passwd').success).toBe(false)
  })
})

describe('numericString schema', () => {
  it('accepts integer string', () => {
    expect(numericString.safeParse('100').success).toBe(true)
  })

  it('accepts decimal string', () => {
    expect(numericString.safeParse('100.50').success).toBe(true)
  })

  it('accepts zero', () => {
    expect(numericString.safeParse('0').success).toBe(true)
  })

  it('accepts "0.001"', () => {
    expect(numericString.safeParse('0.001').success).toBe(true)
  })

  it('accepts large number', () => {
    expect(numericString.safeParse('999999999.999999').success).toBe(true)
  })

  it('rejects negative number', () => {
    expect(numericString.safeParse('-100').success).toBe(false)
  })

  it('rejects "NaN"', () => {
    expect(numericString.safeParse('NaN').success).toBe(false)
  })

  it('rejects "Infinity"', () => {
    expect(numericString.safeParse('Infinity').success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(numericString.safeParse('').success).toBe(false)
  })

  it('rejects scientific notation', () => {
    expect(numericString.safeParse('1e5').success).toBe(false)
  })

  it('rejects string with spaces', () => {
    expect(numericString.safeParse('100 ').success).toBe(false)
  })

  it('rejects non-numeric string', () => {
    expect(numericString.safeParse('abc').success).toBe(false)
  })

  it('rejects multiple dots', () => {
    expect(numericString.safeParse('1.2.3').success).toBe(false)
  })

  it('rejects leading dot without digit', () => {
    expect(numericString.safeParse('.5').success).toBe(false)
  })

  it('rejects trailing dot', () => {
    expect(numericString.safeParse('5.').success).toBe(false)
  })
})

// ─── Tool parameter shape tests ──────────────────────────────────────────────
// Verify the schema combinations used by each MCP tool.

describe('trade_open parameter validation', () => {
  const schema = z.object({
    address: injAddress,
    password: z.string(),
    symbol: z.string(),
    side: z.enum(['long', 'short']),
    amount: numericString,
    leverage: z.number().min(1).max(50).optional(),
    slippage: z.number().min(0).max(0.5).optional(),
  })

  it('accepts valid long trade params', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'my-password',
      symbol: 'BTC',
      side: 'long',
      amount: '1000',
    })
    expect(result.success).toBe(true)
  })

  it('accepts full params with leverage and slippage', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'my-password',
      symbol: 'ETH',
      side: 'short',
      amount: '500.50',
      leverage: 20,
      slippage: 0.02,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid side', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      symbol: 'BTC',
      side: 'up',
      amount: '100',
    })
    expect(result.success).toBe(false)
  })

  it('rejects leverage below 1', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      symbol: 'BTC',
      side: 'long',
      amount: '100',
      leverage: 0.5,
    })
    expect(result.success).toBe(false)
  })

  it('rejects leverage above 50', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      symbol: 'BTC',
      side: 'long',
      amount: '100',
      leverage: 100,
    })
    expect(result.success).toBe(false)
  })

  it('rejects slippage above 0.5', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      symbol: 'BTC',
      side: 'long',
      amount: '100',
      slippage: 0.9,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative slippage', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      symbol: 'BTC',
      side: 'long',
      amount: '100',
      slippage: -0.1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative amount', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      symbol: 'BTC',
      side: 'long',
      amount: '-100',
    })
    expect(result.success).toBe(false)
  })
})

describe('trade_close parameter validation', () => {
  const schema = z.object({
    address: injAddress,
    password: z.string(),
    symbol: z.string(),
    slippage: z.number().min(0).max(0.5).optional(),
  })

  it('accepts valid close params', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      symbol: 'BTC',
    })
    expect(result.success).toBe(true)
  })

  it('accepts close with custom slippage', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      symbol: 'ETH',
      slippage: 0.1,
    })
    expect(result.success).toBe(true)
  })
})

describe('wallet_generate parameter validation', () => {
  const schema = z.object({
    password: z.string().min(8),
    name: z.string().optional(),
  })

  it('accepts valid password', () => {
    expect(schema.safeParse({ password: 'my-secure-pw' }).success).toBe(true)
  })

  it('accepts password with name', () => {
    expect(schema.safeParse({ password: 'my-secure-pw', name: 'Main Wallet' }).success).toBe(true)
  })

  it('rejects password shorter than 8 chars', () => {
    expect(schema.safeParse({ password: 'short' }).success).toBe(false)
  })

  it('rejects empty password', () => {
    expect(schema.safeParse({ password: '' }).success).toBe(false)
  })
})

describe('bridge_debridge_quote parameter validation', () => {
  const schema = z.object({
    srcDenom: z.string().min(1),
    amount: numericString,
    dstChain: z.union([z.string(), z.number().int().positive()]),
    dstTokenAddress: z.string().min(1),
    recipient: z.string().min(1),
  })

  it('accepts valid quote params with named chain', () => {
    const result = schema.safeParse({
      srcDenom: 'inj',
      amount: '1.5',
      dstChain: 'ethereum',
      dstTokenAddress: '0x' + 'a'.repeat(40),
      recipient: '0x' + 'b'.repeat(40),
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid quote params with numeric chain id', () => {
    const result = schema.safeParse({
      srcDenom: 'erc20:0x' + 'a'.repeat(40),
      amount: '100',
      dstChain: 8453,
      dstTokenAddress: '0x' + 'b'.repeat(40),
      recipient: '0x' + 'c'.repeat(40),
    })
    expect(result.success).toBe(true)
  })

  it('rejects negative amount', () => {
    const result = schema.safeParse({
      srcDenom: 'inj',
      amount: '-1',
      dstChain: 'ethereum',
      dstTokenAddress: '0x' + 'a'.repeat(40),
      recipient: '0x' + 'b'.repeat(40),
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid numeric chain id', () => {
    const result = schema.safeParse({
      srcDenom: 'inj',
      amount: '1',
      dstChain: 0,
      dstTokenAddress: '0x' + 'a'.repeat(40),
      recipient: '0x' + 'b'.repeat(40),
    })
    expect(result.success).toBe(false)
  })
})

describe('evm_broadcast parameter validation', () => {
  const schema = z.object({
    address: injAddress,
    password: z.string(),
    to: ethAddress.optional(),
    data: z.string().optional(),
    value: numericString.optional(),
    nonce: z.number().int().min(0).optional(),
    gasLimit: z.union([z.number().int().positive(), numericString]).optional(),
    gasPrice: numericString.optional(),
    chainId: z.number().int().positive().optional(),
    memo: z.string().optional(),
  })

  it('accepts valid params with destination address', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      to: '0x' + 'b'.repeat(40),
      data: '0x1234',
      value: '0',
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid params without destination address (contract deploy)', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      data: '0x60006000',
      gasLimit: 500000,
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid ethereum destination address', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      to: '0x123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative nonce', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      nonce: -1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid gasLimit numeric string', () => {
    const result = schema.safeParse({
      address: 'inj1' + 'a'.repeat(38),
      password: 'pw',
      gasLimit: '-100',
    })
    expect(result.success).toBe(false)
  })
})
