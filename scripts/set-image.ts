#!/usr/bin/env npx tsx
import { createConfig } from '../src/config/index.js'
import { wallets } from '../src/wallets/index.js'
import { identity } from '../src/identity/index.js'
import { identityRead } from '../src/identity/read.js'

const PRIVATE_KEY = process.env['INJECTIVE_PRIVATE_KEY']
if (!PRIVATE_KEY) { console.error('Set INJECTIVE_PRIVATE_KEY'); process.exit(1) }

const config = createConfig('testnet')
const PASSWORD = 'set-image-123'

async function main() {
  const pk = PRIVATE_KEY!.startsWith('0x') ? PRIVATE_KEY! : `0x${PRIVATE_KEY}`
  const { address } = wallets.import(pk, PASSWORD, 'set-image')

  // Set the image as an on-chain metadata key so the explorer can find it
  const imageUrl = 'https://picsum.photos/id/982/400/400'

  console.log(`Setting on-chain "image" metadata for agent #10: ${imageUrl}`)

  // Use setMetadata directly via the handler — we need to add "image" as a metadata key
  // The update handler only supports name/agentType/builderCode, so let's call setMetadata directly
  const { createIdentityWalletClient, createIdentityPublicClient } = await import('../src/identity/client.js')
  const { getIdentityConfig } = await import('../src/identity/config.js')
  const { IDENTITY_REGISTRY_ABI } = await import('../src/identity/abis.js')
  const { encodeStringMetadata } = await import('../src/identity/helpers.js')

  const privateKeyHex = wallets.unlock(address, PASSWORD)
  const walletClient = createIdentityWalletClient('testnet', privateKeyHex)
  const publicClient = createIdentityPublicClient('testnet')
  const identityCfg = getIdentityConfig('testnet')
  const account = walletClient.account!

  const txHash = await walletClient.writeContract({
    chain: walletClient.chain!,
    account,
    address: identityCfg.identityRegistry,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setMetadata',
    args: [10n, 'image', encodeStringMetadata(imageUrl)],
  })

  console.log(`TX: ${txHash}`)
  await publicClient.waitForTransactionReceipt({ hash: txHash })
  console.log('Done! Refresh the explorer to see the image.')

  wallets.remove(address)
}

main().catch(console.error)
