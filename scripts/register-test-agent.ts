#!/usr/bin/env npx tsx
/**
 * Quick script to register a fake agent on Injective EVM testnet.
 *
 * Usage:
 *   INJECTIVE_PRIVATE_KEY=0x... npx tsx scripts/register-test-agent.ts
 *
 * Requires a funded testnet wallet (needs INJ for gas).
 */
import { createConfig } from '../src/config/index.js'
import { wallets } from '../src/wallets/index.js'
import { identity } from '../src/identity/index.js'
import { identityRead } from '../src/identity/read.js'

const PRIVATE_KEY = process.env['INJECTIVE_PRIVATE_KEY']
if (!PRIVATE_KEY) {
  console.error('Set INJECTIVE_PRIVATE_KEY env var to a funded testnet wallet')
  process.exit(1)
}

const PASSWORD = 'test-script-password-123'
const config = createConfig('testnet')

async function main() {
  // 1. Import wallet
  const pk = PRIVATE_KEY!.startsWith('0x') ? PRIVATE_KEY! : `0x${PRIVATE_KEY}`
  const { address } = wallets.import(pk, PASSWORD, 'test-agent-script')
  console.log(`Wallet: ${address}`)

  // 2. Derive EVM address for wallet linkage
  const { privateKeyToAccount } = await import('viem/accounts')
  const evmAccount = privateKeyToAccount(pk as `0x${string}`)
  const evmAddress = evmAccount.address
  console.log(`EVM address: ${evmAddress}`)

  // 3. Generate agent metadata
  const agentName = 'NebulaTrade-' + Math.floor(Math.random() * 9999)
  const agentType = 'trading'
  const builderCode = 'nebula-' + Math.floor(Math.random() * 9999)

  // Simple JSON metadata as the token URI (pointing to a real random image)
  const avatarUrl = 'https://picsum.photos/id/' + Math.floor(Math.random() * 1000) + '/400/400'
  const metadataJson = {
    name: agentName,
    description: 'An autonomous trading agent powered by Injective. Specializes in perpetual futures arbitrage across CEX/DEX venues. Built with the Injective Agent SDK.',
    image: avatarUrl,
    attributes: [
      { trait_type: 'Agent Type', value: 'Trading' },
      { trait_type: 'Strategy', value: 'Perp Arbitrage' },
      { trait_type: 'Risk Level', value: 'Medium' },
      { trait_type: 'Uptime', value: '99.7%' },
      { trait_type: 'Builder', value: 'Injective Labs' },
    ],
  }

  // Use a data URI since we don't have IPFS upload -- the contract accepts any string
  const tokenURI = `data:application/json;base64,${Buffer.from(JSON.stringify(metadataJson)).toString('base64')}`

  console.log('\n--- Agent Metadata ---')
  console.log(`Name: ${agentName}`)
  console.log(`Type: ${agentType}`)
  console.log(`Builder Code: ${builderCode}`)
  console.log(`Avatar: ${avatarUrl}`)
  console.log(`Token URI: data:application/json;base64,... (${tokenURI.length} chars)`)

  // 4. Register the agent
  console.log('\nRegistering agent on Injective EVM testnet...')
  try {
    const result = await identity.register(config, {
      address,
      password: PASSWORD,
      name: agentName,
      type: agentType,
      builderCode,
      wallet: evmAddress,
      uri: tokenURI,
    })

    console.log('\n--- Registration Result ---')
    console.log(`Agent ID: ${result.agentId}`)
    console.log(`TX Hash: ${result.txHash}`)
    console.log(`Owner: ${result.owner}`)
    if (result.walletTxHash) {
      console.log(`Wallet Link TX: ${result.walletTxHash}`)
    }
    if (result.walletLinkSkipped) {
      console.log(`Wallet Link Skipped: ${result.walletLinkReason}`)
    }

    // 5. Query the agent back
    console.log('\nQuerying agent status...')
    const status = await identityRead.status(config, { agentId: result.agentId })
    console.log('\n--- Agent Status ---')
    console.log(JSON.stringify(status, null, 2))
  } catch (err) {
    console.error('\nRegistration failed:', err instanceof Error ? err.message : err)
  }

  // Cleanup
  wallets.remove(address)
}

main().catch(console.error)
