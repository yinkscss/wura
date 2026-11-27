import { BASE_USDC } from "../ramp/paycrest";

/**
 * LI.FI client: USDC from Stellar to Base through Circle CCTP only.
 * See docs/payquest-offramp-plan.md.
 *
 * This file quotes and reads status. It never signs or submits anything: the
 * payment itself is a money move and belongs in money.ts (caps, approval, log).
 *
 * Safety rules in `getQuote`: the route is pinned to `cctp`; the quote is refused
 * if it uses any other tool, adds a swap step, delivers to a different address or
 * token than asked, or its guaranteed minimum is below the floor the caller set.
 *
 * Written from LI.FI's Stellar docs, read 27 November 2026, NOT yet run against
 * the live API. Marked "unverified" below: the shape of the Stellar
 * `transactionRequest`, and the exact USDC token identifier on Stellar. Check
 * both on the first real quote. The docs also say the envelope expires (about 5
 * minutes) and Soroban approvals always expire, so a quote is used at once or
 * thrown away.
 *
 * No app imports beyond the Base USDC constant, so `node --test` can load it.
 */

export const STELLAR_CHAIN_ID = "1201081091099710";
export const BASE_CHAIN_ID = "8453";
export const STELLAR_USDC_DECIMALS = 7; // Stellar assets use 7 decimals (unverified for the Soroban USDC token; checked against the quote)
const DEFAULT_BASE_URL = "https://li.quest/v1";
const STELLAR_G = /^G[A-Z2-7]{55}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export class BridgeError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "BridgeError";
    this.status = status;
  }
}

export type BridgeEnv = Record<string, string | undefined>;

export interface BridgeDeps {
  fetch?: typeof fetch;
  env?: BridgeEnv;
  now?: () => number;
}

export interface QuoteInput {
  /** The user's Stellar `G…` account. Must be funded. */
  fromAddress: string;
  /** The Base staging address that receives the USDC. */
  toAddress: string;
  /** Stellar USDC token identifier. Default "USDC" (symbol); set LIFI_STELLAR_USDC to a pinned `C…` address for mainnet. */
  fromToken?: string;
  /** How much USDC leaves Stellar, in that token's smallest unit, as a decimal string. */
  fromAmount: string;
  /** The least USDC (micro-USDC, 6 decimals) the quote may guarantee on Base. A quote below this is refused. */
  minReceiveUnits: bigint;
  /** Allowed slippage as a fraction, default 0.005. CCTP is 1:1 minus fees, so this should stay small. */
  slippage?: number;
}

export interface BridgeQuote {
  tool: "cctp";
  fromAmount: string;
  /** What LI.FI expects to arrive on Base, micro-USDC. */
  toAmountUnits: bigint;
  /** The least that will arrive on Base, micro-USDC. Never below the floor the caller set. */
  toAmountMinUnits: bigint;
  toAddress: string;
  /** Soroban allowance step, when the route needs one. Submit and confirm it before `transactionRequest`. */
  approvalAddress: string | null;
  /** Unverified shape for Stellar; kept raw for the signer to interpret. */
  transactionRequest: Record<string, unknown> | null;
  estimatedSeconds: number | null;
  /** Fees LI.FI reports, raw, for the approval screen. */
  feeCosts: unknown[];
  gasCosts: unknown[];
  expiresAtMs: number;
}

export type BridgeState = "not_found" | "pending" | "done" | "failed" | "invalid";

export interface BridgeStatus {
  state: BridgeState;
  substatus: string | null;
  /** Hash of the Base transaction, once it exists. */
  receivingTxHash: string | null;
  /** What arrived on Base, micro-USDC, when LI.FI reports it. */
  receivedUnits: bigint | null;
}

export interface BridgeClient {
  getQuote(input: QuoteInput): Promise<BridgeQuote>;
  getStatus(input: { txHash: string }): Promise<BridgeStatus>;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
}
function units(v: unknown): bigint | null {
  const s = str(v);
  return s && /^\d+$/.test(s) ? BigInt(s) : null;
}

export function createLifi(deps: BridgeDeps = {}): BridgeClient {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const base = (env.LIFI_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!base.startsWith("https://")) throw new BridgeError("LIFI_BASE_URL must be https.");

  async function get(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = (env.LIFI_API_KEY ?? "").trim();
    if (key) headers["x-lifi-api-key"] = key;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}?${new URLSearchParams(params)}`, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new BridgeError("Couldn't reach the bridge.");
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const msg = str(asObject(json).message);
      throw new BridgeError(msg ? `Bridge refused: ${msg.slice(0, 200)}` : `Bridge answered ${res.status}.`, res.status);
    }
    return asObject(json);
  }

  return {
    async getQuote(input) {
      if (!STELLAR_G.test(input.fromAddress)) throw new BridgeError("Sender isn't a Stellar G… account.");
      if (!EVM_ADDRESS.test(input.toAddress)) throw new BridgeError("Destination isn't a valid Base address.");
      if (!/^\d+$/.test(input.fromAmount) || BigInt(input.fromAmount) <= BigInt(0)) throw new BridgeError("Bad amount.");
      if (input.minReceiveUnits <= BigInt(0)) throw new BridgeError("A minimum to receive is required.");
      const slippage = input.slippage ?? 0.005;
      if (!(slippage >= 0 && slippage <= 0.02)) throw new BridgeError("Slippage above 2% isn't allowed.");

      const q = await get("/quote", {
        fromChain: STELLAR_CHAIN_ID,
        toChain: BASE_CHAIN_ID,
        fromToken: input.fromToken ?? env.LIFI_STELLAR_USDC?.trim() ?? "USDC",
        toToken: BASE_USDC,
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        fromAmount: input.fromAmount,
        allowBridges: "cctp",
        slippage: String(slippage),
        order: "CHEAPEST",
      });

      // Never trust the route to be what we asked for. Check it.
      if (str(q.tool) !== "cctp") throw new BridgeError("Quote doesn't use Circle CCTP; refusing.");
      const steps = Array.isArray(q.includedSteps) ? q.includedSteps.map(asObject) : [];
      if (steps.some((s) => !["cross", "protocol", "custom"].includes(str(s.type) ?? "") || (str(s.tool) ?? "cctp") !== "cctp")) {
        throw new BridgeError("Quote includes a swap or another bridge; refusing.");
      }
      const action = asObject(q.action);
      const est = asObject(q.estimate);
      const toToken = asObject(action.toToken);
      if ((str(toToken.address) ?? "").toLowerCase() !== BASE_USDC.toLowerCase()) throw new BridgeError("Quote doesn't deliver Base USDC; refusing.");
      if (str(action.toAddress) && str(action.toAddress)!.toLowerCase() !== input.toAddress.toLowerCase()) {
        throw new BridgeError("Quote delivers to a different address; refusing.");
      }
      if (str(action.fromAmount) && str(action.fromAmount) !== input.fromAmount) throw new BridgeError("Quote changed the amount; refusing.");
      const toAmount = units(est.toAmount);
      const toAmountMin = units(est.toAmountMin);
      if (toAmount === null || toAmountMin === null) throw new BridgeError("Quote has no usable amounts.");
      if (toAmountMin < input.minReceiveUnits) throw new BridgeError("The bridge would deliver less than the minimum; refusing.");

      const tr = q.transactionRequest;
      return {
        tool: "cctp",
        fromAmount: input.fromAmount,
        toAmountUnits: toAmount,
        toAmountMinUnits: toAmountMin,
        toAddress: input.toAddress,
        approvalAddress: str(est.approvalAddress),
        transactionRequest: tr && typeof tr === "object" ? asObject(tr) : null,
        estimatedSeconds: typeof est.executionDuration === "number" ? est.executionDuration : null,
        feeCosts: Array.isArray(est.feeCosts) ? est.feeCosts : [],
        gasCosts: Array.isArray(est.gasCosts) ? est.gasCosts : [],
        // The docs give about 5 minutes; assume less so a stale quote is never signed.
        expiresAtMs: now() + 4 * 60_000,
      };
    },

    async getStatus({ txHash }) {
      if (!/^[A-Za-z0-9]{16,128}$/.test(txHash)) throw new BridgeError("Bad transaction hash.");
      const s = await get("/status", { txHash, fromChain: STELLAR_CHAIN_ID, toChain: BASE_CHAIN_ID, bridge: "cctp" });
      const raw = (str(s.status) ?? "").toUpperCase();
      const state: BridgeState =
        raw === "DONE" ? "done" : raw === "PENDING" ? "pending" : raw === "FAILED" ? "failed" : raw === "NOT_FOUND" ? "not_found" : "invalid";
      const receiving = asObject(s.receiving);
      return {
        state,
        substatus: str(s.substatus),
        receivingTxHash: str(receiving.txHash),
        receivedUnits: state === "done" ? units(receiving.amount) : null,
      };
    },
  };
}

/** Safe to move on: the money is on Base and at least the guaranteed minimum arrived. */
export function bridgeLanded(status: BridgeStatus, minReceiveUnits: bigint): boolean {
  return status.state === "done" && status.receivedUnits !== null && status.receivedUnits >= minReceiveUnits;
}

/** In-memory stand-in with the same shapes, for tests and the demo. Nothing is signed or sent. */
export function createMockBridge(opts: { now?: () => number } = {}): BridgeClient & { land(txHash: string, receivedUnits: bigint): void } {
  const now = opts.now ?? Date.now;
  const landed = new Map<string, bigint>();
  return {
    async getQuote(input) {
      const out = BigInt(input.fromAmount) / BigInt(10) - BigInt(20_000); // 7 to 6 decimals, minus a made-up 0.02 USDC fee
      if (out < input.minReceiveUnits) throw new BridgeError("The bridge would deliver less than the minimum; refusing.");
      return {
        tool: "cctp",
        fromAmount: input.fromAmount,
        toAmountUnits: out,
        toAmountMinUnits: out,
        toAddress: input.toAddress,
        approvalAddress: null,
        transactionRequest: null,
        estimatedSeconds: 60,
        feeCosts: [],
        gasCosts: [],
        expiresAtMs: now() + 4 * 60_000,
      };
    },
    async getStatus({ txHash }) {
      const got = landed.get(txHash);
      return got !== undefined
        ? { state: "done", substatus: "COMPLETED", receivingTxHash: "0x" + "cd".repeat(32), receivedUnits: got }
        : { state: "pending", substatus: null, receivingTxHash: null, receivedUnits: null };
    },
    land(txHash, receivedUnits) {
      landed.set(txHash, receivedUnits);
    },
  };
}
