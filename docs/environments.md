# Environments and secrets (M7)

Three environments, never mixed. The code refuses the unsafe combinations it can see (`web/src/server/network.ts`, run at boot). The rest is Vercel and Privy settings that only a person can do and check. Tick them off before Stage 3.

## What each environment is

| | Production | Preview | Local dev |
|---|---|---|---|
| `MONEY_MODE` | `mainnet` (when Stage 3 starts), else `testnet` | `mock` or `testnet`. Never `mainnet`: the app refuses to start | `mock` or `testnet` |
| Privy app | **Production Privy app** | **A separate Privy app** (never the production one) | Separate dev app, or none (mock sign-in) |
| Database | Production Postgres | Its own Postgres (or none = memory) | None or local |
| Treasury | Funded mainnet treasury | Testnet treasury only | Testnet only |

## Settings that must be Production-only in Vercel

Set each one with only the **Production** box ticked. Preview gets its own different value, or none.

| Setting | Notes |
|---|---|
| `SESSION_SECRET` | 32+ characters. Different in Production and Preview. |
| `PRIVY_APP_SECRET`, `NEXT_PUBLIC_PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY` | From the production Privy app. The app id is baked in at build time, so Preview builds must carry the other app's id. |
| `TREASURY_SECRET` | Mainnet treasury key. Not in Preview at all. |
| `AGENT_KEY_SECRET` | Stays unset on mainnet until M11. |
| `RAMP_TOKEN_KEY` | Encrypts the partner token (M6). Not in Preview. |
| `CRON_SECRET` | Protects `/api/cron/links`. |
| `DATABASE_URL` | Production database. Preview must not point at it. |
| `APP_URL` | The public https address, e.g. `https://wurapay.xyz`. |
| `BETA_ALLOWLIST`, `MONEY_KILL` | Production values. |
| `SOROSWAP_API_KEY` | Quotes only (swaps run on the Stellar DEX). Without it Soroswap shows as not connected. |
| `SWAP_SLIPPAGE_BPS`, `SWAP_MAX_GAP_PCT`, `SWAP_GAP_CHECK_ABOVE_NGN`, `SWAP_GAP_CHECK_ABOVE_USDC` | Real-swap guards (M10). Defaults 50, 3, 5000, 5. See `.env.example`. |

The app checks at boot that no two of the secrets above are the same value. It cannot compare Production with Preview (it only sees its own environment), so that one is a manual check: open Vercel, Settings, Environment Variables, and confirm `SESSION_SECRET` shows two different entries.

## What the app refuses on mainnet

It will not start (every request returns 500, with the reasons in the log) if any of these hold: Preview deployment; `TESTNET_SIGNER=server-dev`; testnet issuer or Horizon URL; `SESSION_SECRET` under 32 characters; `APP_URL` missing, http or localhost; `NEXT_PUBLIC_PRIVY_APP_ID` missing (mock sign-in would let anyone in as anyone); `PRIVY_APP_SECRET` missing; `DATABASE_URL` missing; `AGENT_KEY_SECRET` set; `TESTNET_CONTACTS` set; any two secrets equal.

## Privy: production app checklist (by hand)

1. Create a second Privy app for production. Keep the current one for Preview and dev.
2. Allowed origins: the production domain only (`https://wurapay.xyz`). No `localhost`, no `*.vercel.app`.
3. Login methods: email only, as today. Embedded Stellar wallets on.
4. Copy the app id, app secret and verification key into Vercel, Production only.
5. Do a test sign-in on the production domain and confirm the wallet address matches what `/api/me` shows.

## Vercel checklist (by hand)

1. Production branch is `main`. Preview deployments are for all other branches.
2. In every secret above, confirm the **Production** box is the only one ticked.
3. Preview has `MONEY_MODE` empty, `mock` or `testnet`. If it ever says `mainnet`, the preview will not start.
4. Add a scheduler that calls `GET /api/cron/links` with `Authorization: Bearer $CRON_SECRET` (Hobby plans allow daily crons only; use an external scheduler for every minute).
5. Turn on Vercel's "Sensitive" flag for each secret so it can't be read back in the dashboard.
