/**
 * Small pure helpers for running Wura safely (M8). No "server-only" import on
 * purpose: tests load this file directly.
 */

import { timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

/**
 * The starting caps as a percentage of the example caps (D5: at or below them,
 * lowered for the first week). CAP_PERCENT sets it, 1 to 100. Unset means 25 on
 * mainnet and 100 elsewhere, so real money starts low without anyone having to
 * remember. It can only lower the caps; raising them needs a code change.
 */
export function capPercent(env: Env, mainnet: boolean): number {
  const raw = (env.CAP_PERCENT || "").trim();
  if (raw === "") return mainnet ? 25 : 100;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 100) {
    throw new Error(`CAP_PERCENT must be a number from 1 to 100. Got "${raw}".`);
  }
  return Math.floor(n);
}

/** Scales a cap in cents or kobo, rounding down to a whole unit (₦1 or $1). */
export function scaleCap(minor: number, percent: number): number {
  return Math.floor((minor * percent) / 100 / 100) * 100;
}

/** True when the request's bearer token is the secret. An unset secret never matches. */
export function bearerMatches(header: string | null | undefined, secret: string | undefined): boolean {
  const want = (secret || "").trim();
  if (!want) return false;
  const given = (header || "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** How long an unconfirmed submit can sit before it counts as stuck. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;
