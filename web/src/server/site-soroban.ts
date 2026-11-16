import "server-only";
import { Account, Asset, BASE_FEE, Contract, StrKey, TransactionBuilder, contract, rpc, xdr, type Transaction } from "@stellar/stellar-sdk";
import { config } from "./config";
import { ApiFailure } from "./errors";
import { SubmitUnconfirmed, assertMoneyOn } from "./stellar";
import { analyzeAuth, refusalFor, spendFor, type Analysis, type Spend } from "./soroban-preview";

/**
 * The Soroban side of site connect (docs/site-connect.md): check that a
 * contract found on a page is really deployed, read its function list from the
 * chain, build a call, simulate it, and submit it once the user has signed.
 * Page text never reaches here as an instruction: only a contract address, a
 * function name and arguments, all checked against the on-chain spec.
 */

function rpcUrl() {
  if (!config.sorobanRpcUrl) {
    throw new ApiFailure("SIGNING_UNAVAILABLE", "Site connect isn't set up on this network yet (no Soroban RPC address).", 503);
  }
  return config.sorobanRpcUrl;
}

const server = () => new rpc.Server(rpcUrl(), { allowHttp: false });

export const usdcContractId = () => new Asset(config.usdc.code, config.usdc.issuer).contractId(config.networkPassphrase);
export const xlmContractId = () => Asset.native().contractId(config.networkPassphrase);

export function describeToken(c: string) {
  if (c === usdcContractId()) return "USDC";
  if (c === xlmContractId()) return "XLM";
  return "a token I don't recognise";
}

export type FnInfo = { name: string; doc: string; inputs: Array<{ name: string; type: string }> };
export type ContractInfo = { address: string; functions: FnInfo[] };

/** Short name for a spec type, e.g. u32, i128, Address, Vec<Symbol>. */
export function typeName(t: xdr.ScSpecTypeDef): string {
  const kind = t.switch().name.replace(/^scSpecType/, "");
  switch (kind) {
    case "Vec":
      return `Vec<${typeName(t.vec().elementType())}>`;
    case "Option":
      return `Option<${typeName(t.option().valueType())}>`;
    case "Map":
      return `Map<${typeName(t.map().keyType())}, ${typeName(t.map().valueType())}>`;
    case "Udt":
      return t.udt().name().toString();
    case "BytesN":
      return `BytesN<${t.bytesN().n()}>`;
    default:
      return kind;
  }
}

async function clientFor(address: string) {
  if (!StrKey.isValidContract(address)) throw new ApiFailure("BAD_REQUEST", "That isn't a valid contract address.", 400);
  try {
    return await contract.Client.from({ contractId: address, networkPassphrase: config.networkPassphrase, rpcUrl: rpcUrl() });
  } catch (err) {
    if (err instanceof ApiFailure) throw err;
    console.error("contract lookup failed", address, err);
    throw new ApiFailure(
      "CONTRACT_NOT_FOUND",
      `${address.slice(0, 6)}…${address.slice(-4)} isn't a contract I can read on ${config.stellarNetwork}, so I stopped.`,
      404,
    );
  }
}

/** Confirms the contract is deployed and returns its public function list, read from the chain. */
export async function inspectContract(address: string): Promise<ContractInfo> {
  const client = await clientFor(address);
  const functions = client.spec.funcs().map((f) => ({
    name: f.name().toString(),
    doc: f.doc().toString().slice(0, 200),
    inputs: f.inputs().map((i) => ({ name: i.name().toString(), type: typeName(i.type()) })),
  }));
  if (functions.length === 0) {
    throw new ApiFailure("CONTRACT_UNVERIFIED", "That contract doesn't publish a function list, so I can't tell what it would do. I stopped.", 403);
  }
  return { address, functions };
}

export type Prepared = {
  xdr: string;
  hash: string;
  analysis: Analysis;
  spend: Spend;
  /** Network fee in stroops. */
  feeStroops: number;
  args: Array<{ name: string; type: string; value: string }>;
};

function show(v: unknown): string {
  const s = typeof v === "bigint" ? v.toString() : typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  return (s ?? "null").slice(0, 80);
}

/**
 * Builds the call, simulates it on the network and reads what it would do.
 * Throws if the function isn't in the spec, the arguments don't fit it, or the
 * simulation fails: we never sign something we couldn't simulate.
 */
export async function prepareCall(
  userAddress: string,
  input: { contract: string; fn: string; args: Record<string, unknown> },
): Promise<Prepared> {
  assertMoneyOn();
  const client = await clientFor(input.contract);
  const spec = client.spec;
  const fnSpec = spec.funcs().find((f) => f.name().toString() === input.fn);
  if (!fnSpec) throw new ApiFailure("BAD_REQUEST", `That contract has no function called ${input.fn}.`, 400);
  const inputs = fnSpec.inputs().map((i) => ({ name: i.name().toString(), type: typeName(i.type()) }));
  const given = Object.keys(input.args);
  const missing = inputs.filter((i) => !given.includes(i.name) && !i.type.startsWith("Option"));
  const extra = given.filter((g) => !inputs.some((i) => i.name === g));
  if (missing.length || extra.length) {
    throw new ApiFailure(
      "BAD_REQUEST",
      `${input.fn} takes ${inputs.map((i) => `${i.name}: ${i.type}`).join(", ") || "nothing"}. ${missing.length ? `Missing: ${missing.map((m) => m.name).join(", ")}. ` : ""}${extra.length ? `Not accepted: ${extra.join(", ")}.` : ""}`,
      400,
    );
  }
  let scArgs: xdr.ScVal[];
  try {
    scArgs = spec.funcArgsToScVals(input.fn, input.args);
  } catch (err) {
    throw new ApiFailure("BAD_REQUEST", `Those values don't fit ${input.fn}: ${(err as Error).message}`.slice(0, 200), 400);
  }

  const s = server();
  let account: Account;
  try {
    const a = await s.getAccount(userAddress);
    account = new Account(userAddress, a.sequenceNumber());
  } catch {
    throw new ApiFailure("BAD_REQUEST", `Your wallet isn't set up on ${config.stellarNetwork} yet. Set it up first.`, 409);
  }
  const raw = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: config.networkPassphrase })
    .addOperation(new Contract(input.contract).call(input.fn, ...scArgs))
    .setTimeout(Math.floor(config.signTtlMs / 1000))
    .build();

  let sim: rpc.Api.SimulateTransactionResponse;
  try {
    sim = await s.simulateTransaction(raw);
  } catch (err) {
    console.error("simulate failed", err);
    throw new ApiFailure("SIMULATION_FAILED", "I couldn't reach the network to simulate that, so nothing was prepared.", 502);
  }
  if (rpc.Api.isSimulationError(sim)) {
    throw new ApiFailure(
      "SIMULATION_FAILED",
      `The simulation of ${input.fn} failed, so I don't know what it would really do. I stopped instead of guessing.`,
      422,
    );
  }
  if (!rpc.Api.isSimulationSuccess(sim)) {
    throw new ApiFailure("SIMULATION_FAILED", "That call needs a restore step I can't do yet, so I stopped.", 422);
  }

  const analysis = analyzeAuth(sim.result?.auth ?? []);
  const spend = spendFor(analysis, userAddress, usdcContractId());
  const refusal = refusalFor(analysis, spend, describeToken);
  if (refusal) throw new ApiFailure("CONTRACT_UNVERIFIED", refusal, 403);

  const built: Transaction = rpc.assembleTransaction(raw, sim).build();
  return {
    xdr: built.toXDR(),
    hash: built.hash().toString("hex"),
    analysis,
    spend,
    feeStroops: Number(built.fee),
    args: inputs.map((i) => ({ name: i.name, type: i.type, value: show(input.args[i.name]) })),
  };
}

/** Submits a signed Soroban transaction through RPC and waits for the result. Returns the hash. */
export async function submitSoroban(tx: Transaction): Promise<string> {
  assertMoneyOn();
  const s = server();
  let sent: rpc.Api.SendTransactionResponse;
  try {
    sent = await s.sendTransaction(tx);
  } catch (err) {
    console.error("sendTransaction failed", err);
    throw new ApiFailure("BAD_REQUEST", "Couldn't reach the network. Nothing was sent.", 502);
  }
  // DUPLICATE: the same signed transaction is already in. Wait for its result instead of failing.
  if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
    console.error("send rejected", sent.status, sent.errorResult?.toXDR("base64"));
    throw new ApiFailure("BAD_REQUEST", "The network rejected the transaction. Nothing was sent.", 422);
  }
  const done = await s.pollTransaction(sent.hash, { attempts: 12, sleepStrategy: () => 1000 });
  // Not found yet: it may still land. The caller keeps the signed transaction and retries it, so it can't pay twice.
  if (done.status === rpc.Api.GetTransactionStatus.NOT_FOUND) throw new SubmitUnconfirmed(sent.hash);
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new ApiFailure("BAD_REQUEST", "The transaction failed on the network. Nothing was taken.", 422);
  }
  return sent.hash;
}
