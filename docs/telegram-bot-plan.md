# Telegram bot integration plan

Status: plan only. Nothing in the Telegram bot is built. It follows the code as of `main` (chat brain in `web/src/server/agent.ts`, tools in `web/src/server/tools.ts`, money flow in `web/src/server/money.ts`, chat entry points in `web/src/server/channel.ts`). Updated after review and after the chat agent key landed (PR #13).

## What we found in the codebase

- **One brain, already channel-neutral.** `handleMessage(session, message, history)` in `agent.ts` returns `{ text, card? }`. `tools.ts` says outright that the Telegram bot and MCP server can reuse `TOOLS` and `runTool`. Tools only *prepare* things (quotes, send previews, links, balance). None of them moves money.
- **Approval is a separate step.** Money moves only through `approveSwap` and `createSend` in `money.ts` (HTTP: `/api/swap/approve`, `/api/send/confirm`). Both re-check caps, balance and expiry on the server. For chat channels, `web/src/server/channel.ts` wraps them: `approveSendFromChat(session, intentId)`, `approveSwapFromChat(session, quoteId)`, plus `cancelSend` and `cancelQuote`. The bot calls these, not the web routes.
- **Identity is a web session.** `Session = { userId, email, address }`, a JWT cookie (`session.ts`). The API routes use `authed()` / `signedIn()` from `route.ts`. Telegram has no cookie, so we need a way to map a Telegram user to a `Session`.
- **Wallet state is per `userId`.** `withWallet(userId, fn)` in `store.ts` locks and saves one user's wallet (Postgres, or memory without `DATABASE_URL`). Bot handlers must use it exactly as the web routes do.
- **Signing from chat is solved on testnet.** `channel.ts` documents the rule: call each function inside `withWallet(session.userId, …)` and only after the linked user tapped the button for that exact quote or preview, never from free text. They never return `needs_signature`.
  - Mock mode: `signer.ts` fakes it.
  - Testnet + `TESTNET_SIGNER=server-dev`: the server holds a throwaway key per email.
  - Testnet + Privy: sends are signed by a per-user **agent key** (weights: user 2, agent 1; thresholds 1/1/2). The user turns it on once on the Channels page ("Approve from chat apps"), and their Privy wallet signs adding it as a second signer. The agent key can pay but cannot change signers or merge the account. If it is off, the call throws `ApiFailure` with code `CHAT_APPROVAL_OFF` and a message to show the user. See "Chat approvals on testnet" in `docs/auth.md`.
  - Swaps are still refused on testnet (`SIGNING_UNAVAILABLE`); `approveSwapFromChat` passes that through.
  - `/api/dev/chat-approve` stands in for the Approve button in local testing. It only works with `ALLOW_DEV_ROUTES=1` and is never on Vercel.
- **History is client-sent.** The web chat sends the last turns with each request. The bot has to keep its own short history per chat.
- **Cards are web-only.** `AgentCard` (quote, send, link, balance, rates, refused, site-permission, site-action) renders as React. The bot needs a text renderer with inline buttons.
- **Placeholders already exist.** `/channels` page says Telegram "isn't connected yet"; the Channels page also has the "Approve from chat apps" switch for the agent key.

## Design

```
Telegram ──webhook──▶ POST /api/telegram/webhook
                         │ verify secret header, dedupe update_id
                         │ resolve telegram user → Session (link table)
                         ▼
                 handleMessage(session, text, history)   ← unchanged
                         │ { text, card }
                         ▼
                 render card → message + inline keyboard
Button tap (callback_query) ─▶ approveSwap / createSend / cancel*  (same server checks)
```

Use the Next.js route handler as a webhook (fits Vercel; no long-running process). Call the Bot API with plain `fetch`, or `grammy` if we want helpers. Decide at build time; plain `fetch` avoids a dependency and we need only `sendMessage`, `editMessageText`, `answerCallbackQuery`.

### Linking a Telegram account (v1)

1. Signed-in user opens `/channels` and clicks "Connect Telegram". Linking is only offered once the user has a wallet address. Server creates a single-use, 10-minute link code (random, stored hashed with `userId`).
2. The page shows a deep link `https://t.me/<bot>?start=<code>`.
3. Bot receives `/start <code>`, validates and consumes it, stores `telegram_user_id ↔ userId (+ email, address)`.
4. From then on, the webhook looks up the user's **current** email and address by `user_id` and builds the `Session` from that. Nothing but `user_id` is copied into the Telegram tables, so it cannot go stale. Unlinked users only get "Connect from the Wura web app".
5. `/unlink` in Telegram and a "Disconnect" button on `/channels` delete the row.

Only private chats are served; ignore groups and channels.

### Storage

New table in `db.ts` `SCHEMA` (idempotent, like the others):

- `telegram_links(telegram_user_id bigint pk, user_id text, created_at)`
- `telegram_link_codes(code_hash text pk, user_id text, expires_at)`
- `telegram_rate(telegram_user_id bigint, window_start timestamptz, count int)` for the per-user rate limit
- `telegram_updates(update_id bigint pk, at)` for dedupe (prune after a day)
- Short chat history in Postgres: a small jsonb column on the link row (last ~8 turns, same limits as `HISTORY_TURNS`).

On Vercel, in-memory counters and history only cover one instance, so the 20 messages/min limit and the history must live in Postgres. Only without `DATABASE_URL` (demo) fall back to in-memory maps on `globalThis`, the same pattern as `store.ts`.

### Safety rules (non-negotiable, match the web)

- Webhook auth: Telegram's `X-Telegram-Bot-Api-Secret-Token` compared in constant time against `TELEGRAM_WEBHOOK_SECRET`. Reject anything else with 401.
- Approval only by button tap (`callback_query`) from the linked Telegram user, never by free text like "yes". Callback data carries only an action and an id (`ap:q_xxx`), looked up server-side; the quote or intent must belong to that user's wallet.
- Callback handlers call `approveSendFromChat` / `approveSwapFromChat` inside `withWallet(session.userId, …)`, where `session` comes from the linked Telegram user, so another user's intent id is simply not found.
- Buttons are single use: after a tap, edit the message to remove the keyboard. `approveSwap` / `createSend` already reject reuse and expired quotes (`ALREADY_USED`, `QUOTE_EXPIRED`).
- Limits, balance and expiry are re-checked in `money.ts`, not in the bot.
- Telegram text is untrusted input, same as web chat: 500-char cap, history trimmed to 600 chars/turn.
- Never log message bodies, addresses or tokens. Bot token only in env.
- Rate limit per Telegram user (e.g. 20 messages/min, stored in Postgres) so a loop can't burn the model budget.
- Respond 200 to Telegram quickly. Model calls can take up to 35s (`DEADLINE_MS`); on Vercel use `after()` / background work so Telegram doesn't retry the update. Dedupe by `update_id` covers retries anyway.

### Money movement per mode

| Mode | Swap/send from Telegram |
|---|---|
| mock | Works end to end (fake signer). |
| testnet + server-dev | Sends work; the server signs with the throwaway key. Dev/demo only. |
| testnet + Privy | Sends work once the user has turned on chat approvals (agent key). If not, reply with the `CHAT_APPROVAL_OFF` message, which tells them to turn it on in Wura on the web. |
| testnet, any signer | Swaps are refused (`SIGNING_UNAVAILABLE`); show that message. |

The bot never holds an unscoped key. Caps are checked by Wura's server before every chat payment; on-chain caps come with the passkey smart wallet (`docs/wallet-roadmap.md`).

### Rendering cards in Telegram

A small `web/src/server/telegram/render.ts` maps each `AgentCard` to `{ text, keyboard }` (plain text or MarkdownV2 with escaping; pick plain text first to avoid escaping bugs):

| Card | Telegram output |
|---|---|
| `rates` | Venue list, best marked. No buttons. |
| `quote` | You pay / you get / venue / rate / market check, expires in 60s. Buttons: Approve, Cancel. |
| `send` | To, amount, fee, total, remaining today. Buttons: Confirm, Cancel. |
| `link` | Amount and URL. |
| `balance` | Balances and remaining limits. |
| `refused` | Reason in plain words. |
| `site-permission` / `site-action` | Allow / Not now, and Approve / Cancel. Same server routes as web. |

Quotes expire in 60s: on tap after expiry, edit the message to "That quote expired. Ask me again."

## File layout (proposed)

```
web/src/app/api/telegram/webhook/route.ts    POST: verify, dedupe, dispatch
web/src/app/api/telegram/link/route.ts       POST (authed): create link code; DELETE: unlink
web/src/server/telegram/api.ts               tiny Bot API client (sendMessage, edit, answerCallbackQuery)
web/src/server/telegram/links.ts             link codes, user mapping, rate limit, history (Postgres; memory only for the demo)
web/src/server/telegram/handler.ts           update → session → handleMessage / callback actions
web/src/server/telegram/render.ts            AgentCard → text + inline keyboard
web/scripts/telegram-webhook.mjs             one-off: setWebhook / deleteWebhook / getWebhookInfo
```

Changes to existing files:

- `config.ts` (shared file, see below): `telegram = { token, webhookSecret, botUsername }`, enabled only when all set.
- `db.ts`: add the tables above.
- `channels/page.tsx` and `wallet-parts.tsx` (`ConnectedApps`): live "Connect Telegram" / "Connected" state instead of the "not connected" copy.
- `types.ts`: nothing needed; `/api/me` could return `telegramLinked` for the UI.
- `.env.example` (and `web/README.md`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`.
- `channel.ts`: no change; the Telegram handler is its first caller.
- `agent.ts`: tiny refactor only if needed, e.g. let the system prompt say "Telegram" (no markdown, short replies already suit it). No change to tools.

### Shared files

`config.ts`, `.env.example` and the READMEs are on the shared-files list in `docs/money-side.md`. Give a heads-up in the team chat before editing them, and keep those changes small.

## Phases

1. **Plumbing (mock mode).** Config, webhook route with secret check and dedupe, Bot API client, `/start`, unlinked reply, echo through `handleMessage`. Webhook script. Test with a BotFather bot and a tunnel (cloudflared / ngrok).
2. **Linking.** Link codes, `/api/telegram/link`, Channels page UI, `/unlink`. Tests: expired code, reused code, wrong user.
3. **Cards and approvals.** `render.ts`, inline keyboards, callback handling for swap approve/cancel and send confirm/cancel, keyboard cleanup, expiry messaging. Mock mode end to end.
4. **Hardening.** Rate limit, history store, error replies ("something went wrong, try again"), logging without content, group-chat ignore, `/help`, `/balance`.
5. **Testnet.** Test with a real linked user, both with chat approvals on (the send is approved and signed by the agent key) and with them off (the bot shows the `CHAT_APPROVAL_OFF` message). Also check server-dev signing.

## Test plan

- Unit: card renderer for every `AgentCard` variant; callback-data parsing; link-code lifecycle; webhook secret check (missing, wrong, right); dedupe on repeated `update_id`.
- Integration (mock mode, no Telegram): post fixture updates to the route; assert replies via a stubbed Bot API client.
- Safety: free-text "approve it" never approves; a callback for an intent or quote that belongs to another user is refused; double tap approves once; expired quote refuses; over-limit send is refused by `money.ts` through the bot; approving after chat approvals were turned off is refused (`CHAT_APPROVAL_OFF`).
- Manual: real bot with a tunnel on iPhone and Android; link, ask a rate, prepare a swap, approve, cancel, let a quote expire, unlink.
- `npm run lint` and `npm run build` pass; no new secrets in the client bundle (all Telegram code is under `server/`, which imports `server-only`).

## Open questions

- **Webhook vs long polling.** Webhook assumed (Vercel). Local dev can use a tunnel or a polling script.
- **Hosting limits.** A model turn can take 35s; confirm background execution (`after()`) is enough on our Vercel plan, or answer "thinking…" first and edit the message.
- **Bot identity.** Bot name and username to register with BotFather; who owns the token.
- **Privacy.** Storing `telegram_user_id` alongside email: add a line to the privacy copy and the `/unlink` guarantee (delete on disconnect).
- **KYC copy.** Telegram users who need a naira top-up still go through the one-time web check (`docs/kyc-and-funding.md`); the bot should link out, not collect a NIN in chat.
