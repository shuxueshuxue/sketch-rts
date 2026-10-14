import { RULES_VERSION } from "../src/shared/rules-version";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { transformSync } from "esbuild";
import { describe, expect, it, vi } from "vitest";
import { distribution, instrumentProbeSource, runProbe } from "./six-player-tick-probe";
import { FocusedScopes, instrumentFocusedSource } from "./six-player-focused-instrumentation";

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

  it("retains callback receiver, argument order, optional undefined and thrown values", () => {
    const source = `function unitClaims(snapshot,owner,scripts,options){return scripts.map(script=>script.claimsUnits?.(snapshot,owner,options));}
      exports.run=(snapshot,owner,script,options)=>script.run(snapshot,owner,options);
      exports.claims=unitClaims;`;
    const result = instrumentFocusedSource("/test/src/ai/policy/script-runner.ts", source);
    const scopes = new FocusedScopes(new Set([0]));
    const module = { exports: {} as { run(...args: unknown[]): unknown; claims(...args: unknown[]): unknown } };
    new Function("exports", "globalThis", result.contents)(module.exports, { __sketchSixPlayerFocus: scopes });
    const observed: unknown[] = [], snapshot = {}, owner = "enemy", options = {}, value = {}, error = new Error("native");
    const script = { id: "x", run(...args: unknown[]) { observed.push(this, ...args); return value; },
      claimsUnits(...args: unknown[]) { observed.push(this, ...args); return value; } };
    scopes.begin(0);
    expect(module.exports.run(snapshot, owner, script, options)).toBe(value);
    expect(module.exports.claims(snapshot, owner, [script, { id: "absent" }], options)).toEqual([value, undefined]);
    expect(observed).toEqual([script, snapshot, owner, options, script, snapshot, owner, options]);
    expect(() => module.exports.run(snapshot, owner, { id: "throw", run() { throw error; } }, options)).toThrow(error);
    scopes.end();
    expect(scopes.ticks[0]?.scopes.filter(scope => scope.name === "script.run").reduce((sum, scope) => sum + scope.calls, 0)).toBe(2);
    expect(scopes.ticks[0]?.scopes.every(scope => scope.exclusiveMs >= 0)).toBe(true);
  });

  it("collects nested exclusive wall time only on selected external ticks", () => {
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValueOnce(1).mockReturnValueOnce(2).mockReturnValueOnce(3).mockReturnValueOnce(5).mockReturnValueOnce(8).mockReturnValueOnce(9);
    try {
      const scopes = new FocusedScopes(new Set([4]));
      scopes.begin(3); expect(scopes.enter("unused")).toBeUndefined(); scopes.end();
      scopes.begin(4); const parent = scopes.enter("parent", "enemy"), child = scopes.enter("child");
      scopes.leave(child); scopes.leave(parent); scopes.end();
      expect(scopes.ticks).toEqual([{ tick: 4, startedMs: 1, endedMs: 9, scopes: [
        { name: "child", owner: "enemy", calls: 1, inclusiveMs: 2, exclusiveMs: 2, maxMs: 2 },
        { name: "parent", owner: "enemy", calls: 1, inclusiveMs: 6, exclusiveMs: 4, maxMs: 6 },
      ] }]);
    } finally { clock.mockRestore(); }
  });

  it("counts actual terrain cache branches without changing clock, LRU order or fields", () => {
    const source = `function tilesOf(state){return state;}
      function createRuntime(terrain,mover){const state={terrain,fields:new Map(),clock:0,spare:[]};return state;}
      function exactField(state,target){return cached(state,target,()=>grow(state,[target]));}
      function cached(state,key,build){state.clock+=1;const known=state.fields.get(key);if(known){known.used=state.clock;return known;}
        if(state.fields.size>=2){let oldest,oldestUse=Infinity;for(const [candidate,field] of state.fields){if(field.used<oldestUse){oldestUse=field.used;oldest=candidate;}}
          state.spare.push(state.fields.get(oldest));state.fields.delete(oldest);}
        const field=build();field.used=state.clock;state.fields.set(key,field);return field;}
      function grow(state,sources){return {source:sources[0],used:0};}
      exports.createRuntime=createRuntime;exports.exactField=exactField;`;
    const transformed = instrumentFocusedSource("/test/src/shared/terrain.ts", source);
    const compile = (contents: string, scope: FocusedScopes) => {
      const module = { exports: {} as { createRuntime(...args: unknown[]): { clock: number; fields: Map<number, { source: number; used: number }> }; exactField(...args: unknown[]): unknown } };
      new Function("exports", "globalThis", contents)(module.exports, { __sketchSixPlayerFocus: scope }); return module.exports;
    };
    const scopes = new FocusedScopes(new Set([6990])), originalScopes = new FocusedScopes(new Set());
    const timed = compile(transformed.contents, scopes), plain = compile(source, originalScopes);
    const state = timed.createRuntime({}, "sea"), control = plain.createRuntime({}, "sea");
    // Register occurs before the selected tick, without any cache writes.
    expect(state.clock).toBe(0); expect(state.fields.size).toBe(0);
    scopes.begin(6990);
    const parent = scopes.enter("naval", "player-6", "navalEconomy");
    const context = scopes.enterTerrainContext("chooseNavalMine");
    const requested = [10, 20, 10, 30, 20];
    expect(requested.map(key => timed.exactField(state, key))).toEqual(requested.map(key => plain.exactField(control, key)));
    expect([...state.fields]).toEqual([...control.fields]); expect(state.clock).toBe(control.clock);
    scopes.leaveTerrainContext(context); scopes.leave(parent); scopes.end();
    const tick = scopes.ticks[0]!;
    const counts = Object.fromEntries(["exactField", "cachedHit", "cachedMiss", "cachedEvict", "cachedStored", "grow"].map(event =>
      [event, tick.terrainCache!.filter(counter => counter.event === event).reduce((sum, counter) => sum + counter.calls, 0)]));
    expect(counts).toEqual({ exactField: 5, cachedHit: 1, cachedMiss: 4, cachedEvict: 2, cachedStored: 4, grow: 4 });
    expect(tick.terrainCache!.every(counter => counter.mover === "sea" && counter.runtimeId === 1 && counter.owner === "player-6" && counter.scriptId === "navalEconomy")).toBe(true);
    expect(tick.terrainCache!.every(counter => counter.queryContext === "chooseNavalMine")).toBe(true);
    expect(tick.terrainEvents!.filter(event => event.event === "cachedEvict").map(event => event.key)).toEqual([20, 10]);
    expect([...state.fields.keys()]).toEqual([30, 20]);
  });

  it("reads no clock and touches no cache for inactive terrain counters", () => {
    const scopes = new FocusedScopes(new Set([2]));
    const state = { fields: new Map<number, unknown>(), clock: 7 };
    scopes.registerTerrain(state, "land"); scopes.begin(2);
    const clock = vi.spyOn(performance, "now");
    try {
      scopes.terrainEvent("exactField", state, 41); scopes.terrainEvent("cachedHit", state, 41);
      expect(clock).not.toHaveBeenCalled(); expect(state.clock).toBe(7); expect(state.fields.size).toBe(0);
      scopes.end();
      scopes.begin(3); scopes.terrainEvent("cachedHit", { get fields(): ReadonlyMap<number, unknown> { throw new Error("must not read"); }, clock: 8 }, 99); scopes.end();
      expect(scopes.ticks).toHaveLength(1);
      expect(scopes.ticks[0]!.terrainEvents).toEqual([]);
    } finally { clock.mockRestore(); }
  });

  it("keeps focused scopes and narrow inspector windows transparent to the complete frame log", async () => {
    const directory = await mkdtemp("/workspace/six-player-focused-contract-");
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const focusedDir = join(directory, "focused"), plainDir = join(directory, "plain");
      const focused = await runProbe({ source: process.cwd(), ticks: 31, out: focusedDir,
        focusTicks: [0, 15, 30], focusRadius: 1, cpuProfWindows: [{ from: 0, to: 1 }, { from: 29, to: 30 }], observeGc: true });
      const plain = await runProbe({ source: process.cwd(), ticks: 31, out: plainDir, plain: true });
      expect(focused.finalChecksum).toBe(plain.finalChecksum);
      expect(focused.commandLogSha256).toBe(plain.commandLogSha256);
      expect(gunzipSync(await readFile(join(focusedDir, "command-frames.jsonl.gz"))))
        .toEqual(gunzipSync(await readFile(join(plainDir, "command-frames.jsonl.gz"))));
      const diagnostics = JSON.parse(gunzipSync(await readFile(join(focusedDir, "focused-diagnostics.json.gz"))).toString());
      expect(diagnostics.clocks).toHaveLength(31);
      expect(diagnostics.scopedTicks.map((tick: { tick: number }) => tick.tick)).toEqual([0, 1, 14, 15, 16, 29, 30]);
      expect(diagnostics.profileWindows).toHaveLength(2);
      expect(diagnostics.profileWindows.every((window: { clockVerified: unknown }) => typeof window.clockVerified === "boolean")).toBe(true);
      expect(diagnostics.scopedTicks[0].scopes.some((scope: { name: string }) => scope.name === "script.run")).toBe(true);
    } finally { quiet.mockRestore(); await rm(directory, { recursive: true, force: true }); }
  }, 30_000);

  it("keeps all native frame bytes and final state identical to unmodified source", async () => {
    const directory = await mkdtemp("/workspace/six-player-probe-contract-");
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const timedDir = join(directory, "timed"), plainDir = join(directory, "plain");
      const timed = await runProbe({ source: process.cwd(), ticks: 31, out: timedDir });
      const plain = await runProbe({ source: process.cwd(), ticks: 31, out: plainDir, plain: true });
      expect(timed.rulesVersion).toBe(RULES_VERSION);
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
