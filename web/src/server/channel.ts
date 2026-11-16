import "server-only";
import { moneyLive } from "./config";
import { ApiFailure } from "./errors";
import { approveSwap, cancelQuote, cancelSend, createSend } from "./money";
import type { Session } from "./session";

/**
 * Entry points for chat channels (Telegram bot, later WhatsApp and MCP).
 *
 * Call each one inside withWallet(session.userId, ...) and only after the
 * linked user tapped the Approve button for this exact quote or preview (never
 * from free text). Caps, balance and expiry are checked in money.ts. On
 * testnet, sends are signed with the user's agent key (agent-key.ts) if they
 * turned chat approvals on; otherwise this throws CHAT_APPROVAL_OFF with a
 * message to show the user. It never returns needs_signature.
 */
export function approveSendFromChat(s: Session, intentId: string) {
  return createSend(s, { intentId, approve: true, via: "chat" });
}

/** Mock mode only. A real swap needs the user's own wallet to sign on the web (chat signing is M11). */
export async function approveSwapFromChat(s: Session, quoteId: string) {
  if (moneyLive()) throw new ApiFailure("SIGNING_UNAVAILABLE", "Swaps need your wallet to sign, so approve this one in Wura on the web.", 409);
  const r = await approveSwap(s, { quoteId, approve: true });
  if (!("mock" in r)) throw new ApiFailure("SIGNING_UNAVAILABLE", "Swaps need your wallet to sign, so approve this one in Wura on the web.", 409);
  return r;
}

export { cancelQuote, cancelSend };
