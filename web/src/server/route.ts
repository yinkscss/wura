import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, ApiFailure } from "./errors";
import { getSession, type Session } from "./session";

/** Wraps a route handler: requires a session and turns ApiFailure into JSON errors. */
export function authed<T>(fn: (s: Session, req: NextRequest) => Promise<T> | T) {
  return async (req: NextRequest) => {
    try {
      const s = await getSession(req);
      if (!s) throw new ApiFailure("UNAUTHENTICATED", "Please sign in.", 401);
      const data = await fn(s, req);
      return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function jsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
  } catch {
    throw new ApiFailure("BAD_REQUEST", "Request body must be JSON.");
  }
}
