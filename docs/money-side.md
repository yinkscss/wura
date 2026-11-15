# Money side

Who works on what in the money code, so two people do not edit the same files at the same time.

**Status: agreed on 14 November 2026. Proposed by Samuel, confirmed by Olayinka.** Change it in this file when the team agrees something different.

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
| Naira partner and identity check | `web/src/app/api/funding/**`, `web/src/server/ramp/` | Samuel |
| Money docs | `docs/kyc-and-funding.md`, this file | Samuel |
| Quotes and venue comparison | `web/src/server/routing.ts`, `docs/routing.md` | Olayinka. The naira partner exposes a `quote()` and routing calls it as one more venue. |
| Sends, swaps, limits, log | `web/src/server/money.ts`, `testnet.ts`, `signer.ts`, `stellar.ts` | Olayinka |
| Screens and components | `web/src/app/**` except `api/funding`, `web/src/components/**` | Olayinka |
| Auth, session, database | `privy.ts`, `session.ts`, `store.ts`, `db.ts`, `web/src/server/route.ts` | Olayinka |

**Shared files. Say so in the team chat before editing, and keep the change small:**

- `web/src/lib/types.ts`
- `web/src/server/config.ts`
- `web/src/server/money.ts` (Olayinka owns it; Samuel adds small hooks after a heads-up)
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
- **Update, later on 14 November:** pull request #9 brought `persistence` into `main`. Money-side branches now start from live quotes and the database.

## Findings so far

Checked against live endpoints on 13 November 2026. Rates move; rerun before relying on them.

**Paycrest does not settle on Stellar.** A live naira flow through it would need a bridge from another chain, or a different partner. Its old code has been removed.

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

Not confirmed about LINK: its fees, how long deposits take, whether a real deposit completes today, and its licence status in Nigeria. Its config file gives a London address, so the question is which Nigerian entity holds the licence, and under which CBN licence. LINK's config file is mainnet only; no test environment is known.

Its 20,000 naira minimum deposit is above the smallest top-up the app allows now (1,000 naira). When LINK is switched on, the top-up screen shows and enforces the partner's minimum, read from LINK's info endpoint and never hard-coded. The mock keeps 1,000 naira.

Cowrie is registered in Lagos, which makes it a backup with a Nigerian entity. It would only fit if it offers a hosted identity page, because of the rule that Wura never handles NIN or BVN.

**Naira to dollars on the open market loses money.** This matches what #5 found.

| Sell (NGNC) | Get (USDC) | Naira per dollar |
| --- | --- | --- |
| 20,000 | 10.24 | 1,953 |
| 50,000 | 22.64 | 2,209 |
| 100,000 | 37.98 | 2,633 |

The other direction is fine at small sizes: 20 USDC bought 30,272 NGNC, about 1,514 naira per dollar. So "send $20 and they get naira" can work. "Change ₦50,000 to dollars" needs dollars from a partner, not from the market.

## Update, 15 November 2026: LINK also runs a dollar anchor, and the build now uses both

Found by reading LINK's public config, docs and code, and by calling the service. No email was needed.

- **A second LINK anchor pays out USDC for naira directly.** [stellar.toml](https://anchor.linkio.world/.well-known/stellar.toml), [limits](https://anchor.linkio.world/sep24/info). Same protocols as the NGNC one (SEP-10 sign-in, SEP-24 hosted page), different domain and signing key. The user pays naira on LINK's page and USDC lands in the wallet. This avoids the market loss in the table above.
- **Limits it publishes:** 10 to 100,000 USDC, both directions. Its fee endpoint answers 0; LINK's docs say the fee is inside the exchange rate. The rate itself is only shown on LINK's page.
- **It is open.** No key or agreement is needed to call it. Nothing is agreed with LINK, so the wording rules above still apply.
- **Checked live on both services with a throwaway wallet, no money:** config validates against the pinned key, the sign-in challenge passes every check, the signed challenge is accepted (session lasts 24 hours), a top-up request returns a page on LINK's own domain, and its status reads as "waiting for you".
- **Not checked:** that a real deposit completes, what LINK's page asks for, and how long it takes. Licence status is still unknown. No test environment was found; it is mainnet only.
- **LINK's partner API** (a separate product, needs a key from LINK's dashboard) covers the Ghana cedi, but its reference lists payouts on Base and Polygon only, not Stellar. Parked.

**In both services the user pays naira from a bank account.** The choice is what lands in the wallet: `NGN` keeps it as naira (the NGNC anchor, the wallet's naira balance, 20,000 naira minimum), `USDC` turns it into dollars (the dollar anchor). Naira is the default. Each service has its own pinned key and its own partner sign-in.

What `RAMP_PROVIDER=link` does now:

| Route | What it does |
| --- | --- |
| `GET /api/funding/naira/info` | `options`: one set of limits per choice (`NGN`, `USDC`; the mock has `NGN` only). `limits` is the default choice, naira. |
| `POST /api/funding/naira/order` `{ amount, receive? }` | `amount` is in the chosen currency. First checks on mainnet Horizon that the wallet exists and holds a trustline for what it would receive, and refuses if not. Then answers `{ status: "needs_partner_signin", receive, hash, address, challenge }` or `{ status: "open_partner_page", url, id }`. |
| `POST /api/funding/naira/signin` `{ receive, challenge, signature }` | The wallet's signature over `hash`. The server checks the challenge again from scratch, sends it to the partner, and keeps the partner session in an httpOnly cookie scoped to `/api/funding`. |
| `GET /api/funding/naira/status?id=&receive=` | `waiting_for_you`, `processing`, `done` or `failed`. |

### Cash-out to a naira bank account

| Route | What it does |
| --- | --- |
| `POST /api/funding/naira/cashout` `{ amount, from? }` | `from` is what leaves the wallet (`NGN` or `USDC`); the bank account always receives naira. With the mock it answers an example preview in kobo (amount, fee, what reaches the bank, expiry). With the live partner it checks the partner's limits, Wura's per-payment and daily caps (`checkLimits`) and the wallet's real mainnet balance, then answers `needs_partner_signin` or `{ status: "open_partner_page", url, id }`. The user enters the bank account on the partner's page. Nothing moves. |
| `GET /api/funding/naira/cashout?id=&from=` | `waiting_for_you`, `processing`, `done` or `failed`, plus `send` (what the wallet must send), `fee`, and `readyToPay`. |

The last step is the wallet paying the partner. That is a money move, so it is **not** in the naira code and has no route. When `readyToPay` is true, `cashOutPayment(s, { id, from, partnerToken })` in `web/src/server/ramp/index.ts` returns the exact payment: `{ network: "mainnet", asset, amount, destination, memo, memoType }`. It refuses a destination that is not a valid address or is the user's own wallet, an empty memo, and an amount outside the partner's limits. `money.ts` (Olayinka's) takes it from there: show it, `approve: true`, caps, build, sign, submit, log. **That hook is not built**, so a cash-out stops at "the partner is ready to be paid".

Checked live on both services with a throwaway wallet: an empty wallet is refused, and a cash-out request returns a page on the partner's own domain with status "waiting for you". Not checked: anything past the partner's page (bank details, the payment, the payout).

For the screen (Olayinka's): on `needs_partner_signin`, sign `hash` with the same Privy hash signer used for sends, post to `signin`, then call `order` again and open `url`. The challenge has sequence number 0, so signing it cannot move money.

What blocks a real top-up in the app: the app runs on testnet and the partner is on mainnet. A user's wallet has no mainnet account or trustline, so `order` refuses with "Your wallet isn't set up to receive naira from the naira partner yet." That is deliberate: nobody should pay naira for money that can't be delivered. A cash-out is refused the same way, because the wallet holds nothing on mainnet.

## Plan, in order

The list below is the original plan. Step 1 is no longer needed to build, step 3 is done, and step 4 is done up to "open the page and read status" against the dollar anchor.

1. **Ask LINK** (support address in its config file): whether it has a testnet anchor, fees, timing, the identity fields it asks for, whether it can deliver USDC for naira directly, and which Nigerian entity holds which CBN licence. Samuel sends this. Not sent yet.
2. **One manual test:** a 20,000 naira deposit and a 10,000 naira withdrawal through LINK in an ordinary Stellar wallet, timed. Real money, so only after both of us agree it in chat.
3. **A partner interface** in `web/src/server/ramp/`: start a top-up, start a cash-out, read status, read the identity-check status. The current mock becomes the first implementation behind it, so the screens do not change.
4. **A LINK implementation** behind an environment variable: SEP-10 sign-in signed by the user's wallet, open LINK's hosted page, poll until the transfer completes, write the result to the log.
5. **Naira out** through the same interface.
6. **Dollars for naira**, once LINK has answered question 1.

Steps 3 to 6 are for after the application goes in on 21 November. The demo keeps the mock.

## Build rules agreed in review

- **Trustline first.** LINK delivers NGNC, so the user's wallet needs an NGNC trustline before a deposit can land. The trustline flow lives in `testnet.ts` (Olayinka's); he adds an asset parameter and the naira code calls it.
- **A cash-out is a money move.** The naira partner code returns a preview only: amount, fee, bank, memo, expiry. It never signs. Signing goes through the same path as a send: `approve: true`, caps checked, signature, submit, log entry. The naira caps apply to cash-outs.
- **Check the partner's sign-in challenge before the wallet signs it.** It must come from LINK's signing key in its config file, have sequence number 0, carry the right `manage_data` operation for the user's account, sit inside a valid time window and already hold the server's signature.
- **Naira balance.** In live mode the dashboard shows the wallet's real NGNC balance from Horizon. That is `getBalances()` in `money.ts` (Olayinka's), wired to what the partner interface exposes.
- **`kycStatus`** stays a single flag until a second partner arrives. Changing it touches `types.ts` and `store.ts`, so flag it first.

## Decided

- The build uses both LINK anchors. Naira in, naira stays naira: the NGNC one. Naira in, dollars out: the dollar one (anchor.linkio.world), so there is no swap.
- LINK is the first partner to pursue. Paycrest is parked because it does not settle on Stellar. The concept, KYC, open-questions and application docs now say LINK.
- `routing.ts` stays with Olayinka.
