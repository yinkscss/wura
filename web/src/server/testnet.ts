import "server-only";
import type { NeedsSignature, SendIntent, WalletStatus } from "@/lib/types";
import { usdc } from "@/lib/format";
import { config, serverDevSigning } from "./config";
import { devKeypairFor } from "./dev-keys";
import { ApiFailure } from "./errors";
import { checkLimits, log } from "./money";
import type { Session } from "./session";
import {
  attachSignature,
  buildUsdcPayment,
  buildUsdcTrustline,
  fundWithFriendbot,
  getAccountStatus,
  signWithKeypair,
  submit,
  verifySignature,
  type BuiltTx,
} from "./stellar";
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
    network: "testnet",
    exists: st.exists,
    xlm: st.xlm,
    usdc: st.usdc,
    hasTrustline: st.hasTrustline,
    ready: st.exists && st.hasTrustline,
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

/** Validates a destination before showing a send preview. */
export async function checkDestination(address: string, name: string) {
  const st = await getAccountStatus(address);
  if (!st.exists) throw new ApiFailure("UNKNOWN_CONTACT", `${name}'s account doesn't exist on testnet yet.`, 404);
  if (!st.hasTrustline) {
    throw new ApiFailure("UNKNOWN_CONTACT", `${name}'s account can't receive USDC yet: it has no USDC trustline.`, 409);
  }
}

/** Real USDC balance (cents). Throws a clear error if the wallet isn't set up. */
export async function usdcBalance(s: Session) {
  const st = await getAccountStatus(s.address);
  if (!st.exists || !st.hasTrustline) {
    throw new ApiFailure("BAD_REQUEST", "Your testnet wallet isn't set up for USDC yet. Set it up on the wallet page first.", 409);
  }
  return st.usdc ?? 0;
}

export async function recheckSend(s: Session, w: WalletState, intent: SendIntent) {
  if (intent.status !== "pending") throw new ApiFailure("ALREADY_USED", "That payment was already sent or cancelled.", 409);
  checkLimits(w, "USDC", intent.amount);
  const bal = await usdcBalance(s);
  if (intent.total > bal) {
    throw new ApiFailure("INSUFFICIENT_BALANCE", `You don't have enough USDC. Your testnet balance is ${usdc(bal)}.`, 403);
  }
}

export function finishSend(w: WalletState, intent: SendIntent, hash: string) {
  intent.status = "sent";
  w.spentToday.USDC += intent.amount;
  return log(w, {
    kind: "send",
    detail: `To ${intent.to.name}`,
    amount: usdc(intent.amount),
    status: "done",
    txRef: hash,
    explorerUrl: config.explorerTx(hash),
  });
}

/** Called by createSend after approval in testnet mode. */
export async function startTestnetSend(s: Session, intent: SendIntent) {
  const w = wallet(s.userId);
  await recheckSend(s, w, intent);
  const tx = await buildUsdcPayment(s.address, intent.to.address, intent.amount);
  if (serverDevSigning()) {
    const hash = await submit(signWithKeypair(tx.xdr, devKeypairFor(s.email)));
    const activity = finishSend(w, intent, hash);
    return { status: "done" as const, intent, activity, mock: false };
  }
  return { ...needsSignature(s, park(w, tx, "send", intent.id)), intent };
}

/** The user's wallet signed the hash. Verify, re-check and submit. */
export async function submitSigned(s: Session, input: { txId: string; signature: string }) {
  const w = wallet(s.userId);
  const p = w.pendingTx.get(String(input.txId));
  if (!p) throw new ApiFailure("INTENT_NOT_FOUND", "That transaction isn't waiting for a signature. Ask again.", 404);
  if (p.status !== "pending") throw new ApiFailure("ALREADY_USED", "That transaction was already submitted.", 409);
  if (Date.now() > p.expiresAt) {
    p.status = "failed";
    throw new ApiFailure("QUOTE_EXPIRED", "That took too long to sign, so it expired. Ask again.", 410);
  }
  const sig = String(input.signature ?? "");
  if (!/^(0x)?[0-9a-fA-F]{128}$/.test(sig) || !verifySignature(s.address, p.hash, sig)) {
    throw new ApiFailure("NOT_APPROVED", "The signature didn't match your wallet, so nothing was sent.", 403);
  }

  let intent: SendIntent | undefined;
  if (p.kind === "send") {
    intent = w.sends.get(p.intentId ?? "");
    if (!intent) throw new ApiFailure("INTENT_NOT_FOUND", "That payment preview doesn't exist any more.", 404);
    await recheckSend(s, w, intent);
  }

  p.status = "submitted";
  let hash: string;
  try {
    hash = await submit(attachSignature(p.xdr, s.address, sig));
  } catch (err) {
    p.status = "failed";
    throw err;
  }

  if (p.kind === "trustline") return { status: "ready" as const, kind: p.kind, hash, wallet: await walletStatus(s) };
  if (p.kind === "agent-key-on" || p.kind === "agent-key-off") return { status: "ready" as const, kind: p.kind, hash };
  const activity = finishSend(w, intent!, hash);
  return { status: "done" as const, kind: p.kind, hash, intent: intent!, activity, mock: false };
}

export function refuseInTestnet(what: string) {
  if (config.moneyMode === "testnet") {
    throw new ApiFailure(
      "SIGNING_UNAVAILABLE",
      `On testnet, only USDC sends are real so far. ${what} go live once real quotes are wired.`,
      409,
    );
  }
}
