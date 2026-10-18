// Runs inside a copy of the repo (`sketch yatu` and `sketch shot` start it there), so a commit is shown with its own
// server, client and menu flow. One argument: a JSON object (Options below). It starts that copy's dev server on a free
// port of the machine's range, checks the page is served by this commit, runs the scene file against it, and prints one
// JSON line: { ok, shots, errors }. Exit 1: the scene's own check failed; exit 2: the environment is wrong.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { connect, createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Size = { name: string; width: number; height: number };
type Options = { scene: string; sha: string; out: string; leases: string; ports: [number, number]; playwright: string; browsersPath?: string; sizes: Size[]; label: string; at?: number[]; locale?: string; launchArgs?: string[] };
type ShotRecord = { name: string; size: string; file: string; dom: Record<string, unknown> };

class EnvError extends Error {}
class SceneFailure extends Error {}

const options = JSON.parse(process.argv[2]!) as Options;
mkdirSync(options.out, { recursive: true });
const shots: ShotRecord[] = [], records: { name: string; file: string }[] = [], errors: string[] = [];
let server: ChildProcess | undefined;

let leased: string | undefined;

function stopServer() {
  // The server has its own process group (tsx starts node under it): the whole group goes, and only it.
  if (server?.pid) try { process.kill(-server.pid, "SIGTERM"); } catch {}
  server = undefined;
  if (leased) rmSync(leased, { recursive: true, force: true });
  leased = undefined;
}
process.on("exit", stopServer);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopServer(); process.exit(130); });

function answers(port: number) {
  return new Promise<boolean>((done) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); done(true); });
    socket.once("error", () => done(false));
  });
}
function bindable(port: number) {
  return new Promise<boolean>((done) => {
    const probe = createServer().once("error", () => done(false)).listen(port, "127.0.0.1", () => probe.close(() => done(true)));
  });
}

// A port of this machine's range where nothing answers, for the server and for vite's HMR socket (port + 20000, see
// viteHmrPort). A port that answers belongs to someone else's server: it is never reused, a run shows only its own code.
// A run holds its port from choosing it until it stops: its server takes up to two minutes to answer, and another run
// on this machine checking that port meanwhile found it free and started a second server on it. The lease is a
// directory (made atomically) under the machine's CLI root with its holder's pid; one whose holder is gone is taken over.
function lease(port: number) {
  const dir = join(options.leases, String(port));
  mkdirSync(options.leases, { recursive: true });
  try { mkdirSync(dir); }
  catch {
    let holder = 0;
    try { holder = Number(readFileSync(join(dir, "pid"), "utf8")); } catch {}
    try { if (holder) { process.kill(holder, 0); return false; } } catch {}
    rmSync(dir, { recursive: true, force: true });
    try { mkdirSync(dir); } catch { return false; }
  }
  writeFileSync(join(dir, "pid"), String(process.pid));
  leased = dir;
  return true;
}

async function freePort() {
  const [from, to] = options.ports;
  for (let port = from; port <= to; port++) {
    if (await answers(port) || await answers(port + 20_000)) continue;
    if (!(await bindable(port) && await bindable(port + 20_000))) continue;
    if (lease(port)) return port;
  }
  throw new EnvError(`No free port in ${from}-${to} (each needs port and port+20000 unanswered); free one or widen "ports" in machines.json`);
}

async function startServer(port: number) {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), ROOM_AUTOTICK: "0", SKETCH_BUILD_SHA: options.sha };
  // The debug hooks exist only in the dev build (vite middleware), which is what the server serves without NODE_ENV.
  delete env.NODE_ENV;
  server = spawn(resolve("node_modules/.bin/tsx"), ["src/server/index.ts"], { env, detached: true, stdio: ["ignore", "ignore", "pipe"] });
  let exited: number | null | undefined, log = "";
  server.stderr!.on("data", (chunk) => { log = (log + chunk).slice(-4000); });
  server.once("exit", (code) => { exited = code; });
  const base = `http://127.0.0.1:${port}`;
  for (const started = Date.now(); ;) {
    if (exited !== undefined) throw new EnvError(`The server exited (${exited}) before answering on ${port}:\n${log}`);
    try { if ((await fetch(`${base}/api/catalog`)).ok) break; } catch {}
    if (Date.now() - started > 120_000) throw new EnvError(`The server did not answer on ${port} within 120 s:\n${log}`);
    await new Promise((done) => setTimeout(done, 300));
  }
  const build = await fetch(`${base}/api/build`);
  if (build.ok) {
    const { sha } = await build.json() as { sha: string | null };
    if (sha !== options.sha) throw new EnvError(`The page on ${port} is served by ${sha}, not ${options.sha}`);
  } else {
    // A commit from before /api/build: the port answered nobody before this server started, and this server is alive,
    // so what answers is this copy.
    process.stderr.write(`[sketch] ${options.sha.slice(0, 10)} predates /api/build; identity rests on the port check\n`);
  }
  return base;
}

// macOS ships its Chinese fonts (Hiragino Sans GB, STHeiti) and has no fontconfig to ask; elsewhere fontconfig says.
const hasCjkFont = process.platform === "darwin" ? true : (() => {
  const listed = spawnSync("fc-list", [":lang=zh"], { encoding: "utf8" });
  return listed.status === 0 && listed.stdout.trim().length > 0;
})();

async function main() {
  const port = await freePort();
  const base = await startServer(port);
  // Only when the machine names one: assigning undefined to process.env stores the string "undefined".
  if (options.browsersPath) process.env.PLAYWRIGHT_BROWSERS_PATH = options.browsersPath;
  let chromium: { launch: (options?: object) => Promise<any> };
  try { ({ chromium } = createRequire(import.meta.url)(options.playwright)); }
  catch (error) { throw new EnvError(`Playwright not found at ${options.playwright} ("browser.playwright" in machines.json): ${(error as Error).message}`); }
  // A machine may name its browser's flags ("browser.args"): mac1 draws on Metal, where frame and GPU times mean something.
  const browser = await chromium.launch({ headless: true, args: options.launchArgs ?? [] });
  try {
    const desktop = options.sizes[0]!;
    // The game speaks the browser's language (see detectLocale): `--locale zh-CN` shoots it in Chinese.
    const page = await browser.newPage({ viewport: { width: desktop.width, height: desktop.height }, locale: options.locale ?? "en-US" });
    page.on("pageerror", (error: Error) => errors.push(`pageerror ${String(error).slice(0, 300)}`));
    page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(`console ${message.text().slice(0, 300)}`); });
    const scene = createScene(page, base);
    const module = await import(pathToFileURL(resolve(options.scene)).href) as { default: (scene: Scene) => Promise<void> };
    await scene.home();
    await module.default(scene);
    // `sketch shot --at`: after the scene, the same picture at each of these game seconds.
    for (const second of options.at ?? []) {
      const tick = (await scene.snapshot() as { tick: number }).tick, target = Math.round(second * 20);
      if (target > tick) await scene.tick(target - tick);
      await scene.shot(`at-${second}s`);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

export type Scene = ReturnType<typeof createScene>;

function createScene(page: any, base: string) {
  let roomId: string | undefined, mapId: string | undefined, centred: { x: number; y: number } | undefined;
  const wait = (ms: number) => page.waitForTimeout(ms);
  const must = (condition: unknown, message: string) => { if (!condition) throw new SceneFailure(message); };
  const api = async (url: string, body?: unknown) => {
    const response = await fetch(`${base}${url}`, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) throw new SceneFailure(`${url}: ${response.status} ${await response.text()}`);
    return response.json();
  };
  const hooks = () => page.evaluate(() => !!(window as any).__sketchRtsDebug);
  const needHooks = async (name: string) => { if (!await hooks()) throw new EnvError(`${name}() needs the dev debug hooks, which this commit (${options.sha.slice(0, 10)}) predates; drive it through the UI instead`); };
  // The resource screen covers the page while a phase's art loads (startup, home, match), and takes the clicks meant for
  // what is under it; a cold copy's first load is slow.
  // With the dev hooks the page says when it is settled (its first screen opened, no art loading); a commit from before
  // them is judged by its resource screen alone.
  const loaded = () => page.waitForFunction(() => {
    const debug = (window as any).__sketchRtsDebug;
    return typeof debug?.ready === "function" ? debug.ready() : !document.querySelector(".resource-screen:not([hidden])");
  }, null, { timeout: 180_000 });
  const inGame = async () => {
    await page.waitForFunction(() => document.querySelector("[data-main-menu]")?.classList.contains("hidden") && ((window as any).__sketchRtsView?.tick ?? -1) >= 0, null, { timeout: 180_000 });
    await loaded();
  };
  const settle = async () => { await page.addStyleTag({ content: "[data-pointer-lock-gate]{display:none!important}" }); await wait(1500); };
  const liveTick = () => page.evaluate(() => (window as any).__sketchRtsView?.tick ?? -1);
  const scene = {
    page, wait, must, api,
    get roomId() { return roomId; },
    /** The home screen, as a player opens it. */
    async home() {
      await page.goto(base, { waitUntil: "load" });
      await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 120_000 });
      // The menu shows before the page reaches the server ("connecting…" under it); once connected it is drawn again, its
      // buttons replaced, and the home's status line empties. A click in between lands on a button being swapped out: on
      // a slow software-rendered page that click could miss for its whole timeout.
      await page.waitForFunction(() => document.querySelector("[data-menu-status]")?.textContent === "", null, { timeout: 120_000 });
      await loaded();
    },
    /** A room built through the real menu (that commit's scripts/room-ui-flow.mjs), computers in the other seats, started. */
    async room(map: string, seats?: number) {
      const flow = await import(pathToFileURL(resolve("scripts/room-ui-flow.mjs")).href) as { roomUiFlowCode: string };
      const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor;
      // The flow's waits (5 s) are for a warm page on a developer's machine; a fresh copy on a remote one rebuilds a room
      // slower. It gets the page with every explicit timeout scaled, and is otherwise unchanged.
      const patient = new Proxy(page, { get(target, key) {
        const value = target[key];
        if (key !== "waitForFunction" && key !== "waitForSelector") return typeof value === "function" ? value.bind(target) : value;
        return (...args: any[]) => target[key](...args.map((arg) => arg && typeof arg === "object" && typeof arg.timeout === "number" ? { ...arg, timeout: arg.timeout * 6 } : arg));
      } });
      const helpers = await new AsyncFunction("page", "must", `${flow.roomUiFlowCode}\nreturn { onlineSetup: typeof onlineSetup === "function" ? onlineSetup : undefined };`)(patient, must);
      must(helpers.onlineSetup, "this commit's scripts/room-ui-flow.mjs has no onlineSetup");
      await page.click("[data-open-room-browser]");
      // A cold copy's first page waits on vite's dependency pass; the flow's own waits are for a warm page.
      await page.waitForSelector("[data-create-room]", { state: "visible", timeout: 60_000 });
      await wait(500);
      roomId = await helpers.onlineSetup(map);
      const slots = await page.locator("[data-slot-id]").count();
      if (seats !== undefined) must(slots === seats, `${map} has ${slots} seats, not ${seats}`);
      await page.click("[data-start-room]");
      await inGame();
      // Paused, the match moves only when the scene ticks it, though the page is connected (see @@@room-paused); a reset
      // keeps the pause. On a commit from before that, a connected page still drives the room live.
      await api(`/api/rooms/${roomId}/pause`, {});
      await settle();
      mapId = map;
      return roomId!;
    },
    snapshot() { must(roomId, "snapshot() before room()"); return api(`/api/rooms/${roomId}/snapshot`); },
    /** Resets the room's game (POST /reset with { mapId, options }), and loads it in the page. */
    async scenario(resetOptions: Record<string, unknown>) {
      must(roomId, "scenario() before room()");
      const current = await scene.snapshot() as { map: { id: string } };
      await api(`/api/rooms/${roomId}/reset`, { mapId: current.map.id ?? mapId, options: resetOptions });
      await scene.tick(2);
      return scene.snapshot();
    },
    /** Advances the room n ticks and waits until the page shows them. A page that does not follow is a failure: every
     * hosted tick is a frame the page follows (@@@hosted-every-tick), so it is not reloaded into catching up. */
    async tick(n: number) {
      must(roomId, "tick() before room()");
      const result = await api(`/api/rooms/${roomId}/tick`, { ticks: n }) as { snapshot?: { tick: number } };
      const target = result.snapshot?.tick ?? (await scene.snapshot() as { tick: number }).tick;
      // A slow software-rendered page (about 4 frames a second on the A100) takes a while to apply a few ticks.
      for (const started = Date.now(); Date.now() - started < 60_000; await wait(200)) if (await liveTick() >= target) return;
      must(false, `the page shows tick ${await liveTick()}, the room is at ${target}`);
    },
    /** Centres the camera on a world point: the dev hook, or on an older commit a click on the minimap. */
    async camera(x: number, y: number, zoom?: number) {
      if (await hooks()) await page.evaluate(({ x, y, zoom }: { x: number; y: number; zoom?: number }) => (window as any).__sketchRtsDebug.camera(x, y, zoom), { x, y, zoom });
      else {
        if (zoom !== undefined) throw new EnvError(`camera zoom needs the dev debug hooks, which ${options.sha.slice(0, 10)} predates`);
        const map = (await scene.snapshot() as { map: { width: number; height: number } }).map;
        const at = await page.evaluate(({ x, y, w, h }: { x: number; y: number; w: number; h: number }) => {
          const frame = document.querySelector("[data-minimap-frame]") as HTMLElement, canvas = document.querySelector(".game-canvas")!;
          const t = new DOMMatrixReadOnly(getComputedStyle(frame).transform), b = canvas.getBoundingClientRect();
          return { x: b.x + t.m41 + parseFloat(frame.style.width) * x / w, y: b.y + t.m42 + parseFloat(frame.style.height) * y / h };
        }, { x, y, w: map.width, h: map.height });
        await page.mouse.click(at.x, at.y);
        await page.mouse.move(at.x - 400, at.y - 300);
      }
      centred = { x, y };
      await wait(800);
    },
    /** A command posted to the room for any seat (POST /api/rooms/:id/command), as a script or the server would. */
    order(playerId: string, command: Record<string, unknown>) { must(roomId, "order() before room()"); return api(`/api/rooms/${roomId}/command`, { playerId, command }); },
    async select(ids: string[]) { await needHooks("select"); await page.evaluate((ids: string[]) => (window as any).__sketchRtsDebug.select(ids), ids); await wait(400); },
    async command(command: Record<string, unknown>) { await needHooks("command"); return page.evaluate((command: unknown) => (window as any).__sketchRtsDebug.command(command), command) as Promise<boolean>; },
    /** The page point where a world point is drawn now. */
    async screenOf(x: number, y: number) {
      if (await hooks()) return page.evaluate(({ x, y }: { x: number; y: number }) => (window as any).__sketchRtsDebug.screenOf(x, y), { x, y }) as Promise<{ x: number; y: number }>;
      // An older commit: only the point the camera was just centred on is known, at the middle of the game canvas.
      if (!centred || centred.x !== x || centred.y !== y) throw new EnvError(`screenOf(${x}, ${y}) needs the dev debug hooks, which ${options.sha.slice(0, 10)} predates; on such a commit centre the camera on the point first`);
      return page.evaluate(() => { const b = document.querySelector(".game-canvas")!.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }) as Promise<{ x: number; y: number }>;
    },
    async click(x: number, y: number, button: "left" | "right" = "left") { const at = await scene.screenOf(x, y); await page.mouse.click(at.x, at.y, { button }); await wait(500); },
    async drag(x0: number, y0: number, x1: number, y1: number) {
      const a = await scene.screenOf(x0, y0), b = await scene.screenOf(x1, y1);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); await wait(700);
    },
    async key(key: string) { await page.keyboard.press(key); await wait(400); },
    async readDom(selector: string): Promise<{ text: string; visible: boolean; data: Record<string, string> }[]> {
      return page.evaluate((selector: string) => [...document.querySelectorAll(selector)].map((element) => ({
        text: (element as HTMLElement).innerText?.slice(0, 500), visible: !!(element as HTMLElement).offsetParent,
        data: { ...(element as HTMLElement).dataset } })), selector);
    },
    /** Measurements a probe scene brings back beside its shots, as <name>.json. */
    record(name: string, data: unknown) {
      must(/^[a-z0-9][a-z0-9-]*$/.test(name), `record names are kebab-case: ${name}`);
      const file = join(options.out, `${name}.json`);
      writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
      records.push({ name, file });
    },
    /** A screenshot at every requested size, with what the page shows read back. */
    async shot(name: string, clip?: { x: number; y: number; width: number; height: number }) {
      must(/^[a-z0-9][a-z0-9-]*$/.test(name), `shot names are kebab-case: ${name}`);
      for (const size of options.sizes) {
        if (options.sizes.length > 1) { await page.setViewportSize({ width: size.width, height: size.height }); await wait(600); }
        const dom = await page.evaluate(() => ({
          text: document.body.innerText.slice(0, 4000),
          selection: (document.querySelector("[data-selection]") as HTMLElement | null)?.innerText ?? null,
          commands: [...document.querySelectorAll("[data-command-label]")].filter((element) => (element as HTMLElement).offsetParent).map((element) => (element as HTMLElement).dataset.commandLabel),
          tick: (window as any).__sketchRtsView?.tick ?? null,
        }));
        if (!hasCjkFont && /[\u3400-\u9fff]/.test(dom.text)) throw new EnvError(`The page shows Chinese text and this machine has no CJK font (fc-list :lang=zh is empty); shoot it on a machine that has one`);
        const file = join(options.out, `${name}-${size.name}.png`);
        await page.screenshot({ path: file, ...(clip && size === options.sizes[0] ? { clip } : {}) });
        shots.push({ name, size: size.name, file, dom });
        writeFileSync(`${file}.json`, `${JSON.stringify(dom, null, 2)}\n`);
      }
      if (options.sizes.length > 1) await page.setViewportSize({ width: options.sizes[0]!.width, height: options.sizes[0]!.height });
    },
  };
  return scene;
}

main().then(() => {
  stopServer();
  process.stdout.write(`${JSON.stringify({ ok: true, shots, records, errors })}\n`);
  process.exit(0);
}, (error: unknown) => {
  stopServer();
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ ok: false, failure: message, shots, records, errors })}\n`);
  process.exit(error instanceof SceneFailure ? 1 : 2);
});
