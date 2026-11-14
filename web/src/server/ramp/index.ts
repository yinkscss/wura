import "server-only";
import { naira } from "@/lib/format";
import { ApiFailure } from "../errors";
import type { Session } from "../session";
import { linkRamp } from "./link";
import { mockRamp } from "./mock";
import type { RampBounds, RampInfo, RampProvider } from "./types";

/**
 * The naira partner in use. RAMP_PROVIDER=mock (default) keeps everything
 * fictional. RAMP_PROVIDER=link reads the live partner's limits; top-ups and
 * cash-outs through it are still refused (see ./link.ts).
 */
export function ramp(): RampProvider {
  return process.env.RAMP_PROVIDER === "link" ? linkRamp : mockRamp;
}

/** Wura's own cap per naira top-up while this is new. Example figure; the real amount isn't decided. */
export const EXAMPLE_TRIAL_TOPUP_CAP = 50_000_00;

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
    limits: { topUp: capped(l.topUp, EXAMPLE_TRIAL_TOPUP_CAP), cashOut: l.cashOut },
  };
}

export function verifyIdentity(s: Session, input: { nin: unknown; consent: unknown }) {
  return ramp().verifyIdentity(s, input);
}

export async function startTopUp(s: Session, input: { amount: number }) {
  const { limits } = await rampInfo();
  const { enabled, min, max } = limits.topUp;
  const amount = input.amount;
  if (!enabled) throw new ApiFailure("BAD_REQUEST", "Naira top-ups aren't available right now.", 409);
  if (!Number.isInteger(amount) || amount <= 0 || (min !== null && amount < min)) {
    throw new ApiFailure("BAD_REQUEST", `The smallest naira top-up is ${naira(min ?? 1)}.`);
  }
  if (max !== null && min !== null && max < min) {
    // The partner's minimum is above our trial cap: no amount is allowed.
    throw new ApiFailure("TRIAL_LIMIT", "Naira top-ups aren't available at trial amounts yet.", 403);
  }
  if (max !== null && amount > max) {
    throw new ApiFailure("TRIAL_LIMIT", `While naira top-ups are new, each one is capped at ${naira(max)}.`, 403);
  }
  return ramp().startTopUp(s, { amount });
}
