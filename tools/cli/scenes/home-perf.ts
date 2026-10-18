// A probe: what each home backdrop costs once settled, three fresh rounds each. A trace of 8 s gives every frame's JS
// (FireAnimationFrame, thread time) and the worst gap between frames; the perf overlay (?perf=1) gives its per-segment JS
// and GPU 3D; the 3D models' downloads give the capital's load. Rewritten from Art Lane's homeperf.mjs. Numbers mean
// something only on a real GPU: run it on mac1, whose machine flags draw on Metal (a software renderer's are not the
// game's). Writes home-perf.json.
import type { Scene } from "../drivers/browser";

const SCENES = ["capital", "woods", "fleet"], ROUNDS = 3;

export default async function (s: Scene) {
  const base = new URL(s.page.url()).origin, browser = s.page.context().browser();
  const results: Record<string, unknown[]> = {};
  for (const id of SCENES) {
    results[id] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      const page = await context.newPage();
      await page.addInitScript(`try { localStorage.setItem("sketch-rts-menu-scene", ${JSON.stringify(id)}); } catch {}`);
      const t0 = Date.now(), models = new Map<string, { name: string; start: number; end?: number; size?: number }>();
      page.on("request", (request: { url(): string }) => { if (/world3d\/.*\.glb/.test(request.url())) models.set(request.url(), { name: request.url().split("/").pop()!.split("?")[0]!, start: Date.now() - t0 }); });
      page.on("requestfinished", async (request: { url(): string; sizes(): Promise<{ responseBodySize: number }> }) => {
        const model = models.get(request.url());
        if (model) { model.end = Date.now() - t0; model.size = (await request.sizes().catch(() => ({ responseBodySize: 0 }))).responseBodySize; }
      });
      await page.goto(`${base}/?perf=1`, { waitUntil: "load" });
      await page.waitForSelector("[data-main-menu]:not(.hidden)", { timeout: 180_000 });
      await page.waitForFunction("!window.__sketchRtsDebug || !window.__sketchRtsDebug.ready || window.__sketchRtsDebug.ready()", null, { timeout: 180_000 });
      await page.waitForTimeout(8000);
      const cdp = await context.newCDPSession(page), events: { name: string; ph: string; ts: number; dur?: number; tdur?: number }[] = [];
      cdp.on("Tracing.dataCollected", (event: { value: typeof events }) => events.push(...event.value));
      await cdp.send("Tracing.start", { categories: "devtools.timeline", transferMode: "ReportEvents" });
      await page.waitForTimeout(8000);
      const complete = new Promise((done) => cdp.once("Tracing.tracingComplete", done));
      await cdp.send("Tracing.end"); await complete;
      const fires = events.filter((event) => event.name === "FireAnimationFrame" && event.ph === "X").sort((a, b) => a.ts - b.ts);
      let worstGap = { gapMs: 0, jsMs: 0 };
      for (let i = 1; i < fires.length; i++) {
        const gap = (fires[i]!.ts - fires[i - 1]!.ts) / 1000;
        if (gap > worstGap.gapMs) worstGap = { gapMs: +gap.toFixed(1), jsMs: +((fires[i]!.tdur ?? fires[i]!.dur ?? 0) / 1000).toFixed(1) };
      }
      const frames = fires.map((event) => (event.tdur ?? event.dur ?? 0) / 1000).sort((a, b) => a - b);
      const at = (q: number) => frames.length ? +frames[Math.min(frames.length - 1, Math.floor(q * frames.length))]!.toFixed(2) : null;
      const overlay = await page.evaluate(`[...document.querySelectorAll("pre")].map(function (e) { return e.textContent; }).find(function (t) { return t && t.includes("GPU 3D"); }) || ""`) as string;
      const segments = Object.fromEntries([...overlay.matchAll(/^ {2}(\w+)\s+([\d.]+) \/ ([\d.]+)/gm)].map((match) => [match[1], +match[2]!]));
      const loaded = [...models.values()].filter((model) => model.end !== undefined), capital = loaded.filter((model) => model.name.startsWith("capital-"));
      results[id]!.push({
        round, frames: frames.length, jsMedianMs: at(.5), jsP95Ms: at(.95), jsWorstMs: frames.length ? +frames.at(-1)!.toFixed(1) : null, worstGap,
        overlayJs: overlay.match(/frame JS ([^\n]*)/)?.[1] ?? null, overlayGpu: overlay.match(/GPU 3D ([^\n]*)/)?.[1] ?? null, segments,
        models: loaded.length, capitalModels: capital.length, capitalBytes: capital.reduce((sum, model) => sum + (model.size ?? 0), 0),
        capitalLoadMs: capital.length ? Math.round(Math.max(...capital.map((model) => model.end!)) - Math.min(...capital.map((model) => model.start))) : 0,
      });
      await context.close();
    }
  }
  s.must(Object.values(results).every((rounds) => rounds.every((round) => (round as { frames: number }).frames > 0)), "a round traced no frames");
  s.record("home-perf", results);
}
