# Mainnet plan

**Status: proposed on 15 November 2026 by Olayinka. Samuel (Otowo) to confirm his path below.** Change it in this file when the team agrees something different. It builds on [Money side](money-side.md) and replaces its "testnet stays the default" assumption.

**The decision: Wura goes fully on Stellar mainnet.** There is no test version of the naira services we use, so the only honest test is the real one, with small amounts, in stages. Preview deployments stay on mock or testnet and can never move real money.

## Scope

| In the mainnet build | Out of the first release |
| --- | --- |
| Stellar wallet on mainnet (Privy `G…` account) | Swaps between naira and dollars on the open market (they lose money, see [Money side](money-side.md#findings-so-far)) |
| Cash in: naira to naira (NGNC) or naira to dollars (USDC), through LINK | Site payments |
| Cash out: naira to a bank account, through LINK | Smart-wallet (`C…`) accounts ([wallet roadmap](wallet-roadmap.md)) |
| Stable transfers: USDC and NGNC to other wallets | Chat approvals with a server-held agent key (see D2) |
| Payment links that really get paid | Naira tools in Claude, ChatGPT and Telegram |

"Get dollars for naira" is covered by the dollar anchor as a cash in, so no swap is needed. If you want swaps in the first release, say so here and add them to Olayinka's path.

## Why there are no test keys

LINK's test keys belong to its partner API, a different product (cedi, and payouts on Base and Polygon, not Stellar). The two Stellar services we use need no key and have no test version that we found. Nothing is gained from a LINK dashboard account for this build. Every check so far was against the live service, with a throwaway wallet and no money, and the next ones use small real amounts (see [Testing and rollout](#testing-and-rollout)).

## Guardrails (apply to everyone's work)

- **Non-custodial.** Wura never holds user funds. Every payment is signed by the user's own Privy wallet.
- **Mock stays the default.** `MONEY_MODE` is `mock` unless a deployment says otherwise. Mainnet is on in Production only, never in Preview.
- **A kill switch.** One environment variable turns every real money move off without a deploy of new code.
- **No server-held keys that can spend user money on mainnet.** The testnet `server-dev` signer and the derived chat-approval agent key both refuse to run on mainnet.
- **Every money move** goes through `approve: true`, the caps, the signature, the submit and the log. Cash-outs too.
- **Beta first.** An allowlist and caps at or below the current example caps. Lower them for the first week.
- **Wording.** Say "through a partner". Do not say "licensed" or name LINK as agreed until it confirms in writing.
- **Identity numbers** (NIN, BVN) are never stored, logged or sent through chat.

## Decisions needed

| # | Question | Recommendation |
| --- | --- | --- |
| D1 | Who pays the XLM reserve? Mainnet has no Friendbot. An account needs about 1 XLM plus 0.5 XLM per trustline, and USDC plus NGNC is two. A chat-first product can't ask a new user to buy XLM. | Wura sponsors the reserves for allowlisted beta users from one small treasury account that only sponsors. Work out the cost per user at the current XLM price before opening up. |
| D2 | Chat approvals (agent key) on mainnet. Today the key is derived from one secret, so a leak drains every opted-in account. | Off on mainnet. Telegram sends a link that opens the web app to sign. Revisit with per-user keys held in a KMS, or the smart wallet. |
| D3 | Swaps in the first release? | No. Covered by the dollar anchor. |
| D4 | Assets. | USDC (Circle, mainnet) and NGNC (LINK). XLM is only the reserve and is never shown as something to spend. |
| D5 | Beta size and caps. | Allowlist by email, about five people first. Start at or below ₦75,000 and $50 per payment, then lower. |
| D6 | When can real users beyond the beta come in? | Not before LINK answers on its Nigerian licence and the terms are written. This is a legal question; get advice before opening up. |

## Otowo's path (naira partner: `web/src/server/ramp/`, `web/src/app/api/funding/**`)

1. **Send the LINK questions now.** They are the only thing that blocks the licence answer. Ask:
   - Which Nigerian entity holds which CBN licence?
   - Is there a test environment for the SEP-24 anchors, or are they mainnet only?
   - Fees and the real rate on the dollar anchor (its fee endpoint says 0 and the rate is inside the exchange rate).
   - How long deposits and withdrawals take, and what the page asks for.
   - Is a past identity check reused on later top-ups?
   - Withdrawal memo type, and does the anchor support callbacks or only polling?
2. **Cash-out on the live partner.** In `link.ts`, start a SEP-24 withdrawal and return the hosted page. When status reaches `pending_user_transfer_start`, read `withdraw_anchor_account`, `withdraw_memo` and `amount_in` from a **fresh** status read and return them as the preview. Check that the account is a valid `G…` address, the memo is present and the asset is the pinned NGNC (or USDC for the dollar anchor). `payTo` is never taken from the browser. Nothing in `ramp/` signs.
3. **Persist the anchor state.** Add tables for partner sessions and SEP-24 transfers (id, wallet, asset, kind, state, anchor transaction id, timestamps), because serverless keeps nothing in memory. Open the schema as a small PR first; `db.ts` is Olayinka's.
4. **Reconcile.** A scheduled job that reads every open transfer from the partner and moves it to `done` or `failed`, writes the log entry once only, and flags transfers stuck longer than a set time.
5. **Plain states.** Map every anchor status (expired, error, incomplete, refunded, no market) to a message a user can act on.
6. **Mainnet gating.** Remove anything that assumes testnet. The wallet-readiness check already reads mainnet Horizon; keep it, and make its message say what to do (it needs XLM and a trustline, which Olayinka's path now provides).
7. **Manual real-money test with Olayinka** (see Stage 3): a ₦20,000 deposit and a ₦10,000 withdrawal, timed, written up in `docs/money-side.md`. Only after you both agree in chat.
8. **Doc.** Add the mainnet decision to "Decided" in `money-side.md` and keep this file's table current.

Done when: a live-mode top-up and cash-out both complete end to end in staging, and a restart in the middle of either one loses nothing.

## Olayinka's path (`config.ts`, `stellar.ts`, `money.ts`, `testnet.ts`, `signer.ts`, `db.ts`, screens)

**M1. Network config.** `config.ts` stops hard-coding testnet. `MONEY_MODE=mainnet` selects the passphrase, Horizon URL, explorer links and asset issuers. Friendbot exists on testnet only. Take the USDC issuer from Circle's own documentation, not from memory. Boot checks: mainnet refuses to start with `TESTNET_SIGNER=server-dev`, with `AGENT_KEY_SECRET` set, or in a Preview environment. Add the kill switch.
Done when: switching the variable changes every address and link, and each refusal has a test.

**M2. `stellar.ts` for real assets.** Take a network and an asset. Add the NGNC trustline builder (the issuer comes from LINK's config file, which Otowo's code already pins). Payments take any asset and a memo. `getBalances` shows real NGNC and USDC from Horizon.
Done when: the balance card shows both on a mainnet wallet and a payment with a memo builds and verifies.

**M3. Account setup and sponsorship (D1).** Create and activate the account, add both trustlines, with reserves sponsored from the treasury once D1 is agreed. The treasury key is separate from every other key, holds a small balance and can only sponsor.
Done when: a new allowlisted user ends up with an activated account and two trustlines without holding any XLM.

**M4. Stable transfers.** USDC and NGNC to other wallets on mainnet. Destination checks: the account exists, it has the trustline, and the memo-required flag (SEP-29) is honoured, which exchanges use. Set a time bound on every transaction, recheck balance and caps just before submit, confirm on Horizon, then log with an explorer link. Make a submit that is retried safe (no double payment).
Done when: a real $1 transfer to a second wallet shows in the log with the right hash and a repeated submit does nothing.

**M5. Payment links that work.** Today's links point to `example.com` and nothing pays them. Replace with `/pay/<code>`: a Wura page showing the recipient and amount, with the address and a unique memo (and a `web+stellar:pay` link for wallets). The money goes straight to the creator's wallet. Wura marks the link paid when a payment arrives with the matching memo, asset and at least the amount before expiry. Needs a watcher on Horizon payments (a cron or a stream). Partial, double and late payments get a visible state, not silence.
Done when: paying a link from another wallet marks it paid exactly once.

**M6. Cash in and cash out in the app.** With Otowo's API:
- A "sign in to partner" signing screen and pending-transaction kind. Submit goes to the anchor, never Horizon, and only the user's own wallet signs it.
- Top-up: start, open the partner page, check status when the user comes back, log the result.
- Cash-out: preview, then `approve: true`, `checkLimits("NGN")`, sign the NGNC payment with the memo, submit, log.
Done when: both complete in staging with the live partner.

**M7. Privy and environments.** A production Privy app with allowed origins. Preview secrets. Production and Preview must not share `SESSION_SECRET`, and Preview must not carry mainnet settings.

**M8. Safety and ops.** The allowlist and starting caps (D5). A per-connection rate limit for Claude and ChatGPT before any money tools exist there. Alerts on failed submits, Horizon errors and stuck transfers. A short runbook: how to turn money off, how to read a stuck transaction, who to call at LINK. Database backups.

**M9. Docs and wording.** Terms and the "through a partner" wording on every screen that moves money.

## Testing and rollout

| Stage | What | Needs |
| --- | --- | --- |
| 0. Automated | Typecheck, lint, tests with the partner and Horizon mocked, `next build`. Every pull request. | Nothing |
| 1. Mock end to end | Browser check of the mock flow. Done on 15 November: sign-in, limits from the partner, caps refused, cash-out preview. Repeat after each change to those screens. | Nothing |
| 2. Mainnet, no money | Read-only checks with a throwaway wallet: partner sign-in, order, status, balances, destination checks. | M1, M2 |
| 3. Mainnet, small real money | $1 stable transfer. A ₦20,000 deposit and a ₦10,000 withdrawal through LINK, timed. A payment link paid from another wallet. Olayinka and Otowo only, their own wallets. | Both agree in chat. M1 to M6 |
| 4. Allowlist beta | About five known people, low caps, the kill switch tested once on purpose. | LINK's licence answer, D5, M7, M8 |
| 5. Wider | More users, higher caps. | D6 |

## Risks to watch

- **LINK could change or stop its anchors.** Both are third-party and uncontracted. The partner interface lets Cowrie (SEP-6) replace it, but only if it offers a hosted identity page.
- **A stuck withdrawal.** The user's NGNC leaves the wallet before the naira arrives. Reconciliation and a runbook with a LINK contact are the mitigation.
- **Reserve cost per user (D1).** Recompute at the current XLM price.
- **Public Horizon rate limits.** Fine for a beta. Move to a paid provider before opening up.
- **Naira per dollar.** The dollar anchor's real rate is only visible on LINK's page. Compare it with the market on the Stage 3 test and write the result down.
