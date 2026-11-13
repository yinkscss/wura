import { getBalances } from "@/server/money";
import { authed } from "@/server/route";

export const GET = authed((s) => getBalances(s));
