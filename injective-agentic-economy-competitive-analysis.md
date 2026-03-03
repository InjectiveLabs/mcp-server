# Injective Agentic Economy — Competitive Analysis
**Date:** March 3, 2026
**Audience:** Internal Engineering & Product Team
**Scope:** Base, Solana, Ethereum/EigenLayer, NEAR Protocol, Fetch.ai vs. Injective

---

## 1. Purpose & Context

This document maps the competitive landscape of the **Agentic Economy** — the emerging paradigm where autonomous AI agents transact, earn, and pay each other on-chain — and assesses Injective's position relative to the chains and ecosystems making the most progress. The analysis draws on Injective's existing infrastructure (`mcp-server`, `iAgent`) to identify where we lead, where we trail, and what we must build to win.

The core insight driving this analysis: every major L1/L2 is racing to become the **settlement layer for autonomous agents**. Injective has structural advantages (sub-cent gas, native orderbook, derivatives) that no competitor can replicate. The race is not about infrastructure power — it's about developer tooling, payment standards, and ecosystem gravity.

---

## 2. The Competitive Set

### Direct Competitors
Chains actively building agentic payment infrastructure and developer tooling targeted at AI agents:

- **Base (Coinbase)** — x402 protocol, AgentKit, Agentic Wallets, USDC micropayments
- **Solana** — Solana Agent Kit (SendAI), 77% of x402 volume, fastest finality at scale
- **Fetch.ai / Agentverse** — purpose-built agent marketplace, uAgents framework, 2.7M agents registered

### Indirect Competitors
Ecosystems building agent infrastructure at a different layer or with different primary design intent:

- **NEAR Protocol** — chain abstraction + NEAR Intents, confidential cross-chain execution, AI Agent Market
- **Ethereum / EigenLayer** — AVS-based validated services, enterprise-grade agent security model

### Substitute Approaches
- **Centralized AI orchestration platforms** (LangChain Cloud, OpenAI Assistants API) — agents without on-chain settlement; no economic layer
- **Traditional API marketplaces** (RapidAPI, etc.) — service discovery without trustless payment or agent-to-agent composition

---

## 3. Landscape Map

Positioning competitors on two axes that reveal the most strategically important trade-offs in this space:

**X-axis: Developer Infrastructure Maturity** (prototyping tools → production-ready agent SDKs)
**Y-axis: Financial Use Case Depth** (general-purpose → native DeFi/derivatives focus)

```
HIGH FINANCIAL DEPTH
(derivatives, perps, orderbook)
        |
        |              ★ INJECTIVE (current)
        |               [missing payment layer]
        |
        |
        |                              Solana
        |                           (DeFi mature,
        |                            60+ tools)
        |
        +------------------------------------------
        |                   NEAR
        |              (cross-chain,         Fetch.ai
        |              intent-based)         (2.7M agents,
        |                                    A2A payments)
        |
        |    EigenLayer
        |   (security,
        |   enterprise)           Base
        |                       (x402, USDC,
        |                        agentic wallets)
LOW FINANCIAL DEPTH
(general purpose, stablecoin)
 LOW INFRA MATURITY ----------------------------- HIGH INFRA MATURITY
```

**Key insight:** Injective sits in the upper-right quadrant in terms of financial capability but has yet to build the horizontal developer tooling (payment gating, agent wallets with policy, agent registry) that the other ecosystems have invested in. The gap is not in the blockchain itself — it's in the agentic abstraction layer above it.

---

## 4. Feature Comparison Matrix

Capability areas are weighted by what matters most to the **agent developer** deciding which chain to build on.

### 4.1 Payment & Monetization for Agents

| Capability | Injective | Base | Solana | NEAR | Fetch.ai | EigenLayer |
|---|---|---|---|---|---|---|
| Native payment protocol for agents | ❌ Absent | ✅ Strong (x402 v2) | ✅ Strong (x402 + SOL) | ✅ Adequate (NEAR token) | ✅ Strong (FET micro-payments) | ⚠️ Weak (proposed) |
| Stablecoin payment support | ❌ Absent | ✅ Strong (USDC-native) | ✅ Strong (USDC via x402) | ⚠️ Weak | ✅ Adequate (USDC, FET, Visa) | ❌ Absent |
| Sub-cent micropayments viable | ✅ Strong ($0.0001 gas) | ✅ Strong | ✅ Strong | ✅ Strong | ✅ Strong (nano FET) | ⚠️ Weak |
| Payment gating middleware | ❌ Absent | ✅ Strong | ✅ Strong | ⚠️ Weak | ✅ Adequate | ❌ Absent |
| Tool-level fee configuration | ❌ Absent | ✅ Strong | ✅ Adequate | ⚠️ Weak | ✅ Strong | ❌ Absent |
| On-chain payment verification | ❌ Absent | ✅ Strong | ✅ Strong | ✅ Adequate | ✅ Adequate | ⚠️ Weak |

**Assessment:** Injective's on-chain economics make micropayments viable (gas ~$0.0001), but there is no payment protocol wired into the developer toolchain. Base and Solana are 12–18 months ahead here.

### 4.2 Agent Wallet & Spending Policy

| Capability | Injective | Base | Solana | NEAR | Fetch.ai | EigenLayer |
|---|---|---|---|---|---|---|
| Purpose-built agent wallet | ⚠️ Weak (iAgent, no limits) | ✅ Strong (Agentic Wallets) | ✅ Adequate (Privy/Turnkey) | ✅ Adequate | ✅ Adequate | ❌ Absent |
| Spending limits / caps | ❌ Absent | ✅ Strong | ✅ Adequate | ⚠️ Weak | ⚠️ Weak | ❌ Absent |
| Autonomous signing | ✅ Adequate (iAgent) | ✅ Strong | ✅ Strong | ✅ Strong | ✅ Strong | ⚠️ Weak |
| Delegated execution (AuthZ) | ✅ Strong (Cosmos AuthZ) | ⚠️ Weak | ✅ Adequate | ✅ Adequate | ❌ Absent | ✅ Adequate |
| Audit log for agent spends | ❌ Absent | ✅ Adequate | ⚠️ Weak | ⚠️ Weak | ⚠️ Weak | ❌ Absent |
| Private key isolation / enclave | ❌ Absent | ✅ Strong (enclave-based) | ✅ Adequate | ✅ Strong (IronClaw HW) | ⚠️ Weak | ❌ Absent |

**Assessment:** Injective has Cosmos AuthZ — a powerful primitive for delegated on-chain execution — but it lacks the off-chain policy layer (spending caps, rate limits, audit logs) that would make iAgent safe to deploy autonomously.

### 4.3 Agent-to-Agent Discovery & Communication

| Capability | Injective | Base | Solana | NEAR | Fetch.ai | EigenLayer |
|---|---|---|---|---|---|---|
| Agent service registry | ❌ Absent | ⚠️ Weak | ⚠️ Weak | ✅ Strong (AI Agent Market) | ✅ Strong (Agentverse 2.7M) | ❌ Absent |
| Agent discovery protocol | ❌ Absent | ⚠️ Weak | ⚠️ Weak | ✅ Strong | ✅ Strong (DeltaV routing) | ❌ Absent |
| A2A payment protocol | ❌ Absent | ✅ Adequate (x402) | ✅ Strong (x402) | ✅ Adequate | ✅ Strong (uAgents SDK) | ❌ Absent |
| Cross-chain agent payments | ⚠️ Weak (deBridge, no agent layer) | ⚠️ Weak | ⚠️ Weak | ✅ Strong (Intents + Confidential) | ⚠️ Weak | ✅ Adequate (AVS) |
| Capability advertising / schemas | ❌ Absent | ⚠️ Weak | ⚠️ Weak | ✅ Adequate | ✅ Strong | ❌ Absent |

**Assessment:** NEAR and Fetch.ai are the leaders in agent-to-agent economics. Injective has the deBridge integration that could power cross-chain agent payments, but no agent registry or discovery layer sits on top of it.

### 4.4 Developer Tooling & DX

| Capability | Injective | Base | Solana | NEAR | Fetch.ai | EigenLayer |
|---|---|---|---|---|---|---|
| MCP server (LLM-native tools) | ✅ Strong (mcp-server) | ✅ Strong | ⚠️ Weak | ⚠️ Weak | ⚠️ Weak | ❌ Absent |
| SDK completeness | ✅ Adequate (iAgent + pyinjective) | ✅ Strong (AgentKit) | ✅ Strong (SAK v2, 60+ tools) | ✅ Adequate | ✅ Strong (uAgents) | ⚠️ Weak |
| Getting started time | ⚠️ Weak (manual setup) | ✅ Strong (<2 min CLI) | ✅ Strong | ✅ Adequate | ✅ Strong (browser IDE) | ⚠️ Weak |
| Example agents / templates | ⚠️ Weak | ✅ Adequate | ✅ Strong | ✅ Adequate | ✅ Strong | ❌ Absent |
| TypeScript SDK | ✅ Strong (mcp-server) | ✅ Strong | ✅ Strong | ✅ Adequate | ⚠️ Weak | ⚠️ Weak |
| Python SDK | ✅ Adequate (pyinjective/iAgent) | ✅ Adequate | ✅ Adequate | ✅ Adequate | ✅ Strong | ⚠️ Weak |
| No-code / low-code option | ❌ Absent | ⚠️ Weak | ⚠️ Weak | ⚠️ Weak | ✅ Strong (Agentverse IDE) | ❌ Absent |

**Assessment:** Injective's MCP server is genuinely strong and LLM-native — this is ahead of most competitors. The drag is on agent developer onboarding: no templates, no CLI quickstart, high barrier to first deployment.

### 4.5 Financial Infrastructure Depth

| Capability | Injective | Base | Solana | NEAR | Fetch.ai | EigenLayer |
|---|---|---|---|---|---|---|
| Native perpetuals / derivatives | ✅ Strong (native orderbook) | ❌ Absent | ✅ Adequate (dex-based) | ❌ Absent | ❌ Absent | ❌ Absent |
| Spot trading for agents | ✅ Strong | ✅ Adequate | ✅ Strong | ⚠️ Weak | ❌ Absent | ❌ Absent |
| Staking / yield actions | ✅ Strong | ⚠️ Weak | ✅ Adequate | ✅ Adequate | ✅ Adequate | ✅ Strong (restaking) |
| Cross-chain bridge actions | ✅ Strong (deBridge, EVM) | ⚠️ Weak | ✅ Adequate | ✅ Strong (Intents) | ⚠️ Weak | ⚠️ Weak |
| Transaction finality | ✅ Strong (~1s) | ✅ Adequate (~2s) | ✅ Strong (<1s) | ✅ Strong (1-2s) | ⚠️ Adequate | ⚠️ Weak (~12s ETH) |
| Gas cost for agent operations | ✅ Strong (~$0.0001) | ✅ Adequate (~$0.01) | ✅ Strong (~$0.0005) | ✅ Strong (negligible) | ✅ Adequate | ⚠️ Weak (variable) |

**Assessment:** Injective's financial infrastructure is unmatched for agent use cases involving derivatives and active trading. No other chain in this set has a native orderbook available as agent-callable functions.

---

## 5. Competitor Positioning Analysis

### 5.1 Base (Coinbase)
**Category claim:** The settlement layer for AI agent commerce
**Differentiator:** x402 — the HTTP-native standard for agent micropayments
**Value proposition:** "Pay for any API call, from any agent, with USDC"
**Proof points:** 75M+ transactions, $24M volume, Stripe adoption, Cloudflare co-governance of x402 foundation

Base is winning the **payment standard war**. x402 is now vendor-neutral (x402 Foundation with Cloudflare), which dramatically increases adoption risk — it's no longer a Coinbase-proprietary protocol, it's an emerging open standard. Every chain that doesn't implement x402 compatibility risks being excluded from cross-ecosystem agent payment flows.

**Where Base is weak:** Financial use cases. Base has no native derivatives, relatively thin DeFi, and agents requiring complex financial execution hit the ceiling quickly. Base is the Stripe for agents — excellent at payments, not at trading.

### 5.2 Solana
**Category claim:** The fastest and cheapest chain for agent execution
**Differentiator:** 60+ pre-built agent tools, proven DeFi depth, 77% of x402 volume
**Value proposition:** "The most tools, the fastest finality, the most activity"
**Proof points:** Sub-second finality, 23B+ daily transactions, Firedancer upgrade (Q1 2026) targeting 1M TPS

Solana is the **current volume leader** for agentic transactions. The combination of the Solana Agent Kit (60+ integrations), x402 adoption, and Firedancer's imminent throughput upgrade makes this the hardest competitor to displace for general-purpose financial agents. However, Solana's derivatives are DEX-based (fragmented liquidity), not native orderbook — a real gap for institutional-grade trading agents.

**Where Solana is weak:** Orderbook depth, network stability history (rare but real), and agent discovery/registry (also absent, similar to Injective).

### 5.3 NEAR Protocol
**Category claim:** The chain abstraction layer for the agentic economy
**Differentiator:** NEAR Intents (cross-chain without bridging), Confidential Intents, AI Agent Market
**Value proposition:** "Agents that can operate across every chain, privately"
**Proof points:** $6B+ in Intent volume (Nov 2025), IronClaw hardware-secured agent runtime, AI Agent Market launch (Feb 2026)

NEAR is pursuing a **differentiated privacy and cross-chain angle** that nobody else has. Confidential Intents (agents transacting without exposing strategies on-chain) is genuinely novel and important for sophisticated trading agents. The AI Agent Market's bidding model is the most economically interesting agent-to-agent design in the space. However, NEAR's financial DeFi ecosystem is thin relative to Solana or Injective.

**Where NEAR is weak:** DeFi depth, derivative trading, developer ecosystem size.

### 5.4 Fetch.ai / Agentverse
**Category claim:** The autonomous agent marketplace
**Differentiator:** 2.7M registered agents, DeltaV intelligent routing, purpose-built A2A payment system
**Value proposition:** "Register your agent once; it finds work, gets paid, and pays others automatically"
**Proof points:** Largest agent directory, AI-to-AI payment system launched Jan 2026, ASI-1 Mini LLM

Fetch.ai is the **closest analog to what Injective needs to build** for the agent economy layer — they have exactly what we're missing: registry, discovery, intelligent routing, and micro-payments. Their weakness is the opposite of ours: strong agent coordination layer, weak financial execution layer. A strategic integration or standard compatibility with Fetch.ai's Agentverse could be more valuable than replicating their marketplace from scratch.

**Where Fetch.ai is weak:** DeFi/derivatives, cross-chain execution, EVM compatibility, institutional credibility.

### 5.5 EigenLayer / Ethereum
**Category claim:** Cryptoeconomic security infrastructure for agent services
**Differentiator:** Borrowed Ethereum security via restaking, multi-chain AVS
**Value proposition:** "Run agent services with Ethereum-grade economic guarantees"
**Proof points:** Enterprise partnerships, EigenCloud (2026), 20%+ of AVS rewards to protocol

EigenLayer is building for a different customer: **enterprises and institutions** that need guarantees around agent execution quality, not speed. Their model is security-first and most complex to develop against. They're not currently competitive for the MCP/agent-tooling space but represent a longer-term vector — validated agent services for high-stakes financial operations could be a compelling future use case.

**Where EigenLayer is weak:** Developer experience, speed, agent wallets, payment protocol.

---

## 6. Injective's Competitive Position

### Where We Lead (Protect & Amplify)

**Native derivatives orderbook — unmatched**
No other chain in this set has a native perpetuals orderbook exposed as agent-callable functions. Injective agents can open/close perp positions in a single tool call. This is a moat: it requires years of chain development, not just a wrapper SDK. Competitors building derivative trading agents on Solana or Base face fragmented DEX liquidity and complex multi-contract execution.

**Near-zero gas for agent micropayments**
At ~$0.0001 per transaction, Injective's gas economics are more favorable than Base ($0.01) and competitive with Solana ($0.0005) and NEAR. This matters for high-frequency agents making thousands of micro-decisions per hour.

**MCP server with full on-chain execution**
Injective's `mcp-server` is the most complete MCP-native on-chain execution layer of any chain. Exposing trading, bridging, staking, AuthZ, and EVM broadcast through MCP tools is ahead of most competitors who are still building this abstraction. This is real leverage with the LLM/agent developer ecosystem.

**Cosmos AuthZ — native delegation primitive**
The `authz_grant` / `authz_revoke` tools expose a powerful on-chain delegation model. No equivalent exists in EVM chains without custom smart contracts. This is the foundation for building spending limits and scoped agent permissions with cryptographic enforcement.

**deBridge integration already live**
Cross-chain payment acceptance is partially solved. `bridge_debridge_quote` and `bridge_debridge_send` allow agents to receive and send value across chains. Wrapping this with x402-style agent payment semantics is a smaller jump than building cross-chain payment rails from scratch.

### Where We Trail (Prioritized Gaps)

**Gap 1 (Critical): No payment gating layer**
Every competitor with traction (Base, Solana, Fetch.ai) has a mechanism for agents to earn money from other agents or users. Injective has none. This is the single biggest gap limiting ecosystem development because it means:
- External developers cannot monetize agents built on Injective
- Injective agents cannot purchase services from other agents
- There is no economic gravity pulling developers to Injective for agentic use cases

The build is well-defined (see x402 middleware proposal). This is Phase 1 of the implementation roadmap and should be the team's top priority.

**Gap 2 (High): No spending limits on agent wallets**
iAgent's AgentManager holds raw private keys with no policy layer. Deploying a trading agent with uncapped spending authority is a liability — both operationally (a buggy agent drains a wallet) and for adoption (enterprises won't deploy agents they can't control). Base and NEAR have this; we don't.

**Gap 3 (Medium): No agent registry or discovery**
Fetch.ai (2.7M agents) and NEAR (AI Agent Market) have the infrastructure for agents to find and hire each other. Without a registry, Injective agents are isolated — they can execute on-chain but cannot participate in multi-agent workflows. This becomes critical once Gaps 1 and 2 are closed.

**Gap 4 (Low-Medium): High developer onboarding friction**
Base's `<2 minute CLI quickstart` and Fetch.ai's browser-based Agentverse IDE set a high bar for DX. Injective requires manual environment setup, understanding of Cosmos/EVM duality, and pyinjective familiarity. Adding agent templates, a quickstart CLI, and example agents would significantly increase developer adoption.

---

## 7. Competitive Win/Loss Analysis (Hypothetical Deals)

When a developer chooses which chain to build a financial AI agent on, Injective's current win/loss pattern would look like:

**Scenarios where Injective wins today:**
- Agent requires native perpetuals / derivatives trading
- Agent needs cross-chain execution with EVM + Cosmos interoperability
- Agent performs high-frequency micro-transactions where gas cost matters
- Developer is already in the Injective/Cosmos ecosystem

**Scenarios where Injective loses today:**
- Developer needs to monetize the agent (earn fees per call) → chooses Base or Fetch.ai
- Developer needs spending caps for safe deployment → chooses Base
- Developer needs to hire other agents for specialized tasks → chooses NEAR or Fetch.ai
- Developer wants fastest time-to-first-agent → chooses Fetch.ai (browser IDE) or Base (CLI)
- Developer needs existing agent marketplace to plug into → chooses Fetch.ai or NEAR

The pattern is clear: **we win on the DeFi depth of what agents can DO; we lose on the economic layer that governs HOW agents pay and get paid.** The fix is targeted: build the payment layer.

---

## 8. Market Trends & Strategic Implications

### Trend 1: x402 Becoming an Open Standard
**What:** x402 moved to a neutral foundation (co-governed with Cloudflare) in September 2025. Stripe adopted it in 2026. It is on track to become the de-facto HTTP-payment protocol for AI agents.
**Implication for Injective:** Implement x402 compatibility — don't build a competing standard. Being x402-compatible means Injective agents can immediately participate in the entire cross-ecosystem agent payment network. This is easier than it sounds: x402 is a simple HTTP 402 response + on-chain tx verification pattern.
**Recommended response:** Lead (implement x402 in mcp-server, be the first Cosmos chain to do so)

### Trend 2: Agent-to-Agent (A2A) Protocol Adoption
**What:** Google's A2A Protocol now has 50+ partners and is converging as the inter-agent communication standard. MCP (Anthropic, now Linux Foundation) has 97M+ monthly SDK downloads.
**Implication for Injective:** Injective's MCP server is already aligned with the winning protocol. The risk is not the transport layer — it's that without a payment layer, MCP tools are freemium with no business model.
**Recommended response:** Fast-follow A2A alongside MCP; design the agent registry to be A2A-compatible from day one.

### Trend 3: Hardware-Secured Agent Execution
**What:** NEAR launched IronClaw (Feb 2026), a hardware-secured agent runtime. This addresses the "can I trust what the agent actually did?" question for high-stakes financial decisions.
**Implication for Injective:** For institutional trading agents managing real capital, execution integrity matters as much as execution speed. This is a longer-term surface area but worth monitoring. TEE-based agent execution would be a powerful differentiator in regulated financial contexts.
**Recommended response:** Monitor. Set trigger: if 2+ institutional customers ask about verifiable agent execution, invest.

### Trend 4: Privacy-Preserving Agent Transactions
**What:** NEAR's Confidential Intents (Feb 2026) allows agents to execute cross-chain without revealing their strategy on-chain. This is directly relevant for trading agents.
**Implication for Injective:** Trading strategy privacy is a real concern for institutional agents. Exposing perpetuals positions on a public orderbook is fine for retail; it's a problem for agents running proprietary strategies. This is a potential feature gap worth evaluating.
**Recommended response:** Monitor. Evaluate Injective's existing privacy tooling; assess whether Confidential Intent-style design is feasible.

### Trend 5: Firedancer (Solana) Closes the TPS Gap
**What:** Solana's Firedancer upgrade targets 1M TPS (Q1 2026), removing the last credible throughput objection to Solana-first agent development.
**Implication for Injective:** Throughput is no longer a Solana weakness. Injective's competitive moat must come from financial depth (derivatives, orderbook) and ecosystem-specific tooling, not raw speed.
**Recommended response:** Don't compete on TPS. Double down on derivatives and the financial agent vertical.

---

## 9. Strategic Recommendations

### Immediate (Q1 2026)
1. **Implement x402 payment middleware** in `mcp-server`. This is the single highest-leverage investment: it closes Gap 1, makes Injective agents interoperable with the x402 ecosystem (75M+ transactions), and gives developers a reason to choose Injective over Base for financial agents that also earn fees. Estimated effort: 3–4 weeks.

2. **Ship a quickstart template** for a "trading agent" — a minimal iAgent example that opens a position, sets a stop-loss, and earns a small fee per call. This is the "Hello World" that converts curious developers into active builders. No other chain has this for derivatives.

### Short-Term (Q2 2026)
3. **Add spending limits to iAgent** (`wallet_policy/` module with policy definitions, Cosmos AuthZ integration, audit log). This is required for any enterprise or institutional adoption of autonomous agents. Without it, every deployment is a liability.

4. **Publish agent service descriptor schema** — a JSON-LD schema that describes what an Injective agent offers, what it charges, and where to call it. This is the prerequisite for the registry and enables immediate integration with NEAR's Agent Market and Fetch.ai's Agentverse as distribution channels.

### Medium-Term (Q3 2026)
5. **Build the agent service registry** — start off-chain (a simple indexed list of descriptors), migrate on-chain once the pattern is proven. Evaluate partnership with Fetch.ai's Agentverse to co-list Injective agents rather than building a competing directory from scratch.

6. **Cross-chain agent payment acceptance via deBridge** — wrap the existing `bridge_debridge_*` tools with x402 semantics so Base agents and Solana agents can pay Injective agents without leaving their native chain. This creates cross-ecosystem demand for Injective agent services.

### Strategic Moat to Defend
The scenario where Injective wins the agentic economy is not by out-tooling Solana on general DeFi or out-registering Fetch.ai on agent count. The winning scenario is:

> *The Injective agent is the only agent that can autonomously manage a derivatives portfolio — entering and exiting perp positions, hedging spot exposure, earning fees from other agents for market signals — all in a single composable MCP workflow.*

No competitor can replicate the native orderbook. The roadmap should be evaluated against this north star: every feature that compounds on Injective's unique financial depth is worth building; features that merely match what Base or Solana already do well are table-stakes, not moats.

---

## 10. Full Competitive Scorecard (Post-Roadmap)

| Feature | Base | Solana | NEAR | Fetch.ai | EigenLayer | **Injective (Now)** | **Injective (Q3 2026)** |
|---|---|---|---|---|---|---|---|
| MCP / LLM-native tools | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ | ✅ | ✅ |
| x402 payment protocol | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Stablecoin micropayments | ✅ | ✅ | ⚠️ | ✅ | ❌ | ❌ | ✅ |
| Agent wallet + spending limits | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ | ✅ |
| Agent-to-agent payments | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Agent registry / discovery | ⚠️ | ⚠️ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Cross-chain agent payments | ⚠️ | ⚠️ | ✅ | ⚠️ | ⚠️ | ⚠️ | ✅ |
| Native perpetuals / orderbook | ❌ | ⚠️ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Sub-cent gas for agents | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| ~1s finality | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ | ✅ |
| Developer quickstart (<5 min) | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠️ | ✅ |
| Cosmos AuthZ delegation | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| EVM + Cosmos interop | ❌ | ❌ | ⚠️ | ❌ | ⚠️ | ✅ | ✅ |

**Legend:** ✅ Strong / Adequate   ⚠️ Weak / Partial   ❌ Absent

---

## Appendix: Key Metrics Reference

| Chain | Block Time | Gas / Tx | Agent Framework | Agent Payment | Registry Scale |
|---|---|---|---|---|---|
| Base | ~2s | ~$0.01 | AgentKit | x402 + USDC (v2) | No registry |
| Solana | <1s | ~$0.0005 | Solana Agent Kit (60+ tools) | x402 (77% of volume) | No registry |
| NEAR | 1–2s | Negligible | NEAR AI Cloud + Intents | NEAR token + Intents | AI Agent Market (Feb 2026) |
| Fetch.ai | FET chain | Nano FET | uAgents + DeltaV | FET + USDC + Visa | 2.7M agents (Agentverse) |
| EigenLayer | ~12s (ETH) | Variable | EigenCloud (AVS) | EIGEN fees (proposed) | No registry |
| **Injective** | **~1s** | **~$0.0001** | **iAgent + mcp-server** | **None** | **None** |

---

*Analysis prepared for InjectiveLabs internal use. Data current as of March 2026. Competitor capabilities change rapidly; recommend re-evaluation at each major milestone in the implementation roadmap.*
