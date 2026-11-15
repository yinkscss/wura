import "server-only";
import { naira, usdcNumber } from "@/lib/format";
import { ApiFailure } from "../errors";
import type { Session } from "../session";
import { linkRamp } from "./link";
import { mockRamp } from "./mock";
import type { RampBounds, RampCurrency, RampInfo, RampProvider } from "./types";

/**
 * The naira partner in use. RAMP_PROVIDER=mock (default) keeps everything
 * fictional. RAMP_PROVIDER=link uses the live partner on Stellar mainnet:
 * limits, partner sign-in, starting a top-up and its status. Cash-outs through
 * it are still refused (see ./link.ts).
 */
export function ramp(): RampProvider {
  return process.env.RAMP_PROVIDER === "link" ? linkRamp : mockRamp;
}

/** Wura's own cap per top-up while this is new. Example figures; the real amounts aren't decided. */
export const EXAMPLE_TRIAL_TOPUP_CAP: Record<RampCurrency, number> = { NGN: 50_000_00, USDC: 30_00 };

/** Customer wording: naira as ₦, dollars as $. No token names. */
function show(minor: number, currency: RampCurrency) {
  return currency === "NGN" ? naira(minor) : `$${usdcNumber(minor)}`;
}

function capped(b: RampBounds, cap: number): RampBounds {
  return { ...b, max: b.max === null ? cap : Math.min(b.max, cap) };
}

/** What the top-up and cash-out screens need: limits come from the partner, never hard-coded. */
export async function rampInfo(): Promise<RampInfo> {
  const p = ramp();
  const l = await p.limits();
  return {
    provider: p.id,
    live: p.live,
    identityCheck: p.identityCheck,
    limits: { currency: l.currency, topUp: capped(l.topUp, EXAMPLE_TRIAL_TOPUP_CAP[l.currency]), cashOut: l.cashOut },
  };
}

export function verifyIdentity(s: Session, input: { nin: unknown; consent: unknown }) {
  return ramp().verifyIdentity(s, input);
}

/**
 * Starts a top-up. `amount` is in the partner's currency (RampInfo.limits.currency),
 * minor units. With a live partner the answer is either a page to open, or a
 * sign-in the wallet has to confirm first (PartnerSignIn).
 */
export async function startTopUp(s: Session, input: { amount: number; partnerToken?: string }) {
  const { limits } = await rampInfo();
  const { enabled, min, max } = limits.topUp;
  const amount = input.amount;
  if (!enabled) throw new ApiFailure("BAD_REQUEST", "Naira top-ups aren't available right now.", 409);
  if (!Number.isInteger(amount) || amount <= 0 || (min !== null && amount < min)) {
    const what = limits.currency === "NGN" ? "naira top-up" : "top-up";
    throw new ApiFailure("BAD_REQUEST", `The smallest ${what} is ${show(min ?? 1, limits.currency)}.`);
  }
  if (max !== null && min !== null && max < min) {
    // The partner's minimum is above our trial cap: no amount is allowed.
    throw new ApiFailure("TRIAL_LIMIT", "Naira top-ups aren't available at trial amounts yet.", 403);
  }
  if (max !== null && amount > max) {
    throw new ApiFailure("TRIAL_LIMIT", `While naira top-ups are new, each one is capped at ${show(max, limits.currency)}.`, 403);
  }
  return ramp().startTopUp(s, { amount, partnerToken: input.partnerToken });
}

function noPartnerSignIn(): never {
  throw new ApiFailure("BAD_REQUEST", "There is no partner sign-in in this mode.", 409);
}

/** Second half of the partner sign-in: the wallet's signature over the checked challenge. */
export async function finishPartnerSignIn(s: Session, input: { challenge: unknown; signature: unknown }) {
  const p = ramp();
  if (!p.finishSignIn) noPartnerSignIn();
  return p.finishSignIn(s, input);
}

export async function topUpStatus(s: Session, input: { id: string; partnerToken?: string }) {
  const p = ramp();
  if (!p.topUpStatus) noPartnerSignIn();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.id)) throw new ApiFailure("BAD_REQUEST", "That top-up wasn't found.", 404);
  return p.topUpStatus(s, input);
}
