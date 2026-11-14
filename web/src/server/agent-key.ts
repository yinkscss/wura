import "server-only";
import { createHmac } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import type { ChatApprovalStatus, NeedsSignature, SendIntent } from "@/lib/types";
import { config, serverDevSigning } from "./config";
import { devKeypairFor } from "./dev-keys";
import { ApiFailure } from "./errors";
import type { Session } from "./session";
import {
  buildAgentKeyOff,
  buildAgentKeyOn,
  buildUsdcPayment,
  getAccountSigners,
  signWithKeypair,
  submit,
  type AccountSigners,
} from "./stellar";
import { wallet } from "./store";
import { finishSend, needsSignature, park, recheckSend } from "./testnet";

/**
 * Chat approvals on Stellar testnet.
 *
 * A chat app (Telegram, later WhatsApp and MCP) can't open the user's Privy
 * wallet to sign. So, once, on the web, the user's own wallet adds a Wura
 * "agent key" as a second signer on their account (weights in
 * stellar.ts buildAgentKeyOn). After that, when the user taps Approve in a
 * chat app, the server signs that one payment with the agent key.
 *
 * - The agent key can make payments but can't change signers or merge the
 *   account. The user can remove it from the web at any time.
 * - Every payment still goes through createSend's checks first: the linked
 *   user tapped Approve on this exact preview, it isn't expired or used, and
 *   it's within the caps and the balance. The caps are checked by our server,
 *   not by Stellar; on-chain caps are the smart-wallet roadmap.
 * - Each user's key is derived from AGENT_KEY_SECRET and their user ID. It is
 *   never stored. If AGENT_KEY_SECRET leaked, every opted-in account could be
 *   drained, which is why this is testnet only.
 * - Horizon is the record of truth: we read the account's signers before every
 *   chat payment, never a flag in our database.
 */

function agentSecret() {
  const s = process.env.AGENT_KEY_SECRET || "";
  return s.length >= 32 ? s : "";
}

/** Chat approvals need testnet and a dedicated AGENT_KEY_SECRET (no fallback). */
export function chatApprovalsAvailable() {
  return config.moneyMode === "testnet" && config.stellarNetwork === "testnet" && !!agentSecret();
}

export function agentKeypairFor(userId: string) {
  if (!chatApprovalsAvailable()) {
    throw new ApiFailure("SIGNING_UNAVAILABLE", "Chat approvals aren't set up on this server.", 503);
  }
  const seed = createHmac("sha256", agentSecret()).update(`wura-agent-key:v1:${userId}`).digest();
  return Keypair.fromRawEd25519Seed(seed);
}

/** True only for exactly the setup we create: user key 2, agent key 1, thresholds 1/1/2. */
function isActive(acct: AccountSigners, userAddress: string, agentAddress: string) {
  const user = acct.signers.find((x) => x.key === userAddress)?.weight ?? 0;
  const agent = acct.signers.find((x) => x.key === agentAddress)?.weight ?? 0;
  const t = acct.thresholds;
  return acct.exists && agent >= 1 && agent >= t.med && agent < t.high && user >= t.high;
}

export async function chatApprovalStatus(s: Session): Promise<ChatApprovalStatus> {
  if (!chatApprovalsAvailable()) return { available: false, active: false };
  const agentAddress = agentKeypairFor(s.userId).publicKey();
  const acct = await getAccountSigners(s.address);
  return { available: true, active: isActive(acct, s.address, agentAddress), agentAddress };
}

type Ready = { status: "ready"; chatApproval: ChatApprovalStatus };

async function signedByUser(s: Session, kind: "agent-key-on" | "agent-key-off", tx: { xdr: string; hash: string }): Promise<Ready | NeedsSignature> {
  if (serverDevSigning()) {
    await submit(signWithKeypair(tx.xdr, devKeypairFor(s.email)));
    return { status: "ready", chatApproval: await chatApprovalStatus(s) };
  }
  // The user's Privy wallet signs in the browser; /api/tx/submit verifies and submits.
  return needsSignature(s, park(wallet(s.userId), tx, kind));
}

/** Builds the one-time setOptions that adds the agent key. The user's wallet signs it. */
export async function enableChatApprovals(s: Session): Promise<Ready | NeedsSignature> {
  const agentAddress = agentKeypairFor(s.userId).publicKey();
  const acct = await getAccountSigners(s.address);
  if (!acct.exists) {
    throw new ApiFailure("BAD_REQUEST", "Set up your testnet wallet first, then turn on chat approvals.", 409);
  }
  if (isActive(acct, s.address, agentAddress)) return { status: "ready", chatApproval: await chatApprovalStatus(s) };
  // Only touch accounts in the plain default setup (or our own), so we never overwrite someone's multisig.
  const others = acct.signers.filter((x) => x.key !== s.address && x.key !== agentAddress && x.weight > 0);
  if (others.length > 0) {
    throw new ApiFailure("BAD_REQUEST", "Your account already has other signers, so Wura won't change it.", 409);
  }
  return signedByUser(s, "agent-key-on", await buildAgentKeyOn(s.address, agentAddress));
}

/** Removes the agent key. The user's wallet signs it. */
export async function disableChatApprovals(s: Session): Promise<Ready | NeedsSignature> {
  const agentAddress = agentKeypairFor(s.userId).publicKey();
  const acct = await getAccountSigners(s.address);
  if (!acct.signers.some((x) => x.key === agentAddress && x.weight > 0)) {
    return { status: "ready", chatApproval: await chatApprovalStatus(s) };
  }
  return signedByUser(s, "agent-key-off", await buildAgentKeyOff(s.address, agentAddress));
}

/**
 * Signs and submits an approved send with the agent key. Only called from
 * createSend(..., via: "chat") after its checks; re-checks caps, balance and
 * the agent key on Horizon right before signing.
 */
export async function sendWithAgentKey(s: Session, intent: SendIntent) {
  const w = wallet(s.userId);
  const status = await chatApprovalStatus(s);
  if (!status.active) {
    throw new ApiFailure(
      "CHAT_APPROVAL_OFF",
      "Chat approvals are off for your wallet. Turn them on in Wura on the web (Channels), then try again.",
      403,
    );
  }
  await recheckSend(s, w, intent);
  const tx = await buildUsdcPayment(s.address, intent.to.address, intent.amount);
  const hash = await submit(signWithKeypair(tx.xdr, agentKeypairFor(s.userId)));
  const activity = finishSend(w, intent, hash);
  return { status: "done" as const, intent, activity, mock: false };
}
