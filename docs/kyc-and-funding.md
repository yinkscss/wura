# KYC and funding

Users can fund the agent with naira or with USDC. The hard part is naira: the naira partner, LINK (a Stellar anchor), requires an identity check, and we do not want people to type a NIN in every time. We also will not bypass KYC.

## The problem

The partner requires an identity check. With a live partner it happens on the partner's own hosted page, so Wura never sees or stores the NIN or BVN. Typing an identity number again and again is a real friction point for a chat-based assistant, especially on WhatsApp or Telegram, where repeating an identity number for every top-up is painful and easy to get wrong.

## The approach

Do not bypass KYC. Identity checks that the on-ramp requires still happen.

Instead, split funding and reuse verification where we can:

- **USDC funding needs no ID.** Someone who already holds USDC can start, swap, send and check balances without submitting a NIN.
- **Verify once for naira, then store the verified status** so the user is not asked again for later naira top-ups. (In mock mode Wura records that the check passed. With the live partner the check happens on its page and the partner holds it.)
- **Start with small-amount trial limits** while this is new, so early use stays bounded.

Storing a verified status is not the same as storing the NIN itself. The aim is to remember that this user has already been checked, not to collect the number over and over in chat.

## Open question: does LINK reuse a verification?

It is not yet confirmed that LINK will accept a one-time verification and apply it to later top-ups, or what its page asks for. That is one of the questions to send to LINK (see [Money side](money-side.md)).

Until that is confirmed:

- Do not promise users that they will only ever enter a NIN once.
- Do not design the naira flow as if reuse is already guaranteed.
- Keep the USDC path available so people can use the agent without a NIN if they fund in stablecoin.

See also [Open questions](open-questions.md).
