# Concept

**Wura** is a money assistant you chat with. You fund it, tell it what you want in ordinary language, and it changes your money, moves it and pays people for you — safely, and at the best rate it can find.

It should work in the places you already chat: Claude and ChatGPT (as an MCP server or app), Telegram and WhatsApp. It is the same assistant in all four, not a different product on each channel.

Nothing described here is live. A first web preview in mock mode lives in this repository. There are no users, no revenue and no real transactions.

## What it does

Users fund Wura in two ways:

- Naira, through on-ramping. The first partner is LINK, a Stellar anchor that needs no API key.
- USDC, sent as a stablecoin. This does not need an ID check to start.

Once funded, a user can ask Wura to:

- Swap naira to USDC and USDC back to naira
- Pay or send money to someone
- Create a payment link
- Check balances
- Ask for the best rate before doing anything

## Example commands

These are the kinds of things a user should be able to say, in their own words:

- Change ₦50,000 to dollars
- Send $20 to Tunde
- Make a payment link for ₦15,000
- What's my balance?
- What's the best rate right now?

The wording does not have to be exact. Wura should understand the intent, then show a clear quote before it acts.

## Safety

Wura does not move money the moment it understands a request.

1. It looks up the rate and cost.
2. It shows a preview: what will happen, the rate, the amount, the destination and any fees it knows about.
3. It waits for the user to approve.
4. Only then does it act.
5. It writes the result to a transaction log the user can review.

There are also spending limits: a cap on a single payment, and a cap on what can be spent in a day. If a request would go over a limit, Wura should stop and say so, not try to send it.

How identity checks work when someone funds with naira is covered in [KYC and funding](kyc-and-funding.md). How the quoted rate is chosen is covered in [Routing](routing.md). Connecting to other blockchain sites is covered in [Site connect](site-connect.md).

## Later skills (roadmap only)

The first version is a money assistant: swap, send, payment links, balances and a best-rate quote.

A scoped stretch skill, described in [Site connect](site-connect.md), is connecting to other Stellar sites when you ask — after an allow-list question, by discovering the contract and simulating the transaction, then signing only once you approve. That is not one of the three core demo skills.

Other skills — trading, help for small businesses, SEO and the like — are later ideas only. They are not part of the buildathon scope and should not be promised in a demo.
