/** Low-level HTTP transport: query signing, cookie injection, error classification. */
import { cookieHeader, type CookieJar } from "../auth/credentials.js";
import { signPath, workshopRnd } from "../signing/index.js";
import { assertNotChallenged, captchaError, noteCaptcha } from "../services/captcha.js";
import { XhhError, classifyUpstream } from "./errors.js";

export const API_ORIGIN = "https://api.xiaoheihe.cn";
export const WORKSHOP_ORIGIN = "https://workshopapi.xiaoheihe.cn";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface ClientConfig {
  cookie: CookieJar;
  heyboxId: string;
  timeoutMs?: number;
  userAgent?: string;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  form?: Record<string, string | number>;
  /** `2.5` for api.xiaoheihe.cn reads, `3.0` for workshop write calls. */
  webVersion?: "2.5" | "3.0";
  /** Send to workshopapi.xiaoheihe.cn and attach `_rnd`. */
  workshop?: boolean;
  /** link/tree requires a bare `h_src` marker right before `link_id`. */
  insertHSrc?: boolean;
}

function baseParams(heyboxId: string, webVersion: string): Record<string, string> {
  return {
    os_type: "web",
    app: "heybox",
    client_type: "web",
    version: "999.0.4",
    web_version: webVersion,
    x_client_type: "web",
    x_app: "heybox_website",
    heybox_id: heyboxId,
    x_os_type: "Windows",
    device_info: "Chrome",
  };
}

/** Thin signed HTTP client. One instance per account. */
export class XhhHttp {
  readonly heyboxId: string;
  private readonly cookie: CookieJar;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(config: ClientConfig) {
    this.cookie = config.cookie;
    this.heyboxId = config.heyboxId;
    this.timeoutMs = config.timeoutMs ?? 20_000;
    this.userAgent = config.userAgent ?? DEFAULT_UA;
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.send<T>("GET", path, options);
  }

  postForm<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.send<T>("POST", path, options);
  }

  private async send<T>(method: "GET" | "POST", path: string, options: RequestOptions): Promise<T> {
    assertNotChallenged();
    const webVersion = options.webVersion ?? (options.workshop ? "3.0" : "2.5");
    const signed = signPath(path);
    const entries: Record<string, string> = {
      ...baseParams(this.heyboxId, webVersion),
      hkey: signed.hkey,
      _time: String(signed._time),
      nonce: signed.nonce,
    };
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) entries[key] = String(value);
    }
    if (options.workshop) {
      entries.x_client_version = "";
      entries._rnd = workshopRnd(signed);
    }
    const params = new URLSearchParams(entries);

    const origin = options.workshop ? WORKSHOP_ORIGIN : API_ORIGIN;
    let query = params.toString();
    if (options.insertHSrc) query = query.replace("&link_id=", "&h_src&link_id=");

    const headers: Record<string, string> = {
      "user-agent": this.userAgent,
      accept: "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9",
      cookie: cookieHeader(this.cookie),
      origin: "https://www.xiaoheihe.cn",
      referer: "https://www.xiaoheihe.cn/",
    };

    let body: string | undefined;
    if (method === "POST") {
      headers["content-type"] = "application/x-www-form-urlencoded;charset=utf-8";
      const form = new URLSearchParams();
      for (const [key, value] of Object.entries(options.form ?? {})) form.set(key, String(value));
      body = form.toString();
    }

    let response: Response;
    try {
      response = await fetch(`${origin}${path}?${query}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new XhhError("network", `请求失败：${message}`);
    }

    const text = await response.text();
    let data: Record<string, unknown>;
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new XhhError("upstream", `响应不是 JSON（HTTP ${response.status}）：${text.slice(0, 160)}`, {
        status: response.status,
      });
    }

    if (response.status === 401 || response.status === 403) {
      throw new XhhError("not_logged_in", `登录态失效（HTTP ${response.status}）`, { status: response.status });
    }
    if (!response.ok) {
      throw new XhhError("upstream", `HTTP ${response.status}`, { status: response.status });
    }

    const status = String(data.status ?? "");
    if (status !== "ok") {
      const message = String(data.msg ?? data.error ?? data.errmsg ?? "");
      const kind = classifyUpstream(status, message);
      if (kind === "captcha_required") {
        noteCaptcha();
        const captcha = captchaError();
        throw new XhhError(captcha.kind, captcha.message, {
          status: response.status,
          retryable: captcha.retryable,
          details: captcha.details,
        });
      }
      throw new XhhError(kind, `接口返回 status=${status || "空"} ${message}`.trim(), {
        status: response.status,
      });
    }

    return data as T;
  }
}
