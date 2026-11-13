"use client";

import type { ApiError, ApiErrorCode } from "./types";

export class ClientApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Calls our own API layer. The UI never talks to Horizon or a DEX directly. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok || !data || (data as ApiError).error) {
    const e = (data as ApiError | null)?.error;
    if (res.status === 401 && typeof window !== "undefined") {
      // Full reload on purpose: the session is gone, so drop all client state.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/sign-in?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ClientApiError(e?.code ?? "BAD_REQUEST", e?.message ?? "Something went wrong. Nothing was sent.", res.status);
  }
  return data as T;
}
