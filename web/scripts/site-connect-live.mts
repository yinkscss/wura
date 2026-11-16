// Runs the real server modules against Stellar testnet: finds any deployed wasm contract,
// reads its interface (inspectContract), then simulates a call (prepareCall). Nothing is sent.
// Run: MONEY_MODE=testnet NODE_USE_ENV_PROXY=1 TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx scripts/site-connect-live.mts
import { Keypair, rpc } from "@stellar/stellar-sdk";
const { inspectContract, prepareCall } = await import("../src/server/site-soroban");

const RPC = "https://soroban-testnet.stellar.org";
const server = new rpc.Server(RPC);
const t = (label: string, t0: number) => console.log(`  ${label}: ${Date.now() - t0}ms`);

const kp = Keypair.random();
await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);

const latest = await server.getLatestLedger();
const ev = await server.getEvents({ startLedger: latest.sequence - 5000, filters: [{ type: "contract" }], limit: 200 });
const ids = [...new Set(ev.events.map((e) => e.contractId?.toString()).filter(Boolean) as string[])];
console.log("candidate contracts from recent events:", ids.length);

for (const id of ids) {
  const t0 = Date.now();
  try {
    const info = await inspectContract(id);
    t("inspectContract", t0);
    console.log("read contract", id, "->", info.functions.map((f) => `${f.name}(${f.inputs.map((i) => i.type).join(",")})`).slice(0, 6).join("; "));
    // Try calls whose arguments we can fill (none, or only Address/u32/u64/i128), until one simulates.
    let ok = false;
    for (const fn of info.functions) {
      const fill: Record<string, unknown> = {};
      let fillable = true;
      for (const i of fn.inputs) {
        if (i.type === "Address") fill[i.name] = kp.publicKey();
        else if (i.type === "u32" || i.type === "u64") fill[i.name] = 1;
        else if (i.type === "i128" || i.type === "U128") fill[i.name] = BigInt(1);
        else fillable = false;
      }
      if (!fillable) continue;
      const t1 = Date.now();
      try {
        const p = await prepareCall(kp.publicKey(), { contract: id, fn: fn.name, args: fill });
        t("prepareCall", t1);
        console.log("PREPARED", fn.name, "fee stroops", p.feeStroops, "usdc cents", p.spend.usdcCents, "calls", p.analysis.calls.map((c) => c.fn).join(","), "hash", p.hash.slice(0, 10));
        ok = true;
        break;
      } catch (e) {
        console.log("  ", fn.name, "->", (e as Error).message.slice(0, 90));
      }
    }
    if (!ok) continue;
    break;
  } catch (e) {
    console.log("skip", id.slice(0, 8), (e as Error).message.slice(0, 80));
  }
}
