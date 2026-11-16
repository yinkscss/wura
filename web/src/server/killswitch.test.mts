import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MONEY_MODE = "testnet";
delete process.env.MONEY_KILL;
const { assertMoneyOn } = await import("./stellar");
const { ApiFailure } = await import("./errors");

test("the kill switch stops real money moves, and applies the moment it is set", () => {
  assert.doesNotThrow(() => assertMoneyOn());
  process.env.MONEY_KILL = "1";
  assert.throws(() => assertMoneyOn(), (e: unknown) => e instanceof ApiFailure && e.code === "MONEY_PAUSED" && e.status === 503);
  delete process.env.MONEY_KILL;
  assert.doesNotThrow(() => assertMoneyOn());
});
