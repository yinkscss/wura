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
 * Telegram ↔ Wura user links. Thin wrappers around the shared channel link
 * table (channel = "telegram"). Against a Telegram id we store the user_id,
 * a display label (@handle or name) and the last few chat lines.
 */

export type TelegramWho = { username?: string; name?: string };
export type { HistoryLine };
export { LINK_CODE_TTL_MS, RATE_LIMIT_PER_MINUTE } from "../channels/links";

const CHANNEL = "telegram" as const;

const labelOf = (who: TelegramWho = {}) =>
  who.username ? `@${who.username.trim().slice(0, 64)}` : who.name?.trim().slice(0, 128) || "a Telegram account";

export async function createLinkCode(userId: string) {
  return createShared(CHANNEL, userId);
}

export async function consumeLinkCode(code: string, telegramUserId: number, who: TelegramWho = {}) {
  return consumeShared(CHANNEL, code, String(telegramUserId), labelOf(who));
}

export async function linkedUserId(telegramUserId: number) {
  return linkedShared(CHANNEL, String(telegramUserId));
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

export async function getHistory(telegramUserId: number) {
  return getShared(CHANNEL, String(telegramUserId));
}

export async function addToHistory(telegramUserId: number, lines: HistoryLine[]) {
  return addShared(CHANNEL, String(telegramUserId), lines);
}

export async function allowMessage(telegramUserId: number, limit?: number) {
  return allowShared(CHANNEL, String(telegramUserId), limit);
}

export async function firstSight(updateId: number) {
  return firstShared(CHANNEL, String(updateId));
}
