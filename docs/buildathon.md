# Stellar Buildathon

This project is for the Stellar Buildathon run by [Stellar Nigeria](https://x.com/Stellar_Nigeria).

- Applications close on 21 November 2026.
- Apply at [https://bit.ly/stellar-buildathon](https://bit.ly/stellar-buildathon).
- Source announcement: [Stellar Nigeria on X](https://x.com/Stellar_Nigeria/status/2120474795737321758).

No application has been submitted from this repository yet. This file is the working scope for that application, not a submitted form.

## Scope

For the buildathon, the demo should show three skills working end to end, plus the safety features in plain sight:

1. Swap naira to USDC and USDC back to naira, at the best rate the routing layer can find.
2. Send or pay someone.
3. Create a payment link, and check balances.

Visible safety, not a hidden setting:

- A quote with the exact rate, shown before anything is sent
- The user has to approve before the agent acts
- Per-payment and daily spending limits
- A transaction log

Trading, small-business or SEO skills are not in this scope.

## Demo flow

A judge or reviewer should be able to follow this path:

1. Fund the agent with USDC, with no ID check.
2. Top up naira, with a one-time verification if the on-ramp requires it.
3. Ask the agent to swap or pay.
4. See a side-by-side rate comparison and a clear quote.
5. Approve.
6. Watch the agent swap and pay, then see the result in the log.

If Paycrest will not reuse a verification in time for the demo, say that honestly and keep the USDC path as the path that needs no ID. Do not show a one-time naira check the product cannot actually honour.

## Why this, and not GoodBuildit, for Stellar

GoodBuildit stays the Celo / GoodBuilders Season 5 pitch. It should not be reused as a Stellar Buildathon entry. That would be a double pitch of the same product on two networks, and Stellar is not core to GoodBuildit.

Stellar is core here. The agent routes across Stellar venues, moves USDC on Stellar, and is being designed for this buildathon as a Stellar product. The two funding pitches should not overlap.
