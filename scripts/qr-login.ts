/**
 * QR login: opens the login page, shows the QR image, waits for the redirect and
 * stores the resulting cookies. Use with a throwaway account only.
 */
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOGIN_URL =
  "https://login.xiaoheihe.cn/?origin=heybox&redirect_url=https%3A%2F%2Fwww.xiaoheihe.cn%2Fhome";
const OUT = join(homedir(), ".xiaoheihe-mcp", "credentials.test.json");
const SHOT = join(process.cwd(), "qrcode.png");
const WAIT_MS = Number(process.env.QR_WAIT_MS ?? 240_000);

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
});
const page = await context.newPage();
await page.goto(LOGIN_URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

// The QR panel is hidden behind a small trigger icon on the current layout.
const trigger = await page.$(".login-code-form__qr-trigger");
if (trigger) {
  await trigger.click();
  await page.waitForTimeout(1500);
}
await page.waitForSelector("canvas#login-qrcode", { timeout: 20_000 });
const canvas = await page.$("canvas#login-qrcode");
if (!canvas) throw new Error("未找到二维码画布");
await canvas.screenshot({ path: SHOT });

if (process.platform === "win32") execFile("explorer.exe", [SHOT]);
process.stderr.write(`二维码已保存并打开：${SHOT}\n等待扫码（最多 ${WAIT_MS / 1000} 秒）...\n`);

await page.waitForURL(/xiaoheihe\.cn\/home/, { timeout: WAIT_MS });
await page.waitForTimeout(1500);

const cookies = await context.cookies();
const jar: Record<string, string> = {};
for (const cookie of cookies) {
  if (!cookie.domain.includes("xiaoheihe")) continue;
  if (!["user_pkey", "user_heybox_id", "heybox_id", "x_xhh_tokenid"].includes(cookie.name)) continue;
  jar[cookie.name] = cookie.value;
}
if (!jar.user_pkey) throw new Error("扫码后没有拿到登录 Cookie");
if (!jar.heybox_id && jar.user_heybox_id) jar.heybox_id = jar.user_heybox_id;

mkdirSync(join(homedir(), ".xiaoheihe-mcp"), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({ cookie: jar }, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`ok: heybox_id=${jar.heybox_id}\n`);

await browser.close();
