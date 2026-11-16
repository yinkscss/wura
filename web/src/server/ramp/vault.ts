/**
 * Encrypts the partner sign-in token before it is stored (AES-256-GCM).
 *
 * The key comes from RAMP_TOKEN_KEY: a secret of 32 characters or more, for
 * Production only, different from every other secret. Without it nothing is
 * stored and the user signs in to the partner again after a restart.
 *
 * The user id and the service are bound into each sealed token (GCM additional
 * data), so a row copied to another user or service won't open.
 *
 * Rotation: set RAMP_TOKEN_KEY to the new secret, raise RAMP_TOKEN_KEY_VERSION
 * by one, and keep the old secret as RAMP_TOKEN_KEY_V<old version> for a day
 * (the partner session's lifetime). Rows sealed with a key that is gone are
 * dropped, and the user signs in again.
 *
 * This file has no app imports on purpose, so the tests can load it directly.
 * It never logs a token or a key.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

type Env = Record<string, string | undefined>;

const MIN_SECRET = 32;

/** The key version new rows are sealed with. 1 unless RAMP_TOKEN_KEY_VERSION says otherwise. */
export function currentKeyVersion(env: Env = process.env): number {
  const n = Number((env.RAMP_TOKEN_KEY_VERSION || "").trim() || "1");
  return Number.isInteger(n) && n >= 1 && n <= 32767 ? n : 1;
}

function keyFor(version: number, env: Env): Buffer | null {
  const name = version === currentKeyVersion(env) ? "RAMP_TOKEN_KEY" : `RAMP_TOKEN_KEY_V${version}`;
  const secret = (env[name] || "").trim();
  if (secret.length < MIN_SECRET) return null;
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "wura-ramp-token:v1", 32));
}

/** True when a partner token can be stored at all. */
export function vaultReady(env: Env = process.env) {
  return keyFor(currentKeyVersion(env), env) !== null;
}

const aad = (userId: string, service: string) => Buffer.from(JSON.stringify(["wura-ramp-session", userId, service]));

/** Seals a token for one user and service. null when no key is set. */
export function seal(token: string, who: { userId: string; service: string }, env: Env = process.env): { sealed: string; keyVersion: number } | null {
  const keyVersion = currentKeyVersion(env);
  const key = keyFor(keyVersion, env);
  if (!key) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(aad(who.userId, who.service));
  const body = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return { sealed: Buffer.concat([iv, c.getAuthTag(), body]).toString("base64"), keyVersion };
}

/** Opens a sealed token. null when the key is gone, or the row was changed or belongs to someone else. */
export function unseal(sealed: string, keyVersion: number, who: { userId: string; service: string }, env: Env = process.env): string | null {
  const key = keyFor(keyVersion, env);
  if (!key) return null;
  try {
    const raw = Buffer.from(sealed, "base64");
    if (raw.length < 12 + 16 + 1) return null;
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAAD(aad(who.userId, who.service));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
