import { config } from "@/server/config";
import { ApiFailure } from "@/server/errors";
import { authed } from "@/server/route";
import { setupWallet } from "@/server/testnet";

// Funds the testnet account with Friendbot and adds the USDC trustline.
// With Privy signing, returns { status: "needs_signature", txId, hash } for the trustline.
export const POST = authed(async (s) => {
  if (config.moneyMode !== "testnet") throw new ApiFailure("BAD_REQUEST", "Wallet setup is only needed in testnet mode.", 404);
  return setupWallet(s);
});
