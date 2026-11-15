import { rampInfo } from "@/server/ramp";
import { authed } from "@/server/route";

// Limits for the naira top-up and cash-out screens, read from the partner.
export const GET = authed(() => rampInfo());
