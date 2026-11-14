import "server-only";
import { Asset, BASE_FEE, Horizon, Keypair, Memo, Operation, StrKey, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { config } from "./config";
import { ApiFailure } from "./errors";

/**
 * Stellar testnet access. Server-side only: the UI never talks to Horizon.
 * Amounts are handled in cents (2 decimals) and converted to Stellar's
 * 7-decimal strings here.
 */

const server = () => new Horizon.Server(config.horizonUrl);

export const usdcAsset = () => new Asset(config.usdc.code, config.usdc.issuer);

export function isValidAccount(address: string) {
  return StrKey.isValidEd25519PublicKey(address);
}

export function centsToAmount(cents: number) {
  return (cents / 100).toFixed(2);
}

/** "20.0000000" → 2000 cents, rounded down. */
export function amountToCents(amount: string) {
  return Math.floor(Number(amount) * 100 + 1e-6);
}

export type AccountStatus = {
  address: string;
  exists: boolean;
  xlm: string;
  /** USDC balance in cents, or null when there's no trustline. */
  usdc: number | null;
  hasTrustline: boolean;
};

export async function getAccountStatus(address: string): Promise<AccountStatus> {
  try {
    const acct = await server().loadAccount(address);
    let xlm = "0";
    let usdc: number | null = null;
    for (const b of acct.balances) {
      if (b.asset_type === "native") xlm = b.balance;
      if (
        (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
        b.asset_code === config.usdc.code &&
        b.asset_issuer === config.usdc.issuer
      ) {
        usdc = amountToCents(b.balance);
      }
    }
    return { address, exists: true, xlm, usdc, hasTrustline: usdc !== null };
  } catch (err) {
    if (isNotFound(err)) return { address, exists: false, xlm: "0", usdc: null, hasTrustline: false };
    throw networkError(err);
  }
}

/** Testnet only: creates and funds the account with test XLM. */
export async function fundWithFriendbot(address: string) {
  const res = await fetch(`${config.friendbotUrl}/?addr=${encodeURIComponent(address)}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // Friendbot says "already funded" with a 400; that's fine for us.
    if (!/createAccountAlreadyExist|already funded/i.test(body)) {
      throw new ApiFailure("BAD_REQUEST", "Couldn't get test XLM from Friendbot. Try again in a minute.", 502);
    }
  }
}

export type BuiltTx = { xdr: string; hash: string };

type Op = ReturnType<typeof Operation.payment> | ReturnType<typeof Operation.changeTrust> | ReturnType<typeof Operation.setOptions>;

async function build(source: string, op: Op, memo?: string): Promise<BuiltTx> {
  let account;
  try {
    account = await server().loadAccount(source);
  } catch (err) {
    if (isNotFound(err)) throw new ApiFailure("BAD_REQUEST", "Your wallet isn't set up on testnet yet. Set it up first.", 409);
    throw networkError(err);
  }
  const b = new TransactionBuilder(account, { fee: String(Number(BASE_FEE) * 2), networkPassphrase: config.networkPassphrase })
    .addOperation(op)
    .setTimeout(Math.floor(config.signTtlMs / 1000));
  if (memo) b.addMemo(Memo.text(memo.slice(0, 28)));
  const tx = b.build();
  return { xdr: tx.toXDR(), hash: tx.hash().toString("hex") };
}

export function buildUsdcPayment(from: string, to: string, cents: number) {
  return build(from, Operation.payment({ destination: to, asset: usdcAsset(), amount: centsToAmount(cents) }), "Wura");
}

export function buildUsdcTrustline(address: string) {
  return build(address, Operation.changeTrust({ asset: usdcAsset() }));
}

/**
 * Chat approvals: adds Wura's agent key as a second signer. Weights tested on
 * testnet: the user's own key gets weight 2 and the agent key 1, with
 * thresholds low 1 / medium 1 / high 2. So the agent key can make payments
 * (medium) but can't add or change signers, change thresholds or merge the
 * account (high). The user's key alone can still do everything.
 */
export function buildAgentKeyOn(address: string, agentAddress: string) {
  return build(
    address,
    Operation.setOptions({
      masterWeight: 2,
      lowThreshold: 1,
      medThreshold: 1,
      highThreshold: 2,
      signer: { ed25519PublicKey: agentAddress, weight: 1 },
    }),
  );
}

/** Removes the agent key and puts the account back to the default single-key setup. */
export function buildAgentKeyOff(address: string, agentAddress: string) {
  return build(
    address,
    Operation.setOptions({
      signer: { ed25519PublicKey: agentAddress, weight: 0 },
      masterWeight: 1,
      lowThreshold: 0,
      medThreshold: 0,
      highThreshold: 0,
    }),
  );
}

export type AccountSigners = {
  exists: boolean;
  signers: Array<{ key: string; weight: number }>;
  thresholds: { low: number; med: number; high: number };
};

/** The account's signers and thresholds, straight from Horizon. */
export async function getAccountSigners(address: string): Promise<AccountSigners> {
  try {
    const a = await server().loadAccount(address);
    return {
      exists: true,
      signers: a.signers.map((x) => ({ key: x.key, weight: x.weight })),
      thresholds: { low: a.thresholds.low_threshold, med: a.thresholds.med_threshold, high: a.thresholds.high_threshold },
    };
  } catch (err) {
    if (isNotFound(err)) return { exists: false, signers: [], thresholds: { low: 0, med: 0, high: 0 } };
    throw networkError(err);
  }
}

/** Checks a 64-byte ed25519 signature over the transaction hash. */
export function verifySignature(address: string, hashHex: string, signatureHex: string) {
  const sig = Buffer.from(signatureHex.replace(/^0x/, ""), "hex");
  if (sig.length !== 64) return false;
  try {
    return Keypair.fromPublicKey(address).verify(Buffer.from(hashHex, "hex"), sig);
  } catch {
    return false;
  }
}

export function signWithKeypair(xdr: string, kp: Keypair) {
  const tx = TransactionBuilder.fromXDR(xdr, config.networkPassphrase) as Transaction;
  tx.sign(kp);
  return tx;
}

export function attachSignature(xdr: string, address: string, signatureHex: string) {
  const tx = TransactionBuilder.fromXDR(xdr, config.networkPassphrase) as Transaction;
  tx.addSignature(address, Buffer.from(signatureHex.replace(/^0x/, ""), "hex").toString("base64"));
  return tx;
}

/** Submits and returns the transaction hash, or throws a plain-language error. */
export async function submit(tx: Transaction): Promise<string> {
  try {
    const res = await server().submitTransaction(tx);
    return res.hash;
  } catch (err) {
    throw submitError(err);
  }
}

function isNotFound(err: unknown) {
  const e = err as { response?: { status?: number }; name?: string };
  return e?.response?.status === 404 || e?.name === "NotFoundError";
}

function networkError(err: unknown) {
  console.error("horizon error", err);
  return new ApiFailure("BAD_REQUEST", "Couldn't reach Stellar testnet. Nothing was sent. Try again in a moment.", 502);
}

function submitError(err: unknown) {
  const e = err as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } };
  const codes = e?.response?.data?.extras?.result_codes;
  const op = codes?.operations?.[0];
  const txc = codes?.transaction;
  const msg: Record<string, string> = {
    op_underfunded: "Your wallet doesn't have enough USDC for that on testnet.",
    op_no_trust: "The other account can't receive USDC yet: it has no USDC trustline.",
    op_no_destination: "That account doesn't exist on testnet yet.",
    op_line_full: "The other account can't hold that much USDC.",
    op_src_no_trust: "Your wallet isn't set up for USDC yet. Set it up first.",
    op_low_reserve: "Your wallet needs a little more XLM to do that.",
    tx_bad_seq: "Another transaction went through first. Ask again and I'll rebuild it.",
    tx_too_late: "That took too long to sign, so it expired. Ask again.",
    tx_bad_auth: "The signature didn't match your wallet, so nothing was sent.",
    tx_insufficient_fee: "The network fee was too low. Try again.",
  };
  const text = (op && msg[op]) || (txc && msg[txc]) || "Stellar rejected the transaction. Nothing was sent.";
  console.error("submit failed", codes ?? err);
  return new ApiFailure("BAD_REQUEST", text, 422);
}
