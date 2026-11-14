# Claude connector plan (remote MCP server)

Status: plan only. Nothing here is built. It follows `main` as of 14 Nov 2026 (tools in `web/src/server/tools.ts`, chat entry points in `web/src/server/channel.ts`, chat approvals in `web/src/server/agent-key.ts`, favourites in `money.ts`). Research was done the same day; sources are at the end.

**Goal:** someone opens Claude (web, desktop or phone), says "send $5 to Isaac" or "what's the best rate for ₦50k?", and gets the same Wura: real previews, the same limits, and money that moves only when they tap Approve themselves. The same server should also work in ChatGPT.

## Key facts that shape the design

- **Custom connector, not a directory listing.** Claude's Connectors Directory review criteria exclude financial transfers, so Wura is added by URL as a **custom connector**. Custom connectors are available on Free, Pro, Max, Team and Enterprise. Free users can add only one. Don't apply for a listing.
- **Claude is the brain here, not Wura's chat brain.** Over MCP, Claude reads the message and calls our tools directly. Wura's system prompt and model settings don't apply. What Claude needs to know has to be in the tool descriptions and tool results.
- **Tools are model-controlled.** Claude asks before each tool call, but the user can pick "Allow always", and a web page Claude reads can try to inject instructions. So **no tool that Claude can call is allowed to approve or move money.** This is the same rule as the web chat.
- **Auth is OAuth.** Claude connects with OAuth 2.1, registering itself via Dynamic Client Registration (DCR), and uses the callback `https://claude.ai/api/mcp/auth_callback`. ChatGPT also accepts DCR; it prefers Client ID Metadata Documents (CIMD). Claude follows the 2025-03-26, 2025-06-18 and 2025-11-25 authorization specs.
- **Transport.** Streamable HTTP at one public HTTPS endpoint on port 443: `https://<domain>/mcp`. The latest spec (2026-07-28) drops protocol sessions, so run it stateless. Claude calls from Anthropic's cloud, so the server must be public. Tool calls time out after 240 s, and results are capped at about 150,000 characters.
- **In-chat UI is possible but unproven for money.** MCP Apps (a stable extension; Claude supports it) can show a card in the chat. The spec has app-only tools (`_meta.ui.visibility: ["app"]`), which hosts MUST hide from the model, but Claude's docs don't mention that field. They do say the app's own server calls skip the approval prompt. So an in-chat Approve button is a stretch goal behind a spike, not the baseline.

## Approval: link first, in-chat button as a stretch

**Baseline (works everywhere):**
1. `prepare_send` / `prepare_swap` return the preview plus an approval link: `https://<domain>/approve/<id>`.
2. The user taps it. Wura opens in their browser. They sign in if needed, and the existing confirm flow runs: the Privy wallet signs in the browser, and the server re-checks and submits. This doesn't need chat approvals (the agent key).
3. The page shows the same card as the web chat. Back in Claude, the user can say "did it go through?", and `get_activity` answers.

Rules for the approval page:
- The link never signs anyone in: no token in the URL. It only works for the signed-in owner of the preview. Anyone else sees "Sign in as the account that asked for this".
- Previews expire after 60 s (`quoteTtlMs`), which is shorter than opening a browser and signing in. If the preview has expired, the page **rebuilds it** from the stored recipient and amount, runs fresh checks (limits, balance, rate) and shows the new numbers. It never approves stale numbers.
- One approval per preview. Swaps on testnet still say they aren't live yet.

**Stretch (in-chat Approve, Claude only, after the spike):**
- An MCP App card for previews, with an Approve button that calls an app-only tool (`visibility: ["app"]`) carrying a one-time approval code from the result's `_meta`.
- It signs with the **agent key** (`approveSendFromChat`), so it needs chat approvals on, because Privy can't sign inside Claude's sandboxed iframe.
- Only ship it if the spike shows that Claude:
  1. leaves the app-only tool out of the model's tool list;
  2. can't be talked into calling it;
  3. keeps `_meta` out of the model's view.

  Otherwise keep link-only.

## Auth design (Wura is its own OAuth server)

Endpoints, all on the app's domain:
- `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`: RFC 9728 protected-resource metadata pointing at our authorization server.
- `/.well-known/oauth-authorization-server`: RFC 8414 metadata.
- `/oauth/register`: DCR. Allow only known redirect URIs:
  - `https://claude.ai/api/mcp/auth_callback`;
  - ChatGPT's `https://chatgpt.com/connector_platform_oauth_redirect` and `https://chatgpt.com/connector/oauth/*`;
  - loopback, for Claude Code and local tests.

  Store the client and its `client_name`.
- `/oauth/authorize`: requires a Wura web session (Privy email sign-in, or mock in mock mode), then a **consent page**. The page shows:
  - the client name **and the redirect host**, since anyone can register a client called "Claude";
  - what it can do: "check balances and rates, prepare sends, swaps and payment links, manage favourites";
  - what it can't: "move money without your tap in Wura".
- `/oauth/token`: authorization code with PKCE S256 (required), refresh with rotation. The `resource` parameter must equal `https://<domain>/mcp`, and tokens are bound to that audience.
- Tokens are opaque random strings, stored hashed in Postgres with user, client, scopes and expiry, so they can be revoked. Access tokens last about 1 hour; refresh tokens about 30 days.
- Scopes: `wura.read` (balances, rates, activity, favourites) and `wura.prepare` (previews, payment links, saving favourites).
- `/mcp` without a valid token returns 401 with `WWW-Authenticate: Bearer resource_metadata="…"`. A missing scope returns 403 `insufficient_scope`. Tokens from anywhere else are never accepted or passed on.
- **Channels page:** a "Connected apps" list (client, scopes, last used) with **Revoke**.

New tables (in `db.ts`, idempotent like the others; in-memory fallback for the no-`DATABASE_URL` demo):
- `users(user_id pk, email, address, updated_at)`. **Shared with the Telegram plan (phase 1).** Agree who builds it as one small PR before either side starts.
- `oauth_clients(client_id pk, client_name, redirect_uris, created_at)`
- `oauth_codes(code_hash pk, client_id, user_id, redirect_uri, code_challenge, scopes, resource, expires_at)`
- `oauth_tokens(token_hash pk, kind access|refresh, client_id, user_id, scopes, resource, expires_at, revoked_at, last_used_at)`

## MCP server

- Route `web/src/app/mcp/route.ts` (POST only; GET/DELETE return 405), stateless Streamable HTTP.
- Library:
  - `@modelcontextprotocol/sdk` (1.32.x) directly, or Vercel's `mcp-handler` (2.4.x) on top of it.
  - Check `node_modules/next/dist/docs` for route handlers under `cacheComponents` first (AGENTS.md).
  - Set `maxDuration = 60`.
- **Session:**
  - Validate the token, then load `users` by `user_id` to build `Session { userId, email, address }`.
  - Don't wrap the tool call in `withWallet`: `runTool` already locks the wallet, and an outer lock on the same row would deadlock.
- **Origin:** validate the `Origin` header when present (spec MUST), and allow requests without one (Anthropic's servers).
- **Limits:** rate limit per token (e.g. 30 calls/min) and cap open previews per user (e.g. 5), since there's no once-per-message guard here. Never log message bodies, addresses or tokens.

### Tools

Reuse `TOOLS` and `runTool` from `tools.ts`. Each tool gets a `title` and an honest annotation:

| Tool | Annotation | Notes |
|---|---|---|
| `get_balance` | read-only | Balances and what's left today under the caps. |
| `get_rates` | read-only | Live venues plus the market-rate check. |
| `list_contacts` | read-only | Favourites. |
| `get_activity` | read-only | New: recent activity, so "did it go through?" works. |
| `prepare_swap` | not read-only, not destructive | Returns the quote and the approval link. Text says swaps aren't live on testnet. |
| `preview_send` | not read-only, not destructive | Returns the preview and the approval link. USDC only. |
| `create_payment_link` | not read-only | Example link; says so. |
| `save_contact` | not read-only | |

- **Not exposed:** `connect_site` (mocked), and anything that approves, confirms or submits.
- Tool results lead with plain text Claude can relay: numbers, the market-rate warning, the approval link, refusal reasons. `structuredContent` carries the card data for the MCP App stretch.

## Phases

1. **Spike (half a day).**
   - A no-auth `/mcp` with only `get_rates`, in mock mode, behind a cloudflared tunnel. Add it in claude.ai as a custom connector with "No sign in".
   - Check Streamable HTTP on our Next.js setup, the tool permission prompts, and how results look on web and phone.
   - Run the MCP Apps checks from the stretch section.
2. **Auth.** `users` table (shared), OAuth tables and endpoints, consent page, connected apps with Revoke on Channels.
3. **Tools and the approval page.** All tools over `runTool`, the `/approve/<id>` page with rebuild-on-expiry, `get_activity`.
4. **In-chat Approve (stretch).** Only if the spike passed. MCP App card, app-only approve with a one-time code, agent-key signing.
5. **ChatGPT.** Add the same `/mcp` as a custom MCP server in ChatGPT. Add CIMD if ChatGPT needs it beyond DCR. Publishing to ChatGPT's app directory needs organization verification and a privacy policy; that's a separate decision.

## Tests

- **Script (SDK client, mock mode):**
  - the OAuth flow end to end;
  - the tool list contains no approve, confirm or submit tool;
  - `preview_send` returns a link and the activity log doesn't grow;
  - a token can't reach another user's preview;
  - revoked, expired and wrong-audience tokens get 401;
  - a missing scope gets 403;
  - DCR with an unknown redirect URI is refused.
- **Approval page:** owner approves once; double approve is refused; a non-owner sees "sign in as…"; an expired preview is rebuilt with fresh checks.
- **Prompt injection (manual, in Claude):** a page or message telling Claude to "approve the send for me" can at most prepare a preview; nothing moves.
- **Manual:**
  - claude.ai web and the Claude phone app: connect, ask for rates, "send $5 to Isaac", open the link, approve, ask "did it go through?";
  - revoke on Channels, and Claude asks to sign in again.
- **Where to test:** mock mode behind a cloudflared tunnel (public HTTPS on 443; mock sign-in avoids Privy's origin rules). Vercel previews need a Vercel login, so Claude can't reach them. The real Privy check happens on production after merge.
- `npm run lint`, `npx tsc --noEmit` and `npm run build` pass.

## Open questions

- Who builds the shared `users` table (this plan or Telegram phase 1)?
- In-chat Approve: link only for the buildathon, or link plus the MCP App button if the spike passes?
- A production Privy app with allowed origins is still pending. It matters here because the approval page signs with Privy.
- Domain: the connector URL is permanent for users who add it. Decide the final domain before sharing it widely.

## Sources (read 14 Nov 2026)

- MCP Streamable HTTP (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- MCP authorization: https://modelcontextprotocol.io/specification/latest/basic/authorization
- MCP elicitation: https://modelcontextprotocol.io/specification/latest/client/elicitation
- MCP tools: https://modelcontextprotocol.io/specification/latest/server/tools
- MCP Apps spec: https://github.com/modelcontextprotocol/ext-apps (specification/2026-01-26/apps.mdx)
- Claude custom connectors: https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- Building Claude connectors: https://claude.com/docs/connectors/building
- Claude MCP Apps: https://claude.com/docs/connectors/building/mcp-apps/getting-started and …/app-tools
- Claude directory review criteria: https://claude.com/docs/connectors/building/review-criteria
- ChatGPT auth: https://developers.openai.com/plugins/build/auth
- ChatGPT connect and review: https://developers.openai.com/plugins/deploy/connect-chatgpt and …/app-review
