# Off-ramp implementation: from today to real dollar and naira payments on mainnet

Status: plan, 27 November 2026. Written after the Paycrest, LI.FI and Privy research in [payquest-offramp-plan.md](payquest-offramp-plan.md) (the file name keeps an old typo; the partner is Paycrest). It sits on top of [mainnet-plan.md](mainnet-plan.md) and [money-side.md](money-side.md) and does not repeat them. Where this says "M3" or "Stage 3", it means those documents.

Nothing here has moved real money. Every partner call below is written from public docs and **has never run against the live service**, except where a section says it was checked.

## 1. The goal

A Wura user holding USDC on Stellar can turn it into naira in their Nigerian bank account, at close to the market rate, from the web app. Along the way the rest of the dollar side works on mainnet: USDC balances, USDC sends, USDC top-ups.

Two naira routes will exist side by side, and `routing.ts` picks per amount:

| Route | Path | Good for | Status |
| --- | --- | --- | --- |
| **LINK anchor** | Stellar USDC (or NGNC) to LINK's SEP-24 page, naira to bank | Anything LINK accepts; no bridge | Built (`ramp/link.ts`), blocked in production by LINK's 403 on Vercel |
| **Paycrest via Base** (this plan) | Stellar USDC, bridged to Base by Circle CCTP, paid to Paycrest, naira to bank | Market-rate naira at larger sizes; independent of LINK | Clients built, nothing else |

Having both is the point. LINK is a single partner that has not answered us yet; Paycrest is a second route with its own KYB'd account (done) and API key (issued).

## 2. Where we are (27 November 2026)

| Piece | State |
| --- | --- |
| Paycrest KYB and API key | Done by Olayinka. The key is not in the repo. |
| `ramp/paycrest.ts` | Built, mock included, 17 offline tests share this suite. Off by default. |
| `bridge/lifi.ts` | Built, quote and status only, never signs. |
| `bridge/privy-evm.ts` | Built: user-owned Base wallet with Wura as scoped signer, sponsored USDC transfer, request signing, Base balance read. 11 tests. |
| `units.ts` | Built, exact amounts as bigint. |
| Orchestrator, DB table, routes, webhook, screens | Not built. |
| Mainnet foundation (M1 to M4, M7, M8) | Per `mainnet-plan.md`; Stage 2 passed on 17 November, Stage 3 not started. |
| Privy Base sponsorship | Researched. Two questions unanswered by the docs (below). |
| Live runs of any of the three new clients | None. |

All 28 tests across the three clients pass. Full `tsc`, ESLint and `next build` were not run in this container (no `node_modules`); run them in CI or locally before merging.

## 3. Design

### 3.1 The flow

```
User approves once            Stellar              Base                         Paycrest
─────────────────────────────────────────────────────────────────────────────────────────
1 quote  ─ rates, bank name check, floor ─────────────────────────────────────▶ read only
2 approve (one screen: USDC out, bridge fee, est. naira, floor)
3 bridge   user's Stellar wallet signs ──▶ CCTP burn ──▶ mint to user's Base wallet
4 landed?  LI.FI status DONE and Base USDC balance >= floor (read from chain)
5 order    create Paycrest order for the amount that actually arrived ──────▶ deposit address, exact amount, expiry
6 pay      Wura's scoped signer sends exactly amountToTransfer from Base wallet ──▶ deposit address
7 settle   webhook validated / settled ◀────────────────────────────────────── naira paid to bank
```

Why the Base wallet sits in the middle: Paycrest wants an exact amount before a short expiry. A bridge can't promise either. Creating the order only after the money has landed starts the expiry clock at a point we control.

### 3.2 Custody: stay non-custodial

`mainnet-plan.md` guardrail: "Wura never holds user funds." The Base wallet is therefore **owned by the user** in Privy (`owner.user_id`), and Wura's server is a **scoped additional signer** limited by a Privy policy: Base USDC contract only, a per-transfer amount cap, and no other method. This is the same pattern `signer.ts` already describes for chat channels. The recipient (Paycrest's one-time address) can't be allowlisted in advance, so the recipient check lives in Wura's code: `sendUsdc` is only ever called with the address the orchestrator stored from Paycrest's order response, and refuses the USDC contract, the wallet itself, the zero address, and anything over the cap.

If Privy turns out not to allow a scoped signer to send sponsored transactions, the fallbacks in order are: (a) a second user signature at step 6 (the user returns to confirm; works but adds friction and the expiry matters), (b) an app-owned wallet, which is **custodial for the minutes funds sit there** and needs an explicit decision from Olayinka and Samuel and a change to the guardrail wording and the terms page. Do not ship (b) silently.

### 3.3 Gas

`PRIVY_BASE_SPONSOR=app` (default): Wura pays through Privy gas credits; the wallet holds no ETH; the USDC amount sent is exact. Fallback `usdc`: gas is taken from the wallet's USDC; the bridge must deliver the order amount plus a margin. Privy's mode is app-wide, so it is one or the other. Cost is unpublished (the docs say "actual network gas cost plus a convenience fee"); an illustrative figure in Privy's own recipe is about $0.05 per Base transaction. Measure it in Phase 1.

### 3.4 State machine

One row per cash-out in a new table `offramp_orders` (schema as a small PR first; `db.ts` is Olayinka's). Keyed by Wura's own `reference` (also Paycrest's `reference` and Privy's idempotency key, so a retry anywhere can't duplicate).

```
quoted → approved → bridging → on_base → order_created → paying → paid_out → settled
                       │          │            │             │         │
                       └──────────┴────────────┴─────────────┴─────────┴──▶ failed
order_created ─▶ expired      paying/paid_out ─▶ refunding ─▶ refunded      any ─▶ held (compliance review)
```

Rules:
- Each transition is a single conditional update (`WHERE state = <expected>`), saved before the side effect it guards, the way `claimCashOutPayment` already works. Two workers can't both move the same row.
- `approved → bridging`: the Stellar payment is built, signed by the user's wallet and submitted through the existing `money.ts` path (caps, approve, log). The bridge tx hash is stored.
- `bridging → on_base`: only when LI.FI says `DONE` **and** `usdcBalance(base wallet) >= floor` read from the chain. LI.FI's word alone is not enough (`bridgeLanded` plus a balance read).
- `on_base → order_created`: re-quote the rate; if the naira the user would get is below the approved floor, stop in `on_base` and ask the user to accept the new figure or return the USDC. No order is created.
- `order_created → paying`: store the order's `amountToTransfer` and `receiveAddress` first, then `sendUsdc` with the cash-out id as idempotency key. If `validUntil` is under 60 seconds away, don't send; create a fresh order.
- `paying → paid_out`: Paycrest webhook `validated` (the point to tell the user the money is on its way). `settled` closes it.
- `expired`, `refunded`: funds sit in the user's Base wallet. The user is offered "send back to Stellar" (CCTP in reverse through LI.FI, Polymer or Allbridge; **not built**, see Phase 7) or "try again".
- `held` is a visible state, not an error: Paycrest says compliance holds can take days.

A reconcile job (same pattern as `/api/funding/reconcile`, `CRON_SECRET`) walks open rows oldest first, reads LI.FI and Paycrest, closes what has ended, and flags anything stuck past a limit. The webhook is the fast path; the job is the safety net for a missed webhook (Paycrest retries for 24 hours, then stops).

### 3.5 Files

| File | Owner | Role |
| --- | --- | --- |
| `web/src/server/ramp/paycrest.ts` | Samuel | Built. Paycrest client, mock, webhook verify. |
| `web/src/server/bridge/lifi.ts` | Samuel | Built. Quote and status. |
| `web/src/server/bridge/privy-evm.ts` | Samuel (Privy is Olayinka's area: confirm in chat) | Built. |
| `web/src/server/units.ts` | Samuel | Built. |
| `web/src/server/offramp/orchestrator.ts` | Samuel | Phase 3. The state machine above. |
| `web/src/server/offramp/records.ts` | Samuel, schema PR by Olayinka | Phase 3. `offramp_orders` reads and writes. |
| `web/src/app/api/funding/paycrest/**` | Samuel | Phase 3. Quote, approve, status, webhook, reconcile routes. |
| `web/src/server/routing.ts` | Olayinka | Phase 5. Paycrest as one more venue through a `quote()`. |
| `web/src/server/money.ts`, `signer.ts` | Olayinka | Phase 5. The Stellar leg of the bridge goes through here. |
| `web/src/app/**` cash-out screen | Olayinka | Phase 5. |

## 4. Decisions needed

| # | Decision | Recommendation | Who |
| --- | --- | --- | --- |
| P1 | Custody of the Base wallet | User-owned with a scoped signer (§3.2). App-owned only by explicit decision | Olayinka, Samuel |
| P2 | Gas mode | `app`; fall back to `usdc` if Privy can't sponsor the signer's sends | Samuel |
| P3 | Wura's margin | Paycrest supports an optional `senderFee`; start at **zero** for the beta and show Paycrest's own fee, so the first numbers are clean. Revisit before wider launch | Olayinka |
| P4 | Who does end-user KYC | Paycrest says the sender owns it. Ask them exactly what they require for NGN off-ramp (§Phase 0). Use a hosted check; never store NIN or BVN | Samuel |
| P5 | Rate tolerance between approval and order | 1% below the approved floor stops the flow and asks again | Olayinka |
| P6 | Caps | Keep the existing mainnet caps (₦18,750 and $12 per payment, ₦50,000 and $50 a day). Bridge and order together count as one payment | Olayinka |
| P7 | Refund return path to Stellar | Build in Phase 7. Until then the user is told plainly that refunded money stays on Base | Samuel |
| P8 | Route choice in the UI | Show the best route's naira figure; show the other as "also available" only when within a set gap, so users aren't asked to compare | Olayinka |

## 5. Phases

Each phase ends with a "done when" that can be checked. Don't start a phase until the one before is done, except where marked parallel.

### Phase 0: accounts and settings (parallel, Olayinka and Samuel, about a day)

**You do (dashboards; Claude can't):**
- Privy: Fee sponsorship on, Base selected, TEE execution on, prepaid credits (about $10) with a saved card. Create the authorization key (`PRIVY_WALLET_AUTH_KEY`), register it as a signer (`PRIVY_BASE_SIGNER_ID`) and create the spend policy (`PRIVY_BASE_POLICY_ID`): method `eth_sendTransaction`, `to` equals the Base USDC contract, `ethereum_calldata` `transfer.amount` at most the cap. Production only.
- Paycrest: the API key and secret into Vercel Production env, never into chat, the repo or Preview. If Claude needs to make a live call from its container, it will ask through the secure credential form instead.
- LI.FI: optional API key (`LIFI_API_KEY`) for rate limits.
- A Base RPC endpoint with a key if the public one rate-limits (`BASE_RPC_URL`).

**Ask Paycrest (written answers):** what end-user identity and sanctions checks Wura must run for NGN; exact `validUntil` window; what happens on over- and underpayment on Base; refund timing; any test mode; current fee schedule; webhook payload field names; confirmation we may call them a partner.

**Ask Privy (support):** can a scoped additional signer send sponsored transactions from a user-owned wallet? Do policies apply to `sponsor: true` requests? Can the policy check `transfer.recipient`? What is the sponsorship convenience fee?

**Check egress from Vercel Production for every host**: `api.paycrest.io`, `li.quest`, `api.privy.io`, the Base RPC. LINK answered 403 to Vercel's IPs in Stage 2; do not assume the new partners won't. A read-only request from a Production route is enough.

Done when: every environment variable in §8 exists in Production only, each host answers a read-only call from Production, and the Paycrest and Privy answers are written down in `money-side.md`.

### Phase 1: live checks with no user money (Samuel, with Olayinka for the Privy wallet)

Run in this order; each is read-only or uses a throwaway wallet with under $5.
1. Paycrest, read-only: `institutions/NGN`, `verify-account` on a real account number of yours, `rates/base/USDC/10/NGN`. Record the bank code list and the rate.
2. LI.FI, read-only: a real quote for a small Stellar to Base USDC amount with a throwaway `G…` account. Record the fee, `estimate`, the `transactionRequest` shape and the Stellar USDC token identifier; pin the identifier in `LIFI_STELLAR_USDC`. Confirm the quote refusals in `lifi.ts` don't reject a normal quote.
3. Privy: create one **server-owned test wallet**, send it $1 of USDC on Base, try one sponsored transfer with and without the policy. This answers the two open Privy questions by experiment and gives the real cost from the credits drop. Then repeat with a **user-owned wallet and the additional signer** (the production design). Confirm the request-signature format works; this is the least certain code in `privy-evm.ts`.
4. Paycrest write: create a real order for the smallest allowed amount (about $0.50) against your own bank account and pay it from the test wallet. Capture the real webhook bodies and fix the field names marked "unverified" in `paycrest.ts`. This spends real money (cents) and is a mainnet action: do it with Olayinka's agreement.

Output: a "Measured" table in this file: bridge fee and time, Base gas cost, Paycrest fee and settlement time, end-to-end time, naira received versus the quoted figure. Nothing user-facing says "in minutes" until this table exists.

Done when: all four steps ran, the unverified fields are verified or fixed, and the table is filled.

### Phase 2: mainnet foundation for dollars (Olayinka; this is `mainnet-plan.md`, not new work)

The off-ramp needs these first: M1 network config and kill switch (done for boot checks), M2 real assets in `stellar.ts`, M3 sponsored account setup, M4 stable transfers, M7 environment separation, M8 allowlist, alerts, runbook and database backups. M5 (payment links) and M10 (swaps) are not required for the off-ramp.

What "full dollar payments" means here: a user has USDC on mainnet Stellar (top-up through the LINK dollar anchor, or a transfer in), can see it, send it to another wallet with destination checks and a memo, and cash it out. The mainnet plan's Stage 3 "$1 transfer to a second wallet" is the test.

Done when: `mainnet-plan.md` Stage 3 steps for USDC top-up, USDC send and balance all pass with real $1 amounts, and LINK's 403 is either solved or the Paycrest route proves it isn't needed for cash-out.

### Phase 3: the orchestrator (Samuel, can start now against mocks)

- `offramp_orders` schema PR (Olayinka reviews `db.ts`): reference, user id, state, amounts in integers, rate, floor, bridge tx hash, LI.FI status, Base wallet id and address, Paycrest order id and `providerAccount` (address, amount, expiry), Privy transaction id, bank code, **masked** account (last four) and no name or full number after the order is created, timestamps, retry counters.
- `orchestrator.ts`: the state machine in §3.4, written against `createMockPaycrest`, `createMockBridge`, `createMockPrivyEvm`. Tests must cover: restart at every state; the same webhook delivered twice; a webhook before our row is written; bridge lands short of the floor; rate drops below the floor; order expires before payment; Privy retry with the same key; refund path; hold path.
- Routes under `/api/funding/paycrest/`: `quote` (read-only), `approve`, `status`, `webhook` (verify the signature over the raw body first, then idempotently apply; answer 2xx fast), `reconcile` (`CRON_SECRET`). Webhook route must sit outside session auth and be rate-limited.
- Boot check: `RAMP_OFFRAMP_PROVIDER=paycrest` refuses to start without every variable in §8, in Preview, or without `MONEY_KILL` handling.
- Log entries use the existing history path, written once, with no bank details.

Done when: the full state machine passes against mocks including all failure cases above, and a restart in the middle of any state loses nothing.

### Phase 4: wire the money moves (Olayinka for `money.ts`, Samuel for the rest)

- The Stellar leg: `money.ts` builds the bridge payment from the LI.FI `transactionRequest` (Stellar shape confirmed in Phase 1), the user's Privy wallet signs it, the approve/cap/log path applies exactly as for a send. The bridge amount counts against the daily cap.
- The Base wallet is created lazily on a user's first Paycrest cash-out via `findWallet` then `createWallet`. One per user.
- The Base leg: the orchestrator calls `sendUsdc` with the stored Paycrest values. Never from the browser, never from chat. Chat channels can show status but can't approve (as with LINK cash-outs today).
- Kill switch: `MONEY_KILL` stops new approvals and the `paying` step; the reconcile job still runs so in-flight orders resolve and refunds are noticed.

Done when: on a staging deployment with mainnet clients and the mock Paycrest, one cash-out runs end to end including the real signed Stellar leg of a **$1** bridge to a test Base wallet.

### Phase 5: screens and routing (Olayinka)

- Cash-out screen: choose amount, see one summary (USDC leaving, bridge fee, Paycrest fee, estimated naira, floor, bank, verified account name), approve once. Progress states in plain words: "Moving your dollars", "Arrived", "Paying your bank", "Paid", with "Held for review" and "Refunded" as real states, not errors.
- `routing.ts`: Paycrest as a venue with `quote()`; for the same USDC amount compare LINK anchor naira and Paycrest naira and show the better. Remember the sign: Paycrest's `sell` rate, minus fees.
- Wording: "through a partner" everywhere (`PartnerNote`); no "licensed", no partner names as agreed until written confirmation; update `/terms` with the Paycrest and bridge disclosure and that refunds can arrive as USDC on Base.
- Don't show an exact naira figure before the order; show it as an estimate with the floor.

Done when: a user can complete a mock-Paycrest cash-out in the browser on staging, every state has a screen, and no screen exposes bank details beyond the last four digits after submit.

### Phase 6: Stage 3, real money, two people (Olayinka and Samuel, own wallets)

Use the existing Stage 3 checklist from `mainnet-plan.md` and add:
1. $1 USDC top-up (LINK dollar anchor) and a $1 send, from the Phase 2 list.
2. First live Paycrest cash-out: **$5 or the smallest allowed**, to your own bank account. Time every leg. Compare naira received with the quote.
3. Second cash-out: about $12 (the per-payment cap).
4. Force failures on purpose, one at a time, with tiny amounts: a wrong account number (rejected at `verify-account`), `MONEY_KILL=1` mid-flow (in-flight resolves, no new payment starts), webhook delivery blocked (reconcile catches it), an order allowed to expire (funds stay on Base, user offered a retry).
5. Write results into the "Measured" table and `money-side.md`.

Done when: two real cash-outs reached the bank, each failure above behaved as designed, and the measured numbers are in this file.

### Phase 7: beta and hardening (both, after Phase 6)

- Allowlist of about 10 known people, caps at or below today's, the kill switch tested once on purpose with money in flight.
- Alerts: bridge older than 15 minutes, order in `on_base` older than 10, Paycrest `held`, credits balance low, Base wallet holding USDC with no open order for more than an hour, any `failed`.
- Runbook additions: how to read a stuck order, how to return USDC from a user's Base wallet, who to call at Paycrest and Privy, how to rotate `PAYCREST_API_SECRET` (webhook signing) and `PRIVY_WALLET_AUTH_KEY`.
- **Return-to-Stellar path (P7):** CCTP from Base to Stellar for refunded or abandoned funds, with the user approving. Until built, the runbook has a manual procedure.
- Revenue (P3), reviewing fees against the measured table.
- Compliance review before wider launch: Paycrest's KYC requirement implemented, `/terms` reviewed by a lawyer (already open from M9), written confirmation from Paycrest, LINK and Privy.
- Treasury: Privy credits top-up routine with an alert, and the XLM reserve (D1) now also covers bridge-leg sponsorship if used.

Done when: a week of beta runs with no stuck order unexplained and no manual intervention beyond the planned drills.

## 6. Safety invariants

These are tested, not just intended. Where one isn't tested yet, the phase that adds it is named.

| Invariant | Where enforced | Test |
| --- | --- | --- |
| Money only goes to the address Paycrest returned, on Base, in USDC | `paycrest.createOrder` validation; `privy-evm.sendUsdc` refusals | Built |
| Nothing is sent that exceeds the approved amount plus the capped fee | `maxOverheadUnits` (5% of the amount, 0.25 to 3 USDC) and the cash-out's own cap | Built (client); orchestrator in Phase 3 |
| The bridge can only use CCTP, can't swap, can't redirect | `lifi.getQuote` checks | Built |
| A quote that guarantees less than the floor is refused | `lifi.getQuote`, `bridgeLanded` | Built |
| A retry can't pay twice | Privy idempotency key = cash-out id; conditional state transitions | Client mock built; state machine Phase 3 |
| "Landed" means the balance is on Base, not just LI.FI's word | `usdcBalance` read before `order_created` | Client built; wiring Phase 3 |
| Webhooks are authentic | HMAC over the raw body, constant-time compare | Built |
| Secrets never appear in errors, logs or the repo | Error construction, `.env.example` blank, server-only | Built (tests check the key and secret are absent from errors) |
| Wura doesn't hold user funds | User-owned Base wallet with a scoped signer (§3.2) | Needs Phase 1 step 3 to confirm Privy allows it |
| Identity numbers are never stored or logged | Orders keep only the last four digits of the account after submit | Phase 3 |
| Mainnet-only features refuse in Preview | Boot checks | Phase 3 |

## 7. What can go wrong

| Failure | What happens | What the user sees |
| --- | --- | --- |
| Quote moves after approval | Re-check at `on_base`; below the floor stops the flow | "Rate changed. Accept the new amount or get your dollars back" |
| Bridge slow or stuck | Reconcile reads LI.FI; alert at 15 minutes; CCTP doesn't lose funds, it delays them | "Still moving your dollars" |
| Bridge lands less than the floor | Stop at `on_base`, no order | Offer to proceed with the smaller amount or return |
| Order expires before payment | Funds stay in the user's Base wallet; create a fresh order | "That quote expired, here's a fresh one" |
| Paycrest can't fulfil | Paycrest refunds `amount + senderFee` to the user's Base wallet (the refund address) | "Refunded as dollars on Base" with a return-to-Stellar offer (Phase 7) |
| Compliance hold | `held`, days | "Under review by our payment partner" |
| Webhook missed | Reconcile job catches it | Slightly slower update |
| Privy credits run out | Sponsored send fails before any money moves; alert | "Try again shortly"; nothing is lost |
| Privy signer refused by policy | Send fails; investigate; no funds move | Same |
| Server dies after the Base send, before saving the hash | Idempotency key prevents a second send; reconcile reads Privy by transaction id | Invisible |
| Wrong bank account | `verify-account` name shown before approval; a payout to a wrong but valid account can't be recalled | Name shown before approving: the main defence |

## 8. Environment variables

All server-side, Production only, never Preview, blank in `.env.example`.

| Variable | Purpose |
| --- | --- |
| `RAMP_OFFRAMP_PROVIDER` | `paycrest` turns the route on. Default off. |
| `PAYCREST_API_KEY`, `PAYCREST_API_SECRET` | Paycrest API and webhook signing. |
| `PAYCREST_BASE_URL` | Optional override; must be https. |
| `LIFI_API_KEY` | Optional. |
| `LIFI_STELLAR_USDC` | The Stellar USDC token identifier, pinned after Phase 1. |
| `LIFI_BASE_URL` | Optional override; must be https. |
| `PRIVY_APP_SECRET`, `NEXT_PUBLIC_PRIVY_APP_ID` | Already exist. |
| `PRIVY_WALLET_AUTH_KEY` | Signs Privy requests as the scoped signer. Separate from every other secret. |
| `PRIVY_BASE_SIGNER_ID`, `PRIVY_BASE_POLICY_ID` | The signer and the spend policy to attach to each new Base wallet. |
| `PRIVY_BASE_SPONSOR` | `app` (default) or `usdc`. |
| `PRIVY_ALLOW_UNSPONSORED` | Leave unset. Setting `1` allows sends that need ETH. |
| `BASE_RPC_URL` | Base JSON-RPC for balance reads. |
| `CRON_SECRET` | Already exists; guards the reconcile route. |

## 9. Cost model (fill from the Phase 1 "Measured" table)

Per cash-out of `A` USDC, Wura's cost is: Privy convenience fee + gas credits on the Base send, plus any sponsored Stellar fees for the bridge leg. The **user** pays: the CCTP service fee and any relayer fee (LI.FI route), Paycrest's transaction fee (inside `amountToTransfer`), and any sender fee Wura adds (P3, zero to start). Naira received = `A` × Paycrest's sell rate. Published figures are marketing, not measurements: Allbridge's 0.1% CCTP service fee, Privy's "about $0.05", Paycrest's "under 30 seconds". Do not quote any of them to users.

## 10. Measured (fill in during Phase 1 and Phase 6)

| Item | Result | Date |
| --- | --- | --- |
| LI.FI Stellar to Base: fee, time | | |
| Base send gas cost to Wura (Privy credits) | | |
| Paycrest fee on a ~$12 order | | |
| Paycrest order to naira in bank | | |
| End to end, approve to naira received | | |
| Naira received versus the quote | | |
| Privy scoped signer can send sponsored: yes or no | | |
| Webhook field names confirmed | | |

## 11. Open questions

- Does Privy let a scoped additional signer send sponsored transactions from a user-owned wallet? Decides §3.2.
- What does Paycrest require Wura to collect per user for NGN off-ramp?
- Is the request-signature format in `privy-evm.ts` exactly what Privy expects? One real call will show.
- What is LI.FI's real Stellar fee and time, and the Stellar USDC token identifier?
- Does LI.FI's Stellar `transactionRequest` carry an XDR that `money.ts` can sign as-is, or does it need an extra step?
- Does LINK's 403 from Vercel also hit Paycrest, LI.FI or Privy? Check in Phase 0.

## Sources

- [payquest-offramp-plan.md](payquest-offramp-plan.md), [mainnet-plan.md](mainnet-plan.md), [money-side.md](money-side.md)
- [Paycrest docs](https://docs.paycrest.io/)
- [LI.FI Stellar docs](https://docs.li.fi/introduction/stellar-ecosystem)
- [Privy gas sponsorship](https://docs.privy.io/wallets/gas-and-asset-management/gas/overview), [setup](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup), [policies](https://docs.privy.io/controls/policies/overview), [native sponsorship launch post](https://privy.io/blog/introducing-privy-native-gas-sponsorship)
