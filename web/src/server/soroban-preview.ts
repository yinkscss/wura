import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";

/**
 * Works out, from a simulated Soroban transaction, what signing it would let
 * the contract do with the user's money. The preview a person approves is built
 * from this, never from the site's text or the model's words.
 *
 * Every transfer the user must authorise shows up in the simulation's
 * authorisation entries, including transfers made by contracts the site's
 * contract calls. So we read that tree.
 *
 * No "server-only" import on purpose: tests load this file directly.
 */

export type Transfer = { token: string; from: string; to: string; amount: bigint };
export type CallSeen = { contract: string; fn: string };

export type Analysis = {
  transfers: Transfer[];
  calls: CallSeen[];
  /** Reasons to refuse outright. Empty means none found. */
  danger: string[];
  /** True if any entry needs a signature from someone other than the transaction's source account. */
  needsOtherSigner: boolean;
};

/** Function names that hand someone else standing power over the user's assets or the contract. */
const DANGEROUS_FNS = new Set([
  "approve",
  "increase_allowance",
  "decrease_allowance",
  "transfer_from",
  "burn_from",
  "set_admin",
  "set_authorized",
  "set_approval_for_all",
  "approve_for_all",
  "clawback",
  "upgrade",
  "update_current_contract_wasm",
  "add_signer",
  "add_policy",
  "set_owner",
  "transfer_ownership",
]);

function addressOf(sc: xdr.ScAddress): string {
  return Address.fromScAddress(sc).toString();
}

function walk(inv: xdr.SorobanAuthorizedInvocation, out: Analysis) {
  const fn = inv.function();
  const kind = fn.switch().name;
  if (kind === "sorobanAuthorizedFunctionTypeContractFn") {
    const c = fn.contractFn();
    const contract = addressOf(c.contractAddress());
    const name = c.functionName().toString();
    out.calls.push({ contract, fn: name });
    if (DANGEROUS_FNS.has(name)) {
      out.danger.push(`it calls ${name}, which gives someone standing power over your assets`);
    }
    if (name === "transfer") {
      const a = c.args();
      try {
        const [from, to, amount] = [scValToNative(a[0]), scValToNative(a[1]), scValToNative(a[2])];
        if (a.length === 3 && typeof from === "string" && typeof to === "string" && typeof amount === "bigint") {
          out.transfers.push({ token: contract, from, to, amount });
        } else {
          out.danger.push("it makes a transfer I couldn't read");
        }
      } catch {
        out.danger.push("it makes a transfer I couldn't read");
      }
    }
  } else {
    // Creating a contract from inside a signed call: never something a purchase needs.
    out.danger.push("it deploys new code from your account");
  }
  for (const sub of inv.subInvocations()) walk(sub, out);
}

export function analyzeAuth(entries: xdr.SorobanAuthorizationEntry[]): Analysis {
  const out: Analysis = { transfers: [], calls: [], danger: [], needsOtherSigner: false };
  for (const e of entries) {
    if (e.credentials().switch().name !== "sorobanCredentialsSourceAccount") out.needsOtherSigner = true;
    walk(e.rootInvocation(), out);
  }
  return out;
}

/** What the user pays, split into USDC cents we can cap and anything else we won't allow yet. */
export type Spend = {
  usdcCents: number;
  /** Amounts leaving the user in tokens we don't have a cap for. */
  other: Transfer[];
  /** What the user receives (transfers to them), for the preview. */
  incoming: Transfer[];
};

const STROOPS_PER_CENT = BigInt(100000); // USDC on Stellar has 7 decimals; Wura counts cents.

export function spendFor(a: Analysis, user: string, usdcContract: string): Spend {
  let usdcStroops = BigInt(0);
  const other: Transfer[] = [];
  const incoming: Transfer[] = [];
  for (const t of a.transfers) {
    if (t.to === user && t.from !== user) incoming.push(t);
    if (t.from !== user) continue;
    if (t.token === usdcContract) usdcStroops += t.amount;
    else other.push(t);
  }
  // Round up, so a cap is never undercounted.
  const usdcCents = Number((usdcStroops + STROOPS_PER_CENT - BigInt(1)) / STROOPS_PER_CENT);
  return { usdcCents, other, incoming };
}

/** One plain line per refusal reason. Returns null when the call is acceptable to sign. */
export function refusalFor(a: Analysis, s: Spend, describeToken: (contract: string) => string): string | null {
  if (a.danger.length) {
    return `I won't sign this: ${a.danger[0]}. That's how drainer sites work.`;
  }
  if (a.needsOtherSigner) {
    return "This call needs signatures from an account other than yours, which I can't provide yet, so I stopped.";
  }
  if (s.other.length) {
    const t = s.other[0];
    return `This takes ${describeToken(t.token)} from your wallet. Right now I only spend USDC on sites, because that's what your limits cover. Nothing was signed.`;
  }
  return null;
}
