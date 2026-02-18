/**
 * Keystore — encrypted local storage for private keys.
 *
 * Encryption: AES-256-GCM with scrypt key derivation.
 * Random salt + IV per entry. File permissions: 0o600.
 * Storage: ~/.injective-agent/keys/{address}.json
 *
 * Security note: Passwords flow through function parameters.
 * If the integration layer logs function calls, passwords may be visible.
 * This is a known trade-off documented here intentionally.
 */
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, readdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { WalletNotFound, WrongPassword } from '../errors/index.js'

const KEYSTORE_DIR = join(homedir(), '.injective-agent', 'keys')

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32
const IV_LEN = 12
const SALT_LEN = 32
const VERSION = 1

interface KeyFile {
  version: number
  address: string
  name?: string
  salt: string   // hex
  iv: string     // hex
  ciphertext: string  // hex (AES-256-GCM encrypted privateKeyHex)
  authTag: string     // hex (GCM auth tag)
}

function ensureDir(): void {
  if (!existsSync(KEYSTORE_DIR)) {
    mkdirSync(KEYSTORE_DIR, { recursive: true, mode: 0o700 })
  }
}

const VALID_ADDRESS = /^inj1[a-z0-9]{38}$/

function validateAddress(address: string): void {
  if (!VALID_ADDRESS.test(address)) {
    throw new Error(`Invalid Injective address format: ${address}`)
  }
}

function keyPath(address: string): string {
  validateAddress(address)
  return join(KEYSTORE_DIR, `${address}.json`)
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }) as Buffer
}

export interface WalletEntry {
  address: string
  name?: string
}

export const keystore = {
  save(address: string, privateKeyHex: string, password: string, name?: string): void {
    ensureDir()

    const salt = randomBytes(SALT_LEN)
    const iv = randomBytes(IV_LEN)
    const key = deriveKey(password, salt)

    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(privateKeyHex, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()

    const keyFile: KeyFile = {
      version: VERSION,
      address,
      name,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      ciphertext: encrypted.toString('hex'),
      authTag: authTag.toString('hex'),
    }

    const path = keyPath(address)
    writeFileSync(path, JSON.stringify(keyFile, null, 2), { mode: 0o600 })
    // Ensure correct permissions even when overwriting an existing file —
    // writeFileSync's mode option only applies on file creation.
    chmodSync(path, 0o600)
  },

  load(address: string, password: string): string {
    const path = keyPath(address)
    if (!existsSync(path)) {
      throw new WalletNotFound(address)
    }

    const keyFile: KeyFile = JSON.parse(readFileSync(path, 'utf8'))
    const salt = Buffer.from(keyFile.salt, 'hex')
    const iv = Buffer.from(keyFile.iv, 'hex')
    const ciphertext = Buffer.from(keyFile.ciphertext, 'hex')
    const authTag = Buffer.from(keyFile.authTag, 'hex')

    const key = deriveKey(password, salt)

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      return decrypted.toString('utf8')
    } catch {
      throw new WrongPassword()
    }
  },

  list(): WalletEntry[] {
    ensureDir()
    const files = readdirSync(KEYSTORE_DIR).filter(f => f.endsWith('.json'))
    const results: WalletEntry[] = []
    for (const file of files) {
      const path = join(KEYSTORE_DIR, file)
      try {
        const keyFile: KeyFile = JSON.parse(readFileSync(path, 'utf8'))
        results.push({ address: keyFile.address, name: keyFile.name })
      } catch {
        // Skip malformed files
      }
    }
    return results
  },

  remove(address: string): boolean {
    const path = keyPath(address)
    if (!existsSync(path)) return false
    unlinkSync(path)
    return true
  },

  exists(address: string): boolean {
    return existsSync(keyPath(address))
  },
}
