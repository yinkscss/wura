import "server-only";
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

/** Swaps aren't live on testnet yet; this refuses there with a clear message. */
export function approveSwapFromChat(s: Session, quoteId: string) {
  return approveSwap(s, { quoteId, approve: true });
}

export { cancelQuote, cancelSend };
