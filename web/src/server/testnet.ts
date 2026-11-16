import "server-only";
import type { Currency, NeedsSignature, PaymentMemo, Quote, SendIntent, SiteAction, WalletStatus } from "@/lib/types";
import { money, usdc } from "@/lib/format";
import { config, serverDevSigning } from "./config";
import { devKeypairFor } from "./dev-keys";
import { ApiFailure } from "./errors";
import { checkLimits, log } from "./money";
import type { Session } from "./session";
import {
  attachSignature,
  SubmitUnconfirmed,
  assetFor,
  buildPayment,
  buildUsdcTrustline,
  fundWithFriendbot,
  getAccountStatus,
  signWithKeypair,
  submit,
  verifySignature,
  type AccountStatus,
  type BuiltTx,
} from "./stellar";
import { TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import { alert } from "./alerts";
import { submitSoroban } from "./site-soroban";
import { finishSwap, recheckSwap } from "./swaps";
import { assertInvited, prepareSponsoredSetup, sponsorshipConfigured } from "./treasury";
import { newId, wallet, type PendingTx, type WalletState } from "./store";

/**
 * Real Stellar testnet flows (MONEY_MODE=testnet).
 *
 * Signing never skips our checks. The order is always:
 *   1. The user approves the preview (approve: true).
 *   2. We re-check limits and the real Horizon balance, then build the tx.
 *   3. The user's Privy wallet signs the tx hash in the browser
 *      (or, with TESTNET_SIGNER=server-dev, a throwaway testnet key does).
 *   4. We verify the signature belongs to the signed-in user's address,
 *      re-check everything again, attach it and submit to Horizon.
 */

export async function walletStatus(s: Session): Promise<WalletStatus> {
  const st = await getAccountStatus(s.address);
  return {
    address: s.address,
    network: config.stellarNetwork,
    exists: st.exists,
    xlm: st.xlm,
    usdc: st.usdc,
    hasTrustline: st.hasTrustline,
    ngn: st.ngn,
    hasNgncTrustline: st.hasNgncTrustline,
    needsNgnc: assetFor("NGN") !== null,
    sponsored: sponsorshipConfigured(),
    ready: st.exists && st.hasTrustline && (assetFor("NGN") === null || st.hasNgncTrustline),
    usdcIssuer: config.usdc.issuer,
    usingCircleUsdc: config.usingCircleUsdc,
  };
}

export function park(w: WalletState, tx: BuiltTx, kind: PendingTx["kind"], intentId?: string): PendingTx {
  const p: PendingTx = { id: newId("tx"), kind, xdr: tx.xdr, hash: tx.hash, intentId, expiresAt: Date.now() + config.signTtlMs, status: "pending" };
  w.pendingTx.set(p.id, p);
  return p;
}

export function needsSignature(s: Session, p: PendingTx): NeedsSignature {
  return { status: "needs_signature", txId: p.id, hash: p.hash, address: s.address };
}

/** Funds the account with test XLM (Friendbot) and adds the USDC trustline. */
export async function setupWallet(s: Session): Promise<{ status: "ready"; wallet: WalletStatus; hash?: string } | NeedsSignature> {
  const w = wallet(s.userId);
  let st = await getAccountStatus(s.address);

  // Wura's reserve sets the wallet up: account and trustlines, no XLM needed from the user (D1).
  if (sponsorshipConfigured()) {
    const ready = st.exists && st.hasTrustline && (assetFor("NGN") === null || st.hasNgncTrustline);
    if (ready) return { status: "ready", wallet: await walletStatus(s) };
    const tx = await prepareSponsoredSetup(s, st);
    if (serverDevSigning()) {
      const hash = await submit(signWithKeypair(tx.xdr, devKeypairFor(s.email)));
      return { status: "ready", wallet: await walletStatus(s), hash };
    }
    return needsSignature(s, park(w, tx, "setup"));
  }
  if (config.stellarNetwork === "mainnet") {
    throw new ApiFailure("SIGNING_UNAVAILABLE", "Wallet setup isn't available on this server yet.", 503);
  }

  if (!st.exists) {
    await fundWithFriendbot(s.address);
    st = await getAccountStatus(s.address);
    if (!st.exists) throw new ApiFailure("BAD_REQUEST", "Friendbot didn't create the account. Try again in a minute.", 502);
  }
  if (st.hasTrustline) return { status: "ready", wallet: await walletStatus(s) };

  const tx = await buildUsdcTrustline(s.address);
  if (serverDevSigning()) {
    const hash = await submit(signWithKeypair(tx.xdr, devKeypairFor(s.email)));
    return { status: "ready", wallet: await walletStatus(s), hash };
  }
  return needsSignature(s, park(w, tx, "trustline"));
}

const assetName = (c: Currency) => (c === "NGN" ? "naira (NGNC)" : "USDC");

/**
 * Validates a destination before a send preview and again before it is signed
 * and submitted: the account exists, it can receive this asset (trustline), and
 * if it asks for a memo (SEP-29, exchanges do) the payment carries one.
 */
export async function checkDestination(address: string, name: string, asset: Currency = "USDC", memo?: PaymentMemo) {
  if (!assetFor(asset)) {
    throw new ApiFailure("BAD_REQUEST", `${assetName(asset)} isn't available on ${config.stellarNetwork}.`, 409);
  }
  const problem = destinationProblem(await getAccountStatus(address), name, asset, memo);
  if (problem) throw problem;
}

/** The pure part of checkDestination: what's wrong with this destination for this payment, if anything. */
export function destinationProblem(st: AccountStatus, name: string, asset: Currency, memo?: PaymentMemo): ApiFailure | null {
  if (!st.exists) return new ApiFailure("UNKNOWN_CONTACT", `${name}'s account doesn't exist on ${config.stellarNetwork} yet.`, 404);
  if (!(asset === "USDC" ? st.hasTrustline : st.hasNgncTrustline)) {
    return new ApiFailure("UNKNOWN_CONTACT", `${name}'s account can't receive ${assetName(asset)} yet: it has no trustline for it.`, 409);
  }
  if (st.memoRequired && !memo) {
    return new ApiFailure("BAD_REQUEST", `${name}'s account needs a memo on every payment (exchanges ask for this). Add the memo they gave you and try again.`, 409);
  }
  return null;
}

/** Real balance of an asset (minor units). Throws a clear error if the wallet isn't set up for it. */
export async function assetBalance(s: Session, asset: Currency) {
  if (!assetFor(asset)) throw new ApiFailure("BAD_REQUEST", `${assetName(asset)} isn't available on ${config.stellarNetwork}.`, 409);
  const st = await getAccountStatus(s.address);
  const ok = st.exists && (asset === "USDC" ? st.hasTrustline : st.hasNgncTrustline);
  if (!ok) {
    throw new ApiFailure("BAD_REQUEST", `Your wallet isn't set up for ${assetName(asset)} yet. Set it up on the wallet page first.`, 409);
  }
  return (asset === "USDC" ? st.usdc : st.ngn) ?? 0;
}

/** Real USDC balance (cents). */
export const usdcBalance = (s: Session) => assetBalance(s, "USDC");

/** Everything that can change between the preview and the signature, checked again. */
export async function recheckSend(s: Session, w: WalletState, intent: SendIntent) {
  if (intent.status !== "pending") throw new ApiFailure("ALREADY_USED", "That payment was already sent or cancelled.", 409);
  assertInvited(s.email); // someone taken off the list after previewing must not still be able to send
  checkLimits(w, intent.asset, intent.amount);
  const bal = await assetBalance(s, intent.asset);
  if (intent.total > bal) {
    throw new ApiFailure("INSUFFICIENT_BALANCE", `You don't have enough ${assetName(intent.asset)}. Your balance is ${money(bal, intent.asset)}.`, 403);
  }
  await checkDestination(intent.to.address, intent.to.name, intent.asset, intent.memo);
}

/** Records a sent payment once. Calling it again for the same intent returns the same entry. */
export function finishSend(w: WalletState, intent: SendIntent, hash: string) {
  if (intent.status === "sent") {
    const prior = w.activity.find((a) => a.txRef === hash);
    if (prior) return prior;
  }
  intent.status = "sent";
  w.spentToday[intent.asset] += intent.amount;
  return log(w, {
    kind: "send",
    detail: `To ${intent.to.name}`,
    amount: money(intent.amount, intent.asset),
    status: "done",
    txRef: hash,
    explorerUrl: config.explorerTx(hash),
  });
}

/** The payment for an approved intent: the right asset, and its memo if it has one. */
export function buildIntentPayment(s: Session, intent: SendIntent) {
  return buildPayment({ from: s.address, to: intent.to.address, currency: intent.asset, cents: intent.amount, memo: intent.memo });
}

/** Called by createSend after approval on a live network. */
export async function startTestnetSend(s: Session, intent: SendIntent) {
  const w = wallet(s.userId);
  await recheckSend(s, w, intent);
  const tx = await buildIntentPayment(s, intent);
  if (serverDevSigning()) {
    const hash = await submit(signWithKeypair(tx.xdr, devKeypairFor(s.email)));
    const activity = finishSend(w, intent, hash);
    return { status: "done" as const, intent, activity, mock: false };
  }
  return { ...needsSignature(s, park(w, tx, "send", intent.id)), intent };
}

/** The user's wallet signed the hash. Verify, re-check and submit. A repeat never pays twice. */
export async function submitSigned(s: Session, input: { txId: string; signature: string }) {
  const w = wallet(s.userId);
  const p = w.pendingTx.get(String(input.txId));
  if (!p) throw new ApiFailure("INTENT_NOT_FOUND", "That transaction isn't waiting for a signature. Ask again.", 404);

  let signed: Transaction;
  let intent: SendIntent | undefined;
  let quote: Quote | undefined;
  if (p.kind === "send") {
    intent = w.sends.get(p.intentId ?? "");
    if (!intent) throw new ApiFailure("INTENT_NOT_FOUND", "That payment preview doesn't exist any more.", 404);
  }
  if (p.kind === "swap") {
    quote = w.quotes.get(p.intentId ?? "");
    if (!quote) throw new ApiFailure("QUOTE_NOT_FOUND", "That quote doesn't exist any more. Ask for a new one.", 404);
  }

  if (p.status === "unconfirmed" && p.signedXdr) {
    // We never learned if it landed. The same signed transaction can't pay twice, so ask Horizon again.
    // No fresh balance or limit checks here: if it landed, they already moved.
    signed = TransactionBuilder.fromXDR(p.signedXdr, config.networkPassphrase) as Transaction;
  } else {
    if (p.status !== "pending") throw new ApiFailure("ALREADY_USED", "That transaction was already submitted.", 409);
    if (Date.now() > p.expiresAt) {
      p.status = "failed";
      throw new ApiFailure("QUOTE_EXPIRED", "That took too long to sign, so it expired. Ask again.", 410);
    }
    const sig = String(input.signature ?? "");
    if (!/^(0x)?[0-9a-fA-F]{128}$/.test(sig) || !verifySignature(s.address, p.hash, sig)) {
      throw new ApiFailure("NOT_APPROVED", "The signature didn't match your wallet, so nothing was sent.", 403);
    }
    if (intent) await recheckSend(s, w, intent);
    if (quote) await recheckSwap(s, w, quote); // the price itself is held by the transaction's minimum
    signed = attachSignature(p.xdr, s.address, sig);
    p.signedXdr = signed.toXDR();
  }

  let action: SiteAction | undefined;
  if (p.kind === "site") {
    action = w.siteActions.get(p.intentId ?? "");
    if (!action || action.status !== "pending") throw new ApiFailure("ALREADY_USED", "That site payment was already signed or cancelled.", 409);
    if (p.status === "pending") checkLimits(w, "USDC", action.price);
  }

  p.status = "submitted";
  let hash: string;
  try {
    hash = p.kind === "site" ? await submitSoroban(signed) : await submit(signed);
  } catch (err) {
    if (err instanceof SubmitUnconfirmed) {
      p.status = "unconfirmed";
      void alert("submit_unconfirmed", `a ${p.kind} (tx ${p.hash.slice(0, 12)}…) was submitted but Horizon never said if it landed. Retrying the same signed XDR is safe.`, p.hash);
      throw new ApiFailure("BAD_REQUEST", "We couldn't confirm yet whether that went through. Check again in a moment. It won't be sent twice.", 502);
    }
    p.status = "failed";
    void alert("submit_failed", `a ${p.kind} (tx ${p.hash.slice(0, 12)}…) was rejected: ${err instanceof Error ? err.message.slice(0, 160) : "unknown"}`, p.hash);
    throw err;
  }

  if (p.kind === "trustline" || p.kind === "setup") return { status: "ready" as const, kind: p.kind, hash, wallet: await walletStatus(s) };
  if (p.kind === "agent-key-on" || p.kind === "agent-key-off") return { status: "ready" as const, kind: p.kind, hash };
  if (quote) {
    const activity = await finishSwap(w, quote, hash);
    return { status: "done" as const, kind: p.kind, hash, quote, activity, mock: false };
  }
  if (action) {
    const activity = finishSiteAction(w, action, hash);
    return { status: "done" as const, kind: p.kind, hash, action, activity, mock: false };
  }
  const activity = finishSend(w, intent!, hash);
  return { status: "done" as const, kind: p.kind, hash, intent: intent!, activity, mock: false };
}

/** A real site call went through. Counts the USDC it took against today's cap and logs it. */
export function finishSiteAction(w: WalletState, action: SiteAction, hash: string) {
  action.status = "signed";
  w.spentToday.USDC += action.price;
  return log(w, {
    kind: "site",
    detail: `${action.siteName} · ${action.call.fn}`,
    amount: usdc(action.price),
    status: "done",
    txRef: hash,
    explorerUrl: config.explorerTx(hash),
  });
}
