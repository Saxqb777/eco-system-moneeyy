// Screenshots the running game (mock state) at desktop and phone widths.
// Usage: CHROMIUM_PATH=... PASSCODE=... node design/shot.mjs [baseUrl]
import { chromium } from "playwright";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const base = process.argv[2] || "http://localhost:3000";
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, proxy, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const shots = [
  { name: "game-desktop", width: 1600, height: 900 },
  { name: "game-phone", width: 430, height: 900 },
];
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="passcode"]', process.env.PASSCODE || "");
  await page.click('button[type="submit"]');
  await page.waitForURL(`${base}/`, { timeout: 30000 });
  await page.waitForSelector("canvas", { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(here, `${s.name}.png`), fullPage: s.name.includes("phone") });
  console.log("shot", s.name);
  await ctx.close();
}
await browser.close();
