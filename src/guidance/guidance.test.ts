import { describe, expect, it } from 'vitest'
import { frontendGuidanceTopics, getFrontendGuidance, listFrontendGuidanceTopics } from './index.js'

describe('frontend guidance', () => {
  it('lists all supported topics', () => {
    expect(frontendGuidanceTopics).toEqual([
      'wallet-signing',
      'trading-ux',
      'rfq-taker-ux',
      'usdc-balance-ux',
      'authz-autosign-readiness',
    ])

    const topics = listFrontendGuidanceTopics()
    expect(topics).toHaveLength(frontendGuidanceTopics.length)
    expect(topics.map((topic) => topic.topic)).toEqual(frontendGuidanceTopics)
  })

  it('returns all guidance when no topic is provided', () => {
    const sections = getFrontendGuidance()

    expect(sections).toHaveLength(frontendGuidanceTopics.length)
    expect(sections.every((section) => section.checks.length > 0)).toBe(true)
    expect(sections.every((section) => section.avoid.length > 0)).toBe(true)
  })

  it('filters guidance by topic', () => {
    const sections = getFrontendGuidance('wallet-signing')

    expect(sections).toHaveLength(1)
    expect(sections[0]?.topic).toBe('wallet-signing')
    expect(sections[0]?.checks.join(' ')).toContain('/injective.crypto.v1beta1.ethsecp256k1.PubKey')
  })

  it('includes native USDC identifiers in the USDC guidance', () => {
    const [section] = getFrontendGuidance('usdc-balance-ux')
    const text = `${section?.checks.join(' ')} ${section?.avoid.join(' ')}`

    expect(text).toContain('0xa00C59fF5a080D2b954d0c75e46E22a0c371235a')
    expect(text).toContain('erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a')
  })

  it('keeps AuthZ readiness guidance tied to grant and wallet identity checks', () => {
    const [section] = getFrontendGuidance('authz-autosign-readiness')
    const text = section?.checks.join(' ') ?? ''

    expect(text).toContain('active granter inj1 address')
    expect(text).toContain('granter address')
    expect(text).toContain('MsgRevoke')
  })
})
