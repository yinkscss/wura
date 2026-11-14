# Money side

Who works on what in the money code, so two people do not edit the same files at the same time.

**Status: proposed on 14 November 2026 by Samuel (OtowoSamuel). Not yet agreed with Olayinka (yinkscss).** The split below is a starting point. Change it in this file when the team agrees something different.

Nothing here is live. No naira partner has been contacted and no real money moves.

## What "the money side" covers

Samuel takes the parts that turn the mocked naira flow into a real one:

1. **Naira in** (top-up): the partner that takes a bank transfer and delivers money to the user's Stellar address.
2. **Naira out** (cash out to a bank account).
3. **The identity check** that the naira partner requires, and what Wura stores afterwards (a verified status only, never the NIN).
4. **Naira ↔ USDC with real money**: where the dollars actually come from, since the open market on Stellar is too thin (see [Findings](#findings-so-far)).

Everything else stays with Olayinka unless agreed here: the web app screens, landing page, sign-in and Privy, the chat parser, site connect, channels, the database layer, design files and the buildathon application.

## Files

| Area | Files | Owner |
| --- | --- | --- |
| Naira partner and identity check | `web/src/server/paycrest.ts`, `web/src/app/api/funding/**`, new files under `web/src/server/ramp/` | Samuel |
| Money docs | `docs/kyc-and-funding.md`, this file | Samuel |
| Quotes and venue comparison | `web/src/server/routing.ts`, `docs/routing.md` | Olayinka (live quotes are his work on `live-quotes`) |
| Sends, swaps, limits, log | `web/src/server/money.ts`, `testnet.ts`, `signer.ts`, `stellar.ts` | Olayinka |
| Screens and components | `web/src/app/**` except `api/funding`, `web/src/components/**` | Olayinka |
| Auth, session, database | `privy.ts`, `session.ts`, `store.ts`, `db.ts`, `route.ts` | Olayinka |

**Shared files. Say so in the team chat before editing, and keep the change small:**

- `web/src/lib/types.ts`
- `web/src/server/config.ts`
- `web/src/server/money.ts` (when the naira flow needs a new hook)
- `web/.env.example`
- `web/README.md` and the root `README.md`
- `docs/open-questions.md`
- `web/package.json` and `web/package-lock.json`

## Working rules

- **Branch names:** money-side branches start with `money-`, for example `money-ramp-interface`.
- **Every pull request targets `main`.** Do not stack a pull request on another feature branch. Pull requests #5 and #6 were stacked that way and never reached `main` (see below).
- **Small pull requests**, one concern each. Rebase on `main` before opening.
- **Mock mode keeps working with no secrets.** Any real partner sits behind an environment variable that is off by default.
- **New environment variables** go in `web/.env.example` with a comment. Partner keys are server-side only and never committed.
- **Before opening a pull request:** `npm run lint` and a typecheck pass in `web/`.
- **Identity numbers** (NIN, BVN) are never stored, logged or sent through chat. Where the partner offers its own hosted page for the check, use it.
- **Wording:** say "through a partner". Do not say "licensed" or name a partner as agreed until that partner has confirmed it in writing.

## State of the repository on 14 November 2026

- `main` is at pull request #7: brand logos on Channels, refresh buttons on the balance cards, the Wura favicon.
- **Live quotes (#5) and Postgres storage (#6) are not on `main`.** Both show as merged, but #5 merged into `testnet-signing` and #6 merged into `live-quotes`. The `persistence` branch holds all four commits. A test merge of `persistence` into `main` has no conflicts.
- Because of that, `main` still has example prices in `routing.ts`, no `db.ts`, and a README that describes neither.
- **Suggested first step, for Olayinka:** open one pull request from `persistence` into `main`. Money-side work should start after that lands, so it builds on live quotes and the database.

## Findings so far

Checked against live endpoints on 13 November 2026. Rates move; rerun before relying on them.

**Paycrest does not settle on Stellar.** `paycrest.ts` already notes this. A live naira flow through Paycrest needs a bridge from another chain, or a different partner.

**A Stellar naira anchor is live: LINK, which issues NGNC.**

| | LINK (NGNC) | Cowrie (NGNT) |
| --- | --- | --- |
| Config | [stellar.toml](https://ngnc.online/.well-known/stellar.toml) | [stellar.toml](https://cowrie.exchange/.well-known/stellar.toml) |
| Deposit and withdraw | SEP-24, a hosted page ([info](https://anchor.ngnc.online/sep24/info)) | SEP-6, no hosted page ([info](https://api.cowrie.exchange/transfer/info)) |
| Identity check | On LINK's own page | Separate SEP-12 server; Wura would pass the details on |
| Deposit limits (naira) | 20,000 to 20,000,000 | From 100 |
| Withdraw limits (naira) | 10,000 to 5,000,000 | From 300, fixed fee 200 |
| Sign-in | SEP-10, classic `G…` accounts | SEP-10 |

LINK fits best. Its hosted page means LINK collects the identity and bank details, so Wura never handles them. It works with the Privy `G…` wallet used today. It would not work with a `C…` smart wallet: LINK does not advertise SEP-45. That matters for the [wallet roadmap](wallet-roadmap.md).

Not confirmed about LINK: its fees, how long deposits take, whether a real deposit completes today, and its licence status in Nigeria. Its 20,000 naira minimum deposit is above the smallest top-up the app allows now (1,000 naira).

**Naira to dollars on the open market loses money.** This matches what #5 found.

| Sell (NGNC) | Get (USDC) | Naira per dollar |
| --- | --- | --- |
| 20,000 | 10.24 | 1,953 |
| 50,000 | 22.64 | 2,209 |
| 100,000 | 37.98 | 2,633 |

The other direction is fine at small sizes: 20 USDC bought 30,272 NGNC, about 1,514 naira per dollar. So "send $20 and they get naira" can work. "Change ₦50,000 to dollars" needs dollars from a partner, not from the market.

## Plan, in order

1. **Ask LINK** (support address in its config file): test access, fees, timing, the identity fields it asks for, whether it can deliver USDC for naira directly, and its licence status. Samuel sends this. Not sent yet.
2. **One manual test:** a 20,000 naira deposit and a 10,000 naira withdrawal through LINK in an ordinary Stellar wallet, timed. Real money, so only with the team's agreement.
3. **A partner interface** in `web/src/server/ramp/`: start a top-up, start a cash-out, read status, read the identity-check status. The current mock becomes the first implementation behind it, so the screens do not change.
4. **A LINK implementation** behind an environment variable: SEP-10 sign-in signed by the user's wallet, open LINK's hosted page, poll until the transfer completes, write the result to the log.
5. **Naira out** through the same interface.
6. **Dollars for naira**, once LINK has answered question 1.

Steps 3 to 6 are for after the application goes in on 21 November. The demo keeps the mock.

## Open questions

- Is this split right? Olayinka to confirm or change.
- Paycrest or LINK for the first live naira flow? This file recommends LINK. The concept and KYC docs still say Paycrest, and have not been changed.
- Should `kycStatus` stay one flag, or become one status per partner?
- Who owns `routing.ts` once naira quotes can come from a partner as well as from the market?
