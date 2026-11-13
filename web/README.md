# Wura — web app (v1)

The first web app for **Wura**, a money assistant you chat with. The product name is **Wura**. Some screens and the older design shots may still show an “Agent” / “name TBD” wordmark until those are renamed.

This is a Stellar Nigeria Buildathon preview. **Nothing is live.** There are no users, no revenue and no real transactions. Every balance, rate and payment shown is fictional example data, taken from the design mockups in [`../design`](../design/README.md).

## What's here

| Route | Screen |
| --- | --- |
| `/` | Landing: "Your money, on chat." with five cards on a half-moon arc. Also an animated routing demo, an interactive how-it-works demo and a limit tester |
| `/sign-in` | Email + 6-digit code. Creates (or reuses) a Stellar wallet |
| `/onboarding` | Fund choice: USDC (no ID) or naira (identity check before the first top-up) |
| `/chat` | Chat. Try "Change ₦50,000 to dollars", "Send $20 to Tunde", "Make a payment link for ₦15,000" |
| `/wallet` | Dashboard: balances, daily-limit gauge, per-payment cap, transaction log, connected apps |
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

- **Routing** (`src/server/routing.ts`): one adapter per venue (SDEX, Soroswap, Aquarius). Quotes are compared and the best is marked. v1 uses fixed example prices. A venue that can't be quoted is left out and reported, never given an invented rate. Set `MOCK_UNAVAILABLE_VENUES=soroswap` to see that path. There is no live StellarRoute dependency.
- **Paycrest** (`src/server/paycrest.ts`): a mocked naira on-ramp order. It refuses without a passed identity check, keeps only the verified status (never the NIN), and applies an example trial cap. The UI does not promise a one-time NIN, because reuse isn't confirmed with Paycrest.
- **Signer** (`src/server/signer.ts`): mock only. `MONEY_MODE=testnet` is refused until Privy Tier 2 signing is wired. The file also notes the future scoped session key for Telegram, WhatsApp and MCP.
- **Chat** (`src/server/agent.ts`): a rule-based intent parser for the money commands. It only handles money questions. It returns quote and preview cards; it never moves money itself.

Claude, ChatGPT, Telegram and WhatsApp appear only as "connected apps" labels, marked as not connected yet. They use generic icons, not their logos.

## Scripts

```bash
npm run dev     # local dev server
npm run build   # production build
npm run lint    # ESLint
```
