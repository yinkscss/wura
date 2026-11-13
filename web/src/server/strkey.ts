import "server-only";
import { randomBytes } from "node:crypto";

// Minimal Stellar StrKey encoder for account IDs (G…), used only to give mock
// sessions a well-formed address. Real wallets come from Privy.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const VERSION_ACCOUNT_ID = 6 << 3; // 'G'
const VERSION_CONTRACT = 2 << 3; // 'C'

function crc16xmodem(bytes: Uint8Array) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base32(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function encodeAccountId(publicKey: Uint8Array) {
  return encode(VERSION_ACCOUNT_ID, publicKey);
}

/** C… contract address from a 32-byte contract id. */
export function encodeContractId(id: Uint8Array) {
  return encode(VERSION_CONTRACT, id);
}

function encode(version: number, publicKey: Uint8Array) {
  if (publicKey.length !== 32) throw new Error("key must be 32 bytes");
  const payload = new Uint8Array(33);
  payload[0] = version;
  payload.set(publicKey, 1);
  const crc = crc16xmodem(payload);
  const full = new Uint8Array(35);
  full.set(payload);
  full[33] = crc & 0xff;
  full[34] = crc >> 8;
  return base32(full);
}

/** A random, well-formed G… address with no known secret key. Mock mode only. */
export function randomMockAddress() {
  return encodeAccountId(randomBytes(32));
}

export function isAccountId(s: string) {
  return /^G[A-Z2-7]{55}$/.test(s);
}
