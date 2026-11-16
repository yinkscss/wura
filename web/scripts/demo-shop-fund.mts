// Funds the test buyer for an email (the key TESTNET_SIGNER=server-dev derives): XLM, a USDC trustline, 50 test USDC.
// Run: DEV_KEY_SECRET=... NODE_USE_ENV_PROXY=1 TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx scripts/demo-shop-fund.mts <email> ../.toolchain/demo.json
import { readFileSync } from "node:fs";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
const { devKeypairFor } = await import("../src/server/dev-keys");

const [email, file] = [process.argv[2], process.argv[3]];
const demo = JSON.parse(readFileSync(file, "utf8"));
const buyer = devKeypairFor(email);
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const usdc = new Asset("USDC", demo.usdcIssuer);

const f = await fetch(`https://friendbot.stellar.org/?addr=${buyer.publicKey()}`);
console.log("friendbot", f.status);
async function send(kp: Keypair, op: ReturnType<typeof Operation.payment>) {
  const tx = new TransactionBuilder(await horizon.loadAccount(kp.publicKey()), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }).addOperation(op).setTimeout(60).build();
  tx.sign(kp);
  return (await horizon.submitTransaction(tx)).hash;
}
await send(buyer, Operation.changeTrust({ asset: usdc }) as never);
await send(Keypair.fromSecret(demo.usdcIssuerSecret), Operation.payment({ destination: buyer.publicKey(), asset: usdc, amount: "50" }));
console.log("buyer", buyer.publicKey(), "funded with 50 test USDC");
