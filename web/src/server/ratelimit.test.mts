import assert from "node:assert/strict";
import { test } from "node:test";

delete process.env.DATABASE_URL;
const { withinRate } = await import("./ratelimit");

test("a key is allowed up to the limit in a window, then refused; the next window starts fresh", async () => {
  const t = 10 * 60_000;
  for (let i = 0; i < 3; i++) assert.equal(await withinRate("k1", 3, 60, t), true);
  assert.equal(await withinRate("k1", 3, 60, t), false);
  assert.equal(await withinRate("k2", 3, 60, t), true, "other keys are separate");
  assert.equal(await withinRate("k1", 3, 60, t + 61_000), true, "new window");
});
