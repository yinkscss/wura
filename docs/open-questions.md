# Open questions

These are things still to confirm before, or while, building. None of them are decided.

## Naira partner verification reuse

The naira partner is LINK. The planned naira flow is: verify once, and do not ask again.

It is not confirmed that LINK reuses a verification across later top-ups, and its licence status is unknown. Both are questions to send to LINK (not sent yet).

Until that answer is in, the product should not promise a one-time NIN, and the USDC path should remain the way to start with no ID.

## Routing venues

The first venues to compare are proposed as SDEX, Soroswap and Aquarius. That list is not final. Which venues are actually quoted in the demo, and what happens when one of them cannot be reached, still needs to be decided during implementation.

## Spending limit amounts

The product will have a per-payment cap and a daily cap, and early naira use should start with small-amount trial limits. The actual numbers have not been set.

## What is stored after a naira check

The intent is to store a verified status, not to keep asking for the NIN. Exactly what is stored, where it is stored, and how long it is kept has not been designed yet.

## Product name

The product name is **Wura**. Older design screenshots still show an “Agent” / “name TBD” wordmark; those PNGs have not been re-rendered.

## Site connect

The approach is decided and written up in [Site connect](site-connect.md): allow list first, then scraper / contract discovery as the primary path, WalletConnect as a complement, and a hosted browser only later. What is still open is which first Stellar sites the demo should try, and how much contract verification is realistic in the time available.

## WhatsApp

The plan is written up in [WhatsApp](whatsapp.md): Meta's Cloud API directly, with the free test number for the buildathon. WhatsApp is only the message channel. Wura's AI agent (`handleMessage` with `TOOLS` / `runTool`; rule parser as fallback) understands the request, and Wura's server carries out the swap or payment on Stellar after the user approves. Share linking, dedupe and the card renderer core with the [Telegram bot plan](telegram-bot-plan.md). Still open:

- **Currency policy.** WhatsApp never moves Wura's money, but WhatsApp's Business Policy prohibits a business from using WhatsApp to facilitate the exchange of “real, virtual, or fake currency”, whatever licences it holds. Meta judges what the chat is used for, not where the money settles. It is not confirmed whether Meta will accept Wura's chat being used to request naira and USDC swaps. Ask Meta, or a Business Solution Provider, before using WhatsApp in production.
- **Legal entity.** Which registered business (CAC certificate) verifies with Meta, and whether its name links clearly enough to “Wura” for the display name review.
- **Phone number.** Which dedicated number Wura uses in production. It must not already be on WhatsApp.
- **Demo reach.** The free test number can only message 5 pre-verified phones. Decide whether that is enough for the showcase, or whether a verified number is needed before 4 December.

## Wallet after the buildathon

The buildathon uses Privy. The plan afterwards is Wura's own passkey smart wallet, written up in [Wallet roadmap](wallet-roadmap.md). Still open: whether exchanges and the naira partner can pay to and from `C…` smart-wallet addresses, how recovery works for a lost phone, and Wura's final domain (passkeys are tied to it).
