# PayQuest naira off-ramp via a Base bridge: plan

Status: research and plan, 27 November 2026. Nothing built. Nothing agreed with PayQuest.

## The one blocker

I could not find PayQuest. Three searches (name alone, with "Base USDC Nigeria", with "API docs") returned no site, docs, licence record or press for a company of that name. Everything below that depends on PayQuest is therefore a **design to be confirmed**, not a fact. First action: get from PayQuest, in writing, the items in [Questions for PayQuest](#questions-for-payquest). Per `money-side.md`, do not say "licensed" or name them as a partner until they confirm in writing.

## Can Stellar USDC reach a Base address? Yes, per docs

The route is Stellar USDC → Circle CCTP → native USDC on Base (not wrapped). Two ways to drive it:

| Option | What the docs say | Caveats |
| --- | --- | --- |
| [LI.FI](https://docs.li.fi/introduction/stellar-ecosystem) API/SDK | "Circle CCTP: USDC transfers out of Stellar to 10 EVM chains, including … Base." Chain key `xlm`, chainId `1201081091099710`, pass `chainTypes=EVM,STL`. `fromAddress` is a funded `G…` account; tokens are Soroban `C…` SAC addresses. Poll `/status` with `fromChain=XLM`. | Soroban approvals always expire; submit the approval and wait for it before asking for transaction data. Envelope expires (about 5 minutes; 40 seconds for swap-then-bridge). Docs give no fee percentages or settlement time and carry no date. |
| [Allbridge Core](https://docs-core.allbridge.io/) (`@allbridge/bridge-core-sdk`) | Lists CCTP "between any two of Ethereum, Arbitrum, Avalanche, Base, Optimism, Polygon, Solana and Stellar"; service fee typically 0.1% plus a destination relayer fee. | **Conflicting evidence.** One search result said Stellar is paused pending a CCTP audit; the docs I read show no pause. Allbridge's liquidity pools were discontinued July 2026, and third-party reports describe an August 2026 exploit of a CCTP router on Base. Treat as second choice until its live app confirms the Stellar→Base route. |

Prefer LI.FI first (one API, one status endpoint, CCTP route). Pin the route to `cctp` only, so a quote can never silently pick another bridge.

## Proposed flow

1. User asks to cash out ₦X to bank account Y in Wura.
2. Wura asks PayQuest for a quote and an order (amount, bank, account name check). PayQuest returns a **Base deposit address**, a memo/reference, an expiry and the locked rate.
3. Wura shows the user one approval: USDC amount leaving, bridge fee, PayQuest fee, naira reaching the bank, expiry.
4. On approval: LI.FI quote `xlm USDC → base USDC`, `toAddress` = PayQuest's deposit address. Sign with the existing Privy signer through `money.ts`, same caps and log as other sends.
5. Poll LI.FI `/status` until `DONE`; then poll PayQuest order status until paid. Record both ids in `ramp_transfers`.
6. History entry on completion; stuck-job alerting reuses the reconcile job.

This is the same shape as the existing `cashOutPayment` hook in `web/src/server/ramp/index.ts`: the naira code produces an exact payment instruction, `money.ts` moves the money. The bridge step slots between them.

## Risks that need decisions, not just code

- **Bridge amount must match the order.** If PayQuest needs an exact USDC amount on Base and the bridge delivers slightly less after fees, the order may underpay or fail. Ask whether they accept "at least X" or quote on received amount. Mitigation: request the bridge route with exact-output if available, else add a buffer and handle refunds.
- **Wrong-address or expired-order loss.** A bridge transfer cannot be recalled. Validate the Base address format and refuse if the order expires before the bridge's expected time. Never reuse a deposit address.
- **No refund path.** If PayQuest does not pay out, funds sit on their Base address. Needs a written refund policy and a Base address Wura controls for refunds.
- **Compliance.** Bridging to a third party's address and paying out naira means identity checks and reporting obligations sit with someone. Confirm PayQuest's licence and who owns KYC. Wura must still never store NIN or BVN.
- **Trust in the bridge.** CCTP is Circle's own burn-and-mint, which is the lowest-risk option here. Avoid wrapped-token bridges.
- **Cost and speed unknown.** No authoritative fee or finality numbers. Measure with a small real transfer ($10) before any copy says "in minutes".
- **Environment mismatch.** The app runs on testnet; this route is mainnet only. Same gating as LINK today: refuse unless the wallet is set up on mainnet.

## Fallback

If PayQuest cannot be verified or will not give a Base deposit address, LINK's USDC anchor is already integrated and pays naira to a bank from Stellar directly, with no bridge. You said there is no other route; the honest position is that LINK exists in the repo today and is not yet confirmed live end to end, so keep it as the safety net while PayQuest is vetted.

## Build plan

1. `ramp/payquest.ts` behind `RAMP_OFFRAMP_PROVIDER=payquest`, off by default, with a mock that mirrors the real response shape once known.
2. `bridge/lifi.ts`: quote, approval, execute, status, with `cctp` pinned, `chainTypes=EVM,STL`, Soroban approval handling and simulation before submit. Unit tests with recorded fixtures.
3. Orchestrator state machine: `quoted → approved → bridging → bridged → paying_out → done | refund_needed | failed`, idempotent per order id, stored in `ramp_transfers`.
4. `money.ts` hook (Olayinka): bridge send with caps, kill switch, history.
5. Mainnet dry run with $10: Stellar → Base → PayQuest → a real bank account. Record fees and timings in this file.

## Questions for PayQuest

1. Legal entity, licence (CBN or SEC) and who performs KYC on the end user.
2. API docs, sandbox, and an API key process.
3. Do they accept USDC on Base? Native Circle USDC only?
4. Deposit address per order or per user? Memo/tag needed? Expiry?
5. Exact amount required, or at-least? What happens on under/overpayment?
6. Fees, rate lock duration, payout limits, payout speed, supported banks.
7. Refund policy and a refund address process.
8. Webhooks and idempotency keys.
9. Terms for a product that sends them traffic on behalf of end users.

## Sources

- [LI.FI Stellar ecosystem](https://docs.li.fi/introduction/stellar-ecosystem)
- [Allbridge Core docs](https://docs-core.allbridge.io/)
- [Allbridge Core SDK](https://npmjs.com/package/%40allbridge%2Fbridge-core-sdk)
- [Soroswap Allbridge example](https://github.com/soroswap/allbridge-implementation)
