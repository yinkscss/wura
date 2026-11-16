import assert from "node:assert/strict";
import { test } from "node:test";
import { statusMessage } from "./messages";
import { STATE } from "./sep24";

test("every partner status has its own message for top-ups and cash-outs", () => {
  for (const kind of ["topup", "cashout"] as const) {
    const unknown = statusMessage(kind, "something_new");
    for (const status of Object.keys(STATE)) {
      const m = statusMessage(kind, status);
      assert.notEqual(m, unknown, `${kind} ${status} has no message`);
      assert.doesNotMatch(m, /LINK|NGNC|USDC|anchor|SEP|Stellar|trustline/i, `${kind} ${status} uses jargon`);
    }
  }
});

test("only a completed transfer says done, and failures say what happened to the money", () => {
  for (const kind of ["topup", "cashout"] as const) {
    for (const [status, state] of Object.entries(STATE)) {
      const m = statusMessage(kind, status);
      assert.equal(m.startsWith("Done."), state === "done", `${kind} ${status}`);
    }
    for (const status of ["expired", "error"]) assert.match(statusMessage(kind, status), /contact support/);
  }
  assert.match(statusMessage("topup", "refunded"), /back to your bank account/);
  assert.match(statusMessage("cashout", "refunded"), /back to your wallet/);
});

test("an unknown status never claims success or failure, and odd keys are safe", () => {
  for (const s of ["something_new", "__proto__", "constructor", ""]) {
    assert.match(statusMessage("topup", s), /working on your top-up/);
    assert.match(statusMessage("cashout", s), /working on your cash-out/);
  }
});
