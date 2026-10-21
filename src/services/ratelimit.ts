/** Coarse write throttling: one action at a time, plus an hourly ceiling. */
import { XhhError } from "../client/errors.js";

export interface LimiterOptions {
  minIntervalMs?: number;
  maxPerHour?: number;
  now?: () => number;
}

/** Per-action limiter; write calls are rare, so a process-wide instance is enough. */
export class ActionLimiter {
  private readonly minIntervalMs: number;
  private readonly maxPerHour: number;
  private readonly now: () => number;
  private readonly lastAt = new Map<string, number>();
  private stamps: number[] = [];

  constructor(options: LimiterOptions = {}) {
    this.minIntervalMs = options.minIntervalMs ?? 5000;
    this.maxPerHour = options.maxPerHour ?? 30;
    this.now = options.now ?? Date.now;
  }

  /** Throws `rate_limited` when the action must wait. */
  assertAllowed(action: string): void {
    const now = this.now();
    this.stamps = this.stamps.filter((stamp) => now - stamp < 3_600_000);
    if (this.stamps.length >= this.maxPerHour) {
      throw new XhhError("rate_limited", `本小时写操作已达上限（${this.maxPerHour} 次），请稍后再试`);
    }
    const last = this.lastAt.get(action);
    if (last !== undefined && now - last < this.minIntervalMs) {
      const waitMs = this.minIntervalMs - (now - last);
      throw new XhhError("rate_limited", `操作过于频繁，请 ${Math.ceil(waitMs / 1000)} 秒后再试`);
    }
  }

  /** Record a successful attempt. */
  record(action: string): void {
    const now = this.now();
    this.lastAt.set(action, now);
    this.stamps.push(now);
  }
}

export const writeLimiter = new ActionLimiter();
