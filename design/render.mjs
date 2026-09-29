// Renders the palette and font sheets to PNG with the preinstalled Chromium.
import { chromium } from "playwright";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
for (const name of ["palette", "fonts"]) {
  await page.goto(`file://${path.join(here, name + ".html")}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(here, name + ".png"), fullPage: true });
  console.log("rendered", name);
}
await browser.close();
