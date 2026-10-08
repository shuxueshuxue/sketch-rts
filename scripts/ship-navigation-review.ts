import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { boardUnit } from '../src/shared/decks';
import { shipProfile, hullContact, localToWorld } from '../src/shared/ship-geometry';
import { headingDifference, hullFits } from '../src/shared/ship-navigation';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../src/shared/sim';
import { seconds, SIM_TICKS_PER_SECOND } from '../src/shared/time';
import type { GameMap, Unit } from '../src/shared/types';

/** Repeatable player-command journeys. The trace records motion quality, not
 * only eventual arrival. Run the same file against both revisions for review. */
const kinds = ['cutter', 'transport', 'warship', 'bombardShip', 'fireShip', 'carrier'] as const;
type Kind = typeof kinds[number];
type Game = ReturnType<typeof createGame>;
type Point = { x: number; y: number };
type Scene = { id: string; label: string; duration: number; setup: () => Fixture };
type Fixture = { game: Game; ships: Unit[]; focus: Unit; target?: Unit; goal?: Point; crew?: Unit[]; beforeStep?: (tick: number) => void; done?: () => boolean };

function sea(direction = 0, shape?: (x: number, y: number) => string, rows = 128): Game {
  const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [], teams: { player: 'blue', enemy: 'red' } });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = [];
  game.scriptedVictory = true;
  const cols = 256, cell = 32;
  game.map = { ...game.map, id: 'ship-navigation-review', width: cols * cell, height: rows * cell,
    wind: { direction, speed: 80 }, terrain: { cols, rows, cell, cells: Array.from({ length: cols * rows }, (_, i) => shape?.(i % cols, Math.floor(i / cols)) ?? '~').join('') } };
  return game;
}

function spawn(game: Game, kind: Kind, x: number, y: number, owner = 'player', heading = 0) {
  const ship = game.spawnUnit(owner, kind, x, y); ship.sailing!.heading = heading;
  // Keep the target alive so a fixed observation window cannot be truncated
  // by different damage timing. Commands and propulsion remain unmodified.
  ship.invulnerable = true;
  return ship;
}

function move(game: Game, ship: Unit, point: Point, queued = false) {
  issuePlayerCommand(game, ship.owner, { type: 'move', unitIds: [ship.id], ...point, queued, avoidCombat: true });
}

const scenes: Scene[] = [];
for (const kind of kinds) for (const [name, angle, distance] of [
  ['straight', 0, 1700], ['turn-90', Math.PI / 2, 900], ['turn-180', Math.PI, 900],
  ['short-oblique', Math.PI / 3, 100], ['long-upwind', 0, 1700],
] as const) {
  scenes.push({ id: `${kind}-${name}`, label: `${kind}: ${name}`, duration: name === 'long-upwind' ? 240 : 100, setup: () => {
    const game = sea(name === 'long-upwind' ? Math.PI : angle);
    const focus = spawn(game, kind, 2400, 1800), goal = { x: focus.x + distance * Math.cos(angle), y: focus.y + distance * Math.sin(angle) };
    move(game, focus, goal);
    return { game, focus, ships: [focus], goal, done: () => focus.order.type === 'idle' };
  } });
}
for (const kind of kinds) for (const degrees of [90, 180]) {
  scenes.push({ id: `${kind}-running-turn-${degrees}`, label: `${kind}: redirect at cruise speed by ${degrees}°`, duration: 160, setup: () => {
    const game = sea(Math.PI / 4), focus = spawn(game, kind, 1800, 1800);
    move(game, focus, { x: 6000, y: 1800 });
    for (let tick = 0; tick < seconds(10); tick++) stepGame(game);
    const angle = degrees * Math.PI / 180, goal = { x: focus.x + 900 * Math.cos(angle), y: focus.y + 900 * Math.sin(angle) };
    move(game, focus, goal);
    return { game, focus, ships: [focus], goal, done: () => focus.order.type === 'idle' };
  } });
}
for (const kind of kinds) {
  scenes.push({ id: `${kind}-ocean-upwind`, label: `${kind}: upwind with room for full laylines`, duration: 240, setup: () => {
    const game = sea(Math.PI, undefined, 256), focus = spawn(game, kind, 2400, 4000), goal = { x: 4100, y: 4000 };
    move(game, focus, goal);
    return { game, focus, ships: [focus], goal, done: () => focus.order.type === 'idle' };
  } });
}
for (const kind of ['transport', 'warship'] as const) for (let degrees = 0; degrees < 360; degrees += 45) {
  scenes.push({ id: `${kind}-default-wind-${degrees}`, label: `${kind}: default wind, ${degrees}° destination`, duration: 200, setup: () => {
    const game = sea(Math.PI / 4), focus = spawn(game, kind, 2400, 1800);
    const angle = degrees * Math.PI / 180, goal = { x: focus.x + 1000 * Math.cos(angle), y: focus.y + 1000 * Math.sin(angle) };
    move(game, focus, goal);
    return { game, focus, ships: [focus], goal, done: () => focus.order.type === 'idle' };
  } });
}

scenes.push({ id: 'transport-queued-corners', label: 'Three queued 90° legs', duration: 140, setup: () => {
  const game = sea(Math.PI / 4), focus = spawn(game, 'transport', 1800, 1300);
  const goal = { x: 3300, y: 2000 };
  move(game, focus, { x: 2500, y: 1300 }); move(game, focus, { x: 2500, y: 2000 }, true); move(game, focus, goal, true);
  return { game, focus, ships: [focus], goal, done: () => focus.order.type === 'idle' && Math.hypot(focus.x - goal.x, focus.y - goal.y) < 5 };
} });
scenes.push({ id: 'transport-narrow-upwind', label: 'Narrow channel, upwind', duration: 180, setup: () => {
  const game = sea(Math.PI, (_x, y) => y >= 54 && y <= 57 ? '~' : '.');
  const focus = spawn(game, 'transport', 1800, 1792), goal = { x: 3200, y: 1792 };
  move(game, focus, goal);
  return { game, focus, ships: [focus], goal, done: () => focus.order.type === 'idle' };
} });
scenes.push({ id: 'transport-island', label: 'Island detour with two corners', duration: 160, setup: () => {
  const game = sea(0, (x, y) => x >= 70 && x <= 82 && y >= 44 && y <= 64 ? '.' : '~');
  const focus = spawn(game, 'transport', 1700, 1760), goal = { x: 3200, y: 1760 };
  move(game, focus, goal);
  return { game, focus, ships: [focus], goal, done: () => focus.order.type === 'idle' };
} });
for (const kind of kinds) {
  scenes.push({ id: `${kind}-head-on`, label: `${kind}: two ships meeting head-on`, duration: 150, setup: () => {
    const game = sea(Math.PI / 2), focus = spawn(game, kind, 1800, 1800), other = spawn(game, kind, 3500, 1800, 'player', Math.PI);
    const goal = { x: 3500, y: 1800 }; move(game, focus, goal); move(game, other, { x: 1800, y: 1800 });
    return { game, focus, ships: [focus, other], goal, done: () => focus.order.type === 'idle' && other.order.type === 'idle'
      && Math.hypot(focus.x - goal.x, focus.y - goal.y) < 1 && Math.hypot(other.x - 1800, other.y - 1800) < 1 };
  } });
}
scenes.push({ id: 'warship-crossing-traffic', label: 'Warship crossing a friendly transport course', duration: 150, setup: () => {
  const game = sea(Math.PI / 4), focus = spawn(game, 'warship', 1800, 1800), other = spawn(game, 'transport', 2650, 900, 'player', Math.PI / 2);
  const goal = { x: 3500, y: 1800 }; move(game, focus, goal); move(game, other, { x: 2650, y: 3000 });
  return { game, focus, ships: [focus, other], goal, done: () => focus.order.type === 'idle' && other.order.type === 'idle'
    && Math.hypot(focus.x - goal.x, focus.y - goal.y) < 1 && Math.hypot(other.x - 2650, other.y - 3000) < 1 };
} });
scenes.push({ id: 'carrier-parallel-friendly', label: 'Two carriers sailing abreast without a collision course', duration: 100, setup: () => {
  const game = sea(Math.PI / 2), focus = spawn(game, 'carrier', 1800, 1800), other = spawn(game, 'carrier', 1950, 2000);
  const goal = { x: 3500, y: 1800 }; move(game, focus, goal); move(game, other, { x: 3650, y: 2000 });
  return { game, focus, ships: [focus, other], goal, done: () => focus.order.type === 'idle' && other.order.type === 'idle'
    && Math.hypot(focus.x - goal.x, focus.y - goal.y) < 1 && Math.hypot(other.x - 3650, other.y - 2000) < 1 };
} });
for (const [name, position, destination, wind] of [
  ['parallel', { x: 3000, y: 1900 }, { x: 7100, y: 1900 }, Math.PI / 2],
  ['crossing', { x: 3000, y: 900 }, { x: 3000, y: 3600 }, Math.PI / 4],
  ['fleeing', { x: 3000, y: 1800 }, { x: 7100, y: 1800 }, 0],
  ['upwind', { x: 3000, y: 1850 }, { x: 7100, y: 1850 }, Math.PI],
] as const) {
  scenes.push({ id: `attack-${name}`, label: `Attack moving enemy: ${name}`, duration: 65, setup: () => {
    const game = sea(wind), focus = spawn(game, 'warship', 1600, 1800), target = spawn(game, 'transport', position.x, position.y, 'enemy', Math.atan2(destination.y - position.y, destination.x - position.x));
    move(game, target, destination); issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [focus.id], targetId: target.id });
    return { game, focus, ships: [focus, target], target };
  } });
}
for (const close of [false, true]) {
  scenes.push({ id: `attack-${close ? 'close-parallel' : 'crossing-running'}`, label: close ? 'Attack passing ship at combat range' : 'Redirect a cruising ship to a crossing enemy', duration: 65, setup: () => {
    const game = sea(Math.PI / 4), focus = spawn(game, 'warship', 1600, 1800);
    const target = spawn(game, 'transport', close ? 1900 : 3400, close ? 2000 : 700, 'enemy', close ? 0 : Math.PI / 2);
    move(game, focus, { x: 7100, y: 1800 });
    move(game, target, close ? { x: 7100, y: 2000 } : { x: 3400, y: 3650 });
    for (let tick = 0; tick < seconds(8); tick++) stepGame(game);
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [focus.id], targetId: target.id });
    return { game, focus, ships: [focus, target], target };
  } });
}
scenes.push({ id: 'attack-walking-crew', label: 'Attack crew walking on a moving enemy ship', duration: 65, setup: () => {
  const game = sea(Math.PI / 4), focus = spawn(game, 'warship', 1600, 1800), target = spawn(game, 'transport', 3000, 2000, 'enemy');
  const passenger = game.spawnUnit('enemy', 'worker', target.x, target.y); passenger.invulnerable = true;
  boardUnit(target, passenger, game.units); move(game, target, { x: 7100, y: 2000 });
  issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [focus.id], targetId: passenger.id });
  return { game, focus, ships: [focus, target], target, beforeStep: tick => {
    if (tick % seconds(3) === 0) issuePlayerCommand(game, 'enemy', { type: 'move', unitIds: [passenger.id],
      ...localToWorld(target, { x: (Math.floor(tick / seconds(3)) % 2 ? -1 : 1) * 45, y: 8 }) });
  } };
} });
for (const crowded of [false, true]) {
  scenes.push({ id: crowded ? 'capture-crowded' : 'capture-stationary', label: crowded ? 'Three footmen board an empty enemy deck' : 'Board and capture separated empty enemy deck', duration: 100, setup: () => {
    const game = sea(Math.PI / 4), focus = spawn(game, 'transport', 1800, 1800), target = spawn(game, 'transport', 2450, 1950, 'enemy');
    const crew = Array.from({ length: crowded ? 3 : 1 }, () => game.spawnUnit('player', 'footman', focus.x, focus.y));
    for (const unit of crew) { unit.invulnerable = true; boardUnit(focus, unit, game.units); }
    issuePlayerCommand(game, 'player', { type: 'board', unitIds: crew.map(unit => unit.id), transportId: target.id });
    return { game, focus, ships: [focus, target], target, crew, done: () => crew.every(unit => unit.deck?.shipId === target.id && unit.order.type === 'idle') };
  } });
}
scenes.push({ id: 'board-moving-friendly', label: 'Board moving friendly ship', duration: 150, setup: () => {
  const game = sea(0), focus = spawn(game, 'transport', 1800, 1800), target = spawn(game, 'transport', 2450, 1950);
  const crew = [game.spawnUnit('player', 'worker', focus.x, focus.y)]; boardUnit(focus, crew[0]!, game.units);
  move(game, target, { x: 6000, y: 1950 });
  issuePlayerCommand(game, 'player', { type: 'board', unitIds: crew.map(unit => unit.id), transportId: target.id });
  return { game, focus, ships: [focus, target], target, crew, done: () => crew.every(unit => unit.deck?.shipId === target.id && unit.order.type === 'idle') };
} });
for (const upwind of [false, true]) {
  scenes.push({ id: upwind ? 'follow-upwind-then-stop' : 'follow-moving-then-stop', label: upwind ? 'Follow a tacking leader until it stops' : 'Follow a friendly ship until it stops', duration: upwind ? 240 : 150, setup: () => {
    const game = sea(upwind ? Math.PI : Math.PI / 4), focus = spawn(game, 'warship', 1800, 1800), target = spawn(game, 'transport', 2350, 1900);
    move(game, target, { x: upwind ? 3500 : 4300, y: 1900 });
    issuePlayerCommand(game, 'player', { type: 'follow', unitIds: [focus.id], targetId: target.id });
    let settledAt: number | undefined;
    return { game, focus, ships: [focus, target], target, beforeStep: () => {
      if (target.order.type === 'idle' && focus.sailing!.speed < .1 && Math.hypot(focus.x - target.x, focus.y - target.y) < 400) settledAt ??= game.tick;
      else settledAt = undefined;
    }, done: () => settledAt !== undefined && game.tick - settledAt >= seconds(3) };
  } });
}

const arg = (key: string) => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
const only = arg('--only')?.split(',');
const output = resolve(arg('--out') ?? 'work/ship-navigation-review.json');
const traces: unknown[] = [];
for (const scene of scenes.filter(scene => !only || only.some(filter => scene.id.includes(filter)))) {
  const started = performance.now(), fixture = scene.setup(), { game, focus, ships, target, goal, crew } = fixture;
  const initialSnapshot = snapshotGame(game), startTick = game.tick, frames: unknown[] = [], routeEvents: unknown[] = [];
  const previousRoutes = new Map<Unit, NonNullable<Unit['sailing']>['route']>();
  const previousRoutePoints = new Map<Unit, string>();
  const revisions = new Map<Unit, number>();
  const metrics = {
    arrived: false, duration: 0, directDistance: goal ? Math.hypot(goal.x - focus.x, goal.y - focus.y) : undefined,
    travel: 0, pathRatio: undefined as number | undefined, finalGoalGap: undefined as number | undefined,
    initialTargetGap: target ? Math.hypot(target.x - focus.x, target.y - focus.y) : undefined,
    finalTargetGap: undefined as number | undefined, closestTargetGap: Infinity,
    totalYawDegrees: 0, yawSignChanges: 0, rapidTurnReversals: 0, movingTurnTicks: 0, stationaryTurnTicks: 0,
    stopEpisodes: 0, reverseEpisodes: 0, reverseTicks: 0, routeRevisions: 0, maxReplansInOneSecond: 0,
    abandonedTackLegs: 0,
    modeSwitches: 0, slowTicks: 0, coastViolations: 0, maxHullOverlap: 0,
    crewTransferred: 0, targetCaptured: false, wallMilliseconds: 0,
  };
  let lastYawSign = 0, moving = false, reversing = false, everMoved = false, lastMode: string | undefined;
  let turnStarted = 0, turnAngle = 0;
  const replanTicks: number[] = [];
  for (let i = 0; i < seconds(scene.duration); i++) {
    fixture.beforeStep?.(i);
    const before = new Map(ships.map(ship => [ship, { x: ship.x, y: ship.y, heading: ship.sailing!.heading,
      nextPoint: ship.sailing!.route?.points[0] ? { ...ship.sailing!.route.points[0] } : undefined }]));
    stepGame(game);
    const frameShips = ships.map(ship => {
      const prev = before.get(ship)!, motion = ship.sailing!, route = motion.route;
      const dx = ship.x - prev.x, dy = ship.y - prev.y, distance = Math.hypot(dx, dy), yaw = headingDifference(prev.heading, motion.heading);
      const surge = (dx * Math.cos(motion.heading) + dy * Math.sin(motion.heading)) * SIM_TICKS_PER_SECOND;
      if (route !== previousRoutes.get(ship)) {
        previousRoutes.set(ship, route);
        if (route) {
          const revision = (revisions.get(ship) ?? 0) + 1; revisions.set(ship, revision);
          if (ship === focus) {
            metrics.routeRevisions++; replanTicks.push(game.tick);
            if (prev.nextPoint?.tack && route.points[0]?.tack
              && Math.hypot(prev.nextPoint.x - prev.x, prev.nextPoint.y - prev.y) > shipProfile(ship)!.length
              && Math.abs(headingDifference(prev.nextPoint.heading, route.points[0].heading)) > Math.PI / 2) metrics.abandonedTackLegs++;
          }
        }
      }
      // Tack insertion and waypoint consumption mutate a route in place.
      // Record those visual changes without miscounting them as replans.
      const routePoints = route ? JSON.stringify(route.points) : '';
      if (routePoints !== previousRoutePoints.get(ship)) {
        previousRoutePoints.set(ship, routePoints);
        if (route) routeEvents.push({ tick: game.tick, id: ship.id, revision: revisions.get(ship) ?? 0, route: structuredClone(route) });
      }
      if (ship === focus) {
        metrics.travel += distance; metrics.totalYawDegrees += Math.abs(yaw) * 180 / Math.PI;
        const sign = Math.abs(yaw) * SIM_TICKS_PER_SECOND > .01 ? Math.sign(yaw) : 0;
        if (sign && lastYawSign && sign !== lastYawSign) {
          metrics.yawSignChanges++;
          if (i - turnStarted < seconds(2) && Math.abs(turnAngle) > Math.PI / 120) metrics.rapidTurnReversals++;
          turnStarted = i; turnAngle = 0;
        }
        if (sign) lastYawSign = sign;
        turnAngle += yaw;
        if (Math.abs(yaw) > 1e-5) { if (distance > .025) metrics.movingTurnTicks++; else metrics.stationaryTurnTicks++; }
        const nowMoving = distance * SIM_TICKS_PER_SECOND > 1;
        if (!nowMoving && moving && everMoved && !fixture.done?.()) metrics.stopEpisodes++;
        if (nowMoving) everMoved = true;
        moving = nowMoving;
        const nowReverse = surge < -.1;
        if (nowReverse) { metrics.reverseTicks++; if (!reversing) metrics.reverseEpisodes++; }
        reversing = nowReverse;
        if (distance * SIM_TICKS_PER_SECOND < 1 && ship.order.type !== 'idle') metrics.slowTicks++;
        if (motion.sail?.mode !== lastMode) { if (lastMode) metrics.modeSwitches++; lastMode = motion.sail?.mode; }
        if (!hullFits(game.map, ship)) metrics.coastViolations++;
      }
      return { id: ship.id, x: ship.x, y: ship.y, heading: motion.heading, speed: motion.speed, yaw, surge,
        mode: motion.sail?.mode, order: ship.order.type, routeRevision: revisions.get(ship) ?? 0,
        pursuit: motion.pursuit ? { ...motion.pursuit } : undefined,
        routeGoal: route ? { x: route.goalX, y: route.goalY } : undefined,
        routePoints: route?.points.length ?? 0, cruise: route?.cruise,
        nextPoint: route?.points[0] ? structuredClone(route.points[0]) : undefined, owner: ship.owner, hp: ship.hp };
    });
    if (target) metrics.closestTargetGap = Math.min(metrics.closestTargetGap, Math.hypot(target.x - focus.x, target.y - focus.y));
    for (let a = 0; a < ships.length; a++) for (let b = a + 1; b < ships.length; b++) metrics.maxHullOverlap = Math.max(metrics.maxHullOverlap, hullContact(ships[a]!, ships[b]!)?.overlap ?? 0);
    frames.push({ tick: game.tick, ships: frameShips });
    if (fixture.done?.()) { metrics.arrived = !goal || Math.hypot(focus.x - goal.x, focus.y - goal.y) < 1; break; }
  }
  metrics.duration = (game.tick - startTick) / SIM_TICKS_PER_SECOND;
  if (goal) metrics.finalGoalGap = Math.hypot(focus.x - goal.x, focus.y - goal.y);
  if (metrics.directDistance) metrics.pathRatio = metrics.travel / metrics.directDistance;
  if (target) { metrics.finalTargetGap = Math.hypot(target.x - focus.x, target.y - focus.y); metrics.targetCaptured = target.owner === 'player' && initialSnapshot.units.find(unit => unit.id === target.id)?.owner !== 'player'; }
  for (const tick of replanTicks) metrics.maxReplansInOneSecond = Math.max(metrics.maxReplansInOneSecond, replanTicks.filter(other => other >= tick && other < tick + SIM_TICKS_PER_SECOND).length);
  metrics.crewTransferred = crew?.filter(unit => unit.deck?.shipId === target?.id).length ?? 0;
  metrics.wallMilliseconds = performance.now() - started;
  traces.push({ id: scene.id, label: scene.label, focusId: focus.id, targetId: target?.id, goal,
    map: game.map as GameMap, hulls: ships.map(ship => ({ id: ship.id, kind: ship.kind, profile: shipProfile(ship) })), initialSnapshot,
    finalCrew: crew?.map(unit => ({ id: unit.id, kind: unit.kind, x: unit.x, y: unit.y, deck: unit.deck, order: unit.order })), frames, routeEvents, metrics });
  process.stdout.write(`${scene.id} ${JSON.stringify(metrics)}\n`);
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ schema: 1, ticksPerSecond: SIM_TICKS_PER_SECOND, scenes: traces }));
process.stdout.write(`Wrote ${traces.length} scenarios to ${output}\n`);
