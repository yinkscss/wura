# Competitors

A chat-based money assistant is not a new idea. A scan of live products found about seven that are doing something close in Nigeria, plus about 15 to 20 more that overlap in parts — AI wallets, agent payment tools, or Stellar tooling for agents.

Nobody found in that scan was doing the full combination this project is aiming for. That is a product gap, not traction. This project has not been built, and it has no users.

The notes below are from that scan. They are not a claim that every feature on those sites was independently re-tested.

## Closest: Nigeria chat bots that already move naira and stablecoins

These are the most direct comparisons. Most live on WhatsApp or Telegram. Almost every Nigerian bot in this set asks for a BVN or NIN up front.

- **[Chainpaye](https://chainpaye.com/)** is the closest overall. It is a WhatsApp AI agent that sends, converts and makes payment links in naira and USDC, and it already runs on Stellar. It asks for a BVN at sign-up. In a buildathon pitch, this is the competitor to name first.
- **[Saly AI](https://www.salypay.com/)** works on WhatsApp and Telegram for naira payments, crypto swaps and bills, and asks for a passcode before every move.
- **[Tella](https://www.tella.cash/)** works on WhatsApp and Telegram for USDC, with cash-out to naira. Most actions need a confirmation.
- **[Sendra](https://www.usesendra.com/)**, **[Azza](https://useazza.com/)** and **[Obba](https://obba.dayfi.co/)** are WhatsApp stablecoin wallets with naira cash-out. Azza won Stellar Community Fund award #44; its site did not list Stellar at the time of the scan.
- **[SwiftyEx](https://www.swiftyxbot.com/)** is a Telegram bot that locks your rate for 60 seconds and waits for you to confirm.

Narrower products in the same neighbourhood, worth knowing but not the same shape of assistant:

- [Cash-in](https://cash-in.app/)
- [Zend](https://t.me/zend_money_bot)
- [Fonbnk](https://fonbnk.com/)

## Adjacent: AI wallets and agent payment tools

This side is busy, but the products checked here do not touch naira.

- [Coinbase Payments MCP](https://github.com/coinbase/payments-mcp) gives Claude a USDC wallet with spending limits. [Coinbase AgentKit](https://github.com/coinbase/agentkit) is the broader agent-wallet toolkit.
- [ROZO](https://rozo.ai/) lets Claude and ChatGPT pay with Stellar USDC.
- [Bankr](https://bankr.bot/) is mostly for trading.
- Other agent-wallet or agent-payment tools in the same wider space: [Crossmint agent wallets](https://docs.crossmint.com/agents/wallets/overview) (including Lobster), [Skyfire](https://docs.skyfire.xyz/docs/platform-structure), [Payman](https://paymanai.com/), [Stripe agent tools](https://docs.stripe.com/agents), [Wayfinder](https://wayfinder.ai/), [HeyAnon](https://heyanon.ai/) and [Griffain](https://griffain.com/).

## Stellar tooling for agents

These help developers let AI agents pay for things on Stellar. They are not consumer money apps for naira and USDC in chat.

- [x402 on Stellar](https://developers.stellar.org/docs/build/agentic-payments/x402)
- [Vellar](https://docs.vellar.xyz/docs/agent-tooling/mcp-payer)
- [Rail402](https://docs.rail402.dev/agents/mcp-server)
- [STELLARSIGHT](https://docs.stellarsight.xyz/guides/agent)
- [LumenBazaar](https://lumenbazaar-docs.vercel.app/guides/agent-guide)

## Where this can stand out

Four things together are the opening, not any one of them on its own:

1. **The same naira and USDC assistant inside Claude and ChatGPT as well as on WhatsApp and Telegram.** The Nigerian bots above live in chat apps. The AI-wallet tools live in Claude or ChatGPT. Nobody checked in the scan did both, with naira and USDC, as one product.
2. **Cross-venue best-rate routing.** The agent's own routing layer compares rates across Stellar venues and picks the best. None of the consumer products above said they compare prices across exchanges.
3. **Approve-before-act, per-payment and daily limits, and a transaction log, as one consumer product.** Some bots already confirm or use a passcode. The aim here is to ship the quote, the approval, the limits and the log together, in the same assistant people actually chat with.
4. **USDC with no ID, and one-time naira verification.** Almost every Nigerian bot in the scan asks for a BVN or NIN up front. People who already hold USDC should be able to start without ID. Naira users should verify once, if the on-ramp allows that verification to be reused.

Those four points are the lead for the buildathon pitch, with Chainpaye named as the closest competitor.
