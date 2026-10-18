// Tower upgrade YATU: a real browser upgrades a defense tower from its card, watches the job's progress button, sends
// two archers up with a right-click and calls them down. Usage: node tower-upgrade.mjs SOURCE_DIR PORT OUT_DIR LABEL
// LABEL "before" (main) stops after the plain tower's card.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const [source, portArg, outDir, label] = process.argv.slice(2);
const port = Number(portArg), base = `http://127.0.0.1:${port}`;
mkdirSync(outDir, { recursive: true });
const { chromium } = createRequire(import.meta.url)(process.env.PW);
// The port must be free: a server already on it would be an older build, and the run would prove old code.
try { await fetch(base + "/api/catalog"); throw new Error(`port ${port} busy: another server answers there`); } catch (e) { if (String(e).includes("busy")) throw e; }
const server = spawn(path.join(source, "node_modules/.bin/tsx"), ["src/server/index.ts"], { cwd: source, env: { ...process.env, PORT: String(port), ROOM_AUTOTICK: "0" }, stdio: "ignore" });
let serverExit;
server.on("exit", code => { serverExit = code; });
for (const started = Date.now(); ;) {
  if (serverExit !== undefined) throw new Error(`server exited (${serverExit}) before answering`);
  try { if ((await fetch(`${base}/api/catalog`)).ok) break; } catch {}
  if (Date.now() - started > 90_000) throw new Error("server did not start");
  await new Promise(r => setTimeout(r, 300));
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", e => console.log("pageerror", String(e).slice(0, 200)));
const wait = ms => page.waitForTimeout(ms);
const api = (url, body) => page.evaluate(async ({ url, body }) => {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(url + " " + await res.text()); return res.json();
}, { url, body });
const shot = async (name, clip) => { await page.screenshot({ path: path.join(outDir, `${name}-${label}.png`), ...(clip ? { clip } : {}) }); console.log("shot", name); };
const HUD = { x: 0, y: 560, width: 1000, height: 340 };
const facts = { label };
process.on('exit', () => { try { writeFileSync(path.join(outDir, `facts-${label}.json`), JSON.stringify(facts, null, 2)); } catch {} });

await page.goto(base, { waitUntil: "load" });
await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 90_000 });
await page.locator("[data-open-room-browser]").click();
await page.locator("[data-create-room]").click();
// One setup screen for map and seats (@@@solo-setup): another map rebuilds the room under a new id.
await page.waitForSelector("[data-room-setup]", { timeout: 30_000 });
const previous = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
if (!(await page.locator("[data-map-entries] [data-map-id='pineshade']").getAttribute("class"))?.includes("selected")) {
  await page.locator("[data-map-entries] [data-map-id='pineshade']").click();
  await page.waitForFunction((old) => { const id = document.querySelector("[data-room-setup]")?.getAttribute("data-room-setup"); return id && id !== old; }, previous, { timeout: 30_000 });
}
const roomId = await page.locator("[data-room-setup]").getAttribute("data-room-setup");
for (const slot of await page.locator("[data-slot-id]").evaluateAll(rows => rows.filter(r => r.querySelector("[data-slot-controller]")?.value === "open").map(r => r.getAttribute("data-slot-id")))) {
  await page.locator(`[data-slot-id='${slot}'] [data-slot-controller]`).selectOption("ai");
  await page.waitForFunction((s) => { const el = document.querySelector(`[data-slot-id='${s}'] [data-slot-controller]`); return el?.value === "ai" && !el.disabled; }, slot, { timeout: 10_000 });
}
await page.locator("[data-start-room]").click();
await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden"), null, { timeout: 180_000 });
let s = await api(`/api/rooms/${roomId}/snapshot`);
const hall = s.buildings.find(b => b.owner === "player" && b.kind === "townHall");
const enemy = Object.keys(s.players).find(p => p !== "player");
const cx = hall.x, cy = hall.y + 300;
const addUnits = [
  { id: "archer-a", owner: "player", kind: "archer", x: cx - 160, y: cy + 120 },
  { id: "archer-b", owner: "player", kind: "archer", x: cx - 120, y: cy + 120 },
  ...[0, 1, 2].map(i => ({ id: `brute-${i}`, owner: enemy, kind: "footman", x: cx + 520, y: cy - 60 + i * 60 })),
];
await api(`/api/rooms/${roomId}/reset`, { mapId: s.map.id, options: { aiPlayers: [], races: { player: "grove", [enemy]: "ember" },
  scenario: { players: { player: { gold: 2000 } }, addUnits, addBuildings: [{ id: "yatu-tower", owner: "player", kind: "defenseTower", x: cx, y: cy, complete: true }] } } });
await api(`/api/rooms/${roomId}/tick`, { ticks: 2 });
// The page shows the room as it loads it: after the server's ticks it is reloaded and centred on the tower again.
const reloadView = async () => {
  await page.reload();
  await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden") && (window.__sketchRtsView?.tick ?? -1) >= 0, null, { timeout: 180_000 });
  await page.addStyleTag({ content: "[data-pointer-lock-gate]{display:none!important}" });
  await wait(3000);
  const snap = await api(`/api/rooms/${roomId}/snapshot`);
  await page.evaluate(({ w, h }) => { window.__mapW = w; window.__mapH = h; }, { w: snap.map.width, h: snap.map.height });
  const mm = await page.evaluate(({ x, y }) => {
    const frame = document.querySelector("[data-minimap-frame]"), canvas = document.querySelector(".game-canvas");
    const t = new DOMMatrixReadOnly(getComputedStyle(frame).transform), b = canvas.getBoundingClientRect();
    return { x: b.x + t.m41 + parseFloat(frame.style.width) * x / window.__mapW, y: b.y + t.m42 + parseFloat(frame.style.height) * y / window.__mapH };
  }, { x: cx, y: cy });
  await page.mouse.click(mm.x, mm.y); await page.mouse.move(800, 300); await wait(1500);
  return snap;
};
s = await reloadView();
const centre = await page.evaluate(() => { const b = document.querySelector(".game-canvas").getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
const at = (x, y) => ({ x: centre.x + x - cx, y: centre.y + y - cy });
const VIEW = { x: centre.x - 420, y: centre.y - 260, width: 840, height: 440 };
const caughtUp = async () => { s = await reloadView(); };
const tick = (ticks) => api(`/api/rooms/${roomId}/tick`, { ticks });
const unit = id => s.units.find(u => u.id === id);
const tower = () => s.buildings.find(b => b.id === "yatu-tower");
facts.renderer = await page.evaluate(() => document.querySelector("[data-resource-panel], .resource-panel")?.textContent ?? "");

await shot("tower", VIEW);
{ const p = at(tower().x, tower().y); await page.mouse.click(p.x, p.y); } await wait(900);
await shot("tower-card", HUD);
const upgradeButton = page.locator("[data-command-label='升级为加固防御塔'], [data-command-label='Upgrade to Fortified Tower']");
facts.upgradeButtonVisible = await upgradeButton.isVisible().catch(() => false);
facts.oldFortifyButtonVisible = await page.locator("[data-command-label='加固防御塔'], [data-command-label='Fortify tower']").isVisible().catch(() => false);
if (label === "before") {
  writeFileSync(path.join(outDir, `facts-${label}.json`), JSON.stringify(facts, null, 2));
  await browser.close(); server.kill(); process.exit(0);
}
await upgradeButton.hover(); await wait(700);
await shot("upgrade-tooltip", undefined);
await upgradeButton.click(); await wait(500);
// The room plays on while the page is open: the job's progress shows on the card the tower is still selected with.
await page.mouse.move(100, 100); await wait(2500);
{
  const progress = page.locator("[data-training-progress='fortifiedTower']");
  facts.progressButton = await progress.evaluate(el => ({ label: el.dataset.commandLabel, state: el.dataset.trainingState, jobId: el.dataset.jobId, badge: el.querySelector(".research-progress-text")?.textContent, fill: el.style.getPropertyValue("--research-progress") }));
  facts.dockWhileUpgrading = await page.evaluate(() => [...document.querySelectorAll("[data-command-label]")].filter(e => e.offsetParent).map(e => e.dataset.commandLabel));
  await shot("upgrading-card", HUD);
  await progress.hover(); await wait(700);
  await shot("upgrading-tooltip", undefined);
  await page.mouse.move(100, 100);
}
s = await api(`/api/rooms/${roomId}/snapshot`);
facts.afterClick = { queue: tower().queue, gold: s.players.player.gold };
facts.upgradeTicks = [];
for (let i = 0; i < 40; i++) {
  await tick(20);
  s = await api(`/api/rooms/${roomId}/snapshot`);
  facts.upgradeTicks.push({ tick: s.tick, kind: tower().kind, queue: tower().queue });
  if (tower().kind === "fortifiedTower") break;
}
await caughtUp();
facts.upgraded = { kind: tower().kind, maxHp: tower().maxHp, radius: tower().radius, attackDamage: tower().attackDamage, x: tower().x, y: tower().y, gold: s.players.player.gold, queue: tower().queue };
await shot("upgraded", VIEW);

// Select the archers with a box, right-click the tower.
const a = at(unit("archer-a").x - 40, unit("archer-a").y - 40), b = at(unit("archer-b").x + 40, unit("archer-b").y + 30);
await page.keyboard.press("Escape");
await page.mouse.move(a.x, a.y - 20); await page.mouse.down(); await page.mouse.move(b.x, b.y - 10, { steps: 8 }); await page.mouse.up(); await wait(800);
facts.archerRangeBelow = ["archer-a", "archer-b"].map(id => unit(id).attackRange);
facts.selectedBeforeRightClick = await page.evaluate(() => document.querySelector(".hud-subject")?.textContent);
console.log("selected", facts.selectedBeforeRightClick);
{ const p = at(tower().x, tower().y + 14); await page.mouse.click(p.x, p.y, { button: "right" }); } await wait(500);
for (let i = 0; i < 20; i++) {
  await tick(20);
  s = await api(`/api/rooms/${roomId}/snapshot`);
  if (["archer-a", "archer-b"].every(id => unit(id)?.garrison)) break;
}
await caughtUp();
facts.garrison = ["archer-a", "archer-b"].map(id => ({ id, garrison: unit(id)?.garrison, attackRange: unit(id)?.attackRange }));
await page.keyboard.press("Escape"); await page.mouse.move(100, 100); await wait(1500);
await shot("garrisoned", VIEW);
{ const p = at(tower().x, tower().y + 14); await page.mouse.click(p.x, p.y); } await wait(900);
await shot("garrisoned-card", HUD);
const downButton = page.locator("[data-command-label='全部下来'], [data-command-label='All down']");
await downButton.click(); await wait(500);
s = await api(`/api/rooms/${roomId}/snapshot`);
facts.afterDown = ["archer-a", "archer-b"].map(id => ({ id, garrison: unit(id)?.garrison, attackRange: unit(id)?.attackRange }));
writeFileSync(path.join(outDir, `facts-${label}.json`), JSON.stringify(facts, null, 2));
await browser.close();
server.kill();
