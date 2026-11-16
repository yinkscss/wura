import { config } from "@/server/config";
import { ApiFailure } from "@/server/errors";
import { signedIn } from "@/server/route";
import { recordUser } from "@/server/users";
import { createLinkCode, linkedAccount, unlinkUser } from "@/server/whatsapp/links";

/** WhatsApp connection status for the signed-in user. */
export const GET = signedIn(async (s) => {
  const account = config.whatsapp.enabled ? await linkedAccount(s.userId) : null;
  return {
    enabled: config.whatsapp.enabled,
    linked: account !== null,
    account: account?.label ?? null,
    displayNumber: config.whatsapp.enabled ? config.whatsapp.displayNumber || null : null,
  };
});

/**
 * Makes a single-use, 10-minute link code and a wa.me URL that opens chat with
 * the code already typed. Needs WHATSAPP_DISPLAY_NUMBER (E.164 digits) for the URL.
 */
export const POST = signedIn(async (s) => {
  if (!config.whatsapp.enabled) throw new ApiFailure("BAD_REQUEST", "WhatsApp isn't set up on this server yet.", 503);
  if (!s.address) throw new ApiFailure("BAD_REQUEST", "Your wallet address isn't ready yet. Finish setting up your wallet first.");
  const display = config.whatsapp.displayNumber;
  if (!display) {
    throw new ApiFailure(
      "BAD_REQUEST",
      "WhatsApp display number isn't configured (WHATSAPP_DISPLAY_NUMBER). Ask whoever runs the server.",
      503,
    );
  }
  await recordUser(s);
  const { code, expiresAt } = await createLinkCode(s.userId);
  // Code lives only in the wa.me URL (same idea as Telegram's t.me?start=).
  return { url: `https://wa.me/${display}?text=${encodeURIComponent(code)}`, expiresAt };
});

/** Disconnects WhatsApp: deletes the link and its chat history. */
export const DELETE = signedIn(async (s) => ({ removed: await unlinkUser(s.userId) }));
