import { PrivateKey } from '@injectivelabs/sdk-ts'
import { keystore, WalletEntry } from '../keystore/index.js'

export interface GenerateResult {
  address: string
  mnemonic: string  // shown once — user must write this down
}

export interface ImportResult {
  address: string
}

export const wallets = {
  /**
   * Generate a new wallet. Returns the mnemonic ONCE for backup purposes.
   * The private key is encrypted and stored in the keystore — never returned.
   */
  generate(password: string, name?: string): GenerateResult {
    const { privateKey, mnemonic } = PrivateKey.generate()
    const address = privateKey.toAddress().toAccountAddress()
    const privateKeyHex = privateKey.toPrivateKeyHex()
    keystore.save(address, privateKeyHex, password, name)
    return { address, mnemonic }
  },

  /**
   * Import an existing wallet from a hex private key.
   * Returns only the address — private key is never returned.
   */
  import(privateKeyHex: string, password: string, name?: string): ImportResult {
    const pk = PrivateKey.fromHex(privateKeyHex)
    const address = pk.toAddress().toAccountAddress()
    keystore.save(address, privateKeyHex, password, name)
    return { address }
  },

  /**
   * Decrypt and return the private key for internal signing use.
   * Never expose this to the integration layer or LLM.
   * @internal
   */
  unlock(address: string, password: string): string {
    return keystore.load(address, password)
  },

  list(): WalletEntry[] {
    return keystore.list()
  },

  remove(address: string): boolean {
    return keystore.remove(address)
  },
}
