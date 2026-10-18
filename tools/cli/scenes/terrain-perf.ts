// A probe: what the terrain costs on the real page. The home woods idle; every chunk of Temple Spring's ground painted
// (density 1 and 2, the fastest of three each, the map's one-time setup apart); a match after an hour of computers
// while the camera pans, with the perf overlay's ground row once a second; and the match idle. Main-thread time comes
// from a trace: each frame's (FireAnimationFrame) and the busy time per second (RunTask). Rewritten from Art Lane's
// perf.mjs. Numbers mean something only on a real GPU: run it on mac1. Writes terrain-perf.json.
import type { Scene } from "../drivers/browser";

type Event = { name: string; ph: string; pid: number; tid: number; tdur?: number; args?: { name?: string } };
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), at = (q: number) => sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!.toFixed(2) : null;
  return { n: values.length, p50: at(.5), p95: at(.95), max: sorted.length ? +sorted.at(-1)!.toFixed(2) : null };
};

export default async function (s: Scene) {
  const page = s.page, browser = page.context().browser();
  const traced = async (during: () => Promise<unknown>) => {
    await browser.startTracing(page, { categories: ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline"] });
    const started = Date.now();
    await during();
    const seconds = (Date.now() - started) / 1000;
    const events = JSON.parse((await browser.stopTracing()).toString()).traceEvents as Event[];
    const main = new Set(events.filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain").map((e) => `${e.pid}:${e.tid}`));
    const onMain = events.filter((e) => main.has(`${e.pid}:${e.tid}`) && e.ph === "X" && typeof e.tdur === "number");
    const busy = onMain.filter((e) => e.name === "RunTask").reduce((sum, e) => sum + e.tdur! / 1000, 0);
    return { seconds: +seconds.toFixed(1), frameCpuMs: summary(onMain.filter((e) => e.name === "FireAnimationFrame").map((e) => e.tdur! / 1000)), busyMsPerSecond: Math.round(busy / seconds) };
  };
  const result: Record<string, unknown> = {};

  await page.evaluate(`localStorage.setItem("sketch-rts-menu-scene", "woods"); sessionStorage.setItem("perf", "1");`);
  await s.home();
  await s.wait(8000);
  result.homeWoods = await traced(() => s.wait(8000));

  await s.home();
  await s.room("templeSpring");
  const start = await s.snapshot() as { map: { id: string }; players: Record<string, unknown> };
  await s.api(`/api/rooms/${s.roomId}/reset`, { mapId: start.map.id, options: { aiPlayers: Object.keys(start.players) } });
  for (let i = 0; i < 3; i++) await s.api(`/api/rooms/${s.roomId}/tick`, { ticks: 1200 });
  const terrain = (await s.snapshot() as { map: { terrain: unknown } }).map.terrain;
  // Each chunk painted on this thread by the page's own module (the worker runs the same function), three times, the
  // fastest kept so a loaded host's stalls drop out.
  const chunks = await page.evaluate(`(async function (terrain) {
    const module = await import(location.pathname.replace(/[^/]*$/, "") + "src/client/terrain-art.ts");
    let t = performance.now(); module.paintTerrainChunk(terrain, 0, 0, 1); const setup = performance.now() - t;
    const times = { 1: [], 2: [] }, count = Math.ceil(terrain.cols * terrain.cell / 512);
    for (const density of [1, 2]) for (let cy = 0; cy < count; cy++) for (let cx = 0; cx < count; cx++) {
      let best = Infinity;
      for (let k = 0; k < 3; k++) { t = performance.now(); module.paintTerrainChunk(terrain, cx, cy, density); best = Math.min(best, performance.now() - t); }
      times[density].push(best);
    }
    return { setup, times };
  })(${JSON.stringify(terrain)})`) as { setup: number; times: Record<"1" | "2", number[]> };
  result.chunkSetupMs = +chunks.setup.toFixed(1);
  result.chunks = { density1: summary(chunks.times[1]), density2: summary(chunks.times[2]), over16: [chunks.times[1], chunks.times[2]].map((times) => times.filter((t) => t > 16).length) };

  await s.reload();
  await s.wait(5000);
  const ground: { mean: number; max: number }[] = [];
  const rows = (async () => {
    for (let i = 0; i < 10; i++) {
      await s.wait(1000);
      const m = /ground\s+([\d.]+)\s*\/\s*([\d.]+)/.exec(await page.evaluate(`document.querySelector(".perf-overlay")?.textContent ?? ""`) as string);
      if (m) ground.push({ mean: +m[1]!, max: +m[2]! });
    }
  })();
  result.pan = await traced(async () => {
    for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"]) { await page.keyboard.down(key); await s.wait(2500); await page.keyboard.up(key); }
    await rows;
  });
  s.must(ground.length > 0, "the perf overlay shows no ground row: the page did not open with ?perf");
  result.panGroundMax = summary(ground.map((r) => r.max));
  result.panGroundMean = summary(ground.map((r) => r.mean));
  result.idle = await traced(() => s.wait(6000));
  s.record("terrain-perf", result);
}
