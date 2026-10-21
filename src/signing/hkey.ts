/**
 * Request signing for xiaoheihe web APIs.
 *
 * The web client signs every request with `hkey` + `_time` + `nonce`; workshop write
 * endpoints add `_rnd`. The algorithm is reproduced here from observed protocol facts
 * (documented in the research notes), not copied from any existing client.
 */
import { createHash, createHmac } from "node:crypto";

/** Character table used by the client-side obfuscation. */
const ALPHABET = "AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89";

/** Version prefix of the workshop `_rnd` parameter. */
export const WORKSHOP_RND_VERSION = "15";

/** Key mixed into the workshop `_rnd` HMAC. Rotating it breaks all write calls. */
export const WORKSHOP_RND_SECRET = "Z7mFG4tQp9Ws2LxB8H";

/** Signed query parameters attached to every request. */
export interface HkeyParams {
  hkey: string;
  _time: number;
  nonce: string;
}

/** Deterministic inputs, used by tests to pin the output. */
export interface HkeyOptions {
  /** Wall clock in milliseconds. Defaults to `Date.now()`. */
  nowMs?: number;
  /** Value the client folds into the nonce. Defaults to `Math.random()`. */
  random?: number;
  /** Full nonce override; when set, `random` is ignored. */
  nonce?: string;
}

function md5Hex(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/** Map every character of `value` into `table` by `charCode % table.length`. */
function projectChars(value: string, table: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    out += table[value.charCodeAt(i) % table.length];
  }
  return out;
}

/** Round-robin merge: a0 b0 c0 a1 b1 c1 ... */
function interleave(parts: string[]): string {
  const maxLength = Math.max(...parts.map((part) => part.length));
  let out = "";
  for (let i = 0; i < maxLength; i += 1) {
    for (const part of parts) {
      if (i < part.length) out += part[i];
    }
  }
  return out;
}

/** GF(2^8) doubling with the AES polynomial. */
function xtime(value: number): number {
  return value & 0x80 ? ((value << 1) ^ 0x1b) & 0xff : (value << 1) & 0xff;
}

/** The four derived transforms used by the column mixer. */
function q(value: number): number {
  return xtime(value) ^ value;
}

function r(value: number): number {
  return q(xtime(value));
}

function y(value: number): number {
  return r(q(xtime(value)));
}

function g(value: number): number {
  return y(value) ^ r(value) ^ q(value);
}

/** One column-mixing round over four bytes. */
function mixColumns(values: [number, number, number, number]): [number, number, number, number] {
  const [a, b, c, d] = values;
  return [
    g(a) ^ y(b) ^ r(c) ^ q(d),
    q(a) ^ g(b) ^ y(c) ^ r(d),
    r(a) ^ q(b) ^ g(c) ^ y(d),
    y(a) ^ r(b) ^ q(c) ^ g(d),
  ];
}

/** Normalize a path to `/segment/segment/` (collapses duplicate and trailing slashes). */
export function normalizePath(path: string): string {
  return `/${path.split("/").filter(Boolean).join("/")}/`;
}

/**
 * Build `hkey` / `_time` / `nonce` for one request path.
 *
 * The `stem` mixes the next second, the normalized path and the nonce; only its first
 * 20 interleaved characters are hashed, then five characters plus a two-digit checksum
 * become the `hkey`.
 */
export function signPath(path: string, options: HkeyOptions = {}): HkeyParams {
  const nowMs = options.nowMs ?? Date.now();
  const time = Math.floor(nowMs / 1000);
  const nonce = options.nonce ?? md5Hex(`${time}${options.random ?? Math.random()}`).toUpperCase();

  const stem = interleave([
    projectChars(String(time + 1), ALPHABET.slice(0, -2)),
    projectChars(normalizePath(path), ALPHABET),
    projectChars(nonce, ALPHABET),
  ]).slice(0, 20);

  const hash = md5Hex(stem);
  const tail = [...hash.slice(-6)].map((char) => char.charCodeAt(0));
  // The checksum folds the four mixed bytes plus the two untouched tail bytes.
  const mixed = mixColumns([tail[0]!, tail[1]!, tail[2]!, tail[3]!]);
  const checksumSum = mixed.reduce((sum, value) => sum + value, 0) + tail[4]! + tail[5]!;
  const checksum = String(checksumSum % 100).padStart(2, "0");

  return {
    hkey: projectChars(hash.slice(0, 5), ALPHABET.slice(0, -4)) + checksum,
    _time: time,
    nonce,
  };
}

/** Workshop-only signature: `15:<hex hmac-sha256>` over `secret + nonce + time + ":" + nonce`. */
export function workshopRnd(params: Pick<HkeyParams, "nonce" | "_time">): string {
  const { nonce, _time: time } = params;
  const message = `${WORKSHOP_RND_SECRET}${nonce}${time}:${nonce}`;
  const hex = createHmac("sha256", WORKSHOP_RND_SECRET).update(message, "utf8").digest("hex");
  return `${WORKSHOP_RND_VERSION}:${hex}`;
}
