import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addToHistory,
  allowMessage,
  consumeLinkCode,
  createLinkCode,
  firstSight,
  getHistory,
  isLinked,
  linkedAccount,
  linkedUserId,
  maskPhone,
  normalizePhone,
  unlinkUser,
} from "./links";

delete process.env.DATABASE_URL;

test("normalizePhone keeps digits only", () => {
  assert.equal(normalizePhone("+234 801 234 5678"), "2348012345678");
  assert.equal(maskPhone("2348012345678").includes("5678"), true);
});

test("a link code works once and links the WhatsApp number", async () => {
  const { code } = await createLinkCode("wa-user-a");
  assert.equal(await consumeLinkCode(code, "+2348011111111"), "wa-user-a");
  assert.equal(await linkedUserId("2348011111111"), "wa-user-a");
  assert.equal(await isLinked("wa-user-a"), true);
  assert.equal(await consumeLinkCode(code, "2348022222222"), null, "reused code is refused");
});

test("unknown and expired codes are refused", async () => {
  assert.equal(await consumeLinkCode("nope", "2348033333333"), null);
  const { code } = await createLinkCode("wa-user-b");
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60_000;
  try {
    assert.equal(await consumeLinkCode(code, "2348033333333"), null);
  } finally {
    Date.now = realNow;
  }
});

test("unlink removes the link and its history", async () => {
  const { code } = await createLinkCode("wa-user-e");
  await consumeLinkCode(code, "2348066666666");
  await addToHistory("2348066666666", [{ role: "user", text: "hi" }]);
  assert.equal((await getHistory("2348066666666")).length, 1);
  assert.equal(await unlinkUser("wa-user-e"), true);
  assert.equal(await linkedUserId("2348066666666"), null);
  assert.deepEqual(await getHistory("2348066666666"), []);
});

test("rate limit allows 20 a minute, then refuses", async () => {
  for (let i = 0; i < 20; i++) assert.equal(await allowMessage("2348088888888"), true, `message ${i + 1}`);
  assert.equal(await allowMessage("2348088888888"), false);
  assert.equal(await allowMessage("2348088888889"), true, "other numbers are unaffected");
});

test("a repeated wamid is only handled once", async () => {
  assert.equal(await firstSight("wamid.A"), true);
  assert.equal(await firstSight("wamid.A"), false);
  assert.equal(await firstSight("wamid.B"), true);
});

test("linked account shows a masked number", async () => {
  const { code } = await createLinkCode("wa-user-who");
  await consumeLinkCode(code, "2348099999999");
  const account = await linkedAccount("wa-user-who");
  assert.ok(account?.label.includes("9999"));
  assert.equal(await linkedAccount("nobody-wa"), null);
});
