import assert from "node:assert/strict";
import { test } from "node:test";

// Mock mode with example prices: a swap is simulated, exactly as before M10.
for (const k of ["MONEY_MODE", "DATABASE_URL", "TESTNET_SIGNER", "BETA_ALLOWLIST", "MONEY_KILL"]) delete process.env[k];
process.env.QUOTE_SOURCE = "mock";

const { getQuote, approveSwap } = await import("./money");
const s = { userId: "mock:swap@example.com", email: "swap@example.com", address: "GMOCK" };

test("mock mode: the best example venue is used, no minimum, and approving simulates the swap", async () => {
  const q = await getQuote(s, { from: "NGN", to: "USDC", amountIn: 50_000_00 });
  assert.equal(q.source, "example");
  assert.equal(q.executesOn, undefined);
  assert.equal(q.minOut, undefined);
  assert.equal(q.bestVenue, "aquarius");
  const r = await approveSwap(s, { quoteId: q.id, approve: true });
  assert.ok("mock" in r && r.mock);
  assert.equal(q.status, "approved");
});
