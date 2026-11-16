import assert from "node:assert/strict";
import { test } from "node:test";
import { alert, resetAlerts } from "./alerts";
import { bearerMatches, capPercent, scaleCap } from "./ops";

test("caps start at 25% on mainnet, full elsewhere, and can only be lowered", () => {
  assert.equal(capPercent({}, true), 25);
  assert.equal(capPercent({}, false), 100);
  assert.equal(capPercent({ CAP_PERCENT: "10" }, true), 10);
  assert.equal(capPercent({ CAP_PERCENT: "100" }, true), 100);
  for (const bad of ["0", "101", "-5", "abc", "NaN"]) assert.throws(() => capPercent({ CAP_PERCENT: bad }, true), /CAP_PERCENT/, bad);
});

test("scaled caps stay whole naira or dollars", () => {
  assert.equal(scaleCap(75_000_00, 25), 18_750_00);
  assert.equal(scaleCap(50_00, 25), 12_00); // $12.50 rounds down to $12
  assert.equal(scaleCap(200_00, 100), 200_00);
  assert.equal(scaleCap(50_00, 1), 0); // never rounds up past the cap
});

test("bearer secret: exact match only, and an unset secret matches nothing", () => {
  assert.equal(bearerMatches("Bearer s3cret", "s3cret"), true);
  assert.equal(bearerMatches("bearer s3cret", "s3cret"), true);
  assert.equal(bearerMatches("Bearer s3cre", "s3cret"), false);
  assert.equal(bearerMatches("Bearer ", ""), false);
  assert.equal(bearerMatches(null, ""), false);
  assert.equal(bearerMatches(null, "s3cret"), false);
});

test("an alert goes out once, then not again for ten minutes", async () => {
  resetAlerts();
  const sent: string[] = [];
  const fetchStub = (async (_u: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body).text);
    return new Response("ok");
  }) as unknown as typeof fetch;
  const env = { ALERT_WEBHOOK_URL: "https://hooks.example/x" };
  const log = console.error;
  console.error = () => {};
  try {
    assert.equal(await alert("treasury_low", "5 XLM", "t", { fetch: fetchStub, env, now: 1_000 }), true);
    assert.equal(await alert("treasury_low", "5 XLM", "t", { fetch: fetchStub, env, now: 2_000 }), false);
    assert.equal(await alert("treasury_low", "5 XLM", "other", { fetch: fetchStub, env, now: 2_000 }), true);
    assert.equal(await alert("treasury_low", "5 XLM", "t", { fetch: fetchStub, env, now: 1_000 + 11 * 60_000 }), true);
  } finally {
    console.error = log;
  }
  assert.equal(sent.length, 3);
  assert.match(sent[0], /Wura alert · treasury_low: 5 XLM/);
});

test("a broken or non-https webhook never throws and never blocks the alert", async () => {
  resetAlerts();
  const log = console.error;
  console.error = () => {};
  try {
    const boom = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    assert.equal(await alert("horizon_error", "x", "a", { fetch: boom, env: { ALERT_WEBHOOK_URL: "https://hooks.example/x" } }), true);
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response();
    }) as unknown as typeof fetch;
    await alert("horizon_error", "x", "b", { fetch: spy, env: { ALERT_WEBHOOK_URL: "http://insecure.example" } });
    assert.equal(called, false);
  } finally {
    console.error = log;
  }
});
