import "server-only";
import { Account, Asset, BASE_FEE, Horizon, Keypair, Memo, Operation, StrKey, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import type { Currency } from "@/lib/types";
import { config, moneyKilled, moneyLive } from "./config";
import { ApiFailure } from "./errors";
import { LINK } from "./ramp/link";

/**
 * Stellar testnet access. Server-side only: the UI never talks to Horizon.
 * Amounts are handled in cents (2 decimals) and converted to Stellar's
 * 7-decimal strings here.
 */

/** The kill switch (MONEY_KILL=1). Every build and submit passes through here, so real money stops without a deploy. */
export function assertMoneyOn() {
  if (moneyLive() && moneyKilled()) {
    throw new ApiFailure("MONEY_PAUSED", "Payments are paused right now. Nothing was sent. Try again later.", 503);
  }
}

const server = () => new Horizon.Server(config.horizonUrl);

export const usdcAsset = () => new Asset(config.usdc.code, config.usdc.issuer);

/**
 * NGNC, the naira token (LINK's). It exists on mainnet only, so there is no
 * naira asset on testnet. The issuer comes from LINK's pinned config.
 */
export const ngncAsset = () => new Asset(LINK.NGN.asset.code, LINK.NGN.asset.issuer);

/** The Stellar asset for a currency, or null when this network has none (NGNC on testnet). */
export function assetFor(currency: Currency): Asset | null {
  if (currency === "USDC") return usdcAsset();
  return config.stellarNetwork === "mainnet" ? ngncAsset() : null;
}

function requireAsset(currency: Currency): Asset {
  const a = assetFor(currency);
  if (!a) throw new ApiFailure("SIGNING_UNAVAILABLE", `${currency === "NGN" ? "Naira (NGNC)" : currency} isn't available on ${config.stellarNetwork}.`, 409);
  return a;
}

/** A transaction memo. Anchors use text, id or hash (SEP-24 withdrawals). */
export type TxMemo = { type: "text"; value: string } | { type: "id"; value: string } | { type: "hash"; value: string };

export function toMemo(m: TxMemo): Memo {
  switch (m.type) {
    case "text":
      if (Buffer.byteLength(m.value, "utf8") > 28) throw new ApiFailure("BAD_REQUEST", "That payment note is too long (28 characters at most).", 400);
      return Memo.text(m.value);
    case "id":
      if (!/^\d{1,20}$/.test(m.value) || BigInt(m.value) > BigInt("18446744073709551615")) throw new ApiFailure("BAD_REQUEST", "That payment memo isn't a valid number.", 400);
      return Memo.id(m.value);
    case "hash":
      if (!/^[0-9a-fA-F]{64}$/.test(m.value)) throw new ApiFailure("BAD_REQUEST", "That payment memo isn't a valid hash.", 400);
      return Memo.hash(m.value);
  }
}

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
  /** NGNC (naira) balance in kobo, or null when there's no trustline. Always null off mainnet. */
  ngn: number | null;
  hasNgncTrustline: boolean;
  /** SEP-29: the account asks that every payment to it carries a memo (exchanges do). */
  memoRequired: boolean;
};

/** SEP-29: the account's data entry config.memo_required is "1" (base64 "MQ=="). */
export function isMemoRequired(data: Record<string, string> | undefined): boolean {
  return data?.["config.memo_required"] === "MQ==";
}

const isCredit = (b: { asset_type: string }) => b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12";

export async function getAccountStatus(address: string): Promise<AccountStatus> {
  try {
    const acct = await server().loadAccount(address);
    let xlm = "0";
    let usdc: number | null = null;
    let ngn: number | null = null;
    const naira = assetFor("NGN");
    for (const b of acct.balances) {
      if (b.asset_type === "native") xlm = b.balance;
      if (!isCredit(b)) continue;
      const c = b as { asset_code: string; asset_issuer: string; balance: string };
      if (c.asset_code === config.usdc.code && c.asset_issuer === config.usdc.issuer) usdc = amountToCents(c.balance);
      if (naira && c.asset_code === naira.getCode() && c.asset_issuer === naira.getIssuer()) ngn = amountToCents(c.balance);
    }
    return { address, exists: true, xlm, usdc, hasTrustline: usdc !== null, ngn, hasNgncTrustline: ngn !== null, memoRequired: isMemoRequired((acct as unknown as { data_attr?: Record<string, string> }).data_attr) };
  } catch (err) {
    if (isNotFound(err)) return { address, exists: false, xlm: "0", usdc: null, hasTrustline: false, ngn: null, hasNgncTrustline: false, memoRequired: false };
    throw networkError(err);
  }
}

/** Testnet only: creates and funds the account with test XLM. */
export async function fundWithFriendbot(address: string) {
  if (config.stellarNetwork !== "testnet" || !config.friendbotUrl) {
    throw new ApiFailure("BAD_REQUEST", "There is no test faucet on mainnet.", 400);
  }
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

/** Builds the unsigned transaction from an already-loaded account. Pure: no network, so it can be tested. */
export function buildTx(account: Account, op: Op, memo?: Memo): BuiltTx {
  const b = new TransactionBuilder(account, { fee: String(Number(BASE_FEE) * 2), networkPassphrase: config.networkPassphrase })
    .addOperation(op)
    .setTimeout(Math.floor(config.signTtlMs / 1000));
  if (memo) b.addMemo(memo);
  const tx = b.build();
  return { xdr: tx.toXDR(), hash: tx.hash().toString("hex") };
}

async function build(source: string, op: Op, memo?: string | TxMemo): Promise<BuiltTx> {
  assertMoneyOn();
  let account;
  try {
    account = await server().loadAccount(source);
  } catch (err) {
    if (isNotFound(err)) throw new ApiFailure("BAD_REQUEST", `Your wallet isn't set up on ${config.stellarNetwork} yet. Set it up first.`, 409);
    throw networkError(err);
  }
  const m = typeof memo === "string" ? { type: "text" as const, value: memo.slice(0, 28) } : memo;
  return buildTx(account, op, m ? toMemo(m) : undefined);
}

/** A payment of any supported asset, with an optional memo (default: the text "Wura"). */
export async function buildPayment(input: { from: string; to: string; currency: Currency; cents: number; memo?: TxMemo }) {
  const asset = requireAsset(input.currency);
  return build(input.from, Operation.payment({ destination: input.to, asset, amount: centsToAmount(input.cents) }), input.memo ?? "Wura");
}

/** Adds a trustline for a currency's asset. */
export function buildTrustline(address: string, currency: Currency) {
  return build(address, Operation.changeTrust({ asset: requireAsset(currency) }));
}

export const buildUsdcPayment = (from: string, to: string, cents: number) =>
  buildPayment({ from, to, currency: "USDC", cents });
export const buildUsdcTrustline = (address: string) => buildTrustline(address, "USDC");
export const buildNgncTrustline = (address: string) => buildTrustline(address, "NGN");

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

export type SponsorInfo = {
  exists: boolean;
  /** XLM balance. */
  xlm: number;
  /** XLM free to spend or lock up: balance minus the minimum balance (reserves). */
  available: number;
  /** Ledger entries this account sponsors for others (an account is 1, a trustline is 1). */
  sponsoringEntries: number;
  sponsoredAccounts: number;
};

/** The treasury's balance and sponsorship load, straight from Horizon. */
export async function getSponsorInfo(address: string): Promise<SponsorInfo> {
  try {
    const a = (await server().loadAccount(address)) as unknown as {
      balances: Array<{ asset_type: string; balance: string }>;
      subentry_count: number;
      num_sponsoring?: number;
      num_sponsored?: number;
    };
    const xlm = Number(a.balances.find((b) => b.asset_type === "native")?.balance ?? "0");
    const sponsoring = a.num_sponsoring ?? 0;
    const minimum = (2 + a.subentry_count + sponsoring - (a.num_sponsored ?? 0)) * 0.5;
    // If this fails the account cap can't be checked, so setup must stop (networkError below).
    const page = await server().accounts().sponsor(address).limit(200).call();
    const sponsoredAccounts = page.records.length;
    return { exists: true, xlm, available: xlm - minimum, sponsoringEntries: sponsoring, sponsoredAccounts };
  } catch (err) {
    if (isNotFound(err)) return { exists: false, xlm: 0, available: 0, sponsoringEntries: 0, sponsoredAccounts: 0 };
    throw networkError(err);
  }
}

/** Loads an account as an sdk Account (with its current sequence) to build a transaction from. */
export async function loadSourceAccount(address: string) {
  try {
    return await server().loadAccount(address);
  } catch (err) {
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

/** A submit whose result we couldn't learn (timeout, dropped connection). It may have landed. */
export class SubmitUnconfirmed extends Error {
  constructor(public hash: string) {
    super("Couldn't confirm whether the transaction went through.");
  }
}

export type HorizonLike = {
  submitTransaction(tx: Transaction): Promise<{ hash: string }>;
  transactions(): { transaction(hash: string): { call(): Promise<{ successful?: boolean }> } };
};

type ResultCodes = { transaction?: string; operations?: string[] };
const resultCodes = (err: unknown): ResultCodes | undefined =>
  (err as { response?: { data?: { extras?: { result_codes?: ResultCodes } } } })?.response?.data?.extras?.result_codes;

/** What Horizon knows about a transaction hash: it landed, it failed on chain, or it isn't there. */
export async function txOutcome(h: HorizonLike, hash: string): Promise<"success" | "failed" | "not_found"> {
  try {
    const t = await h.transactions().transaction(hash).call();
    return t.successful === false ? "failed" : "success";
  } catch (err) {
    if (isNotFound(err)) return "not_found";
    throw err;
  }
}

/**
 * Submits safely. Sending the same signed transaction again can't pay twice
 * (same hash), so every doubtful case is settled by asking Horizon whether the
 * hash landed:
 *   - rejected with result codes: a real failure, except tx_bad_seq, which is also
 *     what a resubmit of a transaction that already landed looks like;
 *   - no result (timeout, network): wait and look the hash up; if it still isn't
 *     there, throw SubmitUnconfirmed so the caller can retry the same signed XDR later.
 */
export async function submitWith(h: HorizonLike, tx: Transaction, opts: { pollMs?: number; polls?: number } = {}): Promise<string> {
  const hash = tx.hash().toString("hex");
  const pollMs = opts.pollMs ?? 2000;
  const polls = opts.polls ?? 3;
  try {
    const res = await h.submitTransaction(tx);
    return res.hash;
  } catch (err) {
    const codes = resultCodes(err);
    if (codes) {
      if (codes.transaction === "tx_bad_seq" && (await txOutcome(h, hash).catch(() => "not_found")) === "success") return hash;
      throw submitError(err);
    }
    for (let i = 0; i < polls; i++) {
      if (pollMs > 0) await new Promise((r) => setTimeout(r, pollMs));
      const o = await txOutcome(h, hash).catch(() => "not_found" as const);
      if (o === "success") return hash;
      if (o === "failed") throw new ApiFailure("BAD_REQUEST", "Stellar rejected the transaction. Nothing was sent.", 422);
    }
    console.error("submit unconfirmed", hash, err);
    throw new SubmitUnconfirmed(hash);
  }
}

/** Submits and returns the transaction hash, or throws a plain-language error. */
export async function submit(tx: Transaction): Promise<string> {
  assertMoneyOn();
  return submitWith(server() as unknown as HorizonLike, tx);
}

function isNotFound(err: unknown) {
  const e = err as { response?: { status?: number }; name?: string };
  return e?.response?.status === 404 || e?.name === "NotFoundError";
}

function networkError(err: unknown) {
  console.error("horizon error", err);
  return new ApiFailure("BAD_REQUEST", `Couldn't reach ${config.networkLabel}. Nothing was sent. Try again in a moment.`, 502);
}

function submitError(err: unknown) {
  const e = err as { response?: { data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } } } };
  const codes = e?.response?.data?.extras?.result_codes;
  const op = codes?.operations?.[0];
  const txc = codes?.transaction;
  const msg: Record<string, string> = {
    op_underfunded: `Your wallet doesn't have enough USDC for that on ${config.stellarNetwork}.`,
    op_no_trust: "The other account can't receive USDC yet: it has no USDC trustline.",
    op_no_destination: `That account doesn't exist on ${config.stellarNetwork} yet.`,
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
