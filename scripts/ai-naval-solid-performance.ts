import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostname, cpus } from 'node:os';
import { flag, requiredFlag } from './benchmark-cli';
import type { Game, CreateGameOptions } from '../src/shared/sim';
import type { GameSnapshot, Unit } from '../src/shared/types';

// One controlled scene per process; run the same script in A/B/B/A order.
// Source archives isolate module caches without changing another worktree.
const args = process.argv.slice(2), root = resolve(requiredFlag(args, 'source-root'));
const mode = requiredFlag(args, 'mode'), output = requiredFlag(args, 'out');
const load = (path: string) => import(pathToFileURL(resolve(root, 'src', path)).href);
const sim = await load('shared/sim.ts'), { checksumGame } = await load('shared/sim/checksum.ts');
const { isShipKind } = await load('shared/ship-geometry.ts');
const { beginShipCollisionFrame, shipBodyClearAtPose } = await load('shared/ship-collisions.ts');
const { hullFits } = await load('shared/ship-navigation.ts');
const { beginShipPlanningJob } = await load('shared/ship-planning-job.ts');
const { createRoom } = await load('shared/rooms.ts');
const { createSaveGameRecord } = await load('shared/savegame.ts');
const { poolMap } = await load('shared/map-pool.ts');
const { isOpenGround, sameGround, walkableGoal } = await load('shared/terrain.ts');
const runtimeModule = await load('ai/runtime.ts');
const { CommandFrameRuntime } = await load('shared/sim/command-frame-runtime.ts');
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function restore(input: GameSnapshot): Game {
  const players = Object.keys(input.teams ?? input.players);
  const game: Game = sim.createGame(input.map.id, { players, aiPlayers: [], teams: input.teams });
  sim.restoreSnapshotIntoGame(game, input, 500000);
  game.scriptedVictory = true;
  beginShipCollisionFrame(game.units, game.map, [...game.buildings, ...(game.obstacles ?? [])]);
  return game;
}
function inputSnapshot(): GameSnapshot {
  const frame = JSON.parse(readFileSync(requiredFlag(args, 'snapshot'), 'utf8'));
  return frame.snapshot ?? frame;
}
function ships(game: Game): Unit[] { return game.units.filter(unit => unit.hp > 0 && isShipKind(unit.kind)); }
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
}
const metadata = { sourceRoot: root, mode, host: hostname(), cpu: cpus()[0]?.model, node: process.version,
  startedAt: new Date().toISOString(), affinity: readFileSync('/proc/self/status', 'utf8').match(/Cpus_allowed_list:\s*([^\n]+)/)?.[1] };
let result: unknown;
if (mode === 'prepare') {
  const game = restore(inputSnapshot()), minimum = Number(flag(args, 'ships-per-team') ?? 12);
  const originals = ships(game), template = originals.find(unit => unit.kind === 'warship');
  if (!template) throw new Error('The late scene needs a real warship template');
  for (const team of new Set(Object.values(game.teams))) {
    const owner = game.activePlayers.find(owner => game.teams[owner] === team)!;
    let missing = minimum - ships(game).filter(unit => game.teams[unit.owner] === team).length;
    for (let y = 400; missing > 0 && y < game.map.height - 400; y += 280) for (let x = 400; missing > 0 && x < game.map.width - 400; x += 280) {
      const unit = structuredClone(template), pose = { x, y, heading: 0 };
      unit.id = `stress-${team}-${missing}`; unit.owner = owner; unit.hp = unit.maxHp;
      unit.x = x; unit.y = y; unit.order = { type: 'idle' }; unit.orderQueue = [];
      unit.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
      if (!hullFits(game.map, unit, pose) || !shipBodyClearAtPose(game.map, unit, pose, [...game.units, ...game.buildings, ...(game.obstacles ?? [])])) continue;
      game.units.push(unit); missing--;
    }
    if (missing > 0) throw new Error('Could not fit all stress hulls');
  }
  result = { metadata: { ...metadata, note: 'Real late-game frame extended to twelve hulls per team for a simultaneous-planning stress case; added hulls carry no extra weapons or troops.' }, snapshot: sim.snapshotGame(game) };
} else if (mode === 'active-size') {
  const game = restore(inputSnapshot()), hulls = ships(game), ticks = Number(flag(args, 'ticks') ?? 1000);
  const room = { ...createRoom({ id: 'naval-size', host: { id: 'host', name: 'Host' }, mapId: game.map.id,
    humanCount: 1, aiCount: game.activePlayers.length - 1, seatSetup: game.activePlayers.map(owner => ({ controller: 'ai',
      race: game.players[owner]!.race, team: game.teams[owner], aiVersion: game.teams[owner] === 'team-1' ? 'v9_archer' : 'v9' })) }), status: 'inMatch' };
  const goals = hulls.map(ship => ({ owner: ship.owner, id: ship.id,
    ...walkableGoal(game.map, game.map.width - ship.x, game.map.height - ship.y, 'sea') }));
  const rows: unknown[] = [];
  let peakBytes = -1, peak: unknown;
  for (let tick = 0; tick < ticks; tick++) {
    if (tick % 200 === 0) for (const goal of goals) sim.issuePlayerCommand(game, goal.owner,
      { type: 'move', unitIds: [goal.id], x: goal.x, y: goal.y, avoidCombat: true });
    sim.stepGame(game);
    const jobs = ships(game).filter(ship => ship.sailing?.planningJob).map(ship => ({ id: ship.id,
      bytes: Buffer.byteLength(ship.sailing!.planningJob!), phase: JSON.parse(ship.sailing!.planningJob!).phase }));
    const total = jobs.reduce((sum, job) => sum + job.bytes, 0);
    if (total > peakBytes || [1, 100, 300, 600, 1000].includes(tick + 1)) {
      const row = { relativeTick: tick + 1, jobBytes: stats(jobs.map(job => job.bytes)), totalJobBytes: total, jobs,
        snapshotBytes: bytes(sim.snapshotGame(game)),
        saveBytes: bytes(createSaveGameRecord(game, room, { id: 'naval-size' }, new Date('2026-10-19T00:00:00Z'))) };
      if ([1, 100, 300, 600, 1000].includes(tick + 1)) rows.push(row);
      if (total > peakBytes) { peak = row; peakBytes = total; }
    }
  }
  result = { ...metadata, ships: hulls.length, buildings: game.buildings.length, ticks, peak, checkpoints: rows };
} else if (mode === 'size') {
  const game = restore(inputSnapshot()), hulls = ships(game);
  for (const ship of hulls) { delete ship.sailing!.planningJob; delete ship.sailing!.planningJobLastRequestedAtTick; }
  const idleSnapshotBytes = bytes(sim.snapshotGame(game));
  for (const ship of hulls) {
    const goal = 'x' in ship.order && 'y' in ship.order ? { x: ship.order.x, y: ship.order.y }
      : { x: Math.min(game.map.width - 300, ship.x + 1500), y: ship.y };
    beginShipPlanningJob(ship, goal, game.map, game.units);
  }
  const room = { ...createRoom({ id: 'naval-size', host: { id: 'host', name: 'Host' }, mapId: game.map.id,
    humanCount: 1, aiCount: game.activePlayers.length - 1, seatSetup: game.activePlayers.map(owner => ({ controller: 'ai',
      race: game.players[owner]!.race, team: game.teams[owner], aiVersion: game.teams[owner] === 'team-1' ? 'v9_archer' : 'v9' })) }), status: 'inMatch' };
  const save = createSaveGameRecord(game, room, { id: 'naval-size' }, new Date('2026-10-19T00:00:00Z'));
  const jobs = hulls.map(ship => ({ id: ship.id, bytes: Buffer.byteLength(ship.sailing!.planningJob!), solids: JSON.parse(ship.sailing!.planningJob!).solids?.length ?? 0 }));
  result = { ...metadata, second: game.tick / 20, units: game.units.length, buildings: game.buildings.length,
    obstacles: game.obstacles?.length ?? 0, ships: hulls.length, idleSnapshotBytes, snapshotBytes: bytes(sim.snapshotGame(game)), saveBytes: bytes(save),
    jobBytes: stats(jobs.map(job => job.bytes)), totalJobBytes: jobs.reduce((sum, job) => sum + job.bytes, 0), jobs };
} else if (mode === 'tick') {
  const game = restore(inputSnapshot()), hulls = ships(game), ticks = Number(flag(args, 'ticks') ?? 900), warmup = 100;
  const initialChecksum = checksumGame(game), samples: number[] = [], jobs: number[] = [];
  const goals = hulls.map(ship => ({ owner: ship.owner, id: ship.id,
    ...walkableGoal(game.map, game.map.width - ship.x, game.map.height - ship.y, 'sea') }));
  let cpu = process.cpuUsage();
  for (let tick = 0; tick < ticks + warmup; tick++) {
    if (tick === warmup) cpu = process.cpuUsage();
    const start = performance.now();
    // Fixed input at each arm, intentionally exercising concurrent continuations.
    if (tick % 200 === 0) for (const goal of goals) sim.issuePlayerCommand(game, goal.owner,
      { type: 'move', unitIds: [goal.id], x: goal.x, y: goal.y, avoidCombat: true });
    sim.stepGame(game);
    if (tick >= warmup) { samples.push(performance.now() - start); jobs.push(ships(game).filter(ship => ship.sailing?.planningJob).length); }
  }
  const used = process.cpuUsage(cpu);
  result = { ...metadata, second: inputSnapshot().tick / 20, ships: hulls.length, finalShips: ships(game).length, buildings: game.buildings.length, warmup,
    tickMs: stats(samples), cpuMs: (used.user + used.system) / 1000, jobCounts: stats(jobs), samples,
    initialChecksum, finalChecksum: checksumGame(game) };
} else if (mode === 'checksums') {
  const { auditNavalPool, navalRoomSetup } = await load('ai/benchmark/naval-room.ts');
  const { MAP_POOL } = await load('shared/map-pool.ts');
  const initial = auditNavalPool().filter((entry: { selected: boolean }) => entry.selected).map((entry: { mapId: string }) => {
    const setup = navalRoomSetup(MAP_POOL.find((map: { id: string }) => map.id === entry.mapId));
    return { map: entry.mapId, checksum: checksumGame(sim.createGame(setup.mapId, { ...setup.options, aiPlayers: [] })) };
  });
  const follow = (game: Game, ticks = 300) => {
    const hashes = [checksumGame(game)];
    let cold: Game | undefined, coldRestoreMismatch: number | null = null;
    let firstTickShips: unknown;
    for (let tick = 0; tick < ticks; tick++) {
      if (tick === 120) {
        cold = restore(sim.snapshotGame(game));
        cold.nextId = game.nextId;
        if (checksumGame(cold) !== checksumGame(game)) coldRestoreMismatch = tick;
      }
      sim.stepGame(game);
      if (tick === 0) firstTickShips = ships(game).map(ship => ({ id: ship.id, x: ship.x, y: ship.y, heading: ship.sailing!.heading,
        jobVersion: ship.sailing?.planningJob ? JSON.parse(ship.sailing.planningJob).version : null, firstLeg: ship.sailing?.route?.points[0] }));
      if (cold) {
        sim.stepGame(cold);
        if (coldRestoreMismatch === null && checksumGame(cold) !== checksumGame(game)) coldRestoreMismatch = tick + 1;
      }
      hashes.push(checksumGame(game));
    }
    return { hashes, coldRestoreMismatch, firstTickShips };
  };
  const ground: Game = sim.createGame('bareDuel', { aiPlayers: [] });
  ground.scriptedVictory = true;
  const worker = ground.units.find(unit => unit.owner === 'player' && unit.kind === 'worker')!;
  sim.issuePlayerCommand(ground, 'player', { type: 'move', unitIds: [worker.id], x: worker.x + 100, y: worker.y + 100 });
  const water: Game = sim.createGame('bareDuel', { aiPlayers: [] });
  water.units = []; water.items = []; water.buildings = []; water.resources = []; water.mercenaryCamps = []; water.obstacles = []; water.scriptedVictory = true;
  water.map = { ...water.map, width: 4000, height: 3000, wind: { direction: Math.PI / 2, speed: 80 }, terrain: { cell: 100, cols: 40, rows: 30, cells: '~'.repeat(1200) } };
  const ship = water.spawnUnit('player', 'transport', 1000, 1000);
  sim.issuePlayerCommand(water, 'player', { type: 'move', unitIds: [ship.id], x: 2500, y: 1000, avoidCombat: true });
  const deep: Game = sim.createGame('bareDuel', { aiPlayers: [] });
  deep.units = []; deep.items = []; deep.resources = []; deep.mercenaryCamps = []; deep.obstacles = []; deep.scriptedVictory = true;
  const cell = 64, cols = 256, rows = 256;
  deep.map = { ...deep.map, width: cols * cell, height: rows * cell, wind: { direction: Math.PI, speed: 80 },
    terrain: { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, index) => {
      const x = index % cols, y = Math.floor(index / cols);
      return x >= 65 && x < 85 && y >= 67 && y < 112 ? '.' : '~';
    }).join('') } };
  const deepShip = deep.spawnUnit('player', 'warship', 1800, 5660); deepShip.sailing!.heading = 0;
  sim.issuePlayerCommand(deep, 'player', { type: 'move', unitIds: [deepShip.id], x: 9000, y: 5660, avoidCombat: true });
  const fixture = JSON.parse(readFileSync(new URL('../src/ai/benchmark/fixtures/naval-shipyard-snapshots.json', import.meta.url), 'utf8'));
  const saved = fixture.cases[0], dock: Game = sim.createGame('bareDuel', { players: [saved.ship.owner, 'enemy'], aiPlayers: [] });
  dock.map = structuredClone(fixture.maps[saved.map]); dock.units = [structuredClone(saved.ship)]; dock.buildings = structuredClone(saved.buildings);
  dock.items = []; dock.resources = []; dock.mercenaryCamps = []; dock.obstacles = []; dock.scriptedVictory = true;
  const boat = dock.units[0]!;
  sim.issuePlayerCommand(dock, boat.owner, { type: 'move', unitIds: [boat.id], x: saved.ship.order.x, y: saved.ship.order.y, avoidCombat: true });
  result = { ...metadata, initial, fixedGround: follow(ground), fixedOpenWater: follow(water), fixedDeepIsland: follow(deep), fixedShipyard: follow(dock) };
} else if (mode === 'large') {
  // Same setup and 900 ticks as bootstrap_1/large-battle-think.test.ts.
  const players = ['player', 'enemy', 'enemy2', 'player-4'], aiPlayers = players.slice(1);
  const races = { player: 'grove', enemy: 'ember', enemy2: 'grove', 'player-4': 'ember' } as const;
  const versions = { enemy: 'v9_knight', enemy2: 'v9_archer', 'player-4': 'v9_summoner' };
  const setup: CreateGameOptions = { players, aiPlayers, aiVersions: versions as CreateGameOptions['aiVersions'], races,
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
  const game: Game = sim.createGame('templeSpring', { ...setup, scenario: { players: Object.fromEntries(players.map(owner => [owner, { gold: 20000 }])), addUnits } });
  sim.warmGameCaches(game);
  const ai = runtimeModule.createAiRuntime(aiPlayers, { versions }), inline = runtimeModule.createInlineAiThinkExecutor(ai);
  const thinkSamples: number[] = [], samples: number[] = [], ticks = Number(flag(args, 'ticks') ?? 900);
  const executor = { ...inline, submit(...parameters: unknown[]) { const start = performance.now(); inline.submit(...parameters); thinkSamples.push(performance.now() - start); } };
  const runtime = new CommandFrameRuntime({ game, roomId: 'large-battle', rejectionLabel: 'Large battle rejected',
    aiPlanner: runtimeModule.createPresetAiRuntimeFramePlanner(game, ai, { executor }) });
  const initialChecksum = checksumGame(game), cpu = process.cpuUsage();
  for (let tick = 0; tick < ticks && !game.match.winner; tick++) { const start = performance.now(); runtime.tick(); samples.push(performance.now() - start); }
  const used = process.cpuUsage(cpu);
  result = { ...metadata, cpuMs: (used.user + used.system) / 1000, tickMs: stats(samples), thinkMs: stats(thinkSamples), samples, thinkSamples, initialChecksum, finalChecksum: checksumGame(game), tick: game.tick };
} else throw new Error(`Unknown mode ${mode}`);
writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...metadata, out: output }));
