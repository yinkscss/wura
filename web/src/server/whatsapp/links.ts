import "server-only";
import {
  addToHistory as addShared,
  allowMessage as allowShared,
  createLinkCode as createShared,
  consumeLinkCode as consumeShared,
  firstSight as firstShared,
  getHistory as getShared,
  isLinked as isLinkedShared,
  linkedAccount as linkedAccountShared,
  linkedUserId as linkedShared,
  unlinkUser as unlinkShared,
  type HistoryLine,
} from "../channels/links";

/**
 * WhatsApp phone ↔ Wura user links. Shared channel table with channel =
 * "whatsapp". external_id is digits only (no +). The number is stored only for
 * routing; unlink deletes it. Never log it with message text.
 */

export type { HistoryLine };
export { LINK_CODE_TTL_MS, RATE_LIMIT_PER_MINUTE } from "../channels/links";

const CHANNEL = "whatsapp" as const;

/** Digits only; WhatsApp Cloud API sends wa_id without +. */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Mask for the Channels card: keep country-ish prefix and last 4. */
export function maskPhone(digits: string): string {
  const d = normalizePhone(digits);
  if (d.length < 6) return "a WhatsApp number";
  return `+${d.slice(0, Math.min(3, d.length - 4))}…${d.slice(-4)}`;
}

export async function createLinkCode(userId: string) {
  return createShared(CHANNEL, userId);
}

export async function consumeLinkCode(code: string, phone: string) {
  const id = normalizePhone(phone);
  if (!id) return null;
  return consumeShared(CHANNEL, code, id, maskPhone(id));
}

export async function linkedUserId(phone: string) {
  return linkedShared(CHANNEL, normalizePhone(phone));
}

export async function isLinked(userId: string) {
  return isLinkedShared(CHANNEL, userId);
}

export async function linkedAccount(userId: string) {
  return linkedAccountShared(CHANNEL, userId);
}

export async function unlinkUser(userId: string) {
  return unlinkShared(CHANNEL, userId);
}

export async function unlinkByPhone(phone: string): Promise<boolean> {
  const userId = await linkedUserId(phone);
  if (!userId) return false;
  return unlinkUser(userId);
}

export async function getHistory(phone: string) {
  return getShared(CHANNEL, normalizePhone(phone));
}

export async function addToHistory(phone: string, lines: HistoryLine[]) {
  return addShared(CHANNEL, normalizePhone(phone), lines);
}

export async function allowMessage(phone: string, limit?: number) {
  return allowShared(CHANNEL, normalizePhone(phone), limit);
}

export async function firstSight(wamid: string) {
  return firstShared(CHANNEL, wamid);
}
