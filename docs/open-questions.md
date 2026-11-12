# Open questions

These are things still to confirm before, or while, building. None of them are decided.

## Paycrest verification reuse

Paycrest requires a NIN on each order. The planned naira flow is: verify once, store a verified status, and do not ask again.

It is not confirmed that Paycrest allows a verification to be reused across later orders. This needs to be checked in Paycrest's documentation and, if the docs do not say, with Paycrest.

Until that answer is in, the product should not promise a one-time NIN, and the USDC path should remain the way to start with no ID.

## Routing venues

The first venues to compare are proposed as SDEX, Soroswap and Aquarius. That list is not final. Which venues are actually quoted in the demo, and what happens when one of them cannot be reached, still needs to be decided during implementation.

## Spending limit amounts

The product will have a per-payment cap and a daily cap, and early naira use should start with small-amount trial limits. The actual numbers have not been set.

## What is stored after a naira check

The intent is to store a verified status, not to keep asking for the NIN. Exactly what is stored, where it is stored, and how long it is kept has not been designed yet.

## Product name

"Money agent" is the working name used in these docs. The public name, if it is different, has not been chosen.
