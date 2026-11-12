# KYC and funding

Users can fund the agent with naira or with USDC. The hard part is naira: Paycrest, which we would use for on-ramping with our own API key, asks for a NIN on each order. We do not want people to type that in every time. We also will not bypass KYC.

## The problem

Paycrest requires a NIN on each order. That is a real friction point for a chat-based assistant, especially on WhatsApp or Telegram, where repeating an identity number for every top-up is painful and easy to get wrong.

## The approach

Do not bypass KYC. Identity checks that the on-ramp requires still happen.

Instead, split funding and reuse verification where we can:

- **USDC funding needs no ID.** Someone who already holds USDC can start, swap, send and check balances without submitting a NIN.
- **Verify NIN once for naira, then store the verified status** so the user is not asked again for later naira top-ups.
- **Start with small-amount trial limits** while this is new, so early use stays bounded.

Storing a verified status is not the same as storing the NIN itself. The aim is to remember that this user has already been checked, not to collect the number over and over in chat.

## Open question: can Paycrest reuse a verification?

It is not yet confirmed that Paycrest will accept a one-time verification and apply it to later orders. That has to be checked in Paycrest's own docs and, if the docs are unclear, with Paycrest directly.

Until that is confirmed:

- Do not promise users that they will only ever enter a NIN once.
- Do not design the naira flow as if reuse is already guaranteed.
- Keep the USDC path available so people can use the agent without a NIN if they fund in stablecoin.

See also [Open questions](open-questions.md).
