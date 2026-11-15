import "server-only";
import postgres from "postgres";

/**
 * Postgres, when DATABASE_URL is set (e.g. Neon from the Vercel Marketplace).
 * Without it, wallet state stays in server memory (mock/demo only).
 */

type Sql = ReturnType<typeof postgres>;

const g = globalThis as unknown as { __wuraSql?: Sql; __wuraSchema?: Promise<void> };

export function dbEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

export function sql(): Sql {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  g.__wuraSql ??= postgres(process.env.DATABASE_URL, {
    // Serverless: few connections per instance; prepare:false works with poolers (PgBouncer / Neon pooled URLs).
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return g.__wuraSql;
}

const SCHEMA = `
create table if not exists wallets (
  user_id    text primary key,
  state      jsonb not null,
  version    integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only transaction log: every move Wura makes is written here.
create table if not exists activity (
  id           text primary key,
  user_id      text not null,
  at           timestamptz not null,
  kind         text not null,
  detail       text not null,
  amount       text not null,
  status       text not null,
  tx_ref       text,
  explorer_url text
);
create index if not exists activity_user_at on activity (user_id, at desc);

-- Who each user is, so channels without a browser cookie (Telegram, MCP)
-- can rebuild a session from user_id. Written on every sign-in.
create table if not exists users (
  user_id    text primary key,
  email      text not null,
  address    text not null,
  updated_at timestamptz not null default now()
);

-- OAuth for the MCP connector (Claude, ChatGPT). Codes and tokens are stored
-- as SHA-256 hashes, never in the clear.
create table if not exists oauth_clients (
  client_id     text primary key,
  client_name   text not null,
  redirect_uris jsonb not null,
  created_at    timestamptz not null default now()
);
create table if not exists oauth_codes (
  code_hash      text primary key,
  client_id      text not null,
  user_id        text not null,
  redirect_uri   text not null,
  code_challenge text not null,
  scopes         text not null,
  resource       text not null,
  expires_at     timestamptz not null,
  used_at        timestamptz
);
create table if not exists oauth_tokens (
  token_hash   text primary key,
  kind         text not null,
  family       text not null,
  client_id    text not null,
  user_id      text not null,
  scopes       text not null,
  resource     text not null,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists oauth_tokens_user on oauth_tokens (user_id, client_id);
-- Telegram: the link to a user_id, the Telegram handle shown on the Channels
-- card (so a wrong link is easy to spot), and the last few chat lines for
-- context. Email and wallet address are never stored here (they come from the
-- users table above). History can include amounts, names and addresses from the
-- chat; it is deleted on unlink.
create table if not exists telegram_links (
  telegram_user_id bigint primary key,
  user_id          text not null unique,
  history          jsonb not null default '[]',
  created_at       timestamptz not null default now()
);
alter table telegram_links add column if not exists tg_username text;
alter table telegram_links add column if not exists tg_name     text;
create table if not exists telegram_link_codes (
  code_hash  text primary key,
  user_id    text not null,
  expires_at timestamptz not null
);
create table if not exists telegram_rate (
  telegram_user_id bigint not null,
  window_start     timestamptz not null,
  count            integer not null default 0,
  primary key (telegram_user_id, window_start)
);
create table if not exists telegram_updates (
  update_id bigint primary key,
  at        timestamptz not null default now()
);

-- Naira partner (docs/mainnet-plan.md, Otowo's path 3). Serverless keeps
-- nothing in memory, so the partner sign-in and every top-up and cash-out are
-- stored here. No identity or bank details: the partner collects those on its
-- own page and Wura never sees them.

-- One partner sign-in per user and service ('NGN' keeps naira, 'USDC' pays
-- dollars; each is a separate partner service). The token lets the server read
-- that user's transfers and open a partner page for them, nothing else. It is
-- stored encrypted (AES-256-GCM, key from RAMP_TOKEN_KEY), never in the clear,
-- and the row is deleted when it expires (about a day).
create table if not exists ramp_sessions (
  user_id    text not null,
  service    text not null,
  address    text not null,
  token_enc  text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, service)
);

-- One row per top-up or cash-out started with the partner. Amounts are minor
-- units (kobo or cents) of the service's currency. state is Wura's plain state
-- (waiting_for_you, processing, done, failed); anchor_status is the partner's
-- own word, kept for support. logged_at is set exactly once, in the same
-- statement that claims the right to write the activity row, so a transfer is
-- never logged twice. flagged_at marks one that has been open too long.
create table if not exists ramp_transfers (
  id              text primary key,
  user_id         text not null,
  address         text not null,
  provider        text not null,
  service         text not null,
  kind            text not null,
  anchor_tx_id    text not null,
  amount          bigint not null,
  state           text not null,
  anchor_status   text not null,
  amount_in       bigint,
  amount_out      bigint,
  fee             bigint,
  stellar_tx_id   text,
  logged_at       timestamptz,
  flagged_at      timestamptz,
  last_checked_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (provider, service, anchor_tx_id),
  check (kind in ('topup', 'cashout')),
  check (state in ('waiting_for_you', 'processing', 'done', 'failed'))
);
create index if not exists ramp_transfers_user on ramp_transfers (user_id, created_at desc);
-- What the reconcile job reads: only transfers that are still open.
create index if not exists ramp_transfers_open on ramp_transfers (last_checked_at nulls first)
  where state in ('waiting_for_you', 'processing');
`;

/** Creates the tables once per process (idempotent). Also: npm run db:migrate. */
export function ensureSchema() {
  g.__wuraSchema ??= sql()
    .unsafe(SCHEMA)
    .then(() => undefined)
    .catch((err) => {
      g.__wuraSchema = undefined;
      throw err;
    });
  return g.__wuraSchema;
}

export const schemaSql = SCHEMA;
