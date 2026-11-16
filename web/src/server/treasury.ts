import "server-only";
import { Keypair, StrKey, type Asset } from "@stellar/stellar-sdk";
import type { Currency } from "@/lib/types";
import { config } from "./config";
import { ApiFailure } from "./errors";
import type { Session } from "./session";
import { assertSetupTx, buildSetupTx, sponsorCostXlm } from "./sponsorship";
import { assertMoneyOn, assetFor, getSponsorInfo, loadSourceAccount, type AccountStatus, type BuiltTx } from "./stellar";

/**
 * Wura's reserve (D1). One treasury account holds XLM and sponsors the base
 * reserve and trustlines of each beta user's wallet, so nobody has to buy XLM.
 *
 * - TREASURY_SECRET is a separate key from every other secret. It signs the
 *   sponsored setup transaction and nothing else: assertSetupTx refuses any
 *   other shape before the key is used.
 * - Sponsoring is gated: BETA_ALLOWLIST (emails), SPONSOR_MAX_ACCOUNTS, and a
 *   floor (TREASURY_MIN_XLM) below which it stops and logs an error. The log
 *   line is the low-balance alert until M8 adds delivery.
 * - Money stays non-custodial: the treasury never holds user funds. The user's
 *   own wallet signs the trustlines.
 */

const num = (v: string | undefined, d: number) => {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) && n >= 0 && (v ?? "").trim() !== "" ? n : d;
};

/** XLM handed to a new account for network fees (it can't make a payment with zero XLM). */
export const startingXlm = () => num(process.env.SPONSOR_FEE_XLM, 0.5).toFixed(7).replace(/0+$/, "").replace(/\.$/, ".0");
export const treasuryMinXlm = () => num(process.env.TREASURY_MIN_XLM, 20);
export const sponsorMaxAccounts = () => Math.floor(num(process.env.SPONSOR_MAX_ACCOUNTS, 10));

function secret() {
  return (process.env.TREASURY_SECRET || "").trim();
}

export function sponsorshipConfigured() {
  return StrKey.isValidEd25519SecretSeed(secret());
}

export function treasuryKeypair(): Keypair {
  if (!sponsorshipConfigured()) {
    throw new ApiFailure("SIGNING_UNAVAILABLE", "Wallet setup isn't available on this server yet.", 503);
  }
  return Keypair.fromSecret(secret());
}

/** Beta allowlist by email. Empty means nobody on mainnet, and everybody on testnet. */
export function sponsorAllowed(email: string): boolean {
  const list = (process.env.BETA_ALLOWLIST || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return config.stellarNetwork !== "mainnet";
  return list.includes(email.trim().toLowerCase());
}

export type TreasuryStatus = {
  address: string;
  xlm: number;
  available: number;
  minXlm: number;
  low: boolean;
  sponsoredAccounts: number;
  sponsoringEntries: number;
  maxAccounts: number;
};

/** The treasury's balance, free XLM and how many accounts it sponsors, from Horizon. */
export async function treasuryStatus(): Promise<TreasuryStatus> {
  const address = treasuryKeypair().publicKey();
  const info = await getSponsorInfo(address);
  return {
    address,
    xlm: info.xlm,
    available: info.available,
    minXlm: treasuryMinXlm(),
    low: info.available < treasuryMinXlm(),
    sponsoredAccounts: info.sponsoredAccounts,
    sponsoringEntries: info.sponsoringEntries,
    maxAccounts: sponsorMaxAccounts(),
  };
}

/** The assets a wallet on this network should hold a trustline for. */
export function requiredAssets(): Array<{ currency: Currency; asset: Asset }> {
  const out: Array<{ currency: Currency; asset: Asset }> = [];
  for (const c of ["USDC", "NGN"] as const) {
    const asset = assetFor(c);
    if (asset) out.push({ currency: c, asset });
  }
  return out;
}

/**
 * Builds the sponsored setup for this user (new account and/or missing
 * trustlines), checks it, and signs it with the treasury key. The user's
 * wallet signs the hash next.
 */
export async function prepareSponsoredSetup(s: Session, st: AccountStatus): Promise<BuiltTx> {
  assertMoneyOn(); // the kill switch stops the treasury key too
  if (!sponsorAllowed(s.email)) {
    throw new ApiFailure("NOT_INVITED", "Wura is invite-only for now. Your email isn't on the list yet.", 403);
  }
  const kp = treasuryKeypair();
  const missing = requiredAssets()
    .filter((r) => (r.currency === "USDC" ? !st.hasTrustline : !st.hasNgncTrustline))
    .map((r) => r.asset);

  const status = await treasuryStatus();
  const cost = sponsorCostXlm({ newAccount: !st.exists, trustlines: missing.length, startingXlm: startingXlm() });
  if (status.available - cost < status.minXlm) {
    console.error(`[treasury] LOW: ${status.available.toFixed(2)} XLM free, floor ${status.minXlm}. Refusing to sponsor ${s.address}. Top up ${status.address}.`);
    throw new ApiFailure("SIGNING_UNAVAILABLE", "Wallet setup is paused for a moment. We've been told. Try again later.", 503);
  }
  if (!st.exists && status.sponsoredAccounts >= status.maxAccounts) {
    console.error(`[treasury] account cap reached (${status.maxAccounts}). Refusing ${s.address}.`);
    throw new ApiFailure("NOT_INVITED", "Wura is full for now. We'll let you know when there's room.", 403);
  }
  if (status.low) console.error(`[treasury] LOW: ${status.available.toFixed(2)} XLM free, floor ${status.minXlm}. Top up ${status.address}.`);

  const treasury = await loadSourceAccount(kp.publicKey());
  const tx = buildSetupTx({
    treasury,
    user: s.address,
    userExists: st.exists,
    assets: missing,
    startingXlm: startingXlm(),
    passphrase: config.networkPassphrase,
    timeoutSec: Math.floor(config.signTtlMs / 1000),
  });
  assertSetupTx(tx, {
    treasury: kp.publicKey(),
    user: s.address,
    allowedAssets: requiredAssets().map((r) => r.asset),
    maxStartingXlm: startingXlm(),
  });
  tx.sign(kp);
  return { xdr: tx.toXDR(), hash: tx.hash().toString("hex") };
}
