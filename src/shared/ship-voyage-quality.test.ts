import { describe, expect, it } from 'vitest';
import { boardUnit } from './decks';
import { hullContact, localToWorld, shipProfile } from './ship-geometry';
import { coursePerformance } from './ship-wind';
import { headingDifference, hullFits } from './ship-navigation';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { seconds, SIM_TICKS_PER_SECOND } from './time';
import { WIND_CHANGE_INTERVAL_TICKS } from './wind-field';
import type { Unit } from './types';

const kinds = ['cutter', 'transport', 'warship', 'bombardShip', 'fireShip', 'carrier'] as const;
type Game = ReturnType<typeof createGame>;
type Point = { x: number; y: number };

function sea(direction = Math.PI / 4) {
  const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [], teams: { player: 'blue', enemy: 'red' } });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 8192, height: 8192, wind: { direction, speed: 80 }, terrain: { cols: 256, rows: 256, cell: 32, cells: '~'.repeat(256 * 256) } };
  return game;
}

function move(game: Game, unit: Unit, goal: Point) {
  issuePlayerCommand(game, unit.owner, { type: 'move', unitIds: [unit.id], ...goal, avoidCombat: true });
}

/** Measure visible movement after admission through the actual command path. */
function observe(game: Game, ship: Unit, duration: number, goal?: Point, beforeStep?: (tick: number) => void) {
  const metrics = { travel: 0, totalYaw: 0, yawChanges: 0, rapidTurnReversals: 0, stops: 0, stationaryTurns: 0, replans: 0, reverseTicks: 0, activeTackChanges: 0, firstSecondTravel: 0 };
  let lastYawSign = 0, lastTackSide = 0, moving = false, previousRoute = ship.sailing!.route;
  let turnStarted = 0, turnAngle = 0;
  for (let tick = 0; tick < seconds(duration); tick++) {
    beforeStep?.(tick);
    const before = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
    stepGame(game);
    const motion = ship.sailing!, distance = Math.hypot(ship.x - before.x, ship.y - before.y), yaw = headingDifference(before.heading, motion.heading);
    metrics.travel += distance; metrics.totalYaw += Math.abs(yaw);
    if (tick < seconds(1)) metrics.firstSecondTravel += distance;
    const sign = Math.abs(yaw) * SIM_TICKS_PER_SECOND > .01 ? Math.sign(yaw) : 0;
    if (sign && lastYawSign && sign !== lastYawSign) {
      metrics.yawChanges++;
      if (tick - turnStarted < seconds(2) && Math.abs(turnAngle) > Math.PI / 120) metrics.rapidTurnReversals++;
      turnStarted = tick; turnAngle = 0;
    }
    if (sign) lastYawSign = sign;
    turnAngle += yaw;
    const nowMoving = distance * SIM_TICKS_PER_SECOND > 1;
    if (!nowMoving && moving && ship.order.type !== 'idle') metrics.stops++;
    if (!nowMoving && Math.abs(yaw) > 1e-5) metrics.stationaryTurns++;
    moving = nowMoving;
    if ((ship.x - before.x) * Math.cos(motion.heading) + (ship.y - before.y) * Math.sin(motion.heading) < -1e-5) metrics.reverseTicks++;
    if (motion.route !== previousRoute) { if (motion.route) metrics.replans++; previousRoute = motion.route; }
    const polar = coursePerformance(ship, game.map, undefined, { assumeTrimmed: true });
    if (motion.sail?.mode === 'tacking' && motion.speed > polar.auxiliarySpeed * 1.05 && polar.trueWindAngle >= polar.noGoAngle) {
      const side = Math.sign(headingDifference(game.map.wind!.direction + Math.PI, motion.heading));
      if (lastTackSide && side !== lastTackSide) metrics.activeTackChanges++;
      lastTackSide = side;
    }
    expect(hullFits(game.map, ship)).toBe(true);
    if (goal && ship.order.type === 'idle') break;
  }
  return metrics;
}

describe('observable ship voyage quality', () => {
  for (const kind of kinds) it(`${kind} finishes a short oblique command instead of orbiting the point`, () => {
    const game = sea(Math.PI / 3), ship = game.spawnUnit('player', kind, 2400, 4000);
    const goal = { x: 2450, y: 4000 + Math.sqrt(3) * 50 };
    move(game, ship, goal);
    const metrics = observe(game, ship, 60, goal);
    expect(ship.order.type).toBe('idle'); expect(Math.hypot(ship.x - goal.x, ship.y - goal.y)).toBeLessThan(1);
    expect(metrics.travel).toBeLessThan(300); expect(metrics.totalYaw).toBeLessThan(Math.PI * 1.5);
  });

  for (const kind of kinds) for (const degrees of [45, 90, 180]) it(`${kind} carries forward motion through a ${degrees}° cruise redirection`, () => {
    const game = sea(), ship = game.spawnUnit('player', kind, 1800, 4000);
    move(game, ship, { x: 7000, y: 4000 });
    for (let tick = 0; tick < seconds(10); tick++) stepGame(game);
    expect(ship.sailing!.speed).toBeGreaterThan(10);
    const angle = degrees * Math.PI / 180, goal = { x: ship.x + 900 * Math.cos(angle), y: ship.y + 900 * Math.sin(angle) };
    move(game, ship, goal);
    const metrics = observe(game, ship, 160, goal);
    expect(ship.order.type).toBe('idle'); expect(Math.hypot(ship.x - goal.x, ship.y - goal.y)).toBeLessThan(1);
    expect(metrics.firstSecondTravel).toBeGreaterThan(5);
    expect(metrics.stationaryTurns).toBeLessThan(seconds(.5));
    expect(metrics.yawChanges).toBeLessThanOrEqual(5);
    // The westward square-rig course needs a tack in this wind. Allow that
    // legitimate detour while rejecting a second complete circle.
    expect(metrics.totalYaw).toBeLessThan(angle + Math.PI * 2);
    expect(metrics.travel).toBeLessThan(900 * 3.5);
    expect(metrics.reverseTicks).toBe(0);
  });

  for (const kind of kinds) it(`${kind} commits to long upwind legs without repeated stop-and-turn cycles`, () => {
    const game = sea(Math.PI), ship = game.spawnUnit('player', kind, 2400, 4000), goal = { x: 4100, y: 4000 };
    const polar = coursePerformance(ship, game.map, 0, { assumeTrimmed: true });
    move(game, ship, goal);
    const metrics = observe(game, ship, 260, goal);
    expect(ship.order.type).toBe('idle'); expect(Math.hypot(ship.x - goal.x, ship.y - goal.y)).toBeLessThan(1);
    // Square sails beat at 73°: a 3.42× path is physically expected here.
    expect(metrics.travel / 1700).toBeLessThan(1 / Math.cos(polar.beatAngle) + .4);
    expect(metrics.activeTackChanges).toBeGreaterThanOrEqual(1);
    expect(metrics.activeTackChanges).toBeLessThanOrEqual(2);
    expect(metrics.totalYaw).toBeLessThan(Math.PI * 2 + polar.beatAngle);
    expect(metrics.stationaryTurns).toBeLessThan(seconds(.5)); expect(metrics.stops).toBeLessThanOrEqual(2);
  });

  for (const close of [false, true]) it(`pursues a ${close ? 'near parallel' : 'distant crossing'} moving enemy without stop-start range chatter`, () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 1600, 1800);
    const target = game.spawnUnit('enemy', 'transport', close ? 1900 : 3000, close ? 2000 : 900);
    ship.invulnerable = true; target.invulnerable = true; target.sailing!.heading = close ? 0 : Math.PI / 2;
    move(game, target, close ? { x: 7100, y: 2000 } : { x: 3000, y: 3600 });
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: target.id });
    const metrics = observe(game, ship, 65);
    expect(metrics.stops).toBeLessThanOrEqual(3); expect(metrics.replans).toBeLessThanOrEqual(16);
    // A route can avoid full stops yet snake left/right once a second. Allow
    // isolated interception and avoidance corrections, not repeated oscillation.
    expect(metrics.rapidTurnReversals).toBeLessThanOrEqual(4);
    expect(metrics.travel).toBeGreaterThan(1500);
    if (!close) expect(Math.hypot(ship.x - target.x, ship.y - target.y)).toBeLessThan(450);
  });

  for (const kind of kinds) it(`${kind} resumes the full journey after yielding to an oncoming hull`, () => {
    const game = sea(Math.PI / 2), ship = game.spawnUnit('player', kind, 1800, 1800), other = game.spawnUnit('player', kind, 3500, 1800);
    other.sailing!.heading = Math.PI;
    move(game, ship, { x: 3500, y: 1800 }); move(game, other, { x: 1800, y: 1800 });
    for (let tick = 0; tick < seconds(150); tick++) {
      stepGame(game);
      expect(hullContact(ship, other)?.overlap ?? 0).toBeLessThan(.1);
      expect(hullFits(game.map, ship)).toBe(true); expect(hullFits(game.map, other)).toBe(true);
      if (ship.order.type === 'idle' && other.order.type === 'idle') break;
    }
    expect(ship.order.type).toBe('idle'); expect(other.order.type).toBe('idle');
    expect(Math.hypot(ship.x - 3500, ship.y - 1800)).toBeLessThan(1);
    expect(Math.hypot(other.x - 1800, other.y - 1800)).toBeLessThan(1);
  });

  it('does not mistake a temporary crossing-traffic waypoint for the requested destination', () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 1800, 1800), other = game.spawnUnit('player', 'transport', 2650, 900);
    other.sailing!.heading = Math.PI / 2;
    move(game, ship, { x: 3500, y: 1800 }); move(game, other, { x: 2650, y: 3000 });
    for (let tick = 0; tick < seconds(150); tick++) {
      stepGame(game); expect(hullContact(ship, other)?.overlap ?? 0).toBeLessThan(.1);
      if (ship.order.type === 'idle' && other.order.type === 'idle') break;
    }
    expect(ship.order.type).toBe('idle'); expect(other.order.type).toBe('idle');
    expect(Math.hypot(ship.x - 3500, ship.y - 1800)).toBeLessThan(1);
    expect(Math.hypot(other.x - 2650, other.y - 3000)).toBeLessThan(1);
  });

  it('holds course beside a friendly hull with the same velocity', () => {
    const game = sea(Math.PI / 2), ship = game.spawnUnit('player', 'carrier', 1800, 1800), other = game.spawnUnit('player', 'carrier', 1950, 2000);
    const goal = { x: 3500, y: 1800 }; move(game, ship, goal); move(game, other, { x: 3650, y: 2000 });
    const metrics = observe(game, ship, 100, goal);
    expect(ship.order.type).toBe('idle'); expect(Math.hypot(ship.x - goal.x, ship.y - goal.y)).toBeLessThan(1);
    expect(metrics.totalYaw).toBeLessThan(.01); expect(metrics.stops).toBe(0);
  });

  it('follows a moving leader and settles without circling when the leader stops', () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 1800, 1800), target = game.spawnUnit('player', 'transport', 2350, 1900);
    move(game, target, { x: 4300, y: 1900 });
    issuePlayerCommand(game, 'player', { type: 'follow', unitIds: [ship.id], targetId: target.id });
    const metrics = observe(game, ship, 130, undefined, () => { expect(hullContact(ship, target)?.overlap ?? 0).toBeLessThan(.1); });
    expect(target.order.type).toBe('idle'); expect(ship.order.type).toBe('follow');
    expect(Math.hypot(ship.x - target.x, ship.y - target.y)).toBeLessThan(400);
    expect(ship.sailing!.speed).toBeLessThan(.1); expect(metrics.replans).toBeLessThan(25);
    const settled = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
    for (let tick = 0; tick < seconds(5); tick++) stepGame(game);
    expect(Math.hypot(ship.x - settled.x, ship.y - settled.y)).toBeLessThan(1);
    expect(Math.abs(headingDifference(settled.heading, ship.sailing!.heading))).toBeLessThan(.01);
  });

  it('resumes wind-powered pursuit after an exact maneuver and stops safely behind a tacking leader', () => {
    const game = sea(Math.PI), ship = game.spawnUnit('player', 'warship', 1800, 1800), target = game.spawnUnit('player', 'transport', 2350, 1900);
    // The map edge makes this a constrained two-vessel voyage. Record the
    // leader's real tacks; following a faster rig cannot mean straight travel.
    game.map.height = 4096; game.map.terrain = { cell: 32, cols: 256, rows: 128, cells: '~'.repeat(256 * 128) };
    ship.invulnerable = true; target.invulnerable = true;
    move(game, target, { x: 3500, y: 1900 });
    issuePlayerCommand(game, 'player', { type: 'follow', unitIds: [ship.id], targetId: target.id });
    let leaderStopped: number | undefined, distantLowSpeedTicks = 0, leaderDeviation = 0;
    const metrics = observe(game, ship, 240, undefined, () => {
      leaderDeviation = Math.max(leaderDeviation, Math.abs(target.y - 1900));
      if (target.order.type === 'idle') leaderStopped ??= game.tick;
      const auxiliary = coursePerformance(ship, game.map).auxiliarySpeed;
      if (leaderStopped !== undefined && game.tick > leaderStopped + seconds(10)
        && Math.hypot(ship.x - target.x, ship.y - target.y) > shipProfile(ship)!.length * 4
        && ship.sailing!.speed < auxiliary * 1.1) distantLowSpeedTicks++;
      expect(hullContact(ship, target)?.overlap ?? 0).toBeLessThan(.1);
    });
    expect(leaderDeviation).toBeGreaterThan(500); expect(target.order.type).toBe('idle');
    expect(ship.sailing!.speed).toBeLessThan(.1); expect(Math.hypot(ship.x - target.x, ship.y - target.y)).toBeLessThan(400);
    // Two genuine long tacks are allowed. An extra orbit around the stopped
    // leader and a minute-long auxiliary crawl are both visible regressions.
    expect(metrics.totalYaw).toBeLessThan(Math.PI * 4);
    expect(metrics.rapidTurnReversals).toBeLessThanOrEqual(2);
    expect(distantLowSpeedTicks).toBeLessThan(seconds(20));
  });

  it('retains the moving carrying hull as its route target while the ordered crew walks about', () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 1600, 1800), target = game.spawnUnit('enemy', 'transport', 3000, 2000);
    const crew = game.spawnUnit('enemy', 'worker', target.x, target.y);
    ship.invulnerable = true; target.invulnerable = true; crew.invulnerable = true; boardUnit(target, crew, game.units);
    move(game, target, { x: 7100, y: 2000 });
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: crew.id });
    const metrics = observe(game, ship, 30, undefined, tick => {
      if (tick % seconds(3) === 0) issuePlayerCommand(game, 'enemy', { type: 'move', unitIds: [crew.id],
        ...localToWorld(target, { x: (Math.floor(tick / seconds(3)) % 2 ? -1 : 1) * 45, y: 8 }) });
      if (tick > 0) { expect(ship.sailing!.pursuit?.targetId).toBe(target.id); expect(ship.sailing!.route?.targetId).toBe(target.id); }
    });
    expect(metrics.replans).toBeLessThanOrEqual(8); expect(metrics.stops).toBe(0);
  });

  it('restores the helm, committed route and pursuit through the next wind boundary', () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 2400, 4000), target = game.spawnUnit('enemy', 'transport', 3800, 4600);
    ship.invulnerable = true; target.invulnerable = true; move(game, target, { x: 6000, y: 6500 });
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: target.id });
    game.tick = WIND_CHANGE_INTERVAL_TICKS - seconds(4);
    for (let tick = 0; tick < seconds(2); tick++) stepGame(game);
    const saved = snapshotGame(game), restored = sea(); restoreSnapshotIntoGame(restored, saved, game.nextId);
    expect(saved.units.find(unit => unit.id === ship.id)!.sailing!.route!.points).not.toBe(ship.sailing!.route!.points);
    for (let tick = 0; tick < seconds(8); tick++) {
      stepGame(game); stepGame(restored);
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
    expect(game.map.wind!.changedAtTick).toBe(WIND_CHANGE_INTERVAL_TICKS);
  });
});
