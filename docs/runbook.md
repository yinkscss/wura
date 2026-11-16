# Runbook (M8)

For whoever is on call. Short on purpose. Fill the two blanks marked **TODO** before Stage 3.

## 1. Turn money off

1. Vercel, Settings, Environment Variables: set `MONEY_KILL` to `1` for **Production**.
2. Redeploy Production (Deployments, the latest one, Redeploy). Environment changes only apply to new deployments.
3. Check: a send now answers "Payments are paused right now. Nothing was sent." (`MONEY_PAUSED`). Wallets, balances and the log still work. Payment links already made can still be paid by outsiders, because that money goes straight to the creator's wallet; the page keeps working.

Turn it back on by deleting `MONEY_KILL` (or setting `0`) and redeploying. Do the on/off test once on purpose before the beta (Stage 4).

## 2. Read a stuck transfer

An alert says `stuck_transfer` or `submit_unconfirmed`, with the first 12 characters of a transaction hash. Meaning: the user signed and we submitted, but Horizon never told us whether it landed.

1. Find the full hash: Activity log row for that user, or the logs line `[ALERT] ...`.
2. Open `https://stellar.expert/explorer/public/tx/<hash>` (testnet: `/explorer/testnet/tx/`). Three outcomes:
   - **Found, successful:** it landed. The user can open the app and approve again; the same signed transaction is sent again, Horizon says it already exists, and the log row is written. Nothing is paid twice.
   - **Found, failed:** it did not move money. The reason is on the page (for example no trustline or not enough balance). Tell the user.
   - **Not found after 10+ minutes:** the transaction timed out (every one carries a time bound) and can never land. The user can start a new payment.
3. Never build a second payment for the same thing until step 2 says "not found" or "failed".

`GET /api/cron/ops` (see section 4) returns `stuckSubmits`, the count of these older than 10 minutes.

## 3. Cash in and cash out

- A cash-out's payment shows in the log as "Sent to the partner for your cash-out". Reconcile adds "Cash-out paid to your bank account" when the partner pays the bank.
- The claim on the cash-out's `ramp_transfers` row (`stellar_tx_id`, written before submit) blocks a second payment for the same cash-out, even after a timeout mid-submit. If a cash-out is stuck claimed by a payment that never landed, the user starts a new cash-out. An unconfirmed submit is retried with the same signed transaction; it is never approved again.

A partner transfer older than about a day cannot be re-checked automatically (the partner sign-in lasts about a day). Reconcile flags it for a person. Ask the user for the partner reference, then ask LINK.

Who to call at LINK: **TODO** (name, channel, hours). What to give them: the user's wallet address, the Stellar transaction hash, the amount, the time.

## 4. Alerts and health

- Every alert is a log line starting `[ALERT]` and, if `ALERT_WEBHOOK_URL` is set (https, Slack or Discord compatible), a message to that channel. The same alert repeats at most every 10 minutes.
- Kinds: `submit_failed`, `submit_unconfirmed`, `horizon_error`, `stuck_transfer`, `treasury_low`, `link_watcher_failed`, `rate_limited`.
- Scheduled jobs run on cron-job.org; the list, and what to do when they answer 404, is in `docs/environments.md` under "Scheduled jobs". cron-job.org emails Olayinka when a job keeps failing.
- `GET /api/funding/reconcile` (every 5 minutes) brings naira top-ups and cash-outs in step with the partner. Its answer has `stuck.cashoutsInProgress`: cash-outs the partner was already working on and that have been open over a day. Money may have left the wallet, so each one needs a person (section 3). It does not raise an alert yet.
- `GET /api/cron/ops` (every 5 minutes) returns mode, whether the kill switch is on, the treasury (free XLM, floor, sponsored accounts) and the stuck count, and raises `treasury_low` and `stuck_transfer`.
- **Treasury low:** send XLM to the address in the alert. The floor is `TREASURY_MIN_XLM` (default 20). Below it, new wallet setups are refused; existing users are not affected.

## 5. Limits and who is in

- `BETA_ALLOWLIST`: comma-separated emails. Empty means nobody on mainnet. A person not on the list is refused (`NOT_INVITED`) on setup, previews, approvals and links.
- Caps: `CAP_PERCENT` (1 to 100) scales the example caps (₦75,000 and $50 per payment, ₦200,000 and $200 a day). Unset means 25% on mainnet (₦18,750 and $12 per payment, ₦50,000 and $50 a day). It can only lower them. Raise it deliberately after the first week.
- Claude and ChatGPT connections: 60 requests a minute per connection and 120 a minute per user, then HTTP 429.

## 6. Database backups

Production Postgres holds the only copy of balances' records, the log and payment links. Before Stage 3: turn on point-in-time recovery or daily backups in the database provider (Neon: Settings, Backups / restore window), then do one restore into a scratch database and open the app against it to prove it works. **TODO:** note the provider and the restore window here.
