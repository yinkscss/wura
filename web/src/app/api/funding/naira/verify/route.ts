import { verifyIdentity } from "@/server/ramp";
import { authed, jsonBody } from "@/server/route";

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return verifyIdentity(s, { nin: b.nin, consent: b.consent });
});
