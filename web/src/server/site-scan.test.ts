import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { extractContractIds, extractScriptUrls } from "./site-scan";

const C1 = StrKey.encodeContract(Buffer.alloc(32, 1));
const C2 = StrKey.encodeContract(Buffer.alloc(32, 2));

test("finds valid contract addresses and ignores look-alikes", () => {
  const bad = C1.slice(0, -1) + (C1.endsWith("A") ? "B" : "A"); // wrong checksum
  const text = `const a="${C1}"; x:'${C2}' bad:${bad} acct:${Keypair.random().publicKey()} glued:X${C1}`;
  assert.deepEqual(extractContractIds(text), [C1, C2]);
});

test("script URLs: same site first, https only, capped", () => {
  const html = `
    <script src="/assets/app.js"></script>
    <script type="module" src="https://cdn.example.net/lib.mjs"></script>
    <script src="http://insecure.example.org/x.js"></script>
    <link rel="stylesheet" href="/a.css">
    <script src="//other.example.org/y.js?v=1"></script>`;
  assert.deepEqual(extractScriptUrls(html, "https://shop.example.org/"), [
    "https://shop.example.org/assets/app.js",
    "https://cdn.example.net/lib.mjs",
    "https://other.example.org/y.js?v=1",
  ]);
  const many = Array.from({ length: 20 }, (_, i) => `<script src="/s${i}.js"></script>`).join("");
  assert.equal(extractScriptUrls(many, "https://shop.example.org/").length, 8);
});
