/**
 * What to tell the user for each status the partner can report (SEP-24), in
 * words they can act on. No partner or token names, and never "done" unless
 * the partner says completed.
 *
 * This file has no app imports on purpose, so the tests can load it directly.
 */

type Kind = "topup" | "cashout";

const SUPPORT = "If it hasn't moved in a day, contact support with this reference.";

const TOP_UP: Record<string, string> = {
  incomplete: "Finish the steps on the partner's page to continue. Nothing has been paid yet.",
  pending_user_transfer_start: "Make the bank transfer shown on the partner's page. Your money arrives after the partner receives it.",
  pending_user_transfer_complete: "The partner has your transfer and is processing it. You don't need to do anything.",
  pending_external: "The partner is waiting for your bank transfer to arrive. You don't need to do anything.",
  pending_anchor: "The partner is processing your top-up. You don't need to do anything.",
  pending_stellar: "The partner is sending the money to your wallet. You don't need to do anything.",
  pending_trust: "Your wallet isn't set up to receive this money yet. Finish setting up your wallet and the partner will send it.",
  pending_user: "The partner needs something more from you. Open the partner's page to see what.",
  on_hold: `The partner is reviewing this top-up, which can take longer than usual. ${SUPPORT}`,
  completed: "Done. The money is in your wallet.",
  refunded: "The partner sent your money back to your bank account. Nothing was added to your wallet.",
  expired: "This top-up ran out of time and was cancelled. If you already made the bank transfer, contact support with this reference. If not, start a new one.",
  error: "The partner couldn't complete this top-up. If you already made the bank transfer, contact support with this reference. If not, start a new one.",
  no_market: "The partner can't exchange this money right now, so the top-up was cancelled. Nothing was added to your wallet.",
  too_small: "That amount is below the partner's minimum, so the top-up was cancelled. Start a new one with a larger amount.",
  too_large: "That amount is above the partner's maximum, so the top-up was cancelled. Start a new one with a smaller amount.",
};

const CASH_OUT: Record<string, string> = {
  incomplete: "Enter your bank account on the partner's page to continue. Nothing has left your wallet.",
  pending_user_transfer_start: "The partner is ready. Approve the payment from your wallet to finish the cash-out.",
  pending_user_transfer_complete: "Your payment arrived and the partner is sending naira to your bank account. You don't need to do anything.",
  pending_external: "The partner is sending naira to your bank account. You don't need to do anything.",
  pending_anchor: "The partner is processing your cash-out. You don't need to do anything.",
  pending_stellar: "Your payment is on its way to the partner. You don't need to do anything.",
  pending_trust: "The partner is waiting on a wallet setup step. Finish setting up your wallet to continue.",
  pending_user: "The partner needs something more from you. Open the partner's page to see what.",
  on_hold: `The partner is reviewing this cash-out, which can take longer than usual. ${SUPPORT}`,
  completed: "Done. The naira was sent to your bank account.",
  refunded: "The partner sent your money back to your wallet. Nothing reached your bank account.",
  expired: "This cash-out ran out of time and was cancelled. If money already left your wallet, contact support with this reference. If not, start a new one.",
  error: "The partner couldn't complete this cash-out. If money already left your wallet, contact support with this reference. If not, start a new one.",
  no_market: "The partner can't exchange this money right now, so the cash-out was cancelled. Nothing left your wallet.",
  too_small: "That amount is below the partner's minimum, so the cash-out was cancelled. Start a new one with a larger amount.",
  too_large: "That amount is above the partner's maximum, so the cash-out was cancelled. Start a new one with a smaller amount.",
};

/** A status we have never seen is treated as still in progress, never as done or failed. */
const UNKNOWN: Record<Kind, string> = {
  topup: `The partner is working on your top-up. ${SUPPORT}`,
  cashout: `The partner is working on your cash-out. ${SUPPORT}`,
};

export function statusMessage(kind: Kind, anchorStatus: string): string {
  const table = kind === "topup" ? TOP_UP : CASH_OUT;
  return Object.hasOwn(table, anchorStatus) ? table[anchorStatus] : UNKNOWN[kind];
}
