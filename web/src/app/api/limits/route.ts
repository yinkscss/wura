import { getLimits } from "@/server/money";
import { authed } from "@/server/route";

export const GET = authed((s) => getLimits(s));
