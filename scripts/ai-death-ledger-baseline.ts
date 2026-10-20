/** Read-only death baseline, not a win-rate benchmark.
 * tsx scripts/ai-death-ledger-baseline.ts <source-tree> <case.json> <output-dir> <control|observe>
 * The same script loads each immutable source tree; output serialization is outside the timed think.
 */
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { hostname } from 'node:os';
import type { AiDeathLedger } from '../src/ai/death-ledger';
import type { AiPolicyMemory } from '../src/ai/memory';
import type { AiPlanTrace } from '../src/ai/plan-trace';
import type { AiGameRunInput } from '../src/ai/game-runner';
import type { Building } from '../src/shared/types';

const [base, caseFile, out, mode] = process.argv.slice(2);
if (!base || !caseFile || !out || !['control', 'observe'].includes(mode!)) throw new Error('Expected source-tree case.json output-dir control|observe');
const config = JSON.parse(readFileSync(caseFile, 'utf8')) as AiGameRunInput & { source: string };
const { runAiGameLoop } = await import(`${base}/src/ai/game-runner.ts`) as typeof import('../src/ai/game-runner');
const { createAiMemoryProvider, planAiOwnerCommandEntries } = await import(`${base}/src/ai/planner-context.ts`) as typeof import('../src/ai/planner-context');
const { buildAiPlanTrace } = await import(`${base}/src/ai/plan-trace.ts`) as typeof import('../src/ai/plan-trace');
const { canonicalGameState, checksumGame } = await import(`${base}/src/shared/sim/checksum.ts`) as typeof import('../src/shared/sim/checksum');
const { snapshotGame } = await import(`${base}/src/shared/sim.ts`) as typeof import('../src/shared/sim');
const { AiDeathLedger: Ledger } = mode === 'observe' ? await import(`${base}/src/ai/death-ledger.ts`) as typeof import('../src/ai/death-ledger') : { AiDeathLedger: undefined };
const owners = Object.keys(config.agents).filter(owner => config.agents[owner]!.version.startsWith('v9_'));
const memories: Record<string, AiPolicyMemory> = {}, memoryProvider = createAiMemoryProvider(memories);
const previous: Record<string, AiPlanTrace> = {}, durations: { tick: number; owner: string; plannerMs: number; observerMs: number; totalMs: number }[] = [];
const fds = new Map<string, number>(), plannedHash = createHash('sha256'), commandHash = createHash('sha256');
let ledger: AiDeathLedger | undefined, plannedCount = 0, commandCount = 0, worldTick = -1, finalGame: Parameters<typeof checksumGame>[0];
let buildingsBefore: Building[] = [];
mkdirSync(out, { recursive: true });
const log = (name: string, row: unknown) => {
  let fd = fds.get(name);
  if (fd === undefined) { fd = openSync(`${out}/${name}.jsonl`, 'w'); fds.set(name, fd); }
  writeSync(fd, JSON.stringify(row) + '\n');
};
const loop = runAiGameLoop({ ...config, commandPlanner({ game, snapshot, owner, agent, source, teams }) {
  const start = performance.now();
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: owner, source, version: agent.version }, { memoryProvider, teams });
  const planned = performance.now();
  let trace: AiPlanTrace | undefined;
  if (ledger && owners.includes(owner)) {
    ledger.recordThink(snapshot, owner, memories[owner]!);
    const projected = buildAiPlanTrace(snapshot, owner, memories[owner]!, agent.version, previous[owner]);
    trace = ledger.withPlanTrace(projected, projected.previousTick ?? -1); previous[owner] = trace;
  }
  const end = performance.now();
  durations.push({ tick: snapshot.tick, owner, plannerMs: planned - start, observerMs: end - planned, totalMs: end - start });
  const row = { tick: snapshot.tick, owner, entries }, bytes = JSON.stringify(row) + '\n';
  plannedHash.update(bytes); plannedCount += entries.length; log('planned', row);
  if (snapshot.tick !== worldTick) {
    worldTick = snapshot.tick;
    log('worlds', { tick: snapshot.tick, players: snapshot.players, units: snapshot.units.map(unit => ({
      id: unit.id, owner: unit.owner, kind: unit.kind, x: unit.x, y: unit.y, hp: unit.hp, maxHp: unit.maxHp,
      order: unit.order, deck: unit.deck, cabin: unit.cabin, garrison: unit.garrison, expiresTick: unit.expiresTick,
      attackRange: unit.attackRange, attackDamage: unit.attackDamage })),
      buildings: snapshot.buildings.map(building => ({ id: building.id, owner: building.owner, kind: building.kind,
        x: building.x, y: building.y, hp: building.hp, maxHp: building.maxHp, complete: building.complete })),
      resources: snapshot.resources.map(mine => ({ id: mine.id, x: mine.x, y: mine.y, amount: mine.amount })), match: snapshot.match });
  }
  if (trace) log('traces', trace);
  return entries;
} }, {
  beforeLoop({ game }) {
    finalGame = game;
    writeFileSync(`${out}/initial.json`, JSON.stringify({ source: config.source, config, snapshot: snapshotGame(game),
      nextId: game.nextId, activePlayers: game.activePlayers }));
    if (Ledger) ledger = new Ledger(game, { owners });
  },
  onCommand({ tick, owner, source, scriptId, command }) {
    ledger?.recordIssuedCommand(tick, owner, command, scriptId, source);
    const row = { tick, owner, source, scriptId, command };
    commandHash.update(JSON.stringify(row) + '\n'); commandCount++; log('commands', row);
  },
  beforeStep({ game }) { buildingsBefore = [...game.buildings]; },
  onStep({ game }) {
    const liveBuildings = new Set(game.buildings.map(building => building.id));
    for (const building of buildingsBefore) if (building.hp <= 0 && !liveBuildings.has(building.id)) log('building-losses', {
      tick: game.tick, id: building.id, owner: building.owner, kind: building.kind, x: building.x, y: building.y,
      hp: building.hp, evidence: 'nonpositive-hp-and-native-removal', killer: null });
    if (game.tick % 1200 === 0) log('checksums', { tick: game.tick, checksum: checksumGame(game) });
  },
});
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quantile = (values: number[], p: number) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0; };
const timing = (key: 'plannerMs' | 'observerMs' | 'totalMs') => ({ p50: quantile(durations.map(row => row[key]), .5),
  p95: quantile(durations.map(row => row[key]), .95), max: Math.max(0, ...durations.map(row => row[key])) });
for (const row of durations) log('timings', row);
const records = ledger?.records() ?? [];
for (const row of records) log('deaths', row);
// Close the last think→match-end interval, including casualties after the last scheduled think.
// This end cap projects state only; it does not call the planner again.
if (ledger) for (const owner of owners) {
  const trace = buildAiPlanTrace(loop.snapshot, owner, memories[owner]!, config.agents[owner]!.version, previous[owner]);
  log('traces', ledger.withPlanTrace(trace, previous[owner]?.tick ?? -1));
}
const summaries = Object.fromEntries(owners.map(owner => [owner, ledger?.summary(owner) ?? null]));
const reconciled = !ledger || owners.every(owner => ledger.summary(owner).nativeLosses === (loop.snapshot.match.stats.unitsLost[owner] ?? 0));
const receipt = { source: config.source, mode, name: config.name, mapId: config.mapId, owners, tick: loop.snapshot.tick,
  host: hostname(), node: process.version,
  plannedCount, commandCount, plannedSha256: plannedHash.digest('hex'), commandSha256: commandHash.digest('hex'),
  snapshotSha256: sha(loop.snapshot), memorySha256: sha(memories), canonicalSha256: sha(canonicalGameState(finalGame!)),
  checksum: checksumGame(finalGame!), summaries, reconciled, errors: ledger?.errors ?? [],
  timing: { planner: timing('plannerMs'), observer: timing('observerMs'), total: timing('totalMs') }, elapsedMs: loop.elapsedMs, cpuMs: loop.cpuMs };
writeFileSync(`${out}/summary.json`, JSON.stringify(receipt, null, 2));
writeFileSync(`${out}/final.json`, JSON.stringify({ snapshot: loop.snapshot, memories, nextId: finalGame!.nextId }));
ledger?.dispose();
for (const [name, fd] of fds) {
  closeSync(fd); const path = `${out}/${name}.jsonl`;
  await pipeline(createReadStream(path), createGzip({ level: 6 }), createWriteStream(path + '.gz')); unlinkSync(path);
}
console.log(JSON.stringify(receipt));
if (!reconciled || receipt.errors.length) process.exitCode = 1;
