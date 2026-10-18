// Screenshot a static page at desktop and phone width. Usage: node pageshot.mjs FILE OUT_PREFIX
import { createRequire } from "node:module";
const [file, out] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(process.env.PW);
const browser = await chromium.launch();
for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  page.on("console", m => { if (m.type() === "error") console.log("console", m.text()); });
  page.on("requestfailed", r => console.log("failed", r.url()));
  await page.goto("file://" + file); await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}-${name}.png` });
  // The whole scrolled body too, so every component shows.
  await page.evaluate(() => { const s = document.querySelector(".rs-screen"); if (s) s.style.height = "auto"; const b = document.querySelector(".rs-body"); if (b) b.style.overflow = "visible"; });
  await page.screenshot({ path: `${out}-${name}-full.png`, fullPage: true });
  await page.close();
}
await browser.close();
