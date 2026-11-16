import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MONEY_MODE = "testnet";
process.env.STELLAR_HORIZON_URL = "http://127.0.0.1:9"; // nothing listens here: every Horizon call fails
const { getSponsorInfo } = await import("./stellar");
const { ApiFailure } = await import("./errors");

test("if Horizon fails, the sponsor info throws, so the account cap can't be skipped", async () => {
  await assert.rejects(getSponsorInfo("GAAAA"), (e: unknown) => e instanceof ApiFailure);
});
