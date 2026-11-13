import { config } from "@/server/config";
import { authed } from "@/server/route";

// USDC funding needs no ID: the user sends USDC on Stellar to their own address.
export const GET = authed((s) => ({
  address: s.address,
  network: config.stellarNetwork,
  asset: "USDC",
  mock: config.moneyMode === "mock",
}));
