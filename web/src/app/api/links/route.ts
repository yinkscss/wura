import type { Currency } from "@/lib/types";
import { createPaymentLink, getPaymentLinks } from "@/server/money";
import { refreshLink } from "@/server/paylinks-watch";
import { authed, jsonBody, signedIn } from "@/server/route";
import { withWallet } from "@/server/store";

/** The creator's links, each checked on Horizon first (at most every 10 seconds per link). */
// signedIn, not authed: refreshing locks the wallet itself, and holding the lock here would wait on itself.
export const GET = signedIn(async (s) => {
  const links = await withWallet(s.userId, async () => getPaymentLinks(s));
  return Promise.all(links.map((l) => refreshLink(s.userId, l).catch(() => l)));
});

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return await createPaymentLink(s, { amount: Number(b.amount), currency: b.currency as Currency });
});
