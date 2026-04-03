#!/usr/bin/env npx tsx
import { createConfig } from '../src/config/index.js'
import { wallets } from '../src/wallets/index.js'
import { identity } from '../src/identity/index.js'
import { identityRead } from '../src/identity/read.js'

const PRIVATE_KEY = process.env['INJECTIVE_PRIVATE_KEY']
if (!PRIVATE_KEY) { console.error('Set INJECTIVE_PRIVATE_KEY'); process.exit(1) }

const config = createConfig('testnet')
const PASSWORD = 'update-script-123'

async function main() {
  const pk = PRIVATE_KEY!.startsWith('0x') ? PRIVATE_KEY! : `0x${PRIVATE_KEY}`
  const { address } = wallets.import(pk, PASSWORD, 'update-script')

  const imageId = Math.floor(Math.random() * 1000)
  const avatarUrl = `https://picsum.photos/id/${imageId}/400/400`

  const agentCard = {
    name: 'NebulaTrade-2305',
    description: 'Autonomous perp arbitrage agent on Injective. Now with a fresh new look.',
    image: avatarUrl,
    attributes: [
      { trait_type: 'Agent Type', value: 'Trading' },
      { trait_type: 'Strategy', value: 'Perp Arbitrage' },
      { trait_type: 'Risk Level', value: 'Medium' },
      { trait_type: 'Version', value: '2.0' },
    ],
  }

  const newURI = `data:application/json;base64,${Buffer.from(JSON.stringify(agentCard)).toString('base64')}`

  console.log(`Updating agent #10 with new avatar: ${avatarUrl}`)
  console.log()

  const result = await identity.update(config, {
    address,
    password: PASSWORD,
    agentId: '10',
    uri: newURI,
  })

  console.log(`TX Hash: ${result.txHashes[0]}`)
  console.log()

  console.log('Verifying...')
  const status = await identityRead.status(config, { agentId: '10' })
  console.log(`Token URI updated: ${status.tokenURI.length} chars`)
  console.log(`Avatar: ${avatarUrl}`)

  wallets.remove(address)
}

main().catch(console.error)
