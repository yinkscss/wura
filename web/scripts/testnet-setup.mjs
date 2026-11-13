#!/usr/bin/env node
// Stellar TESTNET helper for Wura demos. Never use on mainnet.
//
//   node scripts/testnet-setup.mjs contacts Tunde Ada
//     Creates a funded testnet account per name, adds a USDC trustline, and
//     prints a TESTNET_CONTACTS=... line for .env.local.
//
//   node scripts/testnet-setup.mjs test-usdc
//     Creates a private test "USDC" issuer for local testing and prints
//     STELLAR_USDC_ISSUER=... (Circle's faucet needs a human; this doesn't).
//
//   node scripts/testnet-setup.mjs mint <G-address> <amount>
//     Sends test USDC from that private issuer. The address needs a trustline.
//
// Secrets are written to web/.testnet/ (git-ignored). Testnet resets wipe all of this.

import { Asset, BASE_FEE, Horizon, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HORIZON = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const CIRCLE_TESTNET_USDC = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".testnet");
const server = new Horizon.Server(HORIZON);

function save(name, data) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2));
}
function load(name) {
  const p = join(dir, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

async function friendbot(pub) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${pub}`);
  if (!r.ok && !/already/i.test(await r.text())) throw new Error(`Friendbot failed for ${pub}`);
}

async function submitOps(kp, ops) {
  const acct = await server.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * 2), networkPassphrase: PASSPHRASE }).setTimeout(60);
  ops.forEach((o) => b.addOperation(o));
  const tx = b.build();
  tx.sign(kp);
  const res = await server.submitTransaction(tx);
  return res.hash;
}

function usdcIssuer() {
  return process.env.STELLAR_USDC_ISSUER || load("issuer.json")?.public || CIRCLE_TESTNET_USDC;
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "contacts") {
  const names = args.length ? args : ["Tunde", "Ada"];
  const asset = new Asset("USDC", usdcIssuer());
  const out = {};
  for (const name of names) {
    const kp = Keypair.random();
    await friendbot(kp.publicKey());
    await submitOps(kp, [Operation.changeTrust({ asset })]);
    out[name] = { public: kp.publicKey(), secret: kp.secret() };
    console.error(`✓ ${name}: ${kp.publicKey()} (funded, USDC trustline to ${asset.getIssuer().slice(0, 6)}…)`);
  }
  save("contacts.json", out);
  console.log(`TESTNET_CONTACTS=${names.map((n) => `${n}:${out[n].public}`).join(",")}`);
} else if (cmd === "test-usdc") {
  const kp = Keypair.random();
  await friendbot(kp.publicKey());
  save("issuer.json", { public: kp.publicKey(), secret: kp.secret() });
  console.error("✓ Private test USDC issuer created. Use it only for local testing.");
  console.log(`STELLAR_USDC_ISSUER=${kp.publicKey()}`);
} else if (cmd === "mint") {
  const [to, amount] = args;
  const issuer = load("issuer.json");
  if (!issuer) throw new Error("Run `test-usdc` first; minting only works with your private test issuer.");
  const kp = Keypair.fromSecret(issuer.secret);
  const hash = await submitOps(kp, [Operation.payment({ destination: to, asset: new Asset("USDC", kp.publicKey()), amount: String(amount) })]);
  console.log(`✓ Sent ${amount} test USDC to ${to} · tx ${hash}`);
} else {
  console.error("Usage: node scripts/testnet-setup.mjs contacts [names…] | test-usdc | mint <address> <amount>");
  process.exit(1);
}
