// Usage: node step.mjs STEP.js  — connects to the long-lived Chrome on 5621, runs the step's default export(page, h).
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/mac1/gugu-matrix/node_modules/playwright");
const browser = await chromium.connectOverCDP("http://127.0.0.1:5621");
const context = browser.contexts()[0];
let page = context.pages().find(p => p.url().includes("127.0.0.1:56")) ?? context.pages()[0] ?? await context.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
const base = "http://127.0.0.1:5620";
const must = (c, m) => { if (!c) throw new Error(m); };
const shot = async (name) => { const f = path.resolve("shots", name + ".png"); await page.screenshot({ path: f }); console.log("shot", f); };
const api = (p, body) => page.evaluate(async ({ p, body }) => { const r = await fetch(p, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined); const t = await r.text(); if (!r.ok) throw new Error(p + " " + t); return JSON.parse(t); }, { p, body });
const mod = await import(pathToFileURL(path.resolve(process.argv[2])).href + "?t=" + Date.now());
try { const out = await mod.default(page, { base, must, shot, api, sleep: ms => page.waitForTimeout(ms) }); if (out !== undefined) console.log(JSON.stringify(out, null, 1)); }
finally { await browser.close().catch(() => {}); }
