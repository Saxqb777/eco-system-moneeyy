// Screenshots the running game (mock state) at desktop and phone widths, with and without panels.
// Usage: CHROMIUM_PATH=... PASSCODE=... node design/shot.mjs [baseUrl]
import { chromium } from "playwright";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const base = process.argv[2] || "http://localhost:3000";
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, proxy, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const shots = [
  { name: "game-desktop", width: 1600, height: 900 },
  { name: "panel-character", width: 1600, height: 900, panel: "agent:docledger_chaser" },
  { name: "panel-floor", width: 1600, height: 900, panel: "floor:docledger" },
  { name: "panel-approvals", width: 1600, height: 900, panel: "warden:approvals" },
  { name: "panel-setup", width: 1600, height: 900, panel: "warden:setup" },
  { name: "panel-brief", width: 1600, height: 900, panel: "warden:brief" },
  { name: "game-phone", width: 430, height: 900 },
  { name: "panel-phone", width: 430, height: 900, panel: "warden:approvals", clip: true },
  { name: "panel-company", width: 1600, height: 900, panel: "warden:company" },
  { name: "panel-company-phone", width: 430, height: 900, panel: "warden:company", clip: true },
  { name: "panel-mailbox", width: 1600, height: 900, panel: "warden:mailbox" },
  { name: "panel-mailbox-thread", width: 1600, height: 900, panel: "warden:mailbox", click: ".thread-row.hot" },
  { name: "panel-mailbox-phone", width: 430, height: 900, panel: "warden:mailbox", click: ".thread-row.hot" },
  { name: "panel-trading", width: 1600, height: 900, panel: "floor:trading" },
  { name: "panel-trading-phone", width: 430, height: 900, panel: "floor:trading", clip: true },
  { name: "panel-terminal-stocks", width: 1600, height: 900, panel: "floor:trading", click: ".panel-tabs .tab:nth-child(2)" },
  { name: "panel-terminal-crypto", width: 1600, height: 900, panel: "floor:trading", click: ".panel-tabs .tab:nth-child(3)" },
  { name: "panel-terminal-calls", width: 1600, height: 900, panel: "floor:trading", click: ".panel-tabs .tab:nth-child(4)" },
  { name: "panel-terminal-trades", width: 1600, height: 900, panel: "floor:trading", click: ".panel-tabs .tab:nth-child(5)" },
  { name: "panel-terminal-reports", width: 1600, height: 900, panel: "floor:trading", click: ".panel-tabs .tab:nth-child(6)" },
  { name: "panel-terminal-analytics", width: 1600, height: 900, panel: "floor:trading", click: ".panel-tabs .tab:nth-child(7)" },
  { name: "panel-terminal-calls-phone", width: 430, height: 900, panel: "floor:trading", click: ".panel-tabs .tab:nth-child(4)", clip: true },
  { name: "wall-street", width: 1600, height: 900, dpr: 2, region: { x: 380, y: 536, width: 880, height: 150 }, wait: 11000 },
  { name: "wall-street-meeting", width: 1600, height: 900, dpr: 2, region: { x: 380, y: 536, width: 880, height: 150 }, wait: 17000 },
].filter((s) => !process.env.SHOTS || process.env.SHOTS.split(",").some((p) => s.name.startsWith(p)));
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
const login = await ctx.newPage();
await login.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
await login.fill('input[name="passcode"]', process.env.PASSCODE || "");
await login.click('button[type="submit"]');
await login.waitForURL(`${base}/`, { timeout: 30000 });
await login.close();
const state = await ctx.storageState();
for (const s of shots) {
  const c = s.dpr ? await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, ignoreHTTPSErrors: true, storageState: state }) : ctx;
  const page = await c.newPage();
  await page.setViewportSize({ width: s.width, height: s.height });
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
  await page.goto(`${base}/${s.panel ? `?panel=${s.panel}` : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 60000 });
  await page.waitForTimeout(s.wait ?? (s.panel ? 7000 : 6000));
  if (s.click) {
    await page.click(s.click);
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: path.join(here, `${s.name}.png`), fullPage: s.name === "game-phone", ...(s.region ? { clip: s.region } : {}) });
  console.log("shot", s.name);
  await page.close();
  if (c !== ctx) await c.close();
}
await browser.close();
