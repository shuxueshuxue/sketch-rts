/**
 * Six-seat static solo probe. Runs the production deployment/adapter/frame path.
 * Timing hooks are inserted into an ephemeral esbuild bundle, never game files.
 * Run: npm run benchmark:six-player-ticks -- --source ROOT --ticks 14400 --out NEWDIR
 * --plain uses unmodified source, for checking hook transparency (timings absent).
 * --cpu-prof-from T starts Node's built-in inspector profiler before tick T.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { cpus, freemem, platform, release, totalmem } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { Session } from "node:inspector";
import { PerformanceObserver } from "node:perf_hooks";
import { build, version as esbuildVersion } from "esbuild";
import ts from "typescript";
import type { Game } from "../src/shared/sim";
import type { CommandFrame } from "../src/shared/net/types";
import type { GameSnapshot, RoomState } from "../src/shared/types";
import { FOCUS_HOOK, FocusedScopes, instrumentFocusedSource } from "./six-player-focused-instrumentation";

const HOOK = "__sketchSixPlayerProbe";
export const PROBE_ROOM_ID = "six-player-perf-512";
const scriptPath = fileURLToPath(import.meta.url);
const git = (source: string, ...args: string[]) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" }).trim();
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Mark = { kind: string; started: number; aiDepth: number; owner?: string; version?: string };
type OwnerSample = { owner: string; version: string; ms: number };
export type TickSample = {
  tick: number; tickAfter: number; mod15: number;
  wholeMs: number; frameMs: number; simMs: number; aiMs: number;
  aiSnapshotMs: number; otherSnapshotMs: number; renderSnapshotMs: number;
  observerMs: number; ownerPlans: OwnerSample[]; units: number; buildings: number;
  memory?: NodeJS.MemoryUsage;
};
type Hooks = {
  enter(kind: string, gameOrSnapshot?: Game | GameSnapshot, request?: { playerId: string; version?: string }): Mark;
  leave(mark: Mark): void;
};

/** Only inserts at actual function boundaries; original body/return/throw stay intact. */
export function instrumentProbeSource(file: string, text: string): { contents: string; hooks: string[] } {
  const targetNames: Record<string, string> = file.endsWith("/src/shared/sim.ts")
    ? { stepGame: "sim", snapshotGame: "snapshot" }
    : file.endsWith("/src/ai/runtime.ts") ? { planPresetAiRuntimeCommands: "ai" }
      : file.endsWith("/src/ai/planner-context.ts") ? { planAiOwnerCommandEntries: "owner" } : {};
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const insertions: { at: number; text: string }[] = [];
  const hooks: string[] = [];
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name || !node.body) continue;
    const kind = targetNames[node.name.text];
    if (!kind) continue;
    if (node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword) || node.asteriskToken) {
      throw new Error(`Cannot synchronously instrument ${node.name.text}`);
    }
    const firstParameter = node.parameters[0]?.name.getText(ast);
    if (!firstParameter) throw new Error(`Missing first parameter of ${node.name.text}`);
    const request = kind === "owner" ? ", request" : "";
    insertions.push({ at: node.body.getStart(ast) + 1,
      text: `\nconst __sixPlayerMark = globalThis.${HOOK}.enter(${JSON.stringify(kind)}, ${firstParameter}${request});\ntry {\n` });
    insertions.push({ at: node.body.end - 1, text: `\n} finally { globalThis.${HOOK}.leave(__sixPlayerMark); }\n` });
    hooks.push(node.name.text);
  }
  for (const insertion of insertions.sort((a, b) => b.at - a.at)) {
    text = text.slice(0, insertion.at) + insertion.text + text.slice(insertion.at);
  }
  const expected = Object.keys(targetNames);
  if (hooks.length !== expected.length || expected.some(name => !hooks.includes(name))) {
    throw new Error(`Probe boundary changed in ${file}: expected ${expected}, got ${hooks}`);
  }
  return { contents: text, hooks };
}

export function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return { count: sorted.length, median: quantile(0.5), p95: quantile(0.95), p99: quantile(0.99),
    max: sorted.at(-1) ?? 0, mean: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : 0,
    over16: sorted.filter(value => value > 16).length, over50: sorted.filter(value => value > 50).length };
}

type BundleApi = {
  StaticSoloDeploymentRuntime: new (options: { now: () => number; tickMs: number }) => {
    createRoom(input: unknown): Promise<RoomState>;
    startRoom(id: string, host: { id: string; name: string }): Promise<{
      room: RoomState; snapshot: GameSnapshot; adapter: {
        currentSnapshot(): GameSnapshot; updateToRenderTime(): boolean;
        game: Game;
      };
    }>;
    close(): void;
  };
  CommandFrameRuntime: { prototype: { tick(...args: unknown[]): CommandFrame | undefined } };
  checksumGame(game: Game): string;
  CHECKSUM_VERSION: number;
  RULES_VERSION: number;
};

export type ProbeOptions = { source: string; ticks: number; out: string; plain?: boolean; cpuProfFrom?: number;
  focusTicks?: number[]; focusRadius?: number; cpuProfWindows?: { from: number; to: number }[]; observeGc?: boolean };
export async function runProbe(options: ProbeOptions) {
  const source = resolve(options.source), out = resolve(options.out);
  if (!Number.isSafeInteger(options.ticks) || options.ticks < 1) throw new Error("--ticks must be a positive integer");
  if (options.cpuProfFrom !== undefined && (!Number.isSafeInteger(options.cpuProfFrom) || options.cpuProfFrom < 0 || options.cpuProfFrom >= options.ticks)) {
    throw new Error("--cpu-prof-from must be within the requested tick range");
  }
  const focusRadius = options.focusRadius ?? 0;
  if (!Number.isSafeInteger(focusRadius) || focusRadius < 0) throw new Error("--focus-radius must be a nonnegative integer");
  if (options.focusTicks?.some(tick => !Number.isSafeInteger(tick) || tick < 0 || tick >= options.ticks)) throw new Error("--focus-ticks must be within the requested tick range");
  if (options.plain && options.focusTicks?.length) throw new Error("--plain cannot insert focused scopes");
  const windows = [...(options.cpuProfWindows ?? [])].sort((a, b) => a.from - b.from);
  if (options.cpuProfFrom !== undefined && windows.length) throw new Error("Choose --cpu-prof-from or --cpu-prof-windows");
  windows.forEach((window, index) => {
    if (![window.from, window.to].every(Number.isSafeInteger) || window.from < 0 || window.to < window.from || window.to >= options.ticks
      || index && windows[index - 1]!.to >= window.from) throw new Error("CPU profile windows must be disjoint inclusive tick ranges within the run");
  });
  const focused = options.focusTicks?.length ? new FocusedScopes(new Set(options.focusTicks.flatMap(tick =>
    Array.from({ length: focusRadius * 2 + 1 }, (_, offset) => tick - focusRadius + offset).filter(value => value >= 0 && value < options.ticks)))) : undefined;
  const diagnosticClocks = !!focused || !!options.observeGc || !!windows.length;
  try { await access(out); throw new Error(`Refusing to overwrite output ${out}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(out, { recursive: true });
  const initialGitHead = git(source, "rev-parse", "HEAD");
  const originalInputs = new Map<string, string>();
  const hookManifest: { path: string; functions: string[] }[] = [];
  const focusedHookManifest: { path: string; functions: string[] }[] = [];
  const bundlePath = join(out, "runtime.mjs");
  const entry = [
    ["StaticSoloDeploymentRuntime", "src/client/deployment/static-runtime.ts"],
    ["CommandFrameRuntime", "src/shared/sim/command-frame-runtime.ts"],
    ["checksumGame, CHECKSUM_VERSION", "src/shared/sim/checksum.ts"],
    ["RULES_VERSION", "src/shared/rules-version.ts"],
  ].map(([names, file]) => `export { ${names} } from ${JSON.stringify(join(source, file!))};`).join("\n");
  const built = await build({ stdin: { contents: entry, resolveDir: source, sourcefile: "six-player-probe-entry.ts", loader: "ts" },
    bundle: true, outfile: bundlePath, platform: "node", format: "esm", target: "node22", metafile: true,
    plugins: [{ name: "record-source-and-time-boundaries", setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, async args => {
        if (!args.path.startsWith(join(source, "src") + "/")) return undefined;
        const original = await readFile(args.path, "utf8");
        originalInputs.set(relative(source, args.path), original);
        const transformed = options.plain ? { contents: original, hooks: [] } : instrumentProbeSource(args.path, original);
        if (transformed.hooks.length) hookManifest.push({ path: relative(source, args.path), functions: transformed.hooks });
        const focusedSource = focused ? instrumentFocusedSource(args.path, transformed.contents) : { contents: transformed.contents, hooks: [] };
        if (focusedSource.hooks.length) focusedHookManifest.push({ path: relative(source, args.path), functions: focusedSource.hooks });
        return { contents: focusedSource.contents, loader: "ts" };
      });
    } }],
  });
  if (!options.plain && hookManifest.reduce((sum, item) => sum + item.functions.length, 0) !== 4) {
    throw new Error(`Expected four timed production boundaries, got ${JSON.stringify(hookManifest)}`);
  }
  const inputs = await Promise.all(Object.entries(built.metafile!.inputs).filter(([name]) => !name.endsWith("six-player-probe-entry.ts")).map(async ([name, meta]) => {
    const absolute = isAbsolute(name) ? name : resolve(name);
    const key = relative(source, absolute);
    const contents = originalInputs.get(key) ?? await readFile(absolute, "utf8");
    originalInputs.set(key, contents);
    return { path: key, bytes: Buffer.byteLength(contents), sha256: sha(contents), esbuildBytes: meta.bytes };
  }));
  inputs.sort((a, b) => a.path.localeCompare(b.path));
  const verifyFrozenInputs = async () => {
    for (const input of inputs) if (sha(await readFile(join(source, input.path))) !== input.sha256) {
      throw new Error(`Source changed after bundle: ${input.path}`);
    }
    if (git(source, "rev-parse", "HEAD") !== initialGitHead) throw new Error("Source HEAD changed during probe");
  };
  await verifyFrozenInputs();
  await writeFile(join(out, "source-inputs.json.gz"), gzipSync(JSON.stringify(Object.fromEntries([...originalInputs].sort(([a], [b]) => a.localeCompare(b))))));
  await writeFile(join(out, "probe-source.ts"), await readFile(scriptPath));
  if (diagnosticClocks) await writeFile(join(out, "focused-instrumentation-source.ts"),
    await readFile(join(dirname(scriptPath), "six-player-focused-instrumentation.ts")));
  await writeFile(join(out, "entry.ts"), entry);
  let sample: TickSample | undefined, aiDepth = 0, capturedFrame: CommandFrame | undefined;
  const hooks: Hooks = {
    enter(kind, _game, request) {
      const mark: Mark = { kind, started: performance.now(), aiDepth,
        ...(request ? { owner: request.playerId, version: request.version ?? "default" } : {}) };
      if (kind === "ai") aiDepth += 1;
      return mark;
    },
    leave(mark) {
      const ms = performance.now() - mark.started;
      if (mark.kind === "ai") aiDepth -= 1;
      if (!sample) return;
      if (mark.kind === "sim") sample.simMs += ms;
      else if (mark.kind === "ai") sample.aiMs += ms;
      else if (mark.kind === "snapshot") {
        if (mark.aiDepth) sample.aiSnapshotMs += ms;
        else sample.otherSnapshotMs += ms;
      } else if (mark.kind === "owner") sample.ownerPlans.push({ owner: mark.owner!, version: mark.version!, ms });
    },
  };
  (globalThis as unknown as Record<string, Hooks>)[HOOK] = hooks;
  if (focused) (globalThis as unknown as Record<string, FocusedScopes>)[FOCUS_HOOK] = focused;
  const api = await import(pathToFileURL(bundlePath).href) as BundleApi;
  // An external observer of the actual runtime's returned frame, with no frame/options mutation.
  // This also works with --plain, whose bundle has no AST edits at all.
  const originalTick = api.CommandFrameRuntime.prototype.tick;
  api.CommandFrameRuntime.prototype.tick = function (...args: unknown[]) {
    const started = performance.now();
    try { capturedFrame = originalTick.apply(this, args); return capturedFrame; }
    finally { if (sample) sample.frameMs += performance.now() - started; }
  };
  let runtimeNow = 0;
  const runtime = new api.StaticSoloDeploymentRuntime({ now: () => runtimeNow, tickMs: 50 });
  const host = { id: "six-player-probe-host", name: "Idle human" };
  const roomInput = { id: PROBE_ROOM_ID, host, mapId: "sapphireArchipelago", humanCount: 1, aiCount: 5 };
  let session: Session | undefined;
  const inspectorPost = (method: string) => new Promise<Record<string, unknown>>((done, reject) => {
    session!.post(method, (error, result) => error ? reject(error) : done(result as Record<string, unknown>));
  });
  const ticks: TickSample[] = [];
  const clocks: { tick: number; startedMs: number; endedMs: number; startedHrUs: number; endedHrUs: number }[] = [];
  const clockAnchor = () => ({ performanceMs: performance.now(), hrtimeUs: Number(process.hrtime.bigint()) / 1000 });
  const profileWindows: Record<string, unknown>[] = [];
  let activeWindow: { from: number; to: number; beforeStart: ReturnType<typeof clockAnchor>; afterStart: ReturnType<typeof clockAnchor> } | undefined;
  const gcEntries: { startTime: number; duration: number; detail: unknown; deliveredAtMs: number }[] = [];
  const focusedFacts: Record<string, unknown>[] = [];
  const shipFacts = (game: Game) => game.units.filter(unit => unit.sailing).map(unit => ({ id: unit.id, kind: unit.kind, owner: unit.owner,
    x: unit.x, y: unit.y, order: unit.order, sailing: unit.sailing ? { heading: unit.sailing.heading, speed: unit.sailing.speed,
      route: unit.sailing.route ? { age: unit.sailing.route.age, blockedTicks: unit.sailing.route.blockedTicks,
        goalX: unit.sailing.route.goalX, goalY: unit.sailing.route.goalY, points: unit.sailing.route.points.length } : null,
      planningRequestedAtTick: unit.sailing.planningRequestedAtTick } : null }));
  const gcObserver = options.observeGc ? new PerformanceObserver(list => {
    const deliveredAtMs = performance.now();
    for (const entry of list.getEntries()) gcEntries.push({ startTime: entry.startTime, duration: entry.duration,
      detail: (entry as unknown as { detail?: unknown }).detail ?? null, deliveredAtMs });
  }) : undefined;
  gcObserver?.observe({ entryTypes: ["gc"] });
  const commandLog: string[] = [];
  const commandHash = createHash("sha256");
  const runStarted = performance.now();
  const memoryBefore = process.memoryUsage();
  let finalGame: Game | undefined;
  let initialSnapshot: GameSnapshot | undefined, startedRoom: RoomState | undefined;
  try {
    await runtime.createRoom(roomInput);
    const match = await runtime.startRoom(PROBE_ROOM_ID, host);
    initialSnapshot = match.snapshot; startedRoom = match.room;
    finalGame = match.adapter.game;
    if (!finalGame || initialSnapshot.tick !== 0) throw new Error("Local adapter game boundary changed");
    const expectedVersions = ["v9_archer", "v9_archer", "v9_knight", "v9_summoner", "v9_knight"];
    const actualVersions = match.room.slots.filter(slot => slot.controller === "ai").map(slot => slot.aiVersion);
    // Lobby retains random presets; startRoom resolves them in the native AI runtime.
    const aiVersions = (match.adapter as unknown as { options: { aiRuntime: { versions: Record<string, string> } } }).options.aiRuntime.versions;
    if (Object.values(aiVersions).join(",") !== expectedVersions.join(",")) throw new Error(`Unexpected preset resolution: ${JSON.stringify(aiVersions)}`);
    await writeFile(join(out, "initial-snapshot.json.gz"), gzipSync(JSON.stringify(initialSnapshot)));
    await writeFile(join(out, "room.json"), JSON.stringify({ roomInput, room: startedRoom, aiVersions, lobbyAiVersions: actualVersions }, null, 2));
    for (let index = 0; index < options.ticks; index += 1) {
      const window = windows.find(candidate => candidate.from === index);
      if (window) {
        session = new Session(); session.connect(); await inspectorPost("Profiler.enable");
        const beforeStart = clockAnchor(); await inspectorPost("Profiler.start");
        activeWindow = { ...window, beforeStart, afterStart: clockAnchor() };
      }
      if (options.cpuProfFrom === index) {
        session = new Session(); session.connect();
        await inspectorPost("Profiler.enable"); await inspectorPost("Profiler.start");
      }
      const tick = finalGame.tick;
      const beforeFacts = focused?.includes(tick) ? { unitIds: new Set(finalGame.units.map(unit => unit.id)),
        buildingIds: new Set(finalGame.buildings.map(building => building.id)), ships: shipFacts(finalGame) } : undefined;
      sample = { tick, tickAfter: tick, mod15: tick % 15, wholeMs: 0, frameMs: 0, simMs: 0, aiMs: 0,
        aiSnapshotMs: 0, otherSnapshotMs: 0, renderSnapshotMs: 0, observerMs: 0, ownerPlans: [], units: 0, buildings: 0 };
      capturedFrame = undefined;
      runtimeNow += 50;
      focused?.begin(tick);
      const started = performance.now();
      const startedHrUs = diagnosticClocks ? Number(process.hrtime.bigint()) / 1000 : 0;
      const changed = match.adapter.updateToRenderTime();
      const ended = performance.now(); sample.wholeMs = ended - started;
      if (diagnosticClocks) clocks.push({ tick, startedMs: started, endedMs: ended, startedHrUs,
        endedHrUs: Number(process.hrtime.bigint()) / 1000 });
      focused?.end();
      if (!changed || finalGame.tick !== tick + 1) throw new Error(`Expected one real adapter tick at ${tick}, got ${finalGame.tick}; winner=${finalGame.match.winner}`);
      const snapshotStarted = performance.now();
      const snapshot = match.adapter.currentSnapshot();
      sample.renderSnapshotMs = performance.now() - snapshotStarted;
      sample.tickAfter = snapshot.tick; sample.units = snapshot.units.length; sample.buildings = snapshot.buildings.length;
      if (beforeFacts) focusedFacts.push({ tick, tickAfter: snapshot.tick,
        spawnedUnits: snapshot.units.filter(unit => !beforeFacts.unitIds.has(unit.id)).map(unit => ({ id: unit.id, kind: unit.kind,
          owner: unit.owner, x: unit.x, y: unit.y, order: unit.order })),
        newBuildings: snapshot.buildings.filter(building => !beforeFacts.buildingIds.has(building.id)).map(building => ({ id: building.id,
          kind: building.kind, owner: building.owner, x: building.x, y: building.y, complete: building.complete })),
        shipsBefore: beforeFacts.ships, shipsAfter: shipFacts(finalGame) });
      // Native frame fields/order and null for an empty tick are retained; never sort/drop commands.
      const observerStarted = performance.now();
      const line = JSON.stringify({ tick, frame: capturedFrame ?? null }) + "\n";
      commandHash.update(line); commandLog.push(line);
      if (index % 1200 === 0 || index === options.ticks - 1) sample.memory = process.memoryUsage();
      sample.observerMs = performance.now() - observerStarted;
      ticks.push(sample); sample = undefined;
      if (activeWindow?.to === index) {
        const beforeStop = clockAnchor(); const result = await inspectorPost("Profiler.stop"); const afterStop = clockAnchor();
        const profile = result.profile as { startTime: number; endTime: number };
        const file = `cpu-window-${activeWindow.from}-${activeWindow.to}.cpuprofile.gz`;
        await writeFile(join(out, file), gzipSync(JSON.stringify(profile)));
        const clockVerified = profile.startTime >= activeWindow.beforeStart.hrtimeUs && profile.startTime <= activeWindow.afterStart.hrtimeUs
          && profile.endTime >= beforeStop.hrtimeUs && profile.endTime <= afterStop.hrtimeUs;
        profileWindows.push({ ...activeWindow, beforeStop, afterStop, file, profileStartUs: profile.startTime, profileEndUs: profile.endTime,
          clockVerified, note: clockVerified ? "Profiler start/end empirically fall inside process.hrtime microsecond call brackets; use raw hrtime tick anchors for sample alignment."
            : "Profiler clock failed hrtime bracket validation: no tick-level CPU sample attribution is justified." });
        session!.disconnect(); session = undefined; activeWindow = undefined;
      }
    }
    if (session) {
      const profile = await inspectorPost("Profiler.stop"); session.disconnect(); session = undefined;
      await writeFile(join(out, "cpu-profile.cpuprofile.gz"), gzipSync(JSON.stringify(profile.profile)));
    }
    await verifyFrozenInputs();
    if (gcObserver) {
      // Delivery is asynchronous. No yield is inserted inside measured ticks;
      // flush after the complete synchronous run and retain delivery timestamps.
      await new Promise<void>(done => setImmediate(done));
      await new Promise<void>(done => setImmediate(done));
      const deliveredAtMs = performance.now();
      for (const entry of gcObserver.takeRecords()) gcEntries.push({ startTime: entry.startTime, duration: entry.duration,
        detail: (entry as unknown as { detail?: unknown }).detail ?? null, deliveredAtMs });
    }
    if (diagnosticClocks) await writeFile(join(out, "focused-diagnostics.json.gz"), gzipSync(JSON.stringify({ schema: 1,
      hooks: focusedHookManifest, focusTicks: options.focusTicks ?? [], focusRadius, clocks, scopedTicks: focused?.ticks ?? [], profileWindows,
      gcEntries, focusedFacts, method: {
        tickConvention: "Tick before LocalGameAdapter advances; stepGame increments game.tick inside its prelude.",
        exclusiveMeaning: "Inclusive wall time minus instrumented child scopes; includes uninstrumented children and any GC or scheduler pause. Scope overhead is not subtracted.",
        callbackMeaning: "script.claimsUnits is an attempted optional-call scope, including undefined callbacks; script.run preserves native receiver and args. No script function identity or memory writes are changed.",
        gcMeaning: "Node PerformanceObserver asynchronous GC entries, startTime/duration share performance.now timeline; intersection with tick is association, not proof of exclusive script CPU. Delivery timestamps and post-run flush are retained.",
        clockMeaning: "Profiler absolute microsecond clock is accepted only if start/end lie within measured hrtime brackets. Performance and hrtime anchors are both archived; no assumed clock offset.",
        benchmarkMeaning: "Focused scopes, callback closures, GC observer and inspector perturb execution. Use this run for attribution and separate unprofiled repeated runs for performance acceptance."
      } })));
    const finalChecksum = api.checksumGame(finalGame);
    const commandLogSha256 = commandHash.digest("hex");
    const commandBytes = commandLog.join("");
    if (sha(commandBytes) !== commandLogSha256) throw new Error("Command log streaming/full hash mismatch");
    await writeFile(join(out, "command-frames.jsonl.gz"), gzipSync(commandBytes));
    await writeFile(join(out, "ticks.json.gz"), gzipSync(JSON.stringify(ticks)));
    const ownerNames = [...new Set(ticks.flatMap(tick => tick.ownerPlans.map(plan => plan.owner)))];
    const ownerStats = ownerNames.map(owner => {
      const plans = ticks.flatMap(tick => tick.ownerPlans.filter(plan => plan.owner === owner));
      return { owner, version: plans[0]?.version, ...distribution(plans.map(plan => plan.ms)) };
    });
    const timingKeys = ["wholeMs", "frameMs", "simMs", "aiMs", "aiSnapshotMs", "otherSnapshotMs", "renderSnapshotMs", "observerMs"] as const;
    const timing = Object.fromEntries(timingKeys.map(key => [key, distribution(ticks.map(tick => tick[key]))]));
    const planningTicks = ticks.filter(tick => tick.ownerPlans.length);
    const perMinute = Array.from({ length: Math.ceil(ticks.length / 1200) }, (_, minute) => {
      const subset = ticks.slice(minute * 1200, (minute + 1) * 1200);
      return { minute, ticks: subset.length, unitsAtEnd: subset.at(-1)?.units, buildingsAtEnd: subset.at(-1)?.buildings,
        whole: distribution(subset.map(tick => tick.wholeMs)),
        sim: distribution(subset.map(tick => tick.simMs)), ai: distribution(subset.map(tick => tick.aiMs)),
        planningTick: distribution(subset.filter(tick => tick.ownerPlans.length).map(tick => tick.wholeMs)) };
    });
    const stats = { schema: 1, roomId: PROBE_ROOM_ID, mapId: "sapphireArchipelago", ticks: ticks.length,
      finalTick: finalGame.tick, winner: finalGame.match.winner, rulesVersion: api.RULES_VERSION, checksumVersion: api.CHECKSUM_VERSION,
      finalChecksum, commandLogSha256, commandLogBytes: Buffer.byteLength(commandBytes), frames: ticks.length,
      nonEmptyFrames: commandLog.filter(line => !line.includes('"frame":null')).length,
      initial: { units: initialSnapshot.units.length, buildings: initialSnapshot.buildings.length,
        races: Object.fromEntries(Object.entries(initialSnapshot.players).map(([owner, state]) => [owner, state.race])) },
      final: { units: finalGame.units.length, buildings: finalGame.buildings.length },
      timing, ownerStats, planningTicks: { count: planningTicks.length, whole: distribution(planningTicks.map(tick => tick.wholeMs)),
        allOnMod15Zero: planningTicks.every(tick => tick.mod15 === 0), allFiveOwners: planningTicks.every(tick => tick.ownerPlans.length === 5) },
      top25: [...ticks].sort((a, b) => b.wholeMs - a.wholeMs).slice(0, 25), perMinute,
      memory: { before: memoryBefore, after: process.memoryUsage(), observations: ticks.filter(tick => tick.memory).map(tick => ({ tick: tick.tick, ...tick.memory })) },
      processWallMs: performance.now() - runStarted,
      method: { execution: "StaticSoloDeploymentRuntime.startRoom → LocalGameAdapter.updateToRenderTime → CommandFrameRuntime.tick",
        clockAdvanceMsPerCall: 50, renderSnapshotCallsPerTick: 1, plainSource: !!options.plain, cpuProfileFrom: options.cpuProfFrom ?? null,
        wholeTickExcludes: ["currentSnapshot (separately timed)", "command serialization/hash observer", "disk output"],
        aiIncludes: "planPresetAiRuntimeCommands including shared snapshot and all due owners; no-owner calls also timed",
        simIncludes: "stepGame; frameMs additionally includes admission/planning/apply",
        otherSnapshotIncludes: "All snapshotGame calls outside AI, including the separately timed render currentSnapshot; these are overlapping diagnostics, not additive costs.", hooks: hookManifest,
        incompleteAttachmentReproduction: "Attachment omitted room id/races; this fixed real room resolves the reported owner/preset order, with its complete initial state archived. It is a controlled scenario, not proof of the attachment's exact original match.",
        ...(diagnosticClocks ? { diagnosticOutput: "focused-diagnostics.json.gz", focusedHooks: focusedHookManifest } : {}) },
    };
    const environment = { recordedAt: new Date().toISOString(), source, gitHead: initialGitHead, gitStatus: git(source, "status", "--short"),
      sourceInputs: inputs, sourceManifestSha256: sha(JSON.stringify(inputs.map(({ esbuildBytes: _bytes, ...input }) => input))), probeSha256: sha(await readFile(scriptPath)),
      ...(diagnosticClocks ? { focusedInstrumentationSha256: sha(await readFile(join(dirname(scriptPath), "six-player-focused-instrumentation.ts"))) } : {}),
      bundleSha256: sha(await readFile(bundlePath)), argv: process.argv, node: process.version, v8: process.versions.v8,
      esbuild: esbuildVersion, typescript: ts.version, platform: platform(), release: release(), cpus: cpus(), totalMemory: totalmem(), freeMemory: freemem(),
      processExecArgv: process.execArgv, options };
    await writeFile(join(out, "environment.json"), JSON.stringify(environment, null, 2));
    await writeFile(join(out, "summary.json"), JSON.stringify(stats, null, 2));
    const table = ["metric          count    median      p95      p99      max     mean", ...timingKeys.map(key => {
      const value = timing[key]!;
      return `${key.padEnd(15)} ${String(value.count).padStart(5)} ${[value.median, value.p95, value.p99, value.max, value.mean].map(number => number.toFixed(3).padStart(8)).join(" ")}`;
    })].join("\n");
    const report = `${table}\n\nPer owner:\n${JSON.stringify(ownerStats, null, 2)}\n\nPer minute:\n${JSON.stringify(perMinute, null, 2)}\n\nTop 25 whole ticks:\n${JSON.stringify(stats.top25, null, 2)}\n\nFinal checksum ${finalChecksum}\nFull command-log SHA256 ${commandLogSha256}\n`;
    await writeFile(join(out, "report.txt"), report);
    console.log(report);
    return stats;
  } catch (error) {
    // Preserve completed observations when a match ends early or a real runtime
    // error interrupts it. The unfinished tick is separate, never counted as a
    // successful sample or padded out to the requested duration.
    const errorFact = (value: unknown) => value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : { thrown: String(value) };
    const commandBytes = commandLog.join("");
    let finalChecksum: string | undefined, checksumError: unknown, profileError: unknown;
    if (finalGame) {
      try { finalChecksum = api.checksumGame(finalGame); }
      catch (cause) { checksumError = errorFact(cause); }
    }
    if (session) {
      try {
        const profile = await inspectorPost("Profiler.stop");
        await writeFile(join(out, "partial-cpu-profile.cpuprofile.gz"), gzipSync(JSON.stringify(profile.profile)));
      } catch (cause) { profileError = errorFact(cause); }
      finally { session.disconnect(); session = undefined; }
    }
    const failure = { schema: 1, complete: false, requestedTicks: options.ticks, completedTicks: ticks.length,
      source, gitHead: initialGitHead, roomId: PROBE_ROOM_ID, rulesVersion: api.RULES_VERSION, checksumVersion: api.CHECKSUM_VERSION,
      finalTick: finalGame?.tick, winner: finalGame?.match.winner, finalChecksum, checksumError,
      commandLogSha256: sha(commandBytes), commandLogBytes: Buffer.byteLength(commandBytes), commandLogRecords: commandLog.length,
      error: errorFact(error), profileError, memory: process.memoryUsage(),
      ...(sample ? { interruptedTick: { sample, capturedNativeFrame: capturedFrame ?? null,
        note: "Interrupted observation; not included in completed tick/log counts." } } : {}),
    };
    try {
      await writeFile(join(out, "failure.json"), JSON.stringify(failure, null, 2));
      await writeFile(join(out, "ticks.json.gz"), gzipSync(JSON.stringify(ticks)));
      await writeFile(join(out, "command-frames.jsonl.gz"), gzipSync(commandBytes));
      if (diagnosticClocks) await writeFile(join(out, "partial-focused-diagnostics.json.gz"), gzipSync(JSON.stringify({ clocks, scopedTicks: focused?.ticks ?? [], profileWindows, gcEntries, focusedFacts, activeWindow })));
    } catch (persistenceError) {
      throw new AggregateError([error, persistenceError], "Probe failed and could not fully persist its partial evidence");
    }
    throw error;
  } finally {
    gcObserver?.disconnect();
    session?.disconnect(); runtime.close();
    api.CommandFrameRuntime.prototype.tick = originalTick;
    delete (globalThis as unknown as Record<string, Hooks>)[HOOK];
    if (focused) delete (globalThis as unknown as Record<string, FocusedScopes>)[FOCUS_HOOK];
  }
}

function parseArguments(args: string[]): ProbeOptions {
  const options: ProbeOptions = { source: dirname(dirname(scriptPath)), ticks: 14400, out: "" };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === "--plain") { options.plain = true; continue; }
    if (flag === "--observe-gc") { options.observeGc = true; continue; }
    if (!["--source", "--ticks", "--out", "--cpu-prof-from", "--focus-ticks", "--focus-radius", "--cpu-prof-windows"].includes(flag!)) throw new Error(`Unknown argument ${flag}`);
    const value = args[++i]; if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
    if (flag === "--source") options.source = value;
    else if (flag === "--out") options.out = value;
    else if (flag === "--ticks") options.ticks = Number(value);
    else if (flag === "--cpu-prof-from") options.cpuProfFrom = Number(value);
    else if (flag === "--focus-radius") options.focusRadius = Number(value);
    else if (flag === "--focus-ticks") options.focusTicks = value.split(",").map(Number);
    else options.cpuProfWindows = value.split(",").map(range => { const [from, to, extra] = range.split(":"); if (extra !== undefined || to === undefined) throw new Error("Use --cpu-prof-windows FROM:TO,..."); return { from: Number(from), to: Number(to) }; });
  }
  if (!options.out) throw new Error("--out NEWDIR is required");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await runProbe(parseArguments(process.argv.slice(2)));
}
