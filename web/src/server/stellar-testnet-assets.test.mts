import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MONEY_MODE = "testnet";
delete process.env.MONEY_KILL;
const { assetFor, buildPayment } = await import("./stellar");
const { ApiFailure } = await import("./errors");

test("there is no naira asset on testnet, and a naira payment is refused", async () => {
  assert.equal(assetFor("NGN"), null);
  await assert.rejects(
    buildPayment({ from: "GAAAA", to: "GBBBB", currency: "NGN", cents: 100 }),
    (e: unknown) => e instanceof ApiFailure && e.code === "SIGNING_UNAVAILABLE",
  );
});
