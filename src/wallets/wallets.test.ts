import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { wallets } from './index.js'
import { keystore } from '../keystore/index.js'
import { WrongPassword, WalletNotFound } from '../errors/index.js'

describe('wallets', () => {
  const PASSWORD = 'test-password-123'
  const generatedAddresses: string[] = []

  afterEach(() => {
    for (const addr of generatedAddresses) {
      keystore.remove(addr)
    }
    generatedAddresses.length = 0
  })

  it('generates a new wallet and returns address + mnemonic', () => {
    const result = wallets.generate(PASSWORD, 'test-wallet')
    generatedAddresses.push(result.address)

    expect(result.address).toMatch(/^inj1[a-z0-9]+$/)
    expect(result.mnemonic.split(' ').length).toBeGreaterThanOrEqual(12)
  })

  it('stores wallet in keystore and can list it', () => {
    const result = wallets.generate(PASSWORD)
    generatedAddresses.push(result.address)

    const list = wallets.list()
    expect(list.some(w => w.address === result.address)).toBe(true)
  })

  it('can unlock a generated wallet', () => {
    const result = wallets.generate(PASSWORD)
    generatedAddresses.push(result.address)

    const privateKey = wallets.unlock(result.address, PASSWORD)
    expect(privateKey).toMatch(/^0x[0-9a-f]{64}$/i)
  })

  it('throws WrongPassword on incorrect password', () => {
    const result = wallets.generate(PASSWORD)
    generatedAddresses.push(result.address)

    expect(() => wallets.unlock(result.address, 'wrong-password')).toThrow(WrongPassword)
  })

  it('imports a wallet from a private key hex', () => {
    // Generate to get a key, then re-import it
    const gen = wallets.generate(PASSWORD)
    generatedAddresses.push(gen.address)
    const privateKey = wallets.unlock(gen.address, PASSWORD)

    // Remove and re-import
    wallets.remove(gen.address)
    generatedAddresses.splice(generatedAddresses.indexOf(gen.address), 1)

    const imported = wallets.import(privateKey, 'new-password', 'imported')
    generatedAddresses.push(imported.address)

    expect(imported.address).toBe(gen.address)
  })

  it('removes a wallet', () => {
    const result = wallets.generate(PASSWORD)
    const removed = wallets.remove(result.address)
    expect(removed).toBe(true)

    // Should not be in list anymore
    const list = wallets.list()
    expect(list.some(w => w.address === result.address)).toBe(false)
  })

  it('throws WalletNotFound when unlocking a valid-format but non-existent address', () => {
    // Generate a valid wallet just to get a valid address format, then delete it and try to unlock
    const { address } = wallets.generate('temp-pw')
    wallets.remove(address)
    expect(() => wallets.unlock(address, PASSWORD)).toThrow(WalletNotFound)
  })

  it('throws on invalid address format (path traversal protection)', () => {
    expect(() => wallets.unlock('../../../etc/passwd', PASSWORD)).toThrow(/Invalid Injective address/)
  })

  it('encryption round-trip with different salts per wallet', () => {
    const a = wallets.generate(PASSWORD)
    const b = wallets.generate(PASSWORD)
    generatedAddresses.push(a.address, b.address)

    const keyA = wallets.unlock(a.address, PASSWORD)
    const keyB = wallets.unlock(b.address, PASSWORD)

    // Different wallets, different keys
    expect(keyA).not.toBe(keyB)
  })
})
