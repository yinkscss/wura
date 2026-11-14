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

-- Who a user is, written on every sign-in. Chat channels build a Session from this.
create table if not exists users (
  user_id    text primary key,
  email      text not null,
  address    text not null,
  updated_at timestamptz not null default now()
);

-- Telegram: only the link to a user_id is stored here, never email or address.
create table if not exists telegram_links (
  telegram_user_id bigint primary key,
  user_id          text not null unique,
  history          jsonb not null default '[]',
  created_at       timestamptz not null default now()
);
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
