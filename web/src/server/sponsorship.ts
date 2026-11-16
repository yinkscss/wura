/**
 * The sponsored account-setup transaction (D1, docs/mainnet-plan.md M3).
 *
 * The treasury pays the base reserves for a new user's account and trustlines,
 * so nobody has to buy XLM. Pure functions of their inputs (no network, no
 * "server-only") so the exact shape can be tested, and so the treasury signer
 * can refuse anything else.
 *
 * Operation order, transaction source = treasury:
 *   1. beginSponsoringFutureReserves  (source: treasury, sponsoredId: user)
 *   2. createAccount                  (source: treasury, only if the user's account is new)
 *   3. changeTrust x N                (source: user, one per asset)
 *   4. endSponsoringFutureReserves    (source: user)
 * The user's wallet signs the hash too (steps 3 and 4 are theirs).
 */
import {
  Asset,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  type Account,
  type Transaction,
} from "@stellar/stellar-sdk";

export type SetupPlan = {
  /** The treasury's account, loaded from Horizon (its sequence number is used). */
  treasury: Account;
  user: string;
  userExists: boolean;
  /** Only the trustlines the user is missing. */
  assets: Asset[];
  /** XLM for network fees on a new account, e.g. "0.5". Ignored when the account exists. */
  startingXlm: string;
  passphrase: string;
  timeoutSec: number;
};

export function buildSetupTx(plan: SetupPlan): Transaction {
  if (plan.userExists && plan.assets.length === 0) throw new Error("Nothing to set up.");
  const b = new TransactionBuilder(plan.treasury, {
    fee: String(Number(BASE_FEE) * 2),
    networkPassphrase: plan.passphrase,
  });
  const treasury = plan.treasury.accountId();
  b.addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: plan.user, source: treasury }));
  if (!plan.userExists) {
    b.addOperation(Operation.createAccount({ destination: plan.user, startingBalance: plan.startingXlm, source: treasury }));
  }
  for (const asset of plan.assets) {
    b.addOperation(Operation.changeTrust({ asset, source: plan.user }));
  }
  b.addOperation(Operation.endSponsoringFutureReserves({ source: plan.user }));
  return b.setTimeout(plan.timeoutSec).build();
}

export type SetupLimits = {
  treasury: string;
  user: string;
  /** The only assets a setup may add a trustline for. */
  allowedAssets: Asset[];
  /** The most XLM a setup may hand a new account. */
  maxStartingXlm: string;
};

const stroops = (xlm: string) => BigInt(Math.round(Number(xlm) * 1e7));

/**
 * Throws unless the transaction is exactly a sponsored setup for this user.
 * The treasury signs only what passes this, which is what makes "the treasury
 * key signs sponsorship only" true in code.
 */
export function assertSetupTx(tx: Transaction, lim: SetupLimits): void {
  const bad = (why: string): never => {
    throw new Error(`Refusing to sign with the treasury key: ${why}.`);
  };
  if (tx.source !== lim.treasury) bad("the transaction source isn't the treasury");
  if (tx.memo.type !== "none") bad("it carries a memo");
  if (!tx.timeBounds || tx.timeBounds.maxTime === "0") bad("it has no time limit");
  const ops = tx.operations;
  if (ops.length < 3) bad("too few operations");

  const first = ops[0];
  if (first.type !== "beginSponsoringFutureReserves" || first.source !== lim.treasury || first.sponsoredId !== lim.user) {
    bad("it must start by sponsoring the signed-in wallet");
  }
  const last = ops[ops.length - 1];
  if (last.type !== "endSponsoringFutureReserves" || last.source !== lim.user) bad("it must end the sponsorship, from the wallet");

  let i = 1;
  const maybeCreate = ops[i];
  if (maybeCreate.type === "createAccount") {
    if (maybeCreate.destination !== lim.user || maybeCreate.source !== lim.treasury) bad("it creates an account for someone else");
    if (stroops(maybeCreate.startingBalance) > stroops(lim.maxStartingXlm)) bad("the starting balance is too high");
    i++;
  }
  const seen = new Set<string>();
  for (; i < ops.length - 1; i++) {
    const o = ops[i];
    if (o.type !== "changeTrust") return bad(`unexpected ${o.type} operation`);
    if (o.source !== lim.user) bad("a trustline isn't the wallet's");
    const line = o.line as { code?: string; issuer?: string };
    const key = `${line.code}:${line.issuer}`;
    if (!lim.allowedAssets.some((a) => a.getCode() === line.code && a.getIssuer() === line.issuer)) bad("a trustline is for an asset we don't support");
    if (seen.has(key)) bad("a trustline is repeated");
    if (Number(o.limit) === 0) bad("a trustline would be removed");
    seen.add(key);
  }
  if (seen.size === 0) bad("it adds no trustline");
}

/** XLM the treasury locks up for one user: the account (1), each trustline (0.5), plus the fee balance. */
export function sponsorCostXlm(input: { newAccount: boolean; trustlines: number; startingXlm: string }): number {
  return (input.newAccount ? 1 + Number(input.startingXlm) : 0) + 0.5 * input.trustlines;
}
