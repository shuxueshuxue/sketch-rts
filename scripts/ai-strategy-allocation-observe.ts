/** Full allocation behavior evidence; not a win-rate benchmark.
 * tsx scripts/ai-strategy-allocation-observe.ts <source-tree> <case.json> <output-dir> <control|observe> [default|strategy]
 * Native commands, before/after task memory, positions, death ledger and physical
 * building milestones share one clock. Analysis is separate from the timed think.
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
import type { BootstrapStrategyOutput } from '../src/ai/strategy/bootstrap-control';

const [base, caseFile, out, mode, controller = 'default'] = process.argv.slice(2);
if (!base || !caseFile || !out || !['control', 'observe'].includes(mode!) || !['default', 'strategy'].includes(controller))
  throw new Error('Expected source-tree case.json output-dir control|observe [default|strategy]');
const strategyControl = controller === 'strategy';
const config = JSON.parse(readFileSync(caseFile, 'utf8')) as AiGameRunInput & { source: string };
const { runAiGameLoop } = await import(`${base}/src/ai/game-runner.ts`) as typeof import('../src/ai/game-runner');
const { createAiMemoryProvider, planAiOwnerCommandEntries } = await import(`${base}/src/ai/planner-context.ts`) as typeof import('../src/ai/planner-context');
const { buildAiPlanTrace } = await import(`${base}/src/ai/plan-trace.ts`) as typeof import('../src/ai/plan-trace');
const { projectDeathThinkContext } = await import(`${base}/src/ai/death-ledger-context.ts`) as typeof import('../src/ai/death-ledger-context');
const { canonicalGameState, checksumGame } = await import(`${base}/src/shared/sim/checksum.ts`) as typeof import('../src/shared/sim/checksum');
const { snapshotGame } = await import(`${base}/src/shared/sim.ts`) as typeof import('../src/shared/sim');
const { AiDeathLedger: Ledger } = mode === 'observe' ? await import(`${base}/src/ai/death-ledger.ts`) as typeof import('../src/ai/death-ledger') : { AiDeathLedger: undefined };
const owners = Object.keys(config.agents).filter(owner => config.agents[owner]!.version.startsWith('v9_'));
const memories: Record<string, AiPolicyMemory> = {}, memoryProvider = createAiMemoryProvider(memories);
const previous: Record<string, AiPlanTrace> = {}, durations: { tick: number; owner: string; plannerMs: number; observerMs: number; totalMs: number }[] = [];
const fds = new Map<string, number>(), plannedHash = createHash('sha256'), commandHash = createHash('sha256');
let ledger: AiDeathLedger | undefined, plannedCount = 0, commandCount = 0, worldTick = -1, finalGame: Parameters<typeof checksumGame>[0];
let buildingsBefore: Building[] = [];
let buildingHpBefore = new Map<string, number>();
const born = new Set<string>(), completed = new Set<string>();
mkdirSync(out, { recursive: true });
const log = (name: string, row: unknown) => {
  let fd = fds.get(name);
  if (fd === undefined) { fd = openSync(`${out}/${name}.jsonl`, 'w'); fds.set(name, fd); }
  writeSync(fd, JSON.stringify(row) + '\n');
};
const loop = runAiGameLoop({ ...config, commandPlanner({ game, snapshot, owner, agent, source, teams }) {
  // Keep the exact previous task state before the ordinary think can overwrite it.
  // JSON serialization is outside the planner timer and invokes no policy selector.
  log('memory-before', { tick: snapshot.tick, owner, memory: memories[owner] ?? null });
  let strategy: BootstrapStrategyOutput | undefined;
  const observerOptions: Pick<import('../src/ai/planner-context').AiOwnerPlannerOptions, 'observeBootstrapPlan'> = ledger && owners.includes(owner)
    ? { observeBootstrapPlan(_context, _entries, actual) { strategy = actual; } } : {};
  const start = performance.now();
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: owner, source, version: agent.version }, { memoryProvider, teams,
    ...(strategyControl ? { strategyControl: true } : {}),
    ...observerOptions });
  const planned = performance.now();
  let trace: AiPlanTrace | undefined;
  if (ledger && owners.includes(owner)) {
    ledger.recordThink(snapshot, owner, memories[owner]!);
    const baseTrace = buildAiPlanTrace(snapshot, owner, memories[owner]!, agent.version, previous[owner]);
    // This is the transaction which just issued these orders. Projection cannot
    // construct another Situation or advance the voyage-risk continuation.
    const projected = { ...baseTrace, ...(strategy?.project ? { strategy: strategy.project() } : {}),
      ...(strategy?.goalPlanner ? { goalPlanner: strategy.goalPlanner } : {}) };
    trace = ledger.withPlanTrace(projected, projected.previousTick ?? -1); previous[owner] = trace;
  }
  const end = performance.now();
  log('memory-after', { tick: snapshot.tick, owner, memory: memories[owner] });
  if (mode === 'observe' && owners.includes(owner)) log('task-contexts', projectDeathThinkContext(snapshot, owner, memories[owner]!));
  durations.push({ tick: snapshot.tick, owner, plannerMs: planned - start, observerMs: end - planned, totalMs: end - start });
  const row = { tick: snapshot.tick, owner, entries }, bytes = JSON.stringify(row) + '\n';
  plannedHash.update(bytes); plannedCount += entries.length; log('planned', row);
  if (snapshot.tick !== worldTick) {
    worldTick = snapshot.tick;
    log('worlds', { tick: snapshot.tick, players: snapshot.players, units: snapshot.units.map(unit => ({
      id: unit.id, owner: unit.owner, kind: unit.kind, x: unit.x, y: unit.y, hp: unit.hp, maxHp: unit.maxHp,
      order: unit.order, deck: unit.deck, cabin: unit.cabin, garrison: unit.garrison, expiresTick: unit.expiresTick,
      attackRange: unit.attackRange, attackDamage: unit.attackDamage, attackCooldown: unit.attackCooldown,
      speed: unit.speed, radius: unit.radius, level: unit.level, homeX: unit.homeX, homeY: unit.homeY })),
      buildings: snapshot.buildings.map(building => ({ id: building.id, owner: building.owner, kind: building.kind,
        x: building.x, y: building.y, hp: building.hp, maxHp: building.maxHp, complete: building.complete })),
      resources: snapshot.resources.map(mine => ({ id: mine.id, x: mine.x, y: mine.y, amount: mine.amount })), match: snapshot.match });
  }
  if (trace) log('traces', trace);
  if (strategy && mode === 'observe') {
    // Raw demand is retained even when no arrival row/field/shortlist entry
    // exists. Offline joins must not mistake an absent request for instant work.
    const decision = strategy.decision, authority = memories[owner]?.strategyAllocation;
    const compactArrival = (arrival: import('../src/ai/strategy/decision').DecisionFacts<import('../src/ai/strategy/types').Arrival>) =>
      'ticks' in arrival ? { status: arrival.status, ticks: arrival.ticks,
        crossings: arrival.crossings.map(crossing => ({ seaId: crossing.seaId,
          departure: crossing.departure, landing: crossing.landing, requiresNewShip: crossing.requiresNewShip })) }
        : { status: arrival.status, reason: arrival.reason.code };
    log('fact-requests', { tick: snapshot.tick, owner,
      // Exact provider skeletons and quoted bundles, captured during the same
      // evaluation even if no formal method or Arrival row was granted.
      allocatorCandidates: strategy.candidateRequests ?? null,
      assemblyFacts: strategy.assemblyFacts ?? null,
      objectives: decision.objectives.map(objective => ({ id: objective.id, kind: objective.kind, target: objective.target,
        status: objective.status, score: objective.utility.score, reasons: objective.reasons.map(reason => reason.code) })),
      candidateMethods: decision.methods.map(method => ({ id: method.id, objectiveId: method.objectiveId, status: method.status,
        preconditions: method.preconditions.map(condition => ({ id: condition.id, status: condition.status, reason: condition.reason.code, demand: condition.demand })),
        subgoals: method.subgoals.map(goal => ({ id: goal.id, target: goal.target, status: goal.status, demands: goal.demands })) })),
      formalMethods: Object.values(authority?.methods ?? {}).map(method => ({ id: method.id, objectiveId: method.objectiveId,
        actions: method.actions.map(action => ({ id: action.id, target: action.target, unitIds: action.unitIds,
          execution: authority?.executions[action.id]?.status ?? null })) })),
      unitArrivals: decision.situation.units.map(unit => ({ id: unit.id, owner: unit.owner, location: unit.location, roles: unit.roles,
        hp: unit.hp, commitments: unit.commitments,
        arrivals: unit.arrivals.map(row => ({ targetId: row.targetId, ...compactArrival(row.arrival) })) })),
      allocation: { leases: Object.values(authority?.leases ?? {}), unmet: authority?.unmet ?? [],
        blocked: Object.values(authority?.blocked ?? {}), events: authority?.events ?? [] } });
    log('fact-publications', { tick: snapshot.tick, owner, observation: memories[owner]?.strategy?.observation });
  }
  return entries;
} }, {
  beforeLoop({ game }) {
    finalGame = game;
    writeFileSync(`${out}/initial.json`, JSON.stringify({ source: config.source, config, strategyControl, snapshot: snapshotGame(game),
      nextId: game.nextId, activePlayers: game.activePlayers }));
    if (Ledger) ledger = new Ledger(game, { owners });
    for (const unit of game.units) {
      born.add(unit.id);
      log('births', { tick: game.tick, id: unit.id, owner: unit.owner, kind: unit.kind });
    }
    for (const building of game.buildings) if (building.complete) completed.add(building.id);
  },
  onCommand({ tick, owner, source, scriptId, command }) {
    ledger?.recordIssuedCommand(tick, owner, command, scriptId, source);
    const row = { tick, owner, source, scriptId, command };
    commandHash.update(JSON.stringify(row) + '\n'); commandCount++; log('commands', row);
  },
  beforeStep({ game }) {
    buildingsBefore = [...game.buildings];
    buildingHpBefore = new Map(game.buildings.map(building => [building.id, building.hp]));
  },
  onStep({ game }) {
    for (const unit of game.units) if (!born.has(unit.id)) {
      born.add(unit.id);
      log('births', { tick: game.tick, id: unit.id, owner: unit.owner, kind: unit.kind });
    }
    for (const building of game.buildings) if (building.complete && !completed.has(building.id)) {
      completed.add(building.id);
      log('building-completed', { tick: game.tick, id: building.id, owner: building.owner,
        kind: building.kind, x: building.x, y: building.y });
    }
    const liveBuildings = new Set(game.buildings.map(building => building.id));
    for (const building of buildingsBefore) if (building.hp < buildingHpBefore.get(building.id)!) log('building-hp-loss', {
      tick: game.tick, id: building.id, owner: building.owner, kind: building.kind, x: building.x, y: building.y,
      hpBefore: buildingHpBefore.get(building.id), hpAfter: building.hp, evidence: 'native-per-step-net-hp-decrease' });
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
const reconciled = owners.every(owner => ledger === undefined
  || ledger.summary(owner).nativeLosses === (loop.snapshot.match.stats.unitsLost[owner] ?? 0));
const receipt = { source: config.source, mode, strategyControl, name: config.name, mapId: config.mapId, owners, tick: loop.snapshot.tick,
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
