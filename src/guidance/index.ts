export const frontendGuidanceTopics = [
  'wallet-signing',
  'trading-ux',
  'rfq-taker-ux',
  'usdc-balance-ux',
  'authz-autosign-readiness',
] as const

export type FrontendGuidanceTopic = typeof frontendGuidanceTopics[number]

export interface FrontendGuidanceSection {
  topic: FrontendGuidanceTopic
  title: string
  summary: string
  checks: string[]
  avoid: string[]
  relatedTools: string[]
}

const sections: FrontendGuidanceSection[] = [
  {
    topic: 'wallet-signing',
    title: 'Injective browser wallet signing',
    summary: 'Use Injective account and public key handling for browser transaction flows. Generic Cosmos signing code often reaches signing and then fails CheckTx on Injective EthAccount accounts.',
    checks: [
      'Query account metadata from LCD before signing and handle /injective.types.v1beta1.EthAccount explicitly.',
      'Use base_account.account_number and base_account.sequence from the Injective account payload.',
      'Ensure AuthInfo signer public key type URL is /injective.crypto.v1beta1.ethsecp256k1.PubKey.',
      'Sign the same authInfoBytes that will be broadcast, including the Injective public key type.',
      'Use the wallet address returned for injective-1 and avoid substituting another chain account without conversion checks.',
      'Keep raw CheckTx details in logs and show short user-facing recovery copy.',
    ],
    avoid: [
      'Assuming an inj1 address means generic /cosmos.crypto.secp256k1.PubKey signing is valid.',
      'Treating account sequence mismatch as a chain parameter issue before checking duplicate clicks, stale sequence, multiple tabs, or retries.',
      'Showing account numbers, sequences, signer internals, or raw CheckTx logs in the primary UI.',
    ],
    relatedTools: [
      'address_normalize',
      'account_balances',
      'trade_open',
      'trade_close',
      'trade_open_eip712',
      'trade_close_eip712',
    ],
  },
  {
    topic: 'trading-ux',
    title: 'Injective trading frontend UX',
    summary: 'Keep trading UIs precise in code and logs, but conservative and simple for users. Prevent duplicate submissions across open, close, cancel, cash-out, and emergency flows.',
    checks: [
      'Use one in-flight transaction lock per active wallet or session for all transaction-producing controls.',
      'Disable every trade button while the lock is held and release only after confirmation or failure.',
      'Keep bulk close and cash-out flows sequential unless signer and sequence management are proven safe for parallel broadcasts.',
      'Prefer market search that scrolls to and highlights matching markets while keeping the grid stable.',
      'Use stable card and grid dimensions so loading, error, and search states do not reshape trading forms.',
      'Use short primary copy such as Enter cash, Need cash, Order pending, or Order failed, please try again.',
    ],
    avoid: [
      'Relying on per-card spinners or per-position loading state to prevent duplicate broadcasts.',
      'Filtering a market grid down to one stretched card when a search matches.',
      'Using protocol internals as primary UI copy.',
    ],
    relatedTools: [
      'market_list',
      'market_price',
      'trade_open',
      'trade_close',
      'trade_limit_open',
      'trade_limit_close',
    ],
  },
  {
    topic: 'rfq-taker-ux',
    title: 'RFQ taker browser UX',
    summary: 'RFQ browser taker flows need final click-time validation and serialized submission. A matched quote is not the same as a confirmed trade.',
    checks: [
      'Validate quote freshness, maker allowlists, slippage, and prepared RFQ input at final submit time.',
      'Disable all trade buttons for the wallet while an open or close RFQ is in flight.',
      'Release the in-flight lock only after the accept transaction is confirmed or the flow fails.',
      'Log RFQ IDs, taker details, and quote diagnostics for developers.',
      'Use scroll-and-highlight market search instead of filtering cards out of the grid.',
    ],
    avoid: [
      'Treating prequote or warm RFQ requests as sufficient for final submission.',
      'Letting parallel RFQ accepts from the same wallet race the account sequence.',
      'Showing no-quote diagnostics like RFQ IDs or taker addresses in user-facing error copy.',
    ],
    relatedTools: [
      'rfq_constants',
      'rfq_market_readiness',
    ],
  },
  {
    topic: 'usdc-balance-ux',
    title: 'Native USDC balance UX',
    summary: 'Trading apps should display native USDC balances conservatively, especially after bridge or CCTP funding while indexers catch up.',
    checks: [
      'Default trade amount inputs blank instead of prefilled with a fixed stake.',
      'Let explicit controls such as Half and All-In populate from the currently visible USDC balance.',
      'Truncate displayed USDC balances instead of rounding up.',
      'After bridge or CCTP mint, use a short-lived local balance floor only until authoritative balances catch up or the floor expires.',
      'Keep native USDC denoms explicit in code and logs.',
      'Use Injective EVM USDC 0xa00C59fF5a080D2b954d0c75e46E22a0c371235a and Cosmos denom erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a.',
    ],
    avoid: [
      'Prefilling an amount that may exceed the wallet balance.',
      'Rounding displayed balances up in a way that implies unavailable funds are spendable.',
      'Mixing bridged USDC variants with native Injective USDC in funding or trading flows.',
    ],
    relatedTools: [
      'usdc_native_info',
      'cctp_supported_chains',
      'cctp_attestation_status',
      'cctp_mint',
      'account_balances',
      'subaccount_deposit',
    ],
  },
  {
    topic: 'authz-autosign-readiness',
    title: 'AuthZ and autosign browser readiness',
    summary: 'A connected wallet is not the same as a ready trading session. Browser apps must validate grants, grantee state, fee path, and active wallet identity.',
    checks: [
      'Revalidate local grantee or session state against the active granter inj1 address after connect, account swap, reload, and revoke.',
      'Key local grantee or session storage by granter address.',
      'Broadcast and confirm MsgRevoke before clearing local session state.',
      'Use one in-flight trade lock for the active granter and grantee pair.',
      'Use user-facing states such as Authorize wallet, Order pending, and Order failed, please try again.',
    ],
    avoid: [
      'Letting a session from wallet A appear active for wallet B.',
      'Clearing local revoke state before the on-chain revoke succeeds.',
      'Showing sequence numbers, raw CheckTx logs, or tx internals in the primary UI.',
    ],
    relatedTools: [
      'authz_grant',
      'authz_revoke',
      'trade_open',
      'trade_close',
    ],
  },
]

export function listFrontendGuidanceTopics(): Pick<FrontendGuidanceSection, 'topic' | 'title' | 'summary'>[] {
  return sections.map(({ topic, title, summary }) => ({ topic, title, summary }))
}

export function getFrontendGuidance(topic?: FrontendGuidanceTopic): FrontendGuidanceSection[] {
  if (!topic) {
    return sections
  }

  return sections.filter((section) => section.topic === topic)
}

export const guidance = {
  listFrontendGuidanceTopics,
  getFrontendGuidance,
}
