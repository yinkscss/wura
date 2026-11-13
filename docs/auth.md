# Auth: email to a Stellar address

The product needs a sign-in that feels like a normal app: the user enters an email, proves they own it, and gets a Stellar address they can fund and spend from. They should not have to install Freighter or write down a seed phrase to start.

This note is the recommendation for the Stellar Nigeria Buildathon (applications close 21 November 2026). It is based on official docs, checked in November 2026, plus a search of recent posts on X. Nothing here has been implemented yet.

## Decision

**For the buildathon, Wura uses Privy.** This was decided in November 2026. Privy's free tier is reported as up to 499 monthly active users and 50,000 signatures a month, which covers the buildathon and early pilots (confirm on Privy's pricing page).

After the buildathon, the direction is Wura's own wallet layer: email sign-in we run ourselves, plus a passkey-controlled Stellar smart wallet with spending limits enforced by the wallet contract. That plan, its open problems and the migration path are in [Wallet roadmap](wallet-roadmap.md).

## Recommendation

**Use Privy: email one-time code, then create a Stellar embedded wallet.**

This is the easiest path that still maps an email to a *classic* Stellar `G…` account, which is what most payments, trustlines, SDEX and many on/off-ramps expect.

How it works:

1. The user types their email on the sign-in page.
2. Privy emails a one-time code (`useLoginWithEmail`: `sendCode`, then `loginWithCode`). This is OTP, not a click-through magic link, but it is the same “email in, no seed phrase” idea.
3. After login, the app creates (or reuses) a user wallet with `createWallet({ chainType: 'stellar' })`. The address is a classic `G…` public key. A public Stellar PoC shows this clearly.
4. For a swap or send, the app builds the transaction, Privy signs it (Stellar is **Tier 2**: Privy decodes and signs; the app submits to Horizon itself), and the agent only does this after the user approves the preview.
5. Spending limits are enforced in our server first, and also in Privy transaction policies where they apply at Tier 2.

**Telegram, WhatsApp and MCP:** the user signs in once on the web (email code). For chat channels, add a *delegated / server* signer or session key on that same wallet, scoped to the daily and per-payment caps. The agent server can then sign approved, in-limit actions without opening a browser. If a request would exceed a limit, the agent refuses and does not sign. Do not give the server an unscopeable key.

**Fallback: Dynamic.** Dynamic’s docs now list Stellar as a **Tier 1** native embedded wallet: email OTP (or social) sign-in, a Stellar wallet on signup, plus helpers to sign, send and add a trustline. It also documents agent wallets. Use this if Privy signup or Stellar policy setup gets in the way. Before committing, confirm the wallet is a classic `G…` account, not a contract `C…` account.

**Strong alternative, with a caveat: Crossmint.** Crossmint has official Stellar wallets, email OTP, an official Stellar demo, and the best documented *server signer + spending-limit scopes* for a platform-hosted agent. The catch is that Crossmint wallets are Soroban smart accounts (`C…` addresses). A Stellar builder on X reported that USDC in a passkey / contract wallet can be rejected when cashing out to an exchange. Check Paycrest and any off-ramp against `C…` addresses before choosing Crossmint as the primary path.

## What we checked

| Option | Email → Stellar wallet today? | Notes |
| --- | --- | --- |
| **Privy** | Yes. Email OTP, then `chainType: 'stellar'`. | Tier 2: sign, app broadcasts. Policies at Tier 2. Classic `G…` in public examples. |
| **Dynamic** | Yes. Email OTP / social; Stellar is Tier 1 embedded. | Built-in send and trustlines. Confirm address type on first integration. Agent wallets documented. |
| **Crossmint** | Yes. Email OTP (and Google, Apple, X). Official Stellar demo. | Server signer and transfer scopes (limits, recipients, expiry) on Stellar. Wallets are `C…` smart accounts. |
| **Turnkey** | Yes. Email OTP and passkeys; ED25519 / Stellar keys. | Excellent policy engine for agent signing. Heavier setup than Privy or Dynamic for a short buildathon. |
| **Para (formerly Capsule)** | Yes. Email or phone OTP; announced Stellar embedded wallets (also amplified by Build on Stellar on X). | Viable, but the official Stellar demo and payment-scope docs are thinner than Crossmint / Privy / Dynamic. |
| **Stellar passkey-kit / smart-account-kit** | Passkeys, not email magic link. Email is only a WebAuthn user id. | Stellar-native smart wallets with policies (especially smart-account-kit). Need a relayer; **Launchtube is retired** — use OpenZeppelin Relayer / Stellar Channels. Better as a later path, not the first sprint. `C…` addresses have the same cash-out caveat. |
| **Freighter, LOBSTR, Stellar Wallets Kit** | No email mapping. | Browser / app wallets for people who already have a Stellar account. Offer “Connect wallet” later, not as the default sign-in. |
| **Magic.link, Web3Auth, Circle programmable / user-controlled wallets** | No Stellar wallet support found in current official chain lists. | Do not plan the demo around these. |

## Suggested buildathon shape

- **Web sign-in:** Privy email OTP, styled like the rest of the Wura UI (see [design/README.md](../design/README.md)).
- **Wallet:** one Stellar `G…` address per email.
- **Approvals:** the agent never signs until the user confirms the preview, even if a session key exists.
- **Limits:** enforce per-payment and daily caps in our API; add a scoped server/delegated signer for Telegram, WhatsApp and MCP.
- **Later:** Wura's own passkey smart wallet (see [Wallet roadmap](wallet-roadmap.md)), and “Connect Freighter” for advanced users.

## Sources

Official docs (checked November 2026):

- Privy chain tiers, including Stellar at Tier 2: https://docs.privy.io/wallets/overview/chains
- Privy email OTP: https://docs.privy.io/authentication/user-authentication/login-methods/email
- Privy embedded wallets (lists Stellar): https://docs.privy.io/wallets/overview/embedded
- Privy Tier 2 Stellar signing: https://docs.privy.io/recipes/tier-2-wallet-integration
- Public PoC of a Privy Stellar `G…` wallet and `raw_sign`: https://github.com/oceans404/x402-stellar-aws-poc/blob/main/docs/privy-wallet.md
- Dynamic Stellar wallets (embedded from SDK 4.59.2): https://www.dynamic.xyz/docs/react/wallets/using-wallets/stellar/stellar-wallets
- Dynamic chain tiers (Stellar in Tier 1): https://www.dynamic.xyz/docs/get-started/chains/overview
- Dynamic email OTP: https://www.dynamic.xyz/docs/auth/dynamic-auth/auth-methods
- Dynamic agent wallets: https://www.dynamic.xyz/docs/agents/overview
- Crossmint signers, including Stellar server signer and email/phone OTP: https://docs.crossmint.com/wallets/concepts/signers
- Crossmint signer scopes (spending limits, recipients, expiry): https://docs.crossmint.com/wallets/guides/signers/scopes
- Crossmint official Stellar wallets demo: https://github.com/Crossmint/crossmint-stellar-wallets-demo
- Turnkey email OTP and embedded wallets: https://docs.turnkey.com/features/authentication/email and https://docs.turnkey.com/solutions/embedded-wallets/overview
- Stellar smart wallets, passkey-kit vs smart-account-kit, Launchtube retired: https://developers.stellar.org/docs/build/guides/contract-accounts/smart-wallets
- OpenZeppelin Relayer as Launchtube replacement: https://developers.stellar.org/docs/tools/openzeppelin-relayer
- Circle wallets supported chains (Stellar not listed): https://developers.circle.com/wallets/supported-blockchains
- Magic.link chain overview (Stellar not listed): https://docs.magic.link/embedded-wallets/blockchains/overview
- Para Stellar announcement: https://blog.getpara.com/stellar-support/

Posts on X (not a substitute for the docs above):

- Privy described as email / SMS / social onboarding on Stellar (May 2025): https://x.com/GokuSuperXlm/status/1920200791337677006
- Zebec × Stellar × Privy, Privy as the wallet layer (September 2026): https://x.com/MarcoSalzmann80/status/2095520352856064041
- Crossmint “Stellar Smart Wallets V2” (December 2025, via remixes of @crossmint)
- Barça Mobile in-app wallet with Wirex, Crossmint and Stellar (August 2026): https://x.com/Flexe_io/status/2088017829345800424
- Para live on Stellar, amplified by @BuildOnStellar (August 2026): https://x.com/BuildOnStellar/status/2085027095638389088
- Builder warning: USDC in a Stellar passkey / `C…` wallet can be rejected by exchanges (October 2026): https://x.com/Heisbei02/status/2109511076375044284
