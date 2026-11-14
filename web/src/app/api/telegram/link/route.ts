import { config } from "@/server/config";
import { ApiFailure } from "@/server/errors";
import { authed } from "@/server/route";
import { createLinkCode, linkedAccount, unlinkUser } from "@/server/telegram/links";
import { recordUser } from "@/server/users";

/** Telegram connection status for the signed-in user. */
export const GET = authed(async (s) => {
  const account = config.telegram.enabled ? await linkedAccount(s.userId) : null;
  return {
    enabled: config.telegram.enabled,
    linked: account !== null,
    account: account?.label ?? null,
    botUsername: config.telegram.enabled ? config.telegram.botUsername : null,
  };
});

/** Makes a single-use, 10-minute link for t.me/<bot>?start=<code>. */
export const POST = authed(async (s) => {
  if (!config.telegram.enabled) throw new ApiFailure("BAD_REQUEST", "Telegram isn't set up on this server yet.", 503);
  if (!s.address) throw new ApiFailure("BAD_REQUEST", "Your wallet address isn't ready yet. Finish setting up your wallet first.");
  // Sessions from before the users table existed have no row yet; write it now.
  await recordUser(s);
  const { code, expiresAt } = await createLinkCode(s.userId);
  return { url: `https://t.me/${config.telegram.botUsername}?start=${code}`, expiresAt };
});

/** Disconnects Telegram: deletes the link and its chat history. */
export const DELETE = authed(async (s) => ({ removed: await unlinkUser(s.userId) }));
