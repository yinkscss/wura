// Live testnet check of the site-connect building blocks (no signing, nothing is sent).
// Run: node --import tsx scripts/site-connect-check.mts
import { Account, Asset, BASE_FEE, Contract, Keypair, Networks, TransactionBuilder, contract, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { analyzeAuth, spendFor, refusalFor } from "../src/server/soroban-preview";

const RPC = "https://soroban-testnet.stellar.org";
const PASS = Networks.TESTNET;
const server = new rpc.Server(RPC);

const kp = Keypair.random();
const r = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
console.log("friendbot", r.status);
const xlm = Asset.native().contractId(PASS);

// A Stellar Asset Contract has no wasm and no readable spec: it must be reported as unreadable, not crash.
try {
  await contract.Client.from({ contractId: xlm, networkPassphrase: PASS, rpcUrl: RPC });
  console.log("unexpected: SAC read OK");
} catch (e) {
  console.log("SAC has no readable spec, as expected:", (e as Error).constructor.name);
}

const dest = Keypair.random().publicKey();
const args = [nativeToScVal(kp.publicKey(), { type: "address" }), nativeToScVal(dest, { type: "address" }), nativeToScVal(BigInt(15_000_000), { type: "i128" })];
const acct = await server.getAccount(kp.publicKey());
const tx = new TransactionBuilder(new Account(kp.publicKey(), acct.sequenceNumber()), { fee: BASE_FEE, networkPassphrase: PASS })
  .addOperation(new Contract(xlm).call("transfer", ...args)).setTimeout(120).build();
const sim = await server.simulateTransaction(tx);
if (!rpc.Api.isSimulationSuccess(sim)) throw new Error("simulation failed: " + JSON.stringify(sim).slice(0, 300));
const a = analyzeAuth(sim.result?.auth ?? []);
const usdc = Asset.native().contractId(PASS).replace(/.$/, "A"); // any other id: XLM is "other" here
const spend = spendFor(a, kp.publicKey(), usdc);
console.log("transfers:", a.transfers.map((t) => `${t.amount} from user=${t.from === kp.publicKey()}`));
console.log("refusal:", refusalFor(a, spend, () => "XLM"));
const built = rpc.assembleTransaction(tx, sim).build();
console.log("assembled ok, fee stroops:", built.fee, "hash:", built.hash().toString("hex").slice(0, 12));
