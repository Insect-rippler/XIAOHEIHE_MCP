/** Credential storage: a cookie jar kept outside the repo. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { XhhError } from "../client/errors.js";

export interface CookieJar {
  [name: string]: string;
}

export interface Credentials {
  cookie: CookieJar;
}

/** Cookie names the web session needs; all four are required for write calls. */
export const REQUIRED_COOKIE_FIELDS = ["user_pkey", "user_heybox_id", "heybox_id", "x_xhh_tokenid"] as const;

/** `%USERPROFILE%\.xiaoheihe-mcp\credentials.json` unless `XHH_CREDENTIALS` overrides it. */
export function credentialsPath(): string {
  return process.env.XHH_CREDENTIALS ?? join(homedir(), ".xiaoheihe-mcp", "credentials.json");
}

export function loadCredentials(path = credentialsPath()): Credentials {
  if (existsSync(path)) {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Credentials;
    if (!raw.cookie || typeof raw.cookie !== "object") {
      throw new XhhError("config", `凭据文件格式错误：${path} 缺少 cookie 字段`);
    }
    return raw;
  }
  const envCookie = process.env.XHH_COOKIE;
  if (envCookie) return { cookie: parseCookieHeader(envCookie) };
  throw new XhhError("config", `未找到凭据文件：${path}（可用 XHH_COOKIE 或先执行 import）`);
}

export function saveCredentials(credentials: Credentials, path = credentialsPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar)
    .filter(([, value]) => String(value ?? "").trim())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function parseCookieHeader(header: string): CookieJar {
  const jar: CookieJar = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    jar[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return jar;
}

/** Returns the required fields that are absent; empty array means usable. */
export function missingCookieFields(jar: CookieJar): string[] {
  return REQUIRED_COOKIE_FIELDS.filter((name) => !String(jar[name] ?? "").trim());
}

/** Import from a file shaped `{ heybox: { cookie: {...} } }` or `{ cookie: {...} }`. */
export function importCredentialsFrom(sourcePath: string): Credentials {
  const raw = JSON.parse(readFileSync(sourcePath, "utf8")) as {
    cookie?: CookieJar;
    heybox?: { cookie?: CookieJar };
  };
  const candidates = [raw.heybox?.cookie, raw.cookie];
  const cookie = candidates.find((candidate) => candidate && (candidate.user_pkey || candidate.heybox_id));
  if (!cookie) throw new XhhError("config", `${sourcePath} 中没有找到可用的 cookie 对象`);
  return { cookie };
}
