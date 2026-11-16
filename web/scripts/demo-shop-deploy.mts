// Deploys the demo shop to Stellar testnet with a throwaway test "USDC" that you control.
// Writes the ids to the file given as argv[2] (default demo-shop.json). Testnet only.
// Run: NODE_USE_ENV_PROXY=1 node --import tsx scripts/demo-shop-deploy.mts ../.toolchain/demo.json
import { readFileSync, writeFileSync } from "node:fs";
import { Address, Asset, BASE_FEE, Contract, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";

const RPC = "https://soroban-testnet.stellar.org";
const PASS = Networks.TESTNET;
const server = new rpc.Server(RPC);
const out = process.argv[2] ?? "demo-shop.json";

async function fund(kp: Keypair) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!r.ok) throw new Error("friendbot " + r.status);
}

/** Build, simulate (if Soroban), sign, send and wait. Returns the transaction result. */
async function run(signer: Keypair, op: xdr.Operation, soroban = true) {
  const acct = await server.getAccount(signer.publicKey());
  let tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASS }).addOperation(op).setTimeout(120).build();
  if (soroban) tx = await server.prepareTransaction(tx);
  tx.sign(signer);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error("send failed " + sent.errorResult?.toXDR("base64"));
  const done = await server.pollTransaction(sent.hash, { attempts: 30, sleepStrategy: () => 1000 });
  if (done.status !== "SUCCESS") throw new Error("tx " + done.status + " " + sent.hash);
  return done;
}

const issuer = Keypair.random();
const seller = Keypair.random();
const deployer = Keypair.random();
await Promise.all([fund(issuer), fund(seller), fund(deployer)]);
const usdc = new Asset("USDC", issuer.publicKey());

// Test USDC: the seller can hold it, and its token contract exists on testnet.
await run(seller, Operation.changeTrust({ asset: usdc }), false);
await run(deployer, Operation.createStellarAssetContract({ asset: usdc }));
const usdcContract = usdc.contractId(PASS);

// The shop.
const wasm = readFileSync(new URL("../../demo/soroban-shop/shop.wasm", import.meta.url));
await run(deployer, Operation.uploadContractWasm({ wasm }));
const wasmHash = (await import("node:crypto")).createHash("sha256").update(wasm).digest();
const created = await run(deployer, Operation.createCustomContract({ address: new Address(deployer.publicKey()), wasmHash, salt: Buffer.from(Keypair.random().rawPublicKey()) }));
const shop = Address.fromScAddress(created.returnValue!.address()).toString();
await run(
  deployer,
  new Contract(shop).call(
    "init",
    nativeToScVal(usdcContract, { type: "address" }),
    nativeToScVal(seller.publicKey(), { type: "address" }),
    nativeToScVal(20000000, { type: "i128" }), // 2 USDC per unit
  ),
);

const info = { shop, usdcIssuer: issuer.publicKey(), usdcIssuerSecret: issuer.secret(), usdcContract, seller: seller.publicKey() };
writeFileSync(out, JSON.stringify(info, null, 2));
console.log("shop", shop, "\nusdc issuer", issuer.publicKey(), "\nusdc contract", usdcContract, "\nsaved to", out);
