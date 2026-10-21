/** Errors surfaced to callers; `kind` is stable so agents can branch on it. */
export type ErrorKind =
  | "not_logged_in"
  | "captcha_required"
  | "rate_limited"
  | "content_rejected"
  | "not_found"
  | "upstream"
  | "network"
  | "config";

/** Extra fields that make an error self-describing for the caller. */
export interface ErrorDetails {
  /** Seconds to wait before retrying, when known. */
  retryAfterSeconds?: number;
  /** Human-readable next step. */
  hint?: string;
  [key: string]: unknown;
}

export class XhhError extends Error {
  readonly kind: ErrorKind;
  readonly status?: number;
  readonly retryable: boolean;
  readonly details?: ErrorDetails;

  constructor(
    kind: ErrorKind,
    message: string,
    options: { status?: number; retryable?: boolean; details?: ErrorDetails } = {},
  ) {
    super(message);
    this.name = "XhhError";
    this.kind = kind;
    this.status = options.status;
    this.retryable = options.retryable ?? (kind === "network" || kind === "rate_limited" || kind === "captcha_required");
    this.details = options.details;
  }

  toJSON(): { kind: ErrorKind; message: string; status?: number; retryable: boolean; details?: ErrorDetails } {
    return {
      kind: this.kind,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/** Map an upstream `status`/message pair onto a stable error kind. */
export function classifyUpstream(status: string, message: string): ErrorKind {
  const text = `${status} ${message}`.toLowerCase();
  if (text.includes("captcha") || text.includes("验证")) return "captcha_required";
  if (text.includes("登录") || text.includes("login") || status === "unauthorized") return "not_logged_in";
  if (text.includes("频繁") || text.includes("too many") || text.includes("rate")) return "rate_limited";
  if (text.includes("审核") || text.includes("违规") || text.includes("sensitive")) return "content_rejected";
  if (text.includes("not found") || status === "not_found") return "not_found";
  return "upstream";
}
