#!/usr/bin/env npx tsx
import { toHex } from 'viem'
import { createConfig } from '../src/config/index.js'
import { wallets } from '../src/wallets/index.js'
import { createIdentityWalletClient, createIdentityPublicClient } from '../src/identity/client.js'
import { getIdentityConfig } from '../src/identity/config.js'
import { IDENTITY_REGISTRY_ABI } from '../src/identity/abis.js'

const PRIVATE_KEY = process.env['INJECTIVE_PRIVATE_KEY']
if (!PRIVATE_KEY) { console.error('Set INJECTIVE_PRIVATE_KEY'); process.exit(1) }

async function main() {
  const pk = PRIVATE_KEY!.startsWith('0x') ? PRIVATE_KEY! : `0x${PRIVATE_KEY}`
  const PASSWORD = 'raw-image-123'
  const { address } = wallets.import(pk, PASSWORD, 'raw-image')
  const privateKeyHex = wallets.unlock(address, PASSWORD)

  const walletClient = createIdentityWalletClient('testnet', privateKeyHex)
  const publicClient = createIdentityPublicClient('testnet')
  const identityCfg = getIdentityConfig('testnet')
  const account = walletClient.account!

  const imageUrl = 'https://picsum.photos/id/982/400/400'

  // Set as raw UTF-8 bytes (NOT ABI-encoded)
  const rawBytes = toHex(imageUrl)
  console.log(`Setting "image" as raw UTF-8 bytes: ${rawBytes}`)

  const txHash = await walletClient.writeContract({
    chain: walletClient.chain!,
    account,
    address: identityCfg.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setMetadata',
    args: [10n, 'image', rawBytes],
  })

  console.log(`TX: ${txHash}`)
  await publicClient.waitForTransactionReceipt({ hash: txHash })
  console.log('Done! Refresh the explorer.')

  wallets.remove(address)
}

main().catch(console.error)
