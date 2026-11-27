import { createHmac, timingSafeEqual } from "node:crypto";
import { formatUnits, parseUnits } from "../units";

/**
 * Paycrest sender API: USDC on Base to a Nigerian bank account.
 * See docs/payquest-offramp-plan.md (the file name has an old typo).
 *
 * Off by default: nothing calls this unless RAMP_OFFRAMP_PROVIDER=paycrest.
 * Paycrest runs on mainnet only and has no sandbox, so `createMockPaycrest`
 * mirrors the same shapes for tests and the demo.
 *
 * Money rules in this file:
 *   - Amounts are bigint micro-USDC (6 decimals), never floats.
 *   - An order is refused unless it is USDC on Base, to a valid 0x address, with no
 *     memo (an ERC-20 transfer can't carry one), with enough time left, and with an
 *     amount to pay no more than `maxOverheadUnits` above what was asked.
 *   - The API key and secret never appear in an error message or a log line.
 *
 * Written from Paycrest's published docs, read 27 November 2026, NOT yet run
 * against the live service. Field names marked "unverified" are guesses to
 * check on the first real order.
 *
 * No app imports on purpose, so `node --test` can load it.
 */

export const USDC_DECIMALS = 6;
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DEFAULT_BASE_URL = "https://api.paycrest.io";
const MIN_TIME_LEFT_MS = 60_000;
const OVERHEAD_FLOOR_UNITS = BigInt(250_000); // always allow 0.25 USDC of fees
const OVERHEAD_CEILING_UNITS = BigInt(3_000_000); // never more than 3 USDC
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export class PaycrestError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "PaycrestError";
    this.status = status;
  }
}

export type PaycrestEnv = Record<string, string | undefined>;

/** Plain states Wura can show, whatever Paycrest calls them. */
export type OffRampState =
  | "awaiting_deposit"
  | "processing"
  | "paid" // validated or settling: safe to tell the user the money is on its way
  | "settled"
  | "held" // compliance review, can take days
  | "expired"
  | "refunding"
  | "refunded"
  | "unknown";

export function mapStatus(status: string): OffRampState {
  switch (status) {
    case "initiated":
      return "awaiting_deposit";
    case "deposited":
    case "pending":
    case "fulfilling":
    case "fulfilled":
      return "processing";
    case "validated":
    case "settling":
      return "paid";
    case "settled":
      return "settled";
    case "compliance_hold":
      return "held";
    case "cancelled":
    case "expired":
      return "expired";
    case "refunding":
      return "refunding";
    case "refunded":
      return "refunded";
    default:
      return "unknown";
  }
}

export interface Institution {
  name: string;
  code: string;
  type: string;
}

export interface Recipient {
  institution: string;
  accountIdentifier: string;
  accountName: string;
  /** Short note shown on the bank statement. Required by Paycrest. */
  memo: string;
}

export interface CreateOrderInput {
  /** USDC the recipient's naira should be worth, as a decimal string like "25.5". Fees are added on top by Paycrest. */
  amountUsdc: string;
  /** Where Paycrest returns the money if the order can't be fulfilled. A Base address Wura controls. */
  refundAddress: string;
  /** Wura's own id for this cash-out. Makes a retry recognisable. */
  reference: string;
  recipient: Recipient;
  /** Optional. Omit to let Paycrest choose a valid rate. */
  rate?: string;
}

export interface PaycrestOrder {
  id: string;
  status: string;
  state: OffRampState;
  reference: string | null;
  /** NGN per USDC, as Paycrest gave it. */
  rate: string | null;
  deposit: {
    network: "base";
    currency: "USDC";
    receiveAddress: string;
    /** Exactly what must be sent, micro-USDC. */
    amountUnits: bigint;
    amount: string;
    validUntilMs: number;
  };
}

export interface PaycrestClient {
  institutions(currency: string): Promise<Institution[]>;
  /** The account holder's name, or null when Paycrest can't look names up for this bank. Throws if the account is invalid. */
  verifyAccount(institution: string, accountIdentifier: string): Promise<string | null>;
  /** NGN per USDC for selling `amountUsdc` on Base. Public endpoint. */
  sellRate(amountUsdc: string): Promise<string>;
  createOrder(input: CreateOrderInput): Promise<PaycrestOrder>;
  getOrder(id: string): Promise<{ id: string; status: string; state: OffRampState }>;
}

export function paycrestReady(env: PaycrestEnv = process.env): boolean {
  return (env.PAYCREST_API_KEY ?? "").trim().length > 0 && (env.PAYCREST_API_SECRET ?? "").trim().length > 0;
}

export interface PaycrestDeps {
  fetch?: typeof fetch;
  env?: PaycrestEnv;
  now?: () => number;
  /** Fixed ceiling on fees above `amountUsdc`. Default: 5% of the amount, at least 0.25 and at most 3 USDC. */
  maxOverheadUnits?: bigint;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
}

export function createPaycrest(deps: PaycrestDeps = {}): PaycrestClient {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const base = (env.PAYCREST_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!base.startsWith("https://")) throw new PaycrestError("PAYCREST_BASE_URL must be https.");

  async function call(method: "GET" | "POST", path: string, opts: { body?: unknown; auth?: boolean } = {}): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.auth !== false) {
      const key = (env.PAYCREST_API_KEY ?? "").trim();
      if (!key) throw new PaycrestError("Paycrest isn't configured.");
      headers["API-Key"] = key;
    }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaycrestError("Couldn't reach Paycrest.");
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const msg = str(asObject(json).message);
      throw new PaycrestError(msg ? `Paycrest refused: ${msg.slice(0, 200)}` : `Paycrest answered ${res.status}.`, res.status);
    }
    // Paycrest wraps results as { status, message, data }.
    const o = asObject(json);
    return "data" in o ? o.data : json;
  }

  return {
    async institutions(currency) {
      if (!/^[A-Z]{3}$/.test(currency)) throw new PaycrestError("Bad currency code.");
      const data = await call("GET", `/v2/institutions/${currency}`);
      if (!Array.isArray(data)) throw new PaycrestError("Paycrest sent an unexpected bank list.");
      return data
        .map((r) => asObject(r))
        .filter((r) => str(r.code) && str(r.name))
        .map((r) => ({ name: String(r.name), code: String(r.code), type: str(r.type) ?? "" }));
    },

    async verifyAccount(institution, accountIdentifier) {
      if (!/^[A-Za-z0-9]{3,20}$/.test(institution)) throw new PaycrestError("Bad bank code.");
      if (!/^\d{10}$/.test(accountIdentifier)) throw new PaycrestError("A Nigerian account number has 10 digits.");
      const data = await call("POST", "/v2/verify-account", { body: { institution, accountIdentifier }, auth: true });
      const name = str(data);
      if (!name) throw new PaycrestError("Paycrest couldn't verify that account.");
      return name === "OK" ? null : name; // "OK" means name lookup isn't available for this bank
    },

    async sellRate(amountUsdc) {
      parseUnits(amountUsdc, USDC_DECIMALS);
      const data = asObject(await call("GET", `/v2/rates/base/USDC/${amountUsdc}/NGN`, { auth: false }));
      const rate = str(asObject(data.sell).rate);
      if (!rate || !(Number(rate) > 0)) throw new PaycrestError("Paycrest sent no usable rate.");
      return rate;
    },

    async createOrder(input) {
      let asked: bigint;
      try {
        asked = parseUnits(input.amountUsdc, USDC_DECIMALS);
      } catch {
        throw new PaycrestError("Bad amount.");
      }
      if (asked <= BigInt(0)) throw new PaycrestError("Amount must be above zero.");
      if (!EVM_ADDRESS.test(input.refundAddress)) throw new PaycrestError("Refund address isn't a valid Base address.");
      if (!input.reference || input.reference.length > 100) throw new PaycrestError("Bad reference.");
      const r = input.recipient;
      if (!r.institution || !/^\d{10}$/.test(r.accountIdentifier) || !r.accountName.trim() || !r.memo.trim()) {
        throw new PaycrestError("Recipient details are incomplete.");
      }

      const data = asObject(
        await call("POST", "/v2/sender/orders", {
          body: {
            amount: input.amountUsdc,
            amountIn: "crypto",
            source: { type: "crypto", currency: "USDC", network: "base", refundAddress: input.refundAddress },
            destination: { type: "fiat", currency: "NGN", recipient: r },
            reference: input.reference,
            ...(input.rate ? { rate: input.rate } : {}),
          },
        }),
      );

      const id = str(data.id);
      const status = str(data.status) ?? "initiated";
      const pa = asObject(data.providerAccount);
      if (!id) throw new PaycrestError("Paycrest's order had no id.");

      // Everything about where and how much to pay is checked here, because the
      // next step moves real money to whatever this says.
      if (str(pa.network)?.toLowerCase() !== "base") throw new PaycrestError("Paycrest asked for a network other than Base.");
      if (str(pa.currency)?.toUpperCase() !== "USDC") throw new PaycrestError("Paycrest asked for a token other than USDC.");
      const to = str(pa.receiveAddress);
      if (!to || !EVM_ADDRESS.test(to)) throw new PaycrestError("Paycrest's deposit address isn't valid.");
      if (to.toLowerCase() === input.refundAddress.toLowerCase()) throw new PaycrestError("Deposit address is our own refund address.");
      if (str(pa.memo)) throw new PaycrestError("Paycrest wants a memo on the deposit, which a Base transfer can't carry.");
      let units: bigint;
      try {
        units = parseUnits(String(str(pa.amountToTransfer) ?? ""), USDC_DECIMALS);
      } catch {
        throw new PaycrestError("Paycrest's amount to pay isn't valid.");
      }
      if (units < asked) throw new PaycrestError("Paycrest asked for less than the order amount; refusing to guess.");
      const proportional = asked / BigInt(20);
      const maxOverhead =
        deps.maxOverheadUnits ??
        (proportional < OVERHEAD_FLOOR_UNITS ? OVERHEAD_FLOOR_UNITS : proportional > OVERHEAD_CEILING_UNITS ? OVERHEAD_CEILING_UNITS : proportional);
      if (units - asked > maxOverhead) throw new PaycrestError("Paycrest's fees are above our limit; not paying.");
      const validUntilMs = Date.parse(str(pa.validUntil) ?? "");
      if (!Number.isFinite(validUntilMs) || validUntilMs - now() < MIN_TIME_LEFT_MS) {
        throw new PaycrestError("The order expires too soon to pay.");
      }

      return {
        id,
        status,
        state: mapStatus(status),
        reference: str(data.reference),
        rate: str(data.rate),
        deposit: { network: "base", currency: "USDC", receiveAddress: to, amountUnits: units, amount: formatUnits(units, USDC_DECIMALS), validUntilMs },
      };
    },

    async getOrder(id) {
      if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new PaycrestError("Bad order id.");
      const data = asObject(await call("GET", `/v2/sender/orders/${id}`));
      const status = str(data.status);
      if (!status) throw new PaycrestError("Paycrest sent no status.");
      return { id: str(data.id) ?? id, status, state: mapStatus(status) };
    },
  };
}

// ---------------------------------------------------------------------------
// Webhooks

/** Checks `X-Paycrest-Signature`: HMAC-SHA256 of the RAW body with the API secret, hex. Constant time. */
export function verifyWebhookSignature(rawBody: string | Buffer, header: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const given = header.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(given, "hex"));
}

export interface WebhookEvent {
  event: string;
  status: string;
  state: OffRampState;
  /** Paycrest's order id (unverified field name: `id` or `orderId`). */
  orderId: string | null;
  /** Our `reference` (unverified field name: `reference` or `paymentReference`). */
  reference: string | null;
  direction: string | null;
  txHash: string | null;
}

/** Call only after `verifyWebhookSignature` passed. Returns null for anything that isn't an off-ramp order event. */
export function parseWebhook(rawBody: string): WebhookEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const o = asObject(json);
  const event = str(o.event);
  if (!event || !event.startsWith("payment_order.")) return null;
  const d = asObject(o.data);
  const direction = str(d.direction);
  if (direction && direction !== "offramp") return null;
  const status = str(d.status) ?? event.slice("payment_order.".length);
  return {
    event,
    status,
    state: event === "payment_order.compliance_hold" ? "held" : mapStatus(status),
    orderId: str(d.id) ?? str(d.orderId),
    reference: str(d.reference) ?? str(d.paymentReference),
    direction,
    txHash: str(d.txHash),
  };
}

// ---------------------------------------------------------------------------
// Mock: same shapes, no network. For tests and the demo.

export function createMockPaycrest(opts: { now?: () => number; rate?: string } = {}): PaycrestClient & {
  /** Move an order along, as a webhook would. */
  advance(id: string, status: string): void;
} {
  const now = opts.now ?? Date.now;
  const orders = new Map<string, { id: string; status: string }>();
  let n = 0;
  return {
    async institutions() {
      return [
        { name: "Guaranty Trust Bank", code: "GTBINGLA", type: "bank" },
        { name: "Access Bank", code: "ABNGNGLA", type: "bank" },
      ];
    },
    async verifyAccount(_inst, acct) {
      if (!/^\d{10}$/.test(acct)) throw new PaycrestError("A Nigerian account number has 10 digits.");
      return "MOCK ACCOUNT HOLDER";
    },
    async sellRate() {
      return opts.rate ?? "1500";
    },
    async createOrder(input) {
      const asked = parseUnits(input.amountUsdc, USDC_DECIMALS);
      if (asked <= BigInt(0)) throw new PaycrestError("Amount must be above zero.");
      if (!EVM_ADDRESS.test(input.refundAddress)) throw new PaycrestError("Refund address isn't a valid Base address.");
      const id = `mock-order-${++n}-${input.reference}`.slice(0, 64);
      orders.set(id, { id, status: "initiated" });
      const units = asked + BigInt(100_000); // a made-up 0.10 USDC fee
      return {
        id,
        status: "initiated",
        state: "awaiting_deposit",
        reference: input.reference,
        rate: opts.rate ?? "1500",
        deposit: {
          network: "base",
          currency: "USDC",
          receiveAddress: "0x" + "ab".repeat(20),
          amountUnits: units,
          amount: formatUnits(units, USDC_DECIMALS),
          validUntilMs: now() + 10 * 60_000,
        },
      };
    },
    async getOrder(id) {
      const o = orders.get(id);
      if (!o) throw new PaycrestError("No such order.", 404);
      return { id, status: o.status, state: mapStatus(o.status) };
    },
    advance(id, status) {
      const o = orders.get(id);
      if (o) o.status = status;
    },
  };
}
