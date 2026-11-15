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

## Wallet after the buildathon

The buildathon uses Privy. The plan afterwards is Wura's own passkey smart wallet, written up in [Wallet roadmap](wallet-roadmap.md). Still open: whether exchanges and the naira partner can pay to and from `C…` smart-wallet addresses, how recovery works for a lost phone, and Wura's final domain (passkeys are tied to it).
