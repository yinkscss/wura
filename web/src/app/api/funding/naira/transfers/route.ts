import { myTransfers } from "@/server/ramp";
import { signedIn } from "@/server/route";

// GET — the user's latest top-ups and cash-outs as stored, newest first, so a
// screen can pick up after a restart. Empty in mock mode.
export const GET = signedIn(async (s) => ({ transfers: await myTransfers(s) }));
