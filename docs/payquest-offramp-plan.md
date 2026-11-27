# Paycrest naira off-ramp via a Stellar to Base bridge: plan

Status: research and plan, 27 November 2026. Nothing built. Nothing agreed with Paycrest. (The file name says "payquest" from an earlier typo; it is Paycrest.)

This supersedes the line in [money-side.md](money-side.md) that parks Paycrest because it does not settle on Stellar. The bridge is how it can.

## What Paycrest is (from its [docs](https://docs.paycrest.io/), read 27 November 2026)

- Non-custodial payment routing protocol with on-chain escrow. "Paycrest is not a licensed financial institution." Today a single operator, the "Paycrest Aggregator".
- **Base and USDC are supported** (USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals). Stellar is not listed.
- NGN is an active corridor, bank and mobile.
- **Mainnet only, no sandbox documented.** Minimum test order reported as about $0.50 (from a summarised page, confirm).
- Senders are KYB-verified; **the sender owns end-user KYC and sanctions screening.** Paycrest can put an order on `compliance_hold` for several days.

## API we would call

| Step | Call |
| --- | --- |
| Banks | `GET /v2/institutions/NGN` |
| Name check | `POST /v2/verify-account` `{institution, accountIdentifier}` |
| Rate | `GET /v2/rates/base/USDC/{amount}/NGN`, use `data.sell.rate`. Public. |
| Order | `POST /v2/sender/orders`, header `API-Key`. `source {type:"crypto", currency:"USDC", network:"base", refundAddress}`, `destination {type:"fiat", currency:"NGN", recipient {institution, accountIdentifier, accountName, memo}}`, `reference` = our id. |
| Response | `providerAccount {receiveAddress, amountToTransfer, validUntil, memo?}`. `amountToTransfer = amount + senderFee + transactionFee`. |
| Status | Webhooks `payment_order.{deposited,pending,validated,settling,settled,refunding,refunded,expired,compliance_hold}`, signed `X-Paycrest-Signature` (HMAC-SHA256 of raw body with the API secret). Or poll `GET /v2/sender/orders/:id`. Notify the user at `validated`. |

Paycrest says the median NGN order completes in under 30 seconds from deposit. That is their own figure.

## The design problem, and the answer

Paycrest says: "Send **exactly** `amountToTransfer` ... before `validUntil`." Validity windows in the docs are about 5 to 30 minutes. Over/under-payment handling is documented only for Tron. A bridge cannot promise an exact output or a landing time, so bridging straight to the order's address is fragile.

**Answer: bridge to a Wura-controlled staging address on Base first, create the Paycrest order after the money lands, then send the exact amount.**

1. User asks to cash out ₦X to bank account Y. Wura verifies the account name (`verify-account`) and shows an indicative rate from the rates endpoint.
2. User approves one screen: USDC leaving Stellar, bridge fee, expected naira (shown as an estimate with a floor), bank and name.
3. LI.FI route `xlm USDC` to `base USDC`, tool pinned to `cctp`, `toAddress` = the user's Base staging address. Signed through the existing Privy signer and `money.ts` path (caps, log, kill switch).
4. When LI.FI `/status` is `DONE` and the USDC balance is on Base, create the Paycrest order for the amount actually received. The clock on `validUntil` starts only now.
5. Send exactly `amountToTransfer` from the staging address to `receiveAddress` (needs a little ETH on Base for gas, see below). Re-check the rate against the floor from step 2 before sending; if it fell below, stop and ask the user.
6. Webhook `validated` then `settled`: history entry, done. `refunded` or `expired`: money returns to `refundAddress` = the staging address, and the user is offered a return to Stellar or a retry.

Why this is better than bridging straight to the order: exact amount is under our control, expiry never races the bridge, the rate is fixed only when we can actually pay, and a failed bridge never leaves money at a Paycrest address.

### Staging address

- One Base address per user, derived from the same Privy wallet provider as the Stellar one. Needs a decision: custody and signing on Base is new surface (see `wallet-roadmap.md`, `signer.ts`), and `mainnet-plan.md` D2 conditions would need to cover it.
- Gas: Base sends need ETH. Options: Wura sponsors from a treasury (like the XLM reserve in D1), or a gas-paying paymaster. Cost per cash-out is small, but must be measured.
- Funds sit there only for minutes. Sweep or return anything left over after a timeout.

## Flow that skips the staging hop (later optimisation)

If LI.FI supports an exact-output CCTP route, or Paycrest confirms in writing that a slight overpayment is credited or refunded cleanly, bridge straight to `receiveAddress`. Do not do this until measured.

## Bridge details (LI.FI, from its [Stellar docs](https://docs.li.fi/introduction/stellar-ecosystem))

- "Circle CCTP: USDC transfers out of Stellar to 10 EVM chains, including ... Base." Chain key `xlm`, id `1201081091099710`, request `chainTypes=EVM,STL`. `fromAddress` is a funded `G...` account; token addresses are Soroban `C...` SAC contracts.
- Soroban approvals always expire: submit the approval, wait for it, then request transaction data. Envelope deadline about 5 minutes (40 s for swap-then-bridge). Simulate before submitting.
- Docs give no fee percentages or settlement time and carry no date. Measure.
- Allbridge Core also lists Stellar and Base on CCTP, but sources conflict on whether Stellar is live and there are third-party reports of an August 2026 Base router exploit. Second choice.

## Risks

- **Compliance (biggest).** Wura becomes a KYB'd sender and owns end-user KYC and sanctions screening. Needs an answer on what Wura must collect for an NGN off-ramp, while never storing NIN or BVN (use a hosted check). Paycrest holds can last days, so the UI needs a "held for review" state.
- **Rate risk** between approval and order creation. Show a floor, enforce it before sending.
- **Overpayment and underpayment rules are undocumented** outside Tron. Always send exactly `amountToTransfer`.
- **Refunds land on Base**, not Stellar. Refund timing is not stated. Needs a return-to-Stellar path (CCTP into Stellar exists via Polymer/Allbridge) or a clear "stays as Base USDC" message.
- **Mainnet only, no sandbox.** Everything is tested with real small amounts. The app is on testnet today, so this needs the mainnet mode in `mainnet-plan.md` first.
- **Bridge and order are two steps.** Idempotent state machine keyed by our `reference`, stored in `ramp_transfers`: `quoted, approved, bridging, on_base, order_created, paying, settled | refunded | held | failed`.
- Marketing numbers (30 s, 98.7 %, "zero sender fees") are Paycrest's own.

## Build plan

1. `ramp/paycrest.ts` behind `RAMP_OFFRAMP_PROVIDER=paycrest`, off by default. Typed client for institutions, verify-account, rates, create/get order, webhook signature check, with a mock matching the real shapes.
2. `bridge/lifi.ts`: quote, approval, execute, status; `cctp` pinned; recorded-fixture tests.
3. Base staging wallet and gas sponsorship (decision first).
4. Orchestrator state machine and `/api/funding/paycrest/webhook` route (signature verified over the raw body, idempotent, 2xx fast).
5. Hook into `money.ts` (Olayinka): bridge send and the Base send, both with caps, kill switch, history.
6. Mainnet dry run, about $1: Stellar to Base to Paycrest to a real bank account. Record fees and timings here.

## Built so far (27 November 2026)

Both clients exist, off by default, and are covered by 17 offline tests. Neither has touched the live services.

- `web/src/server/ramp/paycrest.ts`: banks, account-name check, sell rate, create/get order, webhook signature check and parser, and a mock with the same shapes. `createOrder` refuses any order that is not USDC on Base, has a bad or self-referencing deposit address, needs a memo, asks for less than the order or more than 3 USDC of fees on top, or expires in under a minute.
- `web/src/server/bridge/lifi.ts`: quote and status only, never signs. Pins `cctp`, refuses a quote that adds a swap, delivers to another address or token, changes the amount, or guarantees less than the caller's floor. `bridgeLanded()` is the gate before creating the Paycrest order.
- `web/src/server/units.ts`: exact bigint amounts.
- Env vars in `web/.env.example`: `RAMP_OFFRAMP_PROVIDER`, `PAYCREST_API_KEY`, `PAYCREST_API_SECRET`, `LIFI_API_KEY`, `LIFI_STELLAR_USDC`.

Not yet verified against the live APIs (check on the first real $1 run): Paycrest's webhook field names (`id`/`orderId`, `reference`/`paymentReference`), LI.FI's Stellar `transactionRequest` shape, and the Stellar USDC token identifier to pin in `LIFI_STELLAR_USDC`.

Not built: the Base staging wallet, the orchestrator state machine, the webhook route, and the `money.ts` hook (steps 3 to 5 of the build plan).

## To get from Paycrest

1. KYB onboarding at app.paycrest.io; what Wura must collect per end user for NGN off-ramp.
2. Confirm overpayment behaviour, the exact `validUntil` window, refund timing.
3. Whether a testnet or sandbox exists, and the current NGN fee schedule.
4. Written confirmation before we describe them as a partner (rule in `money-side.md`).

## Sources

- [Paycrest docs](https://docs.paycrest.io/), [sender order API](https://docs.paycrest.io/api-reference/sender/initiate-payment-order-v2.md), [supported stablecoins](https://docs.paycrest.io/resources/supported-stablecoins.md), [compliance](https://docs.paycrest.io/concepts/compliance-security.md), [transaction lifecycle](https://docs.paycrest.io/concepts/transaction-lifecycle.md)
- [LI.FI Stellar ecosystem](https://docs.li.fi/introduction/stellar-ecosystem)
- [Allbridge Core docs](https://docs-core.allbridge.io/)
