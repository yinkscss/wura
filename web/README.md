# Wura — web app (v1)

The first web app for **Wura**, a money assistant you chat with. The app uses the Wura name throughout. The older design shots in `../design` still show the old “Agent” / “name TBD” placeholder; they haven't been re-rendered.

This is a Stellar Nigeria Buildathon preview. **Nothing is live.** There are no users, no revenue and no real transactions. Every balance, rate and payment shown is fictional example data, taken from the design mockups in [`../design`](../design/README.md).

## What's here

| Route | Screen |
| --- | --- |
| `/` | Landing: "Your money, on chat." with five cards on a half-moon arc. Also an animated routing demo, an interactive how-it-works demo and a limit tester |
| `/sign-in` | Email + 6-digit code. Creates (or reuses) a Stellar wallet |
| `/onboarding` | Fund choice: USDC (no ID) or naira (identity check before the first top-up) |
| `/chat` | Chat. Try "Change ₦50,000 to dollars", "Send $20 to Tunde", "Make a payment link for ₦15,000", "Connect to market.example.org and buy 2 posters" |
| `/wallet` | Dashboard: balances, daily-limit gauge, per-payment cap, transaction log, connected apps |
| `/settings/sites` | Connected sites: the allow list, removing a site, and pending “Connect to this site?” requests |
| `/activity`, `/limits`, `/channels`, `/settings` | The rest of the signed-in shell |

## Run it locally

Needs Node 20+.

```bash
cd web
npm install
npm run dev
```

Then open http://localhost:3000.

**Mock mode is the default.** With no environment variables set:

- Sign-in is mocked. Any email works, and any 6-digit code works. No email is sent.
- You get a random, well-formed Stellar `G…` address with no known secret key.
- Balances, limits and activity are example data, kept in server memory per user. They reset when the server restarts.
- Nothing is signed or broadcast. Approved actions return a `MOCK-…` reference.

To use real email codes, copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_PRIVY_APP_ID` and `SESSION_SECRET` (plus `PRIVY_APP_SECRET` for server-side wallet checks). In the Privy dashboard, enable email login. Money stays in mock mode either way.

## Testnet mode (real transactions)

`MONEY_MODE=testnet` makes **USDC sends real on Stellar testnet**. Swaps and site payments are refused in this mode until live quotes are wired; there's no real naira asset on testnet.

How signing works (`src/server/testnet.ts`):

1. The user approves the preview. The server re-checks limits and the real Horizon balance, then builds the transaction.
2. The user's **Privy Stellar wallet signs the transaction hash** in the browser (`useSignRawHash`, Privy Tier 2).
3. The server **verifies the signature belongs to the signed-in user's address**, re-checks limits and balance again, attaches it and submits to Horizon.
4. The log stores the real transaction hash, linked to Stellar Expert.

A wallet needs test XLM and a USDC trustline before it can hold USDC. The **Stellar testnet wallet** card on `/wallet` does both: Friendbot for XLM, then a trustline the user's wallet signs.

**With Privy:** set `MONEY_MODE=testnet`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_APP_SECRET` (read-only is enough), `PRIVY_VERIFICATION_KEY` and `SESSION_SECRET`. For a dev app, enable test accounts and leave allowed origins empty (Privy test accounts only work without them). Users get test USDC from Circle's faucet (https://faucet.circle.com, pick Stellar testnet).

Tested end to end with a Privy test account: sign-in by email code, Stellar wallet created by Privy, trustline and a USDC send both signed by Privy and confirmed on testnet. Privy's signing step was silent: no Privy pop-up appeared after our own Approve button.

If the Privy secret is injected by a network proxy rather than set as a variable (as in Claude Code cloud sessions), start the server with `NODE_USE_ENV_PROXY=1` so Node's `fetch` goes through the proxy, and set `PRIVY_APP_SECRET` to any placeholder.

**Without Privy (local testing and team demos):** `TESTNET_SIGNER=server-dev` makes the server derive a throwaway testnet key per email and sign with it. It's custodial, testnet-only and meant for development. For example:

```bash
npm run testnet -- test-usdc            # prints STELLAR_USDC_ISSUER=… (a private test USDC)
npm run testnet -- contacts Tunde Ada   # prints TESTNET_CONTACTS=…  (real testnet accounts)
```

Put both lines in `.env.local`, plus `MONEY_MODE=testnet`, `TESTNET_SIGNER=server-dev` and a 32+ character `SESSION_SECRET`. Sign in, click **Set up testnet wallet**, then mint test USDC to your address with `npm run testnet -- mint <address> 50`. Secrets for the helper accounts are saved in `web/.testnet/` (git-ignored). Testnet resets wipe all of this; rerun the commands if that happens.

## Deploy to Vercel

1. Import the repository in Vercel.
2. Set **Root Directory** to `web`. The framework is detected as Next.js.
3. Optionally add the variables from `.env.example`. With none set, the deploy runs in mock mode.
4. Deploy.

Note: mock wallet state lives in server memory, so on Vercel it can reset between requests that land on different instances. That's fine for a preview. Swap `src/server/store.ts` for a database before anything real runs.

## How it's built

- Next.js 16 (App Router) with Tailwind CSS 4 and TypeScript. Motion handles animation.
- Plus Jakarta Sans, loaded locally from `src/fonts`.
- **Auth:** Privy email OTP (`useLoginWithEmail`), then `createWallet({ chainType: 'stellar' })` from `@privy-io/react-auth/extended-chains`. The server verifies the Privy access token against Privy's JWKS and sets its own session cookie. Fallback plan (Dynamic) is in [`../docs/auth.md`](../docs/auth.md).

### The money API (`src/server`)

Every money action goes through typed server functions in `src/server/money.ts`, exposed under `app/api/*`. The UI never talks to Horizon or a DEX directly.

| Function | Route |
| --- | --- |
| `getQuote` | `POST /api/quote` |
| `approveSwap` | `POST /api/swap/approve` (`{ quoteId, approve: true }`) |
| `previewSend` / `createSend` | `POST /api/send/preview`, `POST /api/send/confirm` (`{ intentId, approve: true }`) |
| `createPaymentLink` | `POST /api/links` |
| `getBalances`, `getLimits`, `getActivity` | `GET /api/balances`, `/api/limits`, `/api/activity` |

**Approve-before-act and limits are enforced on the server.** A swap or send reaches the signer only if all of these hold:

- the request has `approve: true` for a quote or preview this user owns,
- it is still pending and hasn't expired (60 seconds),
- the amount is within the per-payment cap and what's left of today's cap,
- the balance covers it.

Otherwise the API returns an error, and nothing is signed. The caps are **examples** (₦75,000 / 50 USDC per payment, ₦200,000 / 200 USDC per day). The real amounts are still open; see [`../docs/open-questions.md`](../docs/open-questions.md).

- **Routing** (`src/server/routing.ts`): one adapter per venue, compared, best marked. With `QUOTE_SOURCE=live` (the default) the prices are **real and read-only, from Stellar mainnet**:
  - **SDEX:** Horizon strict-send path finding, covering order books and classic pools
  - **Aquarius:** the find-path API
  - **Soroswap:** the quote API, limited to Soroswap pools. Needs `SOROSWAP_API_KEY`.

  Naira is quoted as **NGNC**, the most-held naira asset on Stellar. A venue that can't be quoted is left out with its reason, never given an invented rate. Each quote is also compared with a market USD→NGN rate (ExchangeRate-API, cached for an hour), and the card warns when the best Stellar price is 3% or more off the market. Executing a swap stays simulated in mock mode and is refused on testnet. `QUOTE_SOURCE=mock` brings back the fixed example prices from the mockups. There is no live StellarRoute dependency.
- **Paycrest** (`src/server/paycrest.ts`): a mocked naira on-ramp order. It refuses without a passed identity check, keeps only the verified status (never the NIN), and applies an example trial cap. The UI does not promise a one-time NIN, because reuse isn't confirmed with Paycrest.
- **Signer** (`src/server/signer.ts`, `src/server/testnet.ts`): mock by default. In testnet mode, USDC sends are signed by the user's Privy wallet (or the dev key) and submitted to Horizon, as described above. `signer.ts` also notes the future scoped session key for Telegram, WhatsApp and MCP.
- **Site connect** (`src/server/site-connect.ts`, routes under `/api/sites/*`): follows [`../docs/site-connect.md`](../docs/site-connect.md), mocked. A site that isn't on the allow list gets “Connect to this site?” first, with an option to add it. Then Wura runs the mocked discovery path: read the page, find the Soroban contract, check it's verified, read its interface, simulate, and show a signing preview. Signing goes through the same server-side approval, caps and log as a send. The allow list is permission to connect, never to sign. Only fictional sites on reserved example domains work in mock mode:
  - `market.example.org`: allowed by default; buy items at 12.50 USDC each
  - `tickets.example.com`: a 60 USDC ticket, refused by the example cap
  - `coins.example.net`: a 20 USDC token bundle
  - `drainer.example.net`: unverified contract, refused
  - `broken.example.com`: simulation fails, stops
  - any other example host: no contract found

  Real sites get a plain “I can only connect to the example sites in this preview”. There is no hosted browser.
- **Chat** (`src/server/agent.ts`): a rule-based intent parser for the money commands. It only handles money questions. It returns quote and preview cards; it never moves money itself.

Claude, ChatGPT, Telegram and WhatsApp appear only as "connected apps" labels, marked as not connected yet. They use generic icons, not their logos.

## Scripts

```bash
npm run dev     # local dev server
npm run build   # production build
npm run lint    # ESLint
```
