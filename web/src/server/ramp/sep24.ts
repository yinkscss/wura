import { partnerFetch } from "./proxy";
/**
 * SEP-24: hosted deposit and withdrawal. The anchor shows its own page, where
 * it collects identity and bank details. Wura never sees them.
 *
 * This file has no app imports on purpose, so `node --test` can load it
 * directly (see web/tests/ramp).
 *
 * Amounts in and out of this file are minor units (kobo), integers. SEP-24
 * speaks decimal strings; the conversion happens here and nowhere else.
 */

export class Sep24Error extends Error {
  /** The anchor's HTTP status, when it answered with an error. */
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "Sep24Error";
    this.status = status;
  }
}

export type AssetLimits = {
  enabled: boolean;
  /** Minor units. null when the anchor publishes no bound. */
  min: number | null;
  max: number | null;
};

export type Sep24Info = {
  deposit: AssetLimits;
  withdraw: AssetLimits;
  /** True when the anchor serves a /fee endpoint, i.e. fees are not in /info. */
  feeEndpoint: boolean;
};

type Fetch = typeof fetch;
type Opts = { fetch?: Fetch; timeoutMs?: number };

/** "20000.0" or 20000 → 2000000 kobo. Rejects anything that is not a plain non-negative number. */
export function toMinor(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const minor = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 2000000 kobo → "20000.00". */
export function fromMinor(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Sep24Error("Amount must be a whole number of kobo.");
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

async function getJson(f: Fetch, url: string | URL, init: RequestInit, timeoutMs: number, what: string) {
  let res: Response;
  try {
    res = await f(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Sep24Error(`Couldn't reach the anchor (${what}).`);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const reason = body && typeof body.error === "string" ? `: ${body.error.slice(0, 200)}` : "";
    throw new Sep24Error(`The anchor answered ${res.status} (${what})${reason}`, res.status);
  }
  if (!body) throw new Sep24Error(`The anchor sent no data (${what}).`);
  return body;
}

function limits(section: unknown, assetCode: string): AssetLimits {
  const a = (section as Record<string, Record<string, unknown>> | undefined)?.[assetCode];
  if (!a || a.enabled !== true) return { enabled: false, min: null, max: null };
  return { enabled: true, min: toMinor(a.min_amount), max: toMinor(a.max_amount) };
}

/** Reads the anchor's published limits for one asset. No sign-in needed. */
export async function getInfo(transferServer: string, assetCode: string, opts: Opts = {}): Promise<Sep24Info> {
  const body = await getJson(opts.fetch ?? partnerFetch, `${transferServer}/info`, {}, opts.timeoutMs ?? 8000, "info");
  return {
    deposit: limits(body.deposit, assetCode),
    withdraw: limits(body.withdraw, assetCode),
    feeEndpoint: (body.fee as { enabled?: unknown } | undefined)?.enabled === true,
  };
}

export type Interactive = {
  /** The anchor's transaction id. Use it to poll status. */
  id: string;
  /** The anchor's hosted page. Open it for the user; never fetch it from the server. */
  url: string;
};

/**
 * Starts a hosted deposit or withdrawal. Nothing moves yet: the user finishes
 * on the anchor's page. The returned URL must be HTTPS on the anchor's domain.
 */
export async function startInteractive(
  kind: "deposit" | "withdraw",
  input: {
    transferServer: string;
    /** Domain the hosted page must live on, e.g. "ngnc.online". */
    homeDomain: string;
    token: string;
    assetCode: string;
    assetIssuer: string;
    account: string;
    amount: number;
  },
  opts: Opts = {},
): Promise<Interactive> {
  const body = await getJson(
    opts.fetch ?? partnerFetch,
    `${input.transferServer}/transactions/${kind}/interactive`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.token}` },
      body: JSON.stringify({
        asset_code: input.assetCode,
        asset_issuer: input.assetIssuer,
        account: input.account,
        amount: fromMinor(input.amount),
        lang: "en",
      }),
    },
    opts.timeoutMs ?? 10000,
    `start ${kind}`,
  );
  if (body.type !== "interactive_customer_info_needed" || typeof body.id !== "string" || typeof body.url !== "string") {
    throw new Sep24Error(`The anchor's reply to "start ${kind}" was not a hosted page.`);
  }
  let url: URL;
  try {
    url = new URL(body.url);
  } catch {
    throw new Sep24Error("The anchor's hosted page link is not a valid URL.");
  }
  const onDomain = url.hostname === input.homeDomain || url.hostname.endsWith(`.${input.homeDomain}`);
  if (url.protocol !== "https:" || !onDomain || url.username || url.password) {
    throw new Sep24Error("The anchor's hosted page link is not on the anchor's own domain.");
  }
  return { id: body.id, url: url.toString() };
}

/** Wura's plain states for a top-up or cash-out. */
export type TransferState =
  /** The user still has something to do: finish the anchor's page, or make the transfer. */
  | "waiting_for_you"
  /** The anchor or the network is working on it. */
  | "processing"
  | "done"
  | "failed";

/** Every status SEP-24 defines, mapped to a plain state. Exported so the messages can be checked against it. */
export const STATE: Record<string, TransferState> = {
  incomplete: "waiting_for_you",
  pending_user_transfer_start: "waiting_for_you",
  pending_user: "waiting_for_you",
  pending_trust: "waiting_for_you",
  pending_user_transfer_complete: "processing",
  pending_external: "processing",
  pending_anchor: "processing",
  pending_stellar: "processing",
  on_hold: "processing",
  completed: "done",
  refunded: "failed",
  expired: "failed",
  error: "failed",
  no_market: "failed",
  too_small: "failed",
  too_large: "failed",
};

export type TransferStatus = {
  id: string;
  kind: "deposit" | "withdrawal";
  state: TransferState;
  /** The anchor's own status word, for the log. */
  anchorStatus: string;
  amountIn: number | null;
  amountOut: number | null;
  fee: number | null;
  /**
   * What the fee and the paid-out amount are in, as the anchor says it (SEP-38
   * form: "stellar:CODE:ISSUER" or "iso4217:NGN"). null when it doesn't say.
   */
  feeAsset: string | null;
  amountOutAsset: string | null;
  /** Stellar transaction hash once the anchor has paid or been paid. */
  stellarTxId: string | null;
  /**
   * Withdrawals only, once the anchor is ready to be paid: where the user's
   * wallet must send the tokens. This is a payment, so it is built and signed
   * by the money code after approval and limit checks — never here.
   */
  payTo: { account: string; memo: string; memoType: "text" | "id" | "hash" } | null;
};

/** Reads one transfer's status. Unknown anchor statuses count as "processing", never as done. */
export async function getTransfer(
  input: { transferServer: string; token: string; id: string },
  opts: Opts = {},
): Promise<TransferStatus> {
  const url = new URL(`${input.transferServer}/transaction`);
  url.searchParams.set("id", input.id);
  const body = await getJson(
    opts.fetch ?? partnerFetch,
    url,
    { headers: { Authorization: `Bearer ${input.token}` } },
    opts.timeoutMs ?? 8000,
    "status",
  );
  const t = body.transaction as Record<string, unknown> | undefined;
  if (!t || t.id !== input.id) throw new Sep24Error("The anchor's status reply was for a different transfer.");
  const kind = t.kind === "withdrawal" ? "withdrawal" : "deposit";
  const anchorStatus = typeof t.status === "string" ? t.status : "unknown";
  const mt = t.withdraw_memo_type;
  let payTo: TransferStatus["payTo"] = null;
  if (
    kind === "withdrawal" &&
    anchorStatus === "pending_user_transfer_start" &&
    typeof t.withdraw_anchor_account === "string" &&
    typeof t.withdraw_memo === "string" &&
    (mt === "text" || mt === "id" || mt === "hash")
  ) {
    payTo = { account: t.withdraw_anchor_account, memo: t.withdraw_memo, memoType: mt };
  }
  return {
    id: input.id,
    kind,
    state: STATE[anchorStatus] ?? "processing",
    anchorStatus,
    amountIn: toMinor(t.amount_in),
    amountOut: toMinor(t.amount_out),
    fee: toMinor(t.amount_fee),
    feeAsset: typeof t.amount_fee_asset === "string" && t.amount_fee_asset ? t.amount_fee_asset : null,
    amountOutAsset: typeof t.amount_out_asset === "string" && t.amount_out_asset ? t.amount_out_asset : null,
    stellarTxId: typeof t.stellar_transaction_id === "string" ? t.stellar_transaction_id : null,
    payTo,
  };
}
