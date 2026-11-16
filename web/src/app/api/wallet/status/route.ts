import { moneyLive } from "@/server/config";
import { ApiFailure } from "@/server/errors";
import { authed } from "@/server/route";
import { walletStatus } from "@/server/testnet";

// Testnet wallet readiness: account funded, USDC trustline, balances.
export const GET = authed(async (s) => {
  if (!moneyLive()) throw new ApiFailure("BAD_REQUEST", "Wallet setup is only needed in testnet mode.", 404);
  return walletStatus(s);
});
