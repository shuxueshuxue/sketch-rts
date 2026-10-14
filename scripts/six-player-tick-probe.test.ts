import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { distribution, instrumentProbeSource, runProbe } from "./six-player-tick-probe";

describe("six-player production-path probe", () => {
  it("uses nearest-rank percentiles and retains single-tick spikes", () => {
    const values = [...Array.from({ length: 99 }, () => 1), 800];
    expect(distribution(values)).toMatchObject({ count: 100, median: 1, p95: 1, p99: 1, max: 800, over16: 1, over50: 1 });
    expect(distribution([])).toMatchObject({ count: 0, median: 0, max: 0, mean: 0 });
  });

  it("keeps native return values and exceptions while closing timing scopes", () => {
    const original = `export function stepGame(game: { value: unknown, error?: Error }) { if(game.error) throw game.error; return game.value; }
      export function snapshotGame(game: unknown) { return game; }`;
    const transformed = instrumentProbeSource("/test/src/shared/sim.ts", original);
    const counters = { enter: 0, leave: 0 };
    const probe = { enter() { counters.enter += 1; return {}; }, leave() { counters.leave += 1; } };
    const code = transformSync(transformed.contents, { loader: "ts", format: "cjs" }).code;
    const module = { exports: {} as { stepGame(game: unknown): unknown; snapshotGame(game: unknown): unknown } };
    new Function("module", "exports", "globalThis", code)(module, module.exports, { __sketchSixPlayerProbe: probe });
    const result = {}, error = new Error("native exception");
    expect(module.exports.stepGame({ value: result })).toBe(result);
    expect(module.exports.snapshotGame(result)).toBe(result);
    expect(() => module.exports.stepGame({ error })).toThrow(error);
    expect(counters).toEqual({ enter: 3, leave: 3 });
  });

  it("fails clearly when a timed production boundary disappears", () => {
    expect(() => instrumentProbeSource("/test/src/ai/runtime.ts", "export function unrelated() {}"))
      .toThrow("Probe boundary changed");
  });

  it("keeps all native frame bytes and final state identical to unmodified source", async () => {
    const directory = await mkdtemp("/workspace/six-player-probe-contract-");
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const timedDir = join(directory, "timed"), plainDir = join(directory, "plain");
      const timed = await runProbe({ source: process.cwd(), ticks: 31, out: timedDir });
      const plain = await runProbe({ source: process.cwd(), ticks: 31, out: plainDir, plain: true });
      expect(timed.rulesVersion).toBe(2);
      expect(timed.planningTicks).toMatchObject({ count: 3, allOnMod15Zero: true, allFiveOwners: true });
      expect(timed.finalChecksum).toBe(plain.finalChecksum);
      expect(timed.commandLogSha256).toBe(plain.commandLogSha256);
      for (const file of ["command-frames.jsonl.gz", "initial-snapshot.json.gz"]) {
        expect(gunzipSync(await readFile(join(timedDir, file))))
          .toEqual(gunzipSync(await readFile(join(plainDir, file))));
      }
      const frames = gunzipSync(await readFile(join(timedDir, "command-frames.jsonl.gz"))).toString().trim().split("\n").map(line => JSON.parse(line));
      expect(frames).toHaveLength(31);
      expect(frames.some(frame => frame.frame === null)).toBe(true);
      expect(frames.find(frame => frame.frame)?.frame).toHaveProperty("roomId", "six-player-perf-512");
      await expect(runProbe({ source: process.cwd(), ticks: 1, out: timedDir })).rejects.toThrow("Refusing to overwrite");
    } finally {
      quiet.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
