# Mainnet plan

**Status: decisions D1 to D6 made on 15 November 2026 by Olayinka. Samuel (Otowo) to confirm his path below. Nothing is being built yet.** Change it in this file when the team agrees something different. It builds on [Money side](money-side.md) and replaces its "testnet stays the default" assumption.

**The decision: Wura goes fully on Stellar mainnet.** There is no test version of the naira services we use, so the only honest test is the real one, with small amounts, in stages. Preview deployments stay on mock or testnet and can never move real money.

## Scope

| In the mainnet build | Out of the first release |
| --- | --- |
| Stellar wallet on mainnet (Privy `G…` account) | Site payments |
| Cash in: naira to naira (NGNC) or naira to dollars (USDC), through LINK | Smart-wallet (`C…`) accounts ([wallet roadmap](wallet-roadmap.md)) |
| Cash out: naira to a bank account, through LINK | Naira tools in Claude, ChatGPT and Telegram |
| Stable transfers: USDC and NGNC to other wallets | |
| Payment links that really get paid | |
| Swaps between naira and USDC (D3) | |
| Chat approvals on mainnet (D2, with conditions) | |

Swaps are in (D3). The dollar anchor still gives dollars for naira directly as a cash in, and is the better price at size: the open market loses a lot (₦50,000 gets about 22.6 USDC, roughly ₦2,209 per dollar, against about ₦1,514 per dollar the other way, see [Money side](money-side.md#findings-so-far)). The swap screen has to show that gap plainly.

## Why there are no test keys

LINK's test keys belong to its partner API, a different product (cedi, and payouts on Base and Polygon, not Stellar). The two Stellar services we use need no key and have no test version that we found. Nothing is gained from a LINK dashboard account for this build. Every check so far was against the live service, with a throwaway wallet and no money, and the next ones use small real amounts (see [Testing and rollout](#testing-and-rollout)).

## Guardrails (apply to everyone's work)

- **Non-custodial.** Wura never holds user funds. Every payment is signed by the user's own Privy wallet.
- **Mock stays the default.** `MONEY_MODE` is `mock` unless a deployment says otherwise. Mainnet is on in Production only, never in Preview.
- **A kill switch.** One environment variable turns every real money move off without a deploy of new code.
- **The `server-dev` signer never runs on mainnet.** The chat-approval agent key does (D2), under the conditions in D2.
- **Every money move** goes through `approve: true`, the caps, the signature, the submit and the log. Cash-outs too.
- **Beta first.** An allowlist and caps at or below the current example caps. Lower them for the first week.
- **Wording.** Say "through a partner". Do not say "licensed" or name LINK as agreed until it confirms in writing.
- **Identity numbers** (NIN, BVN) are never stored, logged or sent through chat.

## Decisions

**Made on 15 November 2026 (Olayinka):**

| # | Decision | What it means |
| --- | --- | --- |
| D1 | **Wura keeps a reserve.** | A standing XLM balance in one treasury account that sponsors the base reserve and the two trustlines (USDC, NGNC) for each new beta user, so nobody has to buy XLM. The treasury key signs sponsorship only. Size it as users × about 2 XLM plus a fee buffer, and alert when it falls below a set level. Work out the cost per user at the current XLM price before the beta. |
| D2 | **Chat approvals stay on for mainnet.** | The Wura agent key can approve payments from Telegram and later chat apps. See the conditions below. |
| D3 | **Swaps are in the mainnet build.** | See M10. |
| D4 | **Assets: USDC and NGNC.** | XLM is only the reserve and is never shown as something to spend. |
| D5 | **Beta of 10 people**, raised from about five. | An allowlist by email, with caps at or below the example caps (₦75,000 and $50 per payment, ₦200,000 and $200 a day), lowered for the first week. |
| D6 | **We wait for LINK.** | Nobody outside Olayinka and Otowo's own wallets (Stage 3) uses real money until LINK answers in writing on its Nigerian licence and the terms are written. That includes the 10-person beta. Get legal advice before opening up. |

**Conditions on D2.** Today the agent key is derived from one secret (`AGENT_KEY_SECRET`) and the user's ID, so a leak would let someone sign payments for every opted-in account. Stellar can't cap an amount on chain, so the server caps are the only limit. I recommend these before any real money goes through a chat approval (Stage 3). Olayinka to confirm or change:
1. Separate secret for Production, never shared with Preview or testnet.
2. Per-user keys held so that one leaked secret doesn't expose every user: a random key per user, encrypted in the database with a master key kept in a KMS, or signing done inside the KMS. Decide which before building.
3. Lower per-payment and daily caps for chat approvals than for web approvals.
4. The user can switch it off from the web at any time, and the server reads the account's signers from Horizon before every chat payment (it does today), not a flag in the database.
5. Chat approvals only for allowlisted users. A failed or odd approval pings the owner.

**Circle's mainnet USDC issuer.** `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` (asset code `USDC`). Read on 15 November 2026 from Circle's [USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses) page, which also lists the testnet issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` that the app uses today. The code already carries the mainnet one in `routing.ts` and `link.ts` for quotes. Recheck the page when the build starts.

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

**M1. Network config.** `config.ts` stops hard-coding testnet. `MONEY_MODE=mainnet` selects the passphrase, Horizon URL, explorer links and asset issuers. Friendbot exists on testnet only. The mainnet USDC issuer is the Circle address above. Mainnet refuses the testnet issuer, and a test pins the address. Boot checks: mainnet refuses to start with `TESTNET_SIGNER=server-dev`, in a Preview environment, or with chat approvals on and the D2 conditions not in place. Add the kill switch.
Done when: switching the variable changes every address and link, and each refusal has a test.

**M2. `stellar.ts` for real assets.** Take a network and an asset. Add the NGNC trustline builder (the issuer comes from LINK's config file, which Otowo's code already pins). Payments take any asset and a memo. `getBalances` shows real NGNC and USDC from Horizon.
Done when: the balance card shows both on a mainnet wallet and a payment with a memo builds and verifies.

**M3. Account setup and sponsorship (D1).** Create and activate the account, add both trustlines, with the reserves sponsored from the treasury (D1). The treasury key is separate from every other key and signs sponsorship only. Add a low-balance alert and a count of sponsored accounts.
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

Built (code, not yet tried with real money):
- **Partner sign-in.** It has no transaction kind of its own. The server already checks the challenge before asking for a signature and again on the way back (`ramp/link.ts`). The screen explains that signing can't move money, the wallet signs the hash, and the signature goes to `/api/funding/naira/signin`, never to Horizon.
- **Top-up.** On the funding screen: choose naira or dollars, then the amount, sign in, open the partner's page, then check its status when the user comes back to the tab. The server writes the history entry when the top-up ends, so the screen doesn't log anything.
- **Cash-out.** The new `/cash-out` screen: choose the amount, open the partner's page, wait for `readyToPay`, then preview, `approve: true`, the wallet signs, submit and log. `server/cashout.ts` reads the partner's answer again at preview, at approve and just before submit, and sends nothing if it changed. It also checks that:
  - the asset is the pinned one;
  - the amount is no more than the cash-out was started with (`ramp_transfers.amount`);
  - `checkLimits` and the balance cover the partner's amount;
  - a hash memo decodes from base64 to exactly 32 bytes;
  - each cash-out is paid at most once: claimed on its `ramp_transfers` row (`claimCashOutPayment`, saved at once, so it survives a timeout mid-submit) and in `cashOutPaid`, before submit; given back only after a definite rejection.
- **Where it's approved.** A cash-out can't be approved from chat, from an approval link or through `/api/tx/submit`. Its routes sit under `/api/funding/naira/cashout/`, so the partner cookie arrives.
- **The log.** The payment shows as "Sent to the partner for your cash-out"; reconcile later adds "Cash-out paid to your bank account".
- **Recent transfers.** The cash-out screen lists the stored top-ups and cash-outs, and a cash-out can be picked up again after a restart.

**M7. Privy and environments.** A production Privy app with allowed origins. Preview secrets. Production and Preview must not share `SESSION_SECRET`, and Preview must not carry mainnet settings.

**M8. Safety and ops.** The allowlist and starting caps (D5). A per-connection rate limit for Claude and ChatGPT before any money tools exist there. Alerts on failed submits, Horizon errors and stuck transfers. A short runbook: how to turn money off, how to read a stuck transaction, who to call at LINK. Database backups.

**M9. Docs and wording.** Terms and the "through a partner" wording on every screen that moves money.

Built: a public `/terms` page (draft, marked as not reviewed by a lawyer, no claim that Wura or any partner is licensed, contact address left as a placeholder) and one shared component, `components/partner-note.tsx`, that carries the plain wording: "through a partner" on the naira top-up screen, the swap card and the send card, each linking to the terms. Sign-in links to the terms too. The cash-out screen doesn't exist yet; add `<PartnerNote kind="naira" />` to it with M6. Still needed before the beta (D6): a lawyer's review of `/terms`, the contact address, and LINK's written answer.

**M10. Swaps on mainnet (D3).** Today a swap is quoted but refused (`refuseInTestnet("Swaps")`). Plan: turn the best quote from `routing.ts` into a transaction the user's own wallet signs, through the same approve, caps, sign, submit and log path as a send. Design points to settle when this is built:
- Which venues execute first. Stellar DEX path payments are classic operations and the simplest. Aquarius and Soroswap need a contract call and more work, so they may come second. The quote already compares all three.
- A minimum amount received on every swap, so a price that moves between quote and submit fails instead of filling badly.
- The market-versus-reference gap (`vsMarketPct`) is shown before approval, with a refusal above a set threshold for naira to dollars at size. Point the user to the dollar anchor cash in when it is the better price.
- Both trustlines must exist. Caps apply in the currency being sold.
- Soroswap needs its API key in Production.

Done when: a real $1 swap and a small naira swap both go through, the log shows what was received, and a stale quote is refused.

Built (code, not yet tried with real money): Stellar DEX only, as a strict-send path payment from the wallet to itself. On mainnet the quote's price is the DEX's (Aquarius and Soroswap are shown to compare, with a note when one is better). The minimum received is the approved amount less `SWAP_SLIPPAGE_BPS` (0.5%); approving re-reads the route and refuses if it's now under that, and the transaction itself fails on chain below it. Above ₦5,000 or $5, a price more than `SWAP_MAX_GAP_PCT` (3%) under the market rate is refused, and so is a missing market rate; naira to dollars points to the USDC cash in. At today's gap (about 30%) that refuses most naira to dollars swaps above ₦5,000, on purpose. The log shows what Horizon says arrived. Chat apps send the user to the web to sign (chat signing is M11). Soroswap's key is only for quotes.

**M11. Chat approvals on mainnet (D2).** Meet the five conditions above before Stage 3 involves any chat approval.

## Testing and rollout

| Stage | What | Needs |
| --- | --- | --- |
| 0. Automated | Typecheck, lint, tests with the partner and Horizon mocked, `next build`. Every pull request. | Nothing |
| 1. Mock end to end | Browser check of the mock flow. Done on 15 November: sign-in, limits from the partner, caps refused, cash-out preview. Repeat after each change to those screens. | Nothing |
| 2. Mainnet, no money | Read-only checks with a throwaway wallet: partner sign-in, order, status, balances, destination checks. | M1, M2 |
| 3. Mainnet, small real money | $1 stable transfer. A ₦20,000 deposit and a ₦10,000 withdrawal through LINK, timed. A payment link paid from another wallet. A $1 swap and a small naira swap. One chat approval, once the D2 conditions are in. Olayinka and Otowo only, their own wallets. | Both agree in chat. M1 to M6 |
| 4. Allowlist beta | 10 known people, low caps, the kill switch tested once on purpose. | LINK's written licence answer (D6), M7, M8, M10, M11 |
| 5. Wider | More users, higher caps. | D6 |

## Risks to watch

- **A leaked agent-key secret (D2).** One secret can currently approve payments for every opted-in account, and the only limit is our server caps. The five conditions under D2 are the mitigation. Until they are done, no real money goes through a chat approval.
- **Swaps lose money at size on the open market.** Naira to dollars is the worst direction. The minimum-received check and the gap warning (M10) are the guard.
- **LINK could change or stop its anchors.** Both are third-party and uncontracted. The partner interface lets Cowrie (SEP-6) replace it, but only if it offers a hosted identity page.
- **A stuck withdrawal.** The user's NGNC leaves the wallet before the naira arrives. Reconciliation and a runbook with a LINK contact are the mitigation.
- **Reserve cost per user (D1).** Recompute at the current XLM price.
- **Public Horizon rate limits.** Fine for a beta. Move to a paid provider before opening up.
- **Naira per dollar.** The dollar anchor's real rate is only visible on LINK's page. Compare it with the market on the Stage 3 test and write the result down.
