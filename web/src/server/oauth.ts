import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { dbEnabled, ensureSchema, sql } from "./db";
import { ApiFailure } from "./errors";

/**
 * Wura as an OAuth 2.1 authorization server for the MCP connector (Claude,
 * ChatGPT). See docs/claude-connector-plan.md.
 *
 * - Public clients registered by DCR, limited to known redirect URIs.
 * - Authorization code + PKCE S256 only. Tokens are bound to our MCP resource.
 * - Opaque tokens, stored as SHA-256 hashes, so they can be revoked.
 *   Access 1 h, refresh 30 days with rotation; reusing an old refresh token
 *   revokes the whole family.
 */

export const SCOPES = ["wura.read", "wura.prepare"] as const;
export type Scope = (typeof SCOPES)[number];

const CODE_TTL_MS = 5 * 60_000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

/** Public base URL (issuer). APP_URL wins; otherwise the request's own origin. */
export function baseUrl(req: Request) {
  const fromEnv = (process.env.APP_URL || process.env.MCP_PUBLIC_URL || "").replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || u.host;
  const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
export const resourceFor = (base: string) => `${base}/mcp`;

// ---------- redirect URIs ----------

const ALLOWED_REDIRECTS: RegExp[] = [
  /^https:\/\/claude\.ai\/api\/mcp\/auth_callback$/,
  /^https:\/\/claude\.com\/api\/mcp\/auth_callback$/,
  /^https:\/\/chatgpt\.com\/connector_platform_oauth_redirect$/,
  /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]+$/,
  // Loopback, for Claude Code and local tests (any port, RFC 8252).
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s]*$/,
];
export const redirectAllowed = (uri: string) => ALLOWED_REDIRECTS.some((r) => r.test(uri));

// ---------- helpers ----------

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const token = (prefix: string) => `${prefix}_${randomBytes(32).toString("base64url")}`;
const nowIso = () => new Date().toISOString();

export function parseScopes(raw: string | null | undefined): Scope[] {
  const asked = (raw || SCOPES.join(" ")).split(/\s+/).filter(Boolean);
  const ok = asked.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s));
  return ok.length ? Array.from(new Set(ok)) : [...SCOPES];
}

function pkceOk(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- storage (Postgres, or memory for the no-DATABASE_URL demo) ----------

export type OAuthClient = { client_id: string; client_name: string; redirect_uris: string[]; created_at: string };
type CodeRow = {
  code_hash: string; client_id: string; user_id: string; redirect_uri: string; code_challenge: string;
  scopes: string; resource: string; expires_at: string; used_at: string | null;
};
type TokenRow = {
  token_hash: string; kind: "access" | "refresh"; family: string; client_id: string; user_id: string;
  scopes: string; resource: string; expires_at: string; revoked_at: string | null; last_used_at: string | null; created_at: string;
};

const g = globalThis as unknown as { __wuraOAuth?: { clients: Map<string, OAuthClient>; codes: Map<string, CodeRow>; tokens: Map<string, TokenRow> } };
const mem = (g.__wuraOAuth ??= { clients: new Map(), codes: new Map(), tokens: new Map() });

/** Ensures the schema. Don't return sql() from an async function: postgres.js's sql object is thenable. */
async function ready() {
  await ensureSchema();
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (!dbEnabled()) return mem.clients.get(clientId) ?? null;
  const [r] = await (await ready(), sql())<OAuthClient[]>`select client_id, client_name, redirect_uris, created_at from oauth_clients where client_id = ${clientId}`;
  return r ?? null;
}

/** RFC 7591 dynamic client registration (public clients only). */
/**
 * True when every redirect URI of this client is https on claude.ai or
 * claude.com, so its tokens can only have reached Claude. Only Claude was
 * shown (spike, 14 Nov) to hide app-only tools and `_meta` from the model, so
 * only Claude gets the in-chat Approve card.
 */
export async function isClaudeClient(clientId: string) {
  const c = await getClient(clientId);
  if (!c || c.redirect_uris.length === 0) return false;
  return c.redirect_uris.every((u) => {
    try {
      const x = new URL(u);
      return x.protocol === "https:" && (x.host === "claude.ai" || x.host === "claude.com");
    } catch {
      return false;
    }
  });
}

export async function registerClient(input: { client_name?: unknown; redirect_uris?: unknown }): Promise<OAuthClient> {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.map(String) : [];
  if (uris.length === 0 || uris.length > 5) throw new OAuthError("invalid_redirect_uri", "Give 1 to 5 redirect_uris.");
  const bad = uris.find((u) => !redirectAllowed(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${bad}`);
  const name = String(input.client_name ?? "").trim().slice(0, 60) || "MCP client";
  const c: OAuthClient = { client_id: `wc_${randomBytes(16).toString("hex")}`, client_name: name, redirect_uris: uris, created_at: nowIso() };
  if (!dbEnabled()) mem.clients.set(c.client_id, c);
  else await (await ready(), sql())`insert into oauth_clients (client_id, client_name, redirect_uris) values (${c.client_id}, ${c.client_name}, ${sql().json(uris)})`;
  return c;
}

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

// ---------- authorize ----------

export type AuthorizeRequest = {
  client: OAuthClient;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes: Scope[];
  resource: string;
  /** Our issuer (= metadata `issuer`), returned as `iss` on every redirect (RFC 9207). */
  issuer: string;
};

/**
 * Validates an /authorize request. Errors that make the redirect unsafe
 * (unknown client, unregistered redirect URI) are thrown as OAuthError so the
 * page shows them instead of redirecting.
 */
export async function checkAuthorize(params: URLSearchParams, base: string): Promise<AuthorizeRequest> {
  const clientId = params.get("client_id") || "";
  const client = await getClient(clientId);
  if (!client) throw new OAuthError("invalid_client", "This app isn't registered with Wura.");
  const redirectUri = params.get("redirect_uri") || "";
  if (!client.redirect_uris.includes(redirectUri)) throw new OAuthError("invalid_request", "The redirect address doesn't match this app.");
  if (params.get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "Only response_type=code is supported.");
  const codeChallenge = params.get("code_challenge") || "";
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw new OAuthError("invalid_request", "PKCE with S256 is required.");
  }
  const resource = params.get("resource") || resourceFor(base);
  if (resource.replace(/\/+$/, "") !== resourceFor(base)) throw new OAuthError("invalid_target", "Tokens can only be issued for this Wura server.");
  return { client, redirectUri, state: params.get("state") || "", codeChallenge, scopes: parseScopes(params.get("scope")), resource: resourceFor(base), issuer: base };
}

/** The user said yes on the consent page: issue a single-use code. */
export async function issueCode(userId: string, a: AuthorizeRequest) {
  const code = token("wcd");
  const row: CodeRow = {
    code_hash: hash(code), client_id: a.client.client_id, user_id: userId, redirect_uri: a.redirectUri,
    code_challenge: a.codeChallenge, scopes: a.scopes.join(" "), resource: a.resource,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(), used_at: null,
  };
  if (!dbEnabled()) mem.codes.set(row.code_hash, row);
  else await (await ready(), sql())`insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scopes, resource, expires_at)
    values (${row.code_hash}, ${row.client_id}, ${row.user_id}, ${row.redirect_uri}, ${row.code_challenge}, ${row.scopes}, ${row.resource}, ${row.expires_at})`;
  const url = new URL(a.redirectUri);
  url.searchParams.set("code", code);
  if (a.state) url.searchParams.set("state", a.state);
  url.searchParams.set("iss", a.issuer);
  return url.toString();
}

export function denyRedirect(a: AuthorizeRequest) {
  const url = new URL(a.redirectUri);
  url.searchParams.set("error", "access_denied");
  if (a.state) url.searchParams.set("state", a.state);
  url.searchParams.set("iss", a.issuer);
  return url.toString();
}

// ---------- tokens ----------

async function storeToken(row: TokenRow) {
  if (!dbEnabled()) return void mem.tokens.set(row.token_hash, row);
  await (await ready(), sql())`insert into oauth_tokens (token_hash, kind, family, client_id, user_id, scopes, resource, expires_at)
    values (${row.token_hash}, ${row.kind}, ${row.family}, ${row.client_id}, ${row.user_id}, ${row.scopes}, ${row.resource}, ${row.expires_at})`;
}

async function findToken(raw: string): Promise<TokenRow | null> {
  const h = hash(raw);
  if (!dbEnabled()) return mem.tokens.get(h) ?? null;
  const [r] = await (await ready(), sql())<TokenRow[]>`select * from oauth_tokens where token_hash = ${h}`;
  return r ? { ...r, expires_at: new Date(r.expires_at).toISOString(), revoked_at: r.revoked_at && new Date(r.revoked_at).toISOString() } : null;
}

async function revokeFamily(family: string) {
  if (!dbEnabled()) {
    for (const t of mem.tokens.values()) if (t.family === family && !t.revoked_at) t.revoked_at = nowIso();
    return;
  }
  await (await ready(), sql())`update oauth_tokens set revoked_at = now() where family = ${family} and revoked_at is null`;
}

async function issuePair(base: Omit<TokenRow, "token_hash" | "kind" | "expires_at" | "revoked_at" | "last_used_at" | "created_at">) {
  const access = token("wat");
  const refresh = token("wrt");
  const created_at = nowIso();
  await storeToken({ ...base, token_hash: hash(access), kind: "access", expires_at: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(), revoked_at: null, last_used_at: null, created_at });
  await storeToken({ ...base, token_hash: hash(refresh), kind: "refresh", expires_at: new Date(Date.now() + REFRESH_TTL_MS).toISOString(), revoked_at: null, last_used_at: null, created_at });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: base.scopes };
}

/** POST /oauth/token. */
export async function exchange(form: URLSearchParams, base: string) {
  const grant = form.get("grant_type");
  const clientId = form.get("client_id") || "";
  const client = await getClient(clientId);
  if (!client) throw new OAuthError("invalid_client", "Unknown client.", 401);
  const resource = (form.get("resource") || resourceFor(base)).replace(/\/+$/, "");
  if (resource !== resourceFor(base)) throw new OAuthError("invalid_target", "Wrong resource.");

  if (grant === "authorization_code") {
    const raw = form.get("code") || "";
    const h = hash(raw);
    let row: CodeRow | null = null;
    if (!dbEnabled()) {
      row = mem.codes.get(h) ?? null;
      if (row && !row.used_at) row.used_at = nowIso();
      else if (row) row = { ...row, used_at: "used" };
    } else {
      // Mark used atomically, so a code works once even under races.
      const [r] = await (await ready(), sql())<CodeRow[]>`update oauth_codes set used_at = now() where code_hash = ${h} and used_at is null returning *`;
      row = r ?? null;
    }
    if (!row || row.used_at === "used") throw new OAuthError("invalid_grant", "That code is invalid or already used.");
    if (new Date(row.expires_at).getTime() < Date.now()) throw new OAuthError("invalid_grant", "That code expired.");
    if (row.client_id !== clientId || row.redirect_uri !== form.get("redirect_uri")) throw new OAuthError("invalid_grant", "Code doesn't match this client.");
    if (!pkceOk(form.get("code_verifier") || "", row.code_challenge)) throw new OAuthError("invalid_grant", "PKCE check failed.");
    return issuePair({ family: randomBytes(12).toString("hex"), client_id: clientId, user_id: row.user_id, scopes: row.scopes, resource: row.resource });
  }

  if (grant === "refresh_token") {
    const t = await findToken(form.get("refresh_token") || "");
    if (!t || t.kind !== "refresh" || t.client_id !== clientId) throw new OAuthError("invalid_grant", "Invalid refresh token.");
    if (t.revoked_at) {
      // Reuse of a rotated token: someone may have copied it. Kill the family.
      await revokeFamily(t.family);
      throw new OAuthError("invalid_grant", "Refresh token was already used.");
    }
    if (new Date(t.expires_at).getTime() < Date.now()) throw new OAuthError("invalid_grant", "Refresh token expired.");
    // Rotate: revoke the old refresh token (and old access tokens) in this family, issue a new pair.
    await revokeFamily(t.family);
    const scopes = parseScopes(form.get("scope") || t.scopes).filter((s) => t.scopes.split(" ").includes(s)).join(" ") || t.scopes;
    return issuePair({ family: t.family, client_id: clientId, user_id: t.user_id, scopes, resource: t.resource });
  }

  throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/** Validates a Bearer access token for our MCP resource. */
export async function verifyAccessToken(raw: string, base: string): Promise<{ userId: string; clientId: string; scopes: Scope[] } | null> {
  if (!raw.startsWith("wat_")) return null;
  const t = await findToken(raw);
  if (!t || t.kind !== "access" || t.revoked_at) return null;
  if (new Date(t.expires_at).getTime() < Date.now()) return null;
  if (t.resource !== resourceFor(base)) return null;
  if (!dbEnabled()) t.last_used_at = nowIso();
  else void (await ready(), sql())`update oauth_tokens set last_used_at = now() where token_hash = ${t.token_hash} and (last_used_at is null or last_used_at < now() - interval '1 minute')`;
  return { userId: t.user_id, clientId: t.client_id, scopes: parseScopes(t.scopes) };
}

// ---------- connected apps (Channels page) ----------

export type ConnectedApp = { clientId: string; name: string; redirectHost: string; scopes: string[]; connectedAt: string; lastUsedAt: string | null };

export async function connectedApps(userId: string): Promise<ConnectedApp[]> {
  let rows: Array<{ client_id: string; scopes: string; created_at: string; last_used_at: string | null }>;
  if (!dbEnabled()) {
    rows = [...mem.tokens.values()].filter((t) => t.user_id === userId && !t.revoked_at && new Date(t.expires_at).getTime() > Date.now());
  } else {
    rows = await (await ready(), sql())`select client_id, scopes, created_at, last_used_at from oauth_tokens
      where user_id = ${userId} and revoked_at is null and expires_at > now()`;
  }
  const by = new Map<string, ConnectedApp>();
  for (const r of rows) {
    const cur = by.get(r.client_id);
    const created = new Date(r.created_at).toISOString();
    const used = r.last_used_at ? new Date(r.last_used_at).toISOString() : null;
    if (!cur) {
      const c = await getClient(r.client_id);
      by.set(r.client_id, {
        clientId: r.client_id,
        name: c?.client_name ?? "Unknown app",
        redirectHost: c?.redirect_uris[0] ? new URL(c.redirect_uris[0]).host : "",
        scopes: r.scopes.split(" "),
        connectedAt: created,
        lastUsedAt: used,
      });
    } else {
      if (created < cur.connectedAt) cur.connectedAt = created;
      if (used && (!cur.lastUsedAt || used > cur.lastUsedAt)) cur.lastUsedAt = used;
    }
  }
  return [...by.values()].sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
}

export async function revokeApp(userId: string, clientId: string) {
  if (!clientId) throw new ApiFailure("BAD_REQUEST", "Which app?");
  if (!dbEnabled()) {
    for (const t of mem.tokens.values()) if (t.user_id === userId && t.client_id === clientId && !t.revoked_at) t.revoked_at = nowIso();
  } else {
    await (await ready(), sql())`update oauth_tokens set revoked_at = now() where user_id = ${userId} and client_id = ${clientId} and revoked_at is null`;
  }
  return { ok: true };
}
