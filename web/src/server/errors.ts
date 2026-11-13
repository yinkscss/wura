import "server-only";
import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import type { ApiErrorCode } from "@/lib/types";

export class ApiFailure extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown) {
  // Let Next.js handle its own control-flow errors (e.g. prerender bail-out).
  unstable_rethrow(err);
  if (err instanceof ApiFailure) {
    return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json(
    { error: { code: "BAD_REQUEST", message: "Something went wrong. Nothing was sent." } },
    { status: 500 },
  );
}
