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

## Database

Set `DATABASE_URL` to a Postgres connection string and Wura stores everything there. Without it, state lives in server memory: fine for mock-mode demos, but it resets on restart, and Vercel's separate instances don't share it.

- **Tables** (created automatically on first use, see `src/server/db.ts`):
  - `wallets`: one row per user, holding balances in mock mode, spend counters, pending quotes and previews, transactions waiting for a signature, contacts, payment links, the allow list and the identity-check status (never the NIN)
  - `activity`: the append-only transaction log
- **One transaction per request.** Every API request locks the user's row (`SELECT … FOR UPDATE`), runs, and saves. A user's requests therefore run one at a time across all instances, so simultaneous payments can't slip past the daily cap. In a test, five $45 sends fired at once across two instances let exactly four through, and refused the fifth at the cap.
- **Local Postgres:** `DATABASE_URL=postgres://user@127.0.0.1:5432/wura npm run dev`.

## Deploy to Vercel

1. Import the repository in Vercel.
2. Set **Root Directory** to `web`. The framework is detected as Next.js.
3. Add Postgres: in the Vercel project, **Storage → Marketplace → Neon**. It sets `DATABASE_URL` for you. Use the pooled connection string.
4. Optionally add the other variables from `.env.example`. With none set, the deploy runs in mock mode.
5. Deploy.

Without a database, mock wallet state lives in server memory and can reset between requests that land on different Vercel instances. That's fine for a quick preview, not for a demo people use.

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
- **Naira partner** (`src/server/ramp/`): one interface for naira top-ups, cash-outs and the identity check, with two providers behind `RAMP_PROVIDER`. `mock` (default) is the fictional top-up: it refuses without a passed identity check, keeps only the verified status (never the NIN), and applies an example trial cap. `link` reads a live Stellar anchor's published limits (read-only, mainnet), so the smallest top-up comes from the partner and is not hard-coded; top-ups and cash-outs through it are still refused. Nothing in this folder signs a transaction. `GET /api/funding/naira/info` returns the limits for the screens. See [`../docs/money-side.md`](../docs/money-side.md).
- **Signer** (`src/server/signer.ts`, `src/server/testnet.ts`): mock by default. In testnet mode, USDC sends are signed by the user's Privy wallet (or the dev key) and submitted to Horizon, as described above. `signer.ts` also notes the future scoped session key for Telegram, WhatsApp and MCP.
- **Site connect** (`src/server/site-connect.ts`, routes under `/api/sites/*`): follows [`../docs/site-connect.md`](../docs/site-connect.md), mocked. A site that isn't on the allow list gets “Connect to this site?” first, with an option to add it. Then Wura runs the mocked discovery path: read the page, find the Soroban contract, check it's verified, read its interface, simulate, and show a signing preview. Signing goes through the same server-side approval, caps and log as a send. The allow list is permission to connect, never to sign. Only fictional sites on reserved example domains work in mock mode:
  - `market.example.org`: allowed by default; buy items at 12.50 USDC each
  - `tickets.example.com`: a 60 USDC ticket, refused by the example cap
  - `coins.example.net`: a 20 USDC token bundle
  - `drainer.example.net`: unverified contract, refused
  - `broken.example.com`: simulation fails, stops
  - any other example host: no contract found

  Real sites get a plain “I can only connect to the example sites in this preview”. There is no hosted browser.
- **Chat** (`src/server/agent.ts`): the model you configure reads each message and calls the tools in `src/server/tools.ts`: rates, swap quote, send preview, payment link, balance, site connect. Any provider works: set `LLM_PROVIDER`, `LLM_MODEL` and `LLM_API_KEY` (see `.env.example`). `src/server/llm.ts` has two adapters: Anthropic's Messages API, and any OpenAI-compatible Chat Completions API by base URL (presets for OpenAI, DeepSeek, OpenRouter, Gemini and Groq; or `openai-compatible` plus `LLM_BASE_URL` for anything else, including a local server). The model must support tool calling. Every tool only prepares or reads; none approves, confirms or submits, so money still moves only when the user taps Approve, and the server re-checks caps then. The card in each reply comes from a real tool result, never from model text. Each tool call takes its own wallet lock, so the model call never holds the user's row. The browser sends the last 8 chat lines as plain text for follow-ups. With no model configured, or if the call fails or declines, the rule parser in `src/server/rules.ts` answers instead (`AGENT_BRAIN=rules` forces it).
- **Chat approvals** (`src/server/agent-key.ts`, `src/server/channel.ts`): lets a chat app approve testnet USDC sends without the browser. On the Channels page the user turns it on once: their own wallet signs a `setOptions` that adds Wura's agent key (derived from `AGENT_KEY_SECRET` and the user ID, never stored) with weights user 2, agent 1 and thresholds 1/1/2. The agent key can make payments but can't add or change signers or merge the account (tested on testnet). Turning it off removes it. Chat apps call `approveSendFromChat(session, intentId)` inside `withWallet` after the linked user taps Approve; it runs the same checks as the web (approved, not expired or used, caps, balance), reads the signers from Horizon, then signs with the agent key. It never returns `needs_signature`. Caps are still enforced by the server, not on-chain.
- **Favourites** (`/favourites`, `/api/contacts`): saved names for Stellar addresses, kept in the wallet state (Postgres). After a send to an address that isn't saved, the chat offers a "Save to favourites" card; "send $10 to Isaac" then resolves the name. The chat model can also save (`save_contact`) and list (`list_contacts`) favourites. A name maps to one address; saving an address again renames it.
- **Chat eval** (`npm run agent-eval -- <url>`): ten fixed prompts against a mock-mode server, checking card types and that the activity log never grows. Makes real calls to the configured model.

Claude, ChatGPT, Telegram and WhatsApp appear only as "connected apps" labels, marked as not connected yet. They use generic icons, not their logos.

## Scripts

```bash
npm run dev     # local dev server
npm run build   # production build
npm run lint    # ESLint
npm test        # naira partner tests (needs Node 23.6+; reads .ts files directly)
```
