/** Capture the community search request used by the editor. */
import { chromium } from "playwright";
import { loadCredentials } from "../src/auth/credentials.js";

const credentials = loadCredentials();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
});
await context.addCookies(
  Object.entries(credentials.cookie).map(([name, value]) => ({ name, value, domain: ".xiaoheihe.cn", path: "/" })),
);
const page = await context.newPage();

const hits = [];
page.on("request", (request) => {
  const url = request.url();
  if (!url.includes("xiaoheihe")) return;
  if (!["xhr", "fetch"].includes(request.resourceType())) return;
  const parsed = new URL(url);
  if (!/topic|community|search/i.test(parsed.pathname)) return;
  const keys = [...parsed.searchParams.keys()].filter((k) => !["hkey", "_time", "nonce", "_rnd"].includes(k));
  hits.push(`${request.method()} ${parsed.pathname} [${keys.join(",")}]`);
});
page.on("response", async (response) => {
  const url = response.url();
  if (!/topic|community|search/i.test(new URL(url).pathname)) return;
  try {
    const text = await response.text();
    if (text.includes("盒友")) {
      console.log("RESP", new URL(url).pathname, text.slice(0, 400));
    }
  } catch {
    /* ignore */
  }
});

await page.goto("https://www.xiaoheihe.cn/creator/editor/draft/article", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".ProseMirror", { timeout: 30_000 });
await page.waitForTimeout(3000);

await page.getByRole("button", { name: "添加社区" }).click().catch(() => {});
await page.waitForTimeout(1200);
const input = page.locator(".editor__search-input--input").first();
if (await input.count()) {
  await input.fill("盒友杂谈");
  await page.waitForTimeout(2500);
}
console.log("requests:", hits.join("\n") || "(none)");
const items = await page.evaluate(`(() => [...document.querySelectorAll(".editor-model__topic-list-item")].slice(0, 5).map((el) => (el.textContent || "").trim().slice(0, 20)))()`);
console.log("results:", JSON.stringify(items));
await browser.close();
