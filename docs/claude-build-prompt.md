# Build prompt for Claude Code

Copy everything below the line into Claude Code (or Claude) in this repository.

---

You are building the first web app for **Agent**, a working name (the public product name is not chosen yet). This repo is the product write-up and interface designs for a Stellar Nigeria Buildathon. Applications close on 21 November 2026. Nothing is live. There are no users, no revenue and no transactions. Never invent traction.

## What to read first

Read these before writing code:

- `design/README.md` and every PNG in `design/shots/` — this is the look and the screens to match
- `design/src/` — HTML/CSS sources for those screens (Plus Jakarta Sans, starfield, half-moon card layout)
- `docs/concept.md` — what the product is
- `docs/routing.md` — the agent compares rates itself; StellarRoute is not a live dependency
- `docs/kyc-and-funding.md` — USDC needs no ID; naira needs an identity check before the first top-up
- `docs/auth.md` — use **Privy email OTP**, mapping email to a Stellar `G…` address; fallback is Dynamic
- `docs/buildathon.md` and `docs/open-questions.md` — scope and things not yet decided

## What to build

A Next.js (App Router) app with Tailwind, TypeScript, deployable to Vercel. Match the designs closely: deep blue `#08318D` / `#092D8E`, white, bubblegum pink `#FD91CC`, Plus Jakarta Sans (or Inter), solid white cards with 16–24px radius and soft deep shadows, pill buttons, starfield on blue heroes, half-moon card arcs on the landing and a gentle arc on the dashboard stats and onboarding cards. No glassmorphism. No official Claude / ChatGPT / Telegram / WhatsApp logos — text labels and simple generic icons only.

Placeholder wordmark: **Agent**, with a small “name TBD” where the mocks show it.

### Pages

1. **Landing** — match `design/shots/01-landing-desktop.png`. Headline: “Your money, on chat.” Five bento cards on a half-moon (centre highest, sides rotated about ±7° and ±13°): chat snippet, rate comparison, pink daily-limit gauge, payment link, activity. CTAs go to sign-in / app.
2. **Sign-in** — not in the PNG set; invent one screen in the same style. Email field, send code, enter the one-time code. Copy like “Sign in with email. We’ll create your Stellar wallet.” After success, create or reuse the Privy Stellar wallet and go to the wallet or onboarding.
3. **Onboarding / fund choice** — match `design/shots/06-onboarding-verify-once.png`. Two cards: **Fund with USDC** (no ID) and **Fund with naira** (identity check before the first naira deposit; do not promise Paycrest will skip every future NIN until that is confirmed).
4. **Chat (swap approve)** — match `design/shots/02-chat-swap-approve.png`. User: “Change ₦50,000 to dollars.” Agent replies with a quote card comparing SDEX, Soroswap and Aquarius, best row highlighted, fee and “you get”, **Approve** and **Cancel**. Nothing is sent until Approve.
5. **Chat (send confirm)** — match `design/shots/03-send-confirm.png`. User: “Send $20 to Tunde.” Confirmation with destination, fee, daily limit remaining, per-payment cap, Confirm / Cancel.
6. **Chat (payment link)** — match `design/shots/04-payment-link.png`. User: “Make a payment link for ₦15,000.” Card with amount, a clearly fictional link on a reserved host (e.g. `example.com`), Copy / Share, status Open.
7. **Wallet dashboard** — match `design/shots/05-dashboard-balance-limits.png`. NGN and USDC balances, daily limit gauge, per-payment cap, transaction log, connected apps list (Claude, ChatGPT, Telegram, WhatsApp as labels only).

A simple signed-in shell (sidebar like the dashboard) is enough. Mobile chat can be a narrow column or a `/chat` route; it does not need a native app.

## Stack and data

- Next.js + Tailwind + TypeScript. Use the Privy React / Next SDK for auth (`useLoginWithEmail`, then `createWallet({ chainType: 'stellar' })`). If Privy is blocked, follow the Dynamic fallback in `docs/auth.md`.
- Put all money actions behind a clean API layer, e.g. `src/server/` or `app/api/`, with typed functions: `getQuote`, `approveSwap`, `createSend`, `createPaymentLink`, `getBalances`, `getLimits`, `getActivity`. The UI must not talk to Horizon or DEX APIs directly for those writes.
- **Start with mock data** behind that API so every screen works without keys. Use the same fictional example figures as the mockups (₦50,000 → 31.20 USDC, $20 to Tunde, ₦15,000 link, example balances ₦182,450 and 248.60 USDC). Label example limits as examples; real cap amounts are still open (`docs/open-questions.md`).
- **Routing stub:** `getQuote` returns three venue quotes (SDEX, Soroswap, Aquarius), marks the best, and can later be swapped for real Horizon / Soroswap / Aquarius calls. Do not call a live StellarRoute service. If a venue cannot be quoted, omit it and say so — do not invent a rate.
- **Paycrest stub:** a module for “create naira on-ramp order” that is mocked. Do not bypass KYC. USDC funding can be “here is your address”.
- **Approve-before-act and limits must be enforced on the server**, not only in the UI. If the user has not approved, or the payment would exceed the per-payment or daily cap, the API returns an error and does not sign or submit.
- For the buildathon, signing can stay mocked *or* use Privy on testnet if keys are present in env. Gate real signing behind env vars. The app must still run in mock mode with no secrets.
- Telegram, WhatsApp and MCP are out of scope for this first web build except as “connected apps” display. Leave a short server-side comment or stub for a future scoped session key, as described in `docs/auth.md`.

## Rules

- Do not fake user counts, revenue, or testimonials.
- Do not upload to YouTube, trade, or add extra product skills (trading, SEO, etc.).
- Do not commit secrets. Provide a `.env.example` with `NEXT_PUBLIC_PRIVY_APP_ID` and any testnet flags.
- README: how to run locally, how to deploy to Vercel, that the name Agent is a placeholder, and that mock mode is the default.
- Keep the first PR / first version to these pages and the API stubs. Polish the UI against the PNGs rather than adding extra features.

Build it so that opening the landing, signing in with email (or a mocked sign-in when Privy is not configured), walking through fund choice, a swap preview, a send confirm, a payment link, and the dashboard all work end to end.
