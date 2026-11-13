# Wallet roadmap: Privy now, Wura's own passkey wallet next

**Decision for the buildathon:** Wura uses **Privy** for sign-in and wallets. A user signs in with an email one-time code, and Privy creates a classic Stellar `G…` address for them. See [Auth](auth.md) for how that works.

**Direction after the buildathon:** Wura moves to its own wallet layer: email sign-in that we run ourselves, plus a **passkey-controlled Stellar smart wallet** that the user holds. This note records why, what it would take, and what has to be solved first. It is a plan, not something that has been built.

Research behind this note was done in November 2026 (sources at the end). Many sources are community projects rather than official docs, so the open questions below need checking before any build starts.

## Why Privy for the buildathon

- **It works with today's rails.** A classic `G…` address can receive from exchanges and anchors and pay out to them. Smart-wallet `C…` addresses mostly can't yet (see [Hard problems](#hard-problems-to-solve-first)).
- **It's fast.** Email code to a working Stellar wallet is days of work, not weeks. Build Week time is better spent on real signing, live quotes and the naira flow.
- **It's free at our size.** Privy's free tier is reported as up to **499 monthly active users**, **50,000 signatures a month** and about **$1M a month** in transaction volume. Paid plans are reported at about **$299/month** (up to 2,499 users) and **$499/month** (up to about 10,000 users). These figures come from third-party pricing write-ups, not Privy's own page; confirm on https://www.privy.io/pricing before relying on them.
- **It's replaceable.** In the app, sign-in and signing sit behind one server boundary (`/api/auth/*` and `web/src/server/signer.ts`). Swapping Privy out later doesn't touch chat, quotes or limits.

## The target: Wura's own passkey wallet

How it would work:

1. **Sign in with email.** Wura sends the 6-digit code itself and stores only a hash. We keep the email → wallet address mapping in our own database.
2. **Create a wallet with a passkey.** The phone creates a passkey (Face ID or fingerprint) for Wura's domain. A relayer deploys the user's smart wallet and pays the fee, so the user never needs XLM.
3. **Pay with a tap.** For web payments, the user approves the preview and the passkey signs. Stellar verifies passkey signatures natively (secp256r1, available since Protocol 21).
4. **Pay from chat without a passkey.** Once, on the web, the user adds a **Wura agent key** to their wallet with a rule such as: USDC only, $50 per payment, $200 a day, expires in 30 days. Chat payments on Telegram, WhatsApp, Claude and ChatGPT are signed with that key, and **the wallet contract itself refuses anything outside the rule**.

The building blocks:

| Piece | What to use | Status (Nov 2026) |
| --- | --- | --- |
| Passkey signatures | Stellar's built-in secp256r1 check (CAP-51) | Live on mainnet |
| Smart wallet contract | OpenZeppelin `stellar-contracts` smart accounts: signers, context rules, policies | Audited library |
| SDK | Smart Account Kit (TypeScript) | Young (v0.6.x), replaces the older Passkey Kit |
| Spending limits | OpenZeppelin spending-limit policy (rolling cap per token, on `transfer`) | Available |
| Fees | OpenZeppelin Relayer / managed Stellar Channels (Launchtube is retired) | Official successor |
| New-device lookup | Mercury passkey indexer, or self-hosted | Hosted dependency |
| Anchor login for `C…` accounts | SEP-45 | Supported by Anchor Platform; patchy elsewhere |
| Social recovery | OpenZeppelin policy | On their roadmap, not shipped |

## Why this matters for the pitch

- **Limits enforced on-chain.** Today Wura checks the caps in its own server. With a smart wallet, the caps for the agent key live in the wallet contract. Even if Wura's server or the AI were compromised, Stellar would reject a payment over the cap.
- **Nobody else holds the keys.** The user's passkey controls the wallet. Wura's agent key can only do what the user's rule allows, and the user can remove it at any time.
- **Stellar-native.** Native passkey verification, Soroban smart accounts and a fee relayer, with no third-party wallet service in the signing path.

## Hard problems to solve first

1. **Money in from exchanges and ramps.** Exchanges and anchors send classic payments, which can only reach `G…` addresses. Most can't pay a `C…` wallet yet. A protocol-level fix is only at the proposal stage. The workaround is a Wura deposit address (one `G…` account with a memo per user) that forwards each deposit straight into the user's wallet. That means Wura briefly holds funds in transit, which needs legal advice first.
2. **Money out to exchanges and ramps.** A smart wallet can't attach a memo. The fix is a muxed (`M…`) address carrying the exchange's account and memo. Since Protocol 23 the payment event includes that ID, but the receiver has to read it. Check each off-ramp. Paycrest doesn't list Stellar at all, so naira out needs its own plan either way.
3. **Passkeys in chat apps.** Passkeys often fail inside Telegram's and WhatsApp's built-in browsers. Chat payments use the capped agent key instead. Anything that needs the passkey (setup, raising limits, large payments) opens Wura in the phone's real browser.
4. **Lost phone.** Synced passkeys (iCloud Keychain, Google Password Manager) survive most phone changes. For the rest, prompt for a second passkey on another device and add a recovery signer that can only add a new passkey after a waiting period. Email alone must never be enough to take over a wallet.
5. **The domain is permanent.** A passkey only works on the domain it was created for. Choose Wura's final domain before the first real wallet is created.
6. **Costs and upkeep.** Each wallet is a deployed contract whose storage pays rent; lapsed storage is archived and must be restored. The relayer should extend storage as it submits. Measure real deploy and rent costs on testnet.
7. **Getting the limits right.** Put the spending limit on the agent's own rule, and keep the agent key out of any broader rule. A community checker reported that a default single-signer rule can bypass a limit set elsewhere. The spending-limit policy watches `transfer` calls only, so swaps and site payments need their own rules. Keep the server-side checks as well.

## Migration path

1. **Buildathon:** Privy, classic `G…` address, caps enforced on Wura's server. Already the plan.
2. **Spike (2 days, after the buildathon):** on testnet, create a passkey wallet with Smart Account Kit through the managed relayer, add an agent rule with a spending limit, and confirm the contract pays $20 but refuses $60. Test the Telegram → real-browser handoff on iPhone and Android, and ask Paycrest and one Nigerian exchange whether they can pay to and from `C…` or muxed addresses.
3. **New users on the passkey wallet**, if the spike passes and the ramp question has an answer. Keep Privy for existing users.
4. **Offer existing users a move:** create a passkey wallet, then transfer funds from their Privy `G…` address with one approved payment.

## Open questions

- Whether any major exchange (including Nigerian ones) accepts withdrawals to `C…` addresses. No source found says yes.
- Whether Telegram or WhatsApp passkey support changed in 2026. Only older failure reports were found.
- The exact spending-limit history cap (reported as 815, elsewhere 1,000) and the default-rule bypass. Check against current OpenZeppelin code.
- Which SDK is officially maintained: most sources point to Smart Account Kit over Passkey Kit, but they conflict.
- Real deploy and rent costs on mainnet.
- Privy's exact current pricing, from Privy's own page.

## Sources

Privy pricing (third-party, not official):

- https://costbench.com/software/web3-wallet-sdk/privy/
- https://www.openfort.io/blog/privy-vs-turnkey
- https://1shotapi.com/blog/best-embedded-wallets
- https://apis.io/plans/privy/privy-plans-pricing/

Smart wallets, passkeys and limits:

- Smart Account Kit: https://github.com/stellar/smart-account-kit
- Passkey Kit: https://github.com/stellar/passkey-kit
- Stellar developer meeting, 20 August 2026: https://developers.stellar.org/meetings/2026/08/20
- stellar-docs PR moving guides to Smart Account Kit: https://github.com/stellar/stellar-docs/pull/2367
- OpenZeppelin smart accounts: https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account
- OpenZeppelin accounts package: https://github.com/OpenZeppelin/stellar-contracts/tree/main/packages/accounts
- OpenZeppelin Bug Digest #9 (rule-selection fix): https://www.openzeppelin.com/news/the-notorious-bug-digest-9
- OpenZeppelin social recovery issue: https://github.com/OpenZeppelin/stellar-contracts/issues/901
- Community rule checker: https://github.com/bilhokista/rulelens
- CAP-51 (secp256r1): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0051.md
- OpenZeppelin Relayer on Stellar: https://developers.stellar.org/docs/tools/openzeppelin-relayer
- Agent keys with spending limits: https://stellar.org/blog/foundation-news/x402-on-stellar and https://github.com/karagozemin/AgentAllowance

Contract-account payments and ramps:

- Send to and receive from contract accounts: https://developers.stellar.org/docs/build/guides/transactions/send-and-receive-c-accounts
- Smart wallet interoperability gaps: https://github.com/oceans404/smart-wallet-interop
- CAP-72 discussion: https://github.com/orgs/stellar/discussions/1763
- Anchor Platform (SEP-10 and SEP-45): https://developers.stellar.org/docs/platforms/anchor-platform

Passkeys in chat apps and recovery:

- Telegram Mini Apps WebAuthn request: https://github.com/Telegram-Mini-Apps/issues/issues/52
- Passkeys in in-app browsers: https://dev.to/sp0033212000/passkeys-in-in-app-browsers-the-api-is-there-but-it-wont-work-3m9a
- Meridian Pay smart wallet: https://stellar.org/blog/ecosystem/building-meridian-pay-smart-wallet-on-stellar
- Recovery with a waiting period: https://github.com/mhizer-fatai/starlit-pay/pull/3
