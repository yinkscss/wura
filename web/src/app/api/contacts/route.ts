import { listContacts, saveContact } from "@/server/money";
import { authed, jsonBody } from "@/server/route";

export const GET = authed((s) => listContacts(s));

// Body: { name, address }. Saving an address that's already saved renames it.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return saveContact(s, { name: b.name, address: b.address });
});
