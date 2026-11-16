import { StrKey } from "@stellar/stellar-sdk";
import { safeFetchText, FetchRefused } from "./safe-fetch";

/**
 * Reads a site's page and its scripts for Soroban contract addresses (C…).
 * Everything found here is only a candidate. site-soroban.ts checks each one
 * on-chain before anything is built, and page text is data, never instructions.
 *
 * No "server-only" import on purpose: tests load this file directly.
 */

const MAX_SCRIPTS = 8;
const MAX_CANDIDATES = 6;

export type Candidate = { address: string; mentions: number; sources: string[] };

/** Contract addresses in a block of text, with a real checksum check so look-alikes drop out. */
export function extractContractIds(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![A-Z2-7])C[A-Z2-7]{55}(?![A-Z2-7])/g)) {
    if (StrKey.isValidContract(m[0])) out.push(m[0]);
  }
  return out;
}

/** Script and preload URLs a page loads, same-site first, https only, capped. */
export function extractScriptUrls(html: string, base: string): string[] {
  const baseUrl = new URL(base);
  const found = new Set<string>();
  const re = /<(?:script[^>]*?\ssrc|link[^>]*?\shref)\s*=\s*["']([^"']+)["']/gi;
  for (const m of html.matchAll(re)) {
    if (!/\.(m?js)(\?|#|$)/i.test(m[1]) && !/<link[^>]*rel=["']?modulepreload/i.test(m[0])) continue;
    try {
      const u = new URL(m[1], baseUrl);
      if (u.protocol === "https:") found.add(u.toString());
    } catch {
      /* ignore bad URLs */
    }
  }
  const all = [...found];
  const same = all.filter((u) => new URL(u).host === baseUrl.host);
  const other = all.filter((u) => new URL(u).host !== baseUrl.host);
  return [...same, ...other].slice(0, MAX_SCRIPTS);
}

export type ScanResult = {
  page: string;
  fetched: string[];
  candidates: Candidate[];
  /** Pieces we couldn't read. Shown to the user, never hidden. */
  skipped: string[];
};

export async function scanSite(pageUrl: string): Promise<ScanResult> {
  const page = await safeFetchText(pageUrl);
  const counts = new Map<string, Candidate>();
  const add = (text: string, source: string) => {
    for (const address of extractContractIds(text)) {
      const c = counts.get(address) ?? { address, mentions: 0, sources: [] };
      c.mentions++;
      if (!c.sources.includes(source)) c.sources.push(source);
      counts.set(address, c);
    }
  };
  add(page.body, page.url);

  const fetched = [page.url];
  const skipped: string[] = [];
  const scripts = extractScriptUrls(page.body, page.url);
  const results = await Promise.allSettled(scripts.map((u) => safeFetchText(u, { maxBytes: 2_000_000 })));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      fetched.push(r.value.url);
      add(r.value.body, r.value.url);
    } else {
      skipped.push(r.reason instanceof FetchRefused ? `${scripts[i]} (${r.reason.message})` : scripts[i]);
    }
  });

  const candidates = [...counts.values()].sort((a, b) => b.mentions - a.mentions).slice(0, MAX_CANDIDATES);
  return { page: page.url, fetched, candidates, skipped };
}
