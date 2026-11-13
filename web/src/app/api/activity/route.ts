import { getActivity } from "@/server/money";
import { authed } from "@/server/route";

export const GET = authed((s) => getActivity(s));
