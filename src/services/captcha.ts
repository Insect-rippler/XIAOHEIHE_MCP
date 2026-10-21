/** Captcha circuit breaker: after a challenge, fail fast for a cooldown window. */
import { XhhError } from "../client/errors.js";

const COOLDOWN_MS = 5 * 60 * 1000;
let challengedAt = 0;

/** Hint attached to every captcha failure so callers know what to do next. */
const CAPTCHA_HINT =
  "站点要求人机验证：请在浏览器打开 https://www.xiaoheihe.cn 手动完成一次验证，" +
  "并降低请求频率（写操作建议间隔 ≥10 分钟）后重试。持续重试会延长风控时间。";

/** Record that the site demanded a human verification. */
export function noteCaptcha(): void {
  challengedAt = Date.now();
}

/** Milliseconds left in the cooldown window; 0 when not challenged. */
export function captchaCooldownRemainingMs(): number {
  if (challengedAt === 0) return 0;
  return Math.max(0, COOLDOWN_MS - (Date.now() - challengedAt));
}

/** Throw when still inside the cooldown window. */
export function assertNotChallenged(): void {
  const remaining = captchaCooldownRemainingMs();
  if (remaining <= 0) return;
  const retryAfterSeconds = Math.ceil(remaining / 1000);
  throw new XhhError(
    "captcha_required",
    `站点刚触发过人机验证，请求已暂停，请约 ${retryAfterSeconds} 秒后再试。`,
    { retryable: true, details: { retryAfterSeconds, hint: CAPTCHA_HINT } },
  );
}

/** Build the error thrown the moment the site answers with `show_captcha`. */
export function captchaError(): XhhError {
  return new XhhError(
    "captcha_required",
    "站点返回 show_captcha：本次请求被人机验证拦截，未执行成功。",
    {
      retryable: true,
      details: {
        retryAfterSeconds: Math.ceil(COOLDOWN_MS / 1000),
        hint: CAPTCHA_HINT,
        upstreamStatus: "show_captcha",
      },
    },
  );
}

/** Clear the cooldown (tests or after a manual verification). */
export function resetCaptcha(): void {
  challengedAt = 0;
}
