# Wura

A smart wallet you chat with, which changes your money, moves it and pays people for you, safely and at the best rate, wherever you already chat.

## Status

Documentation, interface mockups, and a first web app preview in [`web/`](web/README.md) that runs in mock mode. Nothing is live. There are no users, no revenue and no real transactions.

This repository is the product write-up for a [Stellar Nigeria Buildathon](https://bit.ly/stellar-buildathon) application. Applications close on 21 November 2026. Do not treat anything here as a live product.

The product name is **Wura**. Older design screenshots still show an “Agent” / “name TBD” wordmark; those PNGs have not been re-rendered.

## Documents

- [Concept](docs/concept.md) — what it is and how it should work
- [Routing](docs/routing.md) — how Wura compares rates across Stellar venues
- [KYC and funding](docs/kyc-and-funding.md) — naira and USDC funding, and identity checks
- [Money side](docs/money-side.md) — who owns which money files, working rules, and the naira partner findings
- [Auth](docs/auth.md) — email sign-in mapped to a Stellar address (Privy for the buildathon)
- [Wallet roadmap](docs/wallet-roadmap.md) — Privy now; Wura's own passkey smart wallet with on-chain limits next
- [Site connect](docs/site-connect.md) — connect to other blockchain sites (allow list, contract discovery, later browser option)
- [WhatsApp](docs/whatsapp.md) — message channel only; shared linking/renderer with Telegram; provider, costs, currency-policy risk
- [Competitors](docs/competitors.md) — who is already close, and where this can stand out
- [Buildathon](docs/buildathon.md) — application scope, demo plan, and why this project
- [Buildathon application draft](docs/buildathon-application.md) — drafted form answers; not submitted
- [Open questions](docs/open-questions.md) — things still to confirm before building
- [Claude build prompt](docs/claude-build-prompt.md) — copy-paste prompt to build or update the web app pages
- [Interface designs](design/README.md) — style guide and mockup screenshots
- [Web app](web/README.md) — Next.js preview app: how to run it locally and deploy to Vercel
