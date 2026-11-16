import { config } from "@/server/config";
import { getActivity, getBalances, getLimits, getPaymentLinks } from "@/server/money";
import { signedIn } from "@/server/route";
import { wallet, withWallet } from "@/server/store";
import { refreshLink } from "@/server/paylinks-watch";
import { recordUser } from "@/server/users";

// recordUser runs before the wallet lock: it uses its own DB connection, and
// holding the lock while waiting for a second connection can starve the pool
// when several requests for the same user arrive at once.
export const GET = signedIn(async (s) => {
  await recordUser(s);
  // Look for payments on open links first (each locks the wallet by itself, so this can't be inside the lock below).
  const open = await withWallet(s.userId, async () => getPaymentLinks(s));
  await Promise.all(open.map((l) => refreshLink(s.userId, l).catch(() => l)));
  return withWallet(s.userId, async () => ({
  me: {
    email: s.email,
    address: s.address,
    authMode: config.authMode,
    moneyMode: config.moneyMode,
    signer: config.moneyMode === "mock" ? "mock" : config.testnetSigner,
    kycStatus: wallet(s.userId).kycStatus,
  },
  balances: await getBalances(s),
  limits: getLimits(s),
  activity: getActivity(s),
  links: getPaymentLinks(s),
  }));
});
