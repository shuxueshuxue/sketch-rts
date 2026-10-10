import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hullContact, shipProfile } from '../src/shared/ship-geometry';
import { headingDifference, hullFits } from '../src/shared/ship-navigation';
import { installedWeapons } from '../src/shared/ship-equipment';
import { createGame, issuePlayerCommand, stepGame } from '../src/shared/sim';
import { checksumGame } from '../src/shared/sim/checksum';
import { seconds, SIM_TICKS_PER_SECOND } from '../src/shared/time';
import type { Unit, UnitKind } from '../src/shared/types';

type Game = ReturnType<typeof createGame>;
type Point = { x: number; y: number };
type Fixture = { game: Game; ships: Unit[]; goals?: Map<Unit, Point>; quarry?: Unit; beforeStep?: (tick: number) => void };
type Scene = { id: string; label: string; duration: number; setup: () => Fixture };

function sea(direction = Math.PI / 2) {
  const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [], teams: { player: 'blue', enemy: 'red' } });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 16384, height: 16384, wind: { direction, speed: 80 },
    terrain: { cols: 256, rows: 256, cell: 64, cells: '~'.repeat(256 * 256) } };
  return game;
}
function ship(game: Game, kind: UnitKind, x: number, y: number, owner = 'player', heading = 0, immortal = false) {
  const unit = game.spawnUnit(owner, kind, x, y); unit.sailing!.heading = heading;
  // Only chase/station fixtures keep their target alive for the complete window.
  // Fleet combat uses ordinary HP, fittings, component damage and cooldowns.
  if (immortal) unit.invulnerable = true;
  return unit;
}
function move(game: Game, unit: Unit, goal: Point) {
  issuePlayerCommand(game, unit.owner, { type: 'move', unitIds: [unit.id], ...goal, avoidCombat: true });
}
function attack(game: Game, unit: Unit, target: Unit) {
  issuePlayerCommand(game, unit.owner, { type: 'attack', unitIds: [unit.id], targetId: target.id });
}
function changeWind(game: Game, direction: number, speed = 80) {
  const previous = game.map.wind!;
  game.map.wind = { direction, speed, changedAtTick: game.tick, fromDirection: previous.direction, fromSpeed: previous.speed };
}

export const navalStressScenes: Scene[] = [
  { id: 'fleet-moving-6v6', label: 'Six versus six: moving targets in two columns', duration: 150, setup: () => {
    const game = sea(), allies = Array.from({ length: 6 }, (_, i) => ship(game, i % 3 === 0 ? 'shipOfTheLine' : 'warship', 2500 - (i % 2) * 370, 4400 + Math.floor(i / 2) * 400));
    const enemies = Array.from({ length: 6 }, (_, i) => ship(game, i % 3 === 0 ? 'shipOfTheLine' : 'warship', 5000 + (i % 2) * 370, 4400 + Math.floor(i / 2) * 400, 'enemy', Math.PI));
    for (let i = 0; i < 6; i++) { attack(game, allies[i]!, enemies[i]!); attack(game, enemies[i]!, allies[(i + 2) % 6]!); }
    return { game, ships: [...allies, ...enemies] };
  } },
  { id: 'fleet-station-6v1', label: 'Six pursuers reserve firing positions around one stopped heavy ship', duration: 180, setup: () => {
    const game = sea(), quarry = ship(game, 'shipOfTheLine', 6000, 6200, 'enemy', Math.PI, true);
    const allies = Array.from({ length: 6 }, (_, i) => ship(game, 'warship', 3700 - (i % 2) * 330, 5300 + Math.floor(i / 2) * 450, 'player', 0, true));
    quarry.order = { type: 'hold', x: quarry.x, y: quarry.y };
    for (const unit of allies) attack(game, unit, quarry);
    return { game, ships: [...allies, quarry], quarry };
  } },
  { id: 'long-chase-turns', label: 'Long pursuit of a faster target with two ordinary queued turns', duration: 240, setup: () => {
    const game = sea(), pursuer = ship(game, 'warship', 1800, 4800, 'player', 0, true), quarry = ship(game, 'transport', 4800, 4900, 'enemy', 0, true);
    move(game, quarry, { x: 10000, y: 4900 });
    issuePlayerCommand(game, 'enemy', { type: 'move', unitIds: [quarry.id], x: 10000, y: 9000, queued: true, avoidCombat: true });
    issuePlayerCommand(game, 'enemy', { type: 'move', unitIds: [quarry.id], x: 14000, y: 9000, queued: true, avoidCombat: true });
    attack(game, pursuer, quarry); return { game, ships: [pursuer, quarry], quarry };
  } },
  { id: 'convoy-crossing-12', label: 'Two friendly six-ship convoys crossing in open sea', duration: 240, setup: () => {
    const game = sea(Math.PI / 4), ships: Unit[] = [], goals = new Map<Unit, Point>();
    for (let i = 0; i < 6; i++) {
      const east = ship(game, i % 2 ? 'transport' : 'shipOfTheLine', 2300 - i * 390, 6500, 'player');
      const south = ship(game, i % 2 ? 'warship' : 'transport', 6400, 2300 - i * 340, 'player', Math.PI / 2);
      goals.set(east, { x: 11000 - i * 390, y: 6500 }); goals.set(south, { x: 6400, y: 11000 - i * 340 }); ships.push(east, south);
    }
    for (const [unit, goal] of goals) move(game, unit, goal);
    return { game, ships, goals };
  } },
  { id: 'island-convoy-wind', label: 'Six-ship island detour with a sudden adverse wind', duration: 300, setup: () => {
    const game = sea(), ships = Array.from({ length: 6 }, (_, i) => ship(game, i % 2 ? 'transport' : 'warship', 1800 - (i % 2) * 400, 5300 + Math.floor(i / 2) * 360));
    game.map.terrain!.cells = Array.from({ length: 256 * 256 }, (_, i) => i % 256 >= 65 && i % 256 < 85 && Math.floor(i / 256) >= 67 && Math.floor(i / 256) < 112 ? '.' : '~').join('');
    const goals = new Map(ships.map(unit => [unit, { x: 9000 - (ships.indexOf(unit) % 2) * 400, y: unit.y }]));
    for (const [unit, goal] of goals) move(game, unit, goal);
    return { game, ships, goals, beforeStep: tick => { if (tick === seconds(60)) changeWind(game, Math.PI); } };
  } },
  { id: 'weather-boundary-convoy', label: 'Six mixed ships cross the actual eight-minute weather boundary', duration: 180, setup: () => {
    const game = sea(), ships = Array.from({ length: 6 }, (_, i) => ship(game, i % 3 === 0 ? 'shipOfTheLine' : i % 3 === 1 ? 'warship' : 'transport', 2200 - (i % 2) * 380, 5000 + Math.floor(i / 2) * 400));
    // Advance only the fixture clock to ten seconds before the authored
    // weather event. The actual product updateWindField runs during stepGame.
    game.tick = seconds(8 * 60) - seconds(10);
    const goals = new Map(ships.map(unit => [unit, { x: unit.x + 5000, y: unit.y }]));
    for (const [unit, goal] of goals) move(game, unit, goal);
    return { game, ships, goals };
  } },
];
for (const kind of ['cutter', 'warship', 'shipOfTheLine'] as const) navalStressScenes.push({
  id: `wind-shifts-${kind}`, label: `${kind}: 90° and 180° shifts, calm, then restored wind`, duration: 240, setup: () => {
    const game = sea(Math.PI / 2), unit = ship(game, kind, 2000, 7000), goal = { x: 12500, y: 7000 };
    move(game, unit, goal);
    return { game, ships: [unit], goals: new Map([[unit, goal]]), beforeStep: tick => {
      if (tick === seconds(45)) changeWind(game, Math.PI);
      if (tick === seconds(90)) changeWind(game, 0);
      if (tick === seconds(135)) changeWind(game, 0, 0);
      if (tick === seconds(165)) changeWind(game, Math.PI);
    } };
  },
});

const quantile = (values: number[], fraction: number) => values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;
export function runNavalStress(scene: Scene, record = false) {
  const setupStarted = performance.now();
  const fixture = scene.setup(), setupMs = performance.now() - setupStarted, { game, ships, goals, quarry } = fixture;
  const initial = ships.map(unit => ({ id: unit.id, kind: unit.kind, owner: unit.owner, x: unit.x, y: unit.y, heading: unit.sailing!.heading,
    hull: shipProfile(unit)!.hull, goal: goals?.get(unit) }));
  const origins = new Map(ships.map(unit => [unit, { x: unit.x, y: unit.y }])), timings: number[] = [], frames: unknown[] = [];
  const history = new Map(ships.map(unit => [unit, { route: unit.sailing!.route, travel: 0, yaw: 0, sign: 0, turnTick: 0, turnAngle: 0,
    reversals: 0, movingReversals: 0, stationaryReversals: 0, allReversals: 0, movingAllReversals: 0, stationaryAllReversals: 0,
    revisions: 0, stopped: 0, maxStopped: 0, lowSpeed: 0, shots: 0, firstShot: null as number | null }]));
  let coastViolations = 0, maxHullOverlap = 0, overlapSamples = 0, lastWind = game.map.wind, lastRss = process.memoryUsage().rss;
  const windEvents: unknown[] = [], initialQuarryGap = quarry ? Math.min(...ships.filter(unit => unit.owner === 'player').map(unit => Math.hypot(unit.x - quarry.x, unit.y - quarry.y))) : undefined;
  for (const unit of ships) if (!hullFits(game.map, unit)) throw new Error(`${scene.id}: ${unit.id} starts on land`);
  for (let a = 0; a < ships.length; a++) for (let b = a + 1; b < ships.length; b++) if ((hullContact(ships[a]!, ships[b]!)?.overlap ?? 0) > .1) throw new Error(`${scene.id}: initial hull overlap`);
  for (let tick = 0; tick < seconds(scene.duration); tick++) {
    fixture.beforeStep?.(tick);
    const poses = ships.map(unit => ({ x: unit.x, y: unit.y, heading: unit.sailing!.heading }));
    const cooldowns = new Map(ships.flatMap(unit => installedWeapons(game, unit).map(item => [item, item.cooldownRemaining] as const)));
    const started = performance.now(); stepGame(game); timings.push(performance.now() - started);
    if (game.map.wind !== lastWind) { windEvents.push({ second: (tick + 1) / SIM_TICKS_PER_SECOND, wind: game.map.wind,
      ships: ships.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, speed: unit.sailing!.speed })) }); lastWind = game.map.wind; }
    for (let i = 0; i < ships.length; i++) {
      const unit = ships[i]!, pose = poses[i]!, state = history.get(unit)!, motion = unit.sailing!;
      const distance = Math.hypot(unit.x - pose.x, unit.y - pose.y), yaw = headingDifference(pose.heading, motion.heading);
      state.travel += distance; state.yaw += Math.abs(yaw) * 180 / Math.PI;
      const sign = Math.abs(yaw) * SIM_TICKS_PER_SECOND > .01 ? Math.sign(yaw) : 0;
      if (sign && state.sign && sign !== state.sign) {
        // Also count slower oscillations: a 10-second collision-avoidance cycle
        // is visible to players even though it is outside the rapid threshold.
        if (Math.abs(state.turnAngle) > Math.PI / 120) {
          state.allReversals++;
          if (distance * SIM_TICKS_PER_SECOND > 1) state.movingAllReversals++; else state.stationaryAllReversals++;
          if (tick - state.turnTick < seconds(2)) {
            state.reversals++;
            if (distance * SIM_TICKS_PER_SECOND > 1) state.movingReversals++; else state.stationaryReversals++;
          }
        }
        state.turnTick = tick; state.turnAngle = 0;
      }
      if (sign) state.sign = sign; state.turnAngle += yaw;
      if (motion.route !== state.route) { if (motion.route) state.revisions++; state.route = motion.route; }
      // Stopped firing at a valid engagement station is intended behavior.
      // Count stalls only while an order still requires navigation.
      const pending = unit.hp > 0 && unit.order.type !== 'idle' && unit.order.type !== 'hold'
        && (!motion.pursuit || motion.pursuit.phase === 'approach' || motion.pursuit.moving);
      state.stopped = pending && distance * SIM_TICKS_PER_SECOND < 1 ? state.stopped + 1 : 0;
      state.maxStopped = Math.max(state.maxStopped, state.stopped);
      if (pending && distance * SIM_TICKS_PER_SECOND < 5) state.lowSpeed++;
      for (const item of installedWeapons(game, unit)) if (item.cooldownRemaining > (cooldowns.get(item) ?? Infinity)) { state.shots++; state.firstShot ??= (tick + 1) / SIM_TICKS_PER_SECOND; }
    }
    // Quality sampling is outside the timed simulation step. Identical probes
    // run for both revisions; overlap and coastline statistics are sampled at 10 Hz.
    if (tick % 2 === 0) {
      const live = ships.filter(unit => unit.hp > 0);
      for (const unit of live) if (!hullFits(game.map, unit)) coastViolations++;
      for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
        const overlap = hullContact(live[a]!, live[b]!)?.overlap ?? 0;
        maxHullOverlap = Math.max(maxHullOverlap, overlap); if (overlap > .1) overlapSamples++;
      }
    }
    if (tick % SIM_TICKS_PER_SECOND === 0) {
      lastRss = Math.max(lastRss, process.memoryUsage().rss);
      if (record) frames.push({ second: (tick + 1) / SIM_TICKS_PER_SECOND, wind: game.map.wind,
        ships: ships.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, heading: unit.sailing!.heading, speed: unit.sailing!.speed,
          hp: unit.hp, order: unit.order.type, mode: unit.sailing!.sail?.mode, route: unit.sailing!.route?.points.slice(0, 16) })) });
    }
  }
  const coldTicksMs = timings.slice(0, 2);
  timings.sort((a, b) => a - b);
  return { id: scene.id, label: scene.label, duration: scene.duration, setupMs, initial, windEvents,
    step: { count: timings.length, coldTicksMs, meanMs: timings.reduce((sum, value) => sum + value, 0) / timings.length,
      p50Ms: quantile(timings, .5), p95Ms: quantile(timings, .95), p99Ms: quantile(timings, .99), maxMs: timings.at(-1),
      over16Ms: timings.filter(value => value > 16).length, over33Ms: timings.filter(value => value > 33).length,
      over50Ms: timings.filter(value => value > 50).length },
    quality: { coastViolations, maxHullOverlap, overlapSamples, liveShips: ships.filter(unit => unit.hp > 0).length,
      initialQuarryGap, finalQuarryGap: quarry ? Math.min(...ships.filter(unit => unit.owner === 'player' && unit.hp > 0).map(unit => Math.hypot(unit.x - quarry.x, unit.y - quarry.y))) : undefined,
      ships: ships.map(unit => { const state = history.get(unit)!, goal = goals?.get(unit), origin = origins.get(unit)!;
        const initialGap = goal ? Math.hypot(goal.x - origin.x, goal.y - origin.y) : undefined, finalGap = goal ? Math.hypot(goal.x - unit.x, goal.y - unit.y) : undefined;
        return { id: unit.id, owner: unit.owner, hp: unit.hp, travel: state.travel, totalYawDegrees: state.yaw, rapidTurnReversals: state.reversals,
          movingRapidTurnReversals: state.movingReversals, stationaryRapidTurnReversals: state.stationaryReversals,
          turnReversals: state.allReversals, movingTurnReversals: state.movingAllReversals, stationaryTurnReversals: state.stationaryAllReversals,
          routeRevisions: state.revisions, longestPendingStopSeconds: state.maxStopped / SIM_TICKS_PER_SECOND, lowSpeedSeconds: state.lowSpeed / SIM_TICKS_PER_SECOND,
          shots: state.shots, firstShot: state.firstShot, initialGoalGap: initialGap, finalGoalGap: finalGap, goalProgress: initialGap ? 1 - finalGap! / initialGap : undefined }; }) },
    memory: { peakRssBytes: lastRss, heapUsedBytes: process.memoryUsage().heapUsed }, checksum: checksumGame(game),
    ...(record ? { frames, map: { width: game.map.width, height: game.map.height, terrain: game.map.terrain } } : {}) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (key: string) => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
  const only = arg('--only')?.split(','), output = resolve(arg('--out') ?? 'work/naval-runtime-stress.json');
  const duration = arg('--duration') === undefined ? undefined : Number(arg('--duration'));
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) throw new Error('Duration must be a positive number of seconds');
  const scenes = navalStressScenes.filter(scene => !only || only.some(id => scene.id.includes(id))).map(scene => {
    const result = runNavalStress(duration === undefined ? scene : { ...scene, duration }, process.argv.includes('--record'));
    process.stdout.write(`${scene.id} ${JSON.stringify({ step: result.step, quality: result.quality, checksum: result.checksum })}\n`); return result;
  });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({ schema: 1, environment: { node: process.version, arch: process.arch, platform: process.platform, cpu: cpus()[0]?.model },
    ticksPerSecond: SIM_TICKS_PER_SECOND, qualitySampleHz: 10, scenes }, null, 2));
  process.stdout.write(`Wrote ${scenes.length} scenarios to ${output}\n`);
}
