import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flag, requiredFlag } from './benchmark-cli';
import type { Game, CreateGameOptions } from '../src/shared/sim';
import type { AiScriptVersion } from '../src/shared/types';

// Run isolated source archives in A/B/B/A order on the same host. The ordinary
// command boundary and delivery delay stay intact; observation lives outside Game.
const args = process.argv.slice(2), root = resolve(requiredFlag(args, 'source-root'));
for (const name of ['source-root', 'mode', 'out', 'ticks', 'detail', 'case', 'measure-from', 'measure-until', 'observe'])
  if (args.filter(value => value === `--${name}`).length > 1) throw new Error(`Repeated --${name} would make the audit ambiguous`);
const mode = flag(args, 'mode') ?? 'large', output = requiredFlag(args, 'out');
const ticks = Number(flag(args, 'ticks') ?? (mode === 'ocean' ? 30000 : mode === 'map' ? 18000 : 900));
const measureFromTick = Number(flag(args, 'measure-from') ?? 0);
const measureUntilTick = Number(flag(args, 'measure-until') ?? Infinity);
const observe = flag(args, 'observe') !== 'false';
const detail = flag(args, 'detail') ?? 'trace';
if (!['decision', 'trace', 'complete'].includes(detail)) throw new Error(`Unknown strategy detail ${detail}`);
const load = (path: string) => import(pathToFileURL(resolve(root, 'src', path)).href);
const sim = await load('shared/sim.ts'), runtimeModule = await load('ai/runtime.ts');
const { poolMap } = await load('shared/map-pool.ts');
const { unitMover } = await load('shared/catalog.ts');
const { isOpenGround, sameGround } = await load('shared/terrain.ts');
const { checksumGame } = await load('shared/sim/checksum.ts');
const { CommandFrameRuntime, normalizeCommandFrameEntries } = await load('shared/sim/command-frame-runtime.ts');
const { planAiOwnerCommandEntriesWithTrace } = await load('ai/plan-trace-planner.ts');
const { planAiOwnerCommandEntries } = await load('ai/planner-context.ts');
const decisionPlanner = detail === 'decision' && existsSync(resolve(root, 'src/ai/strategy-decision-planner.ts'))
  ? (await load('ai/strategy-decision-planner.ts')).planAiOwnerCommandEntriesWithDecision : undefined;
const hasSituationEvaluator = existsSync(resolve(root, 'src/ai/strategy/situation.ts'));
const situationCount = hasSituationEvaluator ? (await load('ai/strategy/situation.ts')).situationConstructionCount : () => 0;
if (typeof situationCount !== 'function') throw new Error('Source lacks the diagnostic Situation construction counter');
const initialSituationCount = situationCount();
const started = new Date().toISOString();
const policyMemories = (memories: Record<string, unknown>) => Object.fromEntries(Object.entries(memories).map(([owner, memory]) => {
  const { strategy: _observation, ...policy } = memory as Record<string, unknown>; return [owner, policy];
}));
let game: Game, aiPlayers: string[], versions: Record<string, AiScriptVersion>;
if (mode === 'large') {
  const players = ['player', 'enemy', 'enemy2', 'player-4']; aiPlayers = players.slice(1);
  const races = { player: 'grove', enemy: 'ember', enemy2: 'grove', 'player-4': 'ember' } as const;
  versions = { enemy: 'v9_knight', enemy2: 'v9_archer', 'player-4': 'v9_summoner' };
  const setup: CreateGameOptions = { players, aiPlayers, aiVersions: versions, races,
    teams: { player: 'team-1', enemy: 'team-2', enemy2: 'team-3', 'player-4': 'team-4' },
    layout: { ...poolMap('templeSpring').layout, seed: 'pool-templeSpring-1' } };
  const plain: Game = sim.createGame('templeSpring', setup), centre = { x: plain.map.width / 2, y: plain.map.height / 2 };
  const kinds = { grove: ['footman', 'archer', 'lancer', 'knight', 'priest', 'archer'], ember: ['raider', 'horseArcher', 'ashWarden', 'emberRavager', 'sparkArcher', 'ashHexer'] } as const;
  const addUnits = players.flatMap(owner => {
    const hall = plain.buildings.find(building => building.owner === owner && building.kind === 'townHall')!;
    const anchor = { x: hall.x + (centre.x - hall.x) * .45, y: hall.y + (centre.y - hall.y) * .45 }, taken: { x: number; y: number }[] = [];
    for (let r = 0; taken.length < 80 && r < 2000; r += 18) for (let a = 0; a < 2 * Math.PI && taken.length < 80; a += 36 / Math.max(r, 18)) {
      const point = { x: Math.round(anchor.x + Math.cos(a) * r), y: Math.round(anchor.y + Math.sin(a) * r) };
      if (isOpenGround(plain.map, point.x, point.y) && sameGround(plain.map, point, hall) && sameGround(plain.map, point, centre)
        && !taken.some(other => Math.hypot(other.x - point.x, other.y - point.y) < 34)) taken.push(point);
    }
    return taken.map((point, index) => ({ id: `army-${owner}-${index}`, owner, kind: kinds[races[owner as keyof typeof races]][index % 6]!,
      ...point, order: { type: 'attackMove' as const, ...centre } }));
  });
  game = sim.createGame('templeSpring', { ...setup, scenario: { players: Object.fromEntries(players.map(owner => [owner, { gold: 20000 }])), addUnits } });
} else if (mode === 'ocean') {
  const config = JSON.parse(readFileSync(requiredFlag(args, 'case'), 'utf8'));
  aiPlayers = Object.keys(config.agents);
  versions = Object.fromEntries(aiPlayers.map(owner => [owner, config.agents[owner].version]));
  game = sim.createGame(config.mapId, { ...config.options, players: aiPlayers, aiPlayers,
    teams: Object.fromEntries(aiPlayers.map(owner => [owner, config.agents[owner].team])),
    races: Object.fromEntries(aiPlayers.map(owner => [owner, config.agents[owner].race])) });
  for (const unit of game.units) if (aiPlayers.includes(unit.owner)) delete unit.guardPosition;
} else if (mode === 'late') {
  const fixture = JSON.parse(readFileSync(requiredFlag(args, 'snapshot'), 'utf8')), snapshot = fixture.snapshot;
  const players = Object.keys(snapshot.players); aiPlayers = players.slice(1);
  versions = Object.fromEntries(aiPlayers.map((owner, index) => [owner, (['v9_knight', 'v9_archer', 'v9_summoner'] as const)[index % 3]!]));
  game = sim.createGame(snapshot.map.id, { players, aiPlayers: [], teams: snapshot.teams });
  sim.restoreSnapshotIntoGame(game, snapshot, fixture.nextId ?? 500000);
  game.scriptedVictory = true;
} else if (mode === 'map') {
  const { navalRoomSetup } = await load('ai/benchmark/naval-room.ts');
  const map = poolMap(requiredFlag(args, 'map')), setup = navalRoomSetup(map);
  game = sim.createGame(setup.mapId, { ...setup.options, aiPlayers: [] });
  aiPlayers = game.activePlayers.filter(owner => owner !== game.activePlayers[0]);
  versions = Object.fromEntries(aiPlayers.map(owner => [owner, 'v9_archer' as const]));
} else throw new Error(`Unknown mode ${mode}`);
const ai = runtimeModule.createAiRuntime(aiPlayers, { versions });
if (mode === 'late') {
  const fixture = JSON.parse(readFileSync(requiredFlag(args, 'snapshot'), 'utf8'));
  if (fixture.memories) ai.memories = structuredClone(fixture.memories);
  else for (const owner of aiPlayers) ai.memories[owner].naval = { ferries: structuredClone(fixture.ferries?.[owner] ?? {}) };
}
const warmStarted = performance.now();
sim.warmGameCaches(game);
const warmMs = performance.now() - warmStarted;
const commandsHash = createHash('sha256'), traceHash = createHash('sha256'), previous = new Map();
const planned = new Map(), thinkSamples: number[] = [], timeline: unknown[] = [];
const timedFrames: { tick: number; owners: string[]; ms: number; units: number; ships: number; yards: number }[] = [];
const executor = {
  submit(current: Game, job: { tick: number; deliveryTick: number; requests: any[] }, check: (commands: any[]) => void) {
    const start = performance.now(), snapshot = sim.snapshotGame(current);
    const strategies = new Map();
    const entries = job.requests.flatMap(request => {
      if (!observe) return runtimeModule.planAiCommandFrameFromSnapshot(snapshot, [request], { teams: current.teams }).commands;
      if (detail === 'decision') {
        const result = decisionPlanner ? decisionPlanner(snapshot, request, { teams: current.teams })
          : { commands: planAiOwnerCommandEntries(snapshot, request, { teams: current.teams }), decision: undefined };
        strategies.set(request.playerId, result.decision);
        return result.commands.map((entry: any) => ({ ...entry, playerId: request.playerId }));
      }
      const result = planAiOwnerCommandEntriesWithTrace(snapshot, request, { teams: current.teams }, previous.get(request.playerId));
      const { strategy, ...moduleTrace } = result.trace;
      previous.set(request.playerId, moduleTrace); strategies.set(request.playerId, strategy);
      if (detail === 'complete') traceHash.update(JSON.stringify(result.trace));
      return result.commands.map((entry: any) => ({ ...entry, playerId: request.playerId }));
    });
    const commands = normalizeCommandFrameEntries(entries).map((entry: any) => ({ playerId: entry.playerId, command: entry.command }));
    check(commands);
    const elapsed = performance.now() - start;
    thinkSamples.push(elapsed);
    timedFrames.push({ tick: job.tick, owners: job.requests.map(request => request.playerId), ms: elapsed,
      units: snapshot.units.length, ships: snapshot.units.filter(unit => unitMover(unit.kind) === 'sea').length,
      yards: snapshot.buildings.filter(building => building.kind === 'shipyard' && building.hp > 0).length });
    commandsHash.update(JSON.stringify({ tick: job.tick, commands }));
    if (commands.length) planned.set(job.deliveryTick, [...(planned.get(job.deliveryTick) ?? []), ...commands]);
    for (const request of job.requests) {
      const strategy = strategies.get(request.playerId);
      if (!strategy) continue;
      const row = { tick: job.tick, owner: request.playerId,
        objectives: strategy.objectives, methods: strategy.methods, assignments: strategy.assignments,
        budget: strategy.budget, idleForces: strategy.idleForces, limitations: strategy.limitations };
      traceHash.update(JSON.stringify(row));
      if (mode === 'map') timeline.push(row);
    }
  }, thinking: () => false,
  take(tick: number) { const commands = planned.get(tick) ?? []; planned.delete(tick); return commands; },
};
const runtime = new CommandFrameRuntime({ game, roomId: 'strategy-audit', rejectionLabel: 'Strategy audit rejected',
  aiPlanner: runtimeModule.createPresetAiRuntimeFramePlanner(game, ai, { executor }) });
const initialChecksum = checksumGame(game), startTick = game.tick, cpu = process.cpuUsage();
for (let tick = 0; tick < ticks && !game.match.winner; tick++) runtime.tick();
const situationConstructions = situationCount() - initialSituationCount;
if (!observe && situationConstructions !== 0) throw new Error(`Default room path constructed ${situationConstructions} Situations`);
const used = process.cpuUsage(cpu), sorted = [...thinkSamples].sort((a, b) => a - b);
if (!timedFrames.length) throw new Error('No AI think samples: check seat/controller setup before measuring');
const windowSamples = timedFrames.filter(sample => sample.tick >= measureFromTick && sample.tick < measureUntilTick).map(sample => sample.ms).sort((a, b) => a - b);
if (!windowSamples.length) throw new Error('No think samples in the requested measurement window');
const result = { sourceRoot: root, mode, observe, detail, host: hostname(), cpu: cpus()[0]?.model, node: process.version, started,
  hasSituationEvaluator, situationConstructions,
  recorderFile: fileURLToPath(import.meta.url), recorderSha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  affinity: readFileSync('/proc/self/status', 'utf8').match(/Cpus_allowed_list:\s*([^\n]+)/)?.[1],
  map: game.map.id, startTick, finalTick: game.tick, initialChecksum, finalChecksum: checksumGame(game),
  commandsSha256: commandsHash.digest('hex'), tracesSha256: traceHash.digest('hex'),
  memoriesSha256: createHash('sha256').update(JSON.stringify(ai.memories)).digest('hex'),
  policyMemoriesSha256: createHash('sha256').update(JSON.stringify(policyMemories(ai.memories))).digest('hex'),
  observationSha256: createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(ai.memories)
    .map(([owner, memory]) => [owner, memory.strategy])))).digest('hex'),
  warmMs, maxRssKiB: process.resourceUsage().maxRSS,
  cpuMs: (used.user + used.system) / 1000, thinkMs: { n: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) },
  measurement: { fromTick: measureFromTick, untilTick: Number.isFinite(measureUntilTick) ? measureUntilTick : null,
    thinkMs: { n: windowSamples.length, mean: windowSamples.reduce((a, b) => a + b, 0) / Math.max(1, windowSamples.length),
      p50: windowSamples[Math.floor(windowSamples.length * .5)], p95: windowSamples[Math.floor(windowSamples.length * .95)], max: windowSamples.at(-1) } },
  thinkSamples, timedFrames, timeline };
writeFileSync(output, JSON.stringify(result));
console.log(JSON.stringify({ out: output, ...result, thinkSamples: undefined, timedFrames: undefined, timeline: undefined }));
