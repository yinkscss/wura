import assert from "node:assert/strict";
import { test } from "node:test";

delete process.env.RAMP_PROVIDER; // the mock

const { ApiFailure } = await import("../errors");
const { previewCashOut, rampInfo, verifyIdentity } = await import("./index");
const { EXAMPLE_LIMITS } = await import("../money");

const s = { userId: "cashout-user", email: "a@example.com", address: "GAAAA" };
const refused = (code: string) => (e: unknown) => e instanceof ApiFailure && e.code === code;

test("cash-out limits carry Wura's per-payment cap", async () => {
  const info = await rampInfo();
  assert.equal(info.limits.cashOut.max, EXAMPLE_LIMITS.perPayment.NGN);
});

test("a cash-out needs the identity check, like a top-up", async () => {
  await assert.rejects(previewCashOut(s, { amount: 5_000_00 }), refused("KYC_REQUIRED"));
});

test("a verified user gets a preview; nothing is signed or logged", async () => {
  verifyIdentity(s, { nin: "12345678901", consent: true });
  const p = await previewCashOut(s, { amount: 5_000_00 });
  assert.equal(p.amount, 5_000_00);
  assert.equal(p.receive, p.amount - p.fee);
  assert.equal(p.mock, true);
});

test("amounts below the minimum, fractional or non-positive are refused", async () => {
  for (const amount of [0, -1, 1.5, NaN, 10]) {
    await assert.rejects(previewCashOut(s, { amount }), refused("BAD_REQUEST"));
  }
});

test("over the per-payment cap is refused before the partner is asked", async () => {
  await assert.rejects(previewCashOut(s, { amount: EXAMPLE_LIMITS.perPayment.NGN + 1 }), refused("TRIAL_LIMIT"));
});
