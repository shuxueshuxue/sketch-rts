import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boardUnit } from '../src/shared/decks';
import { strikePoint } from '../src/shared/combat-geometry';
import { installedWeapons, mountedWeaponPose, rebuildShipFittings, SHIP_WEAPONS, shipGunCanAim, shipMounts } from '../src/shared/ship-equipment';
import { hullContact, localToWorld, shipProfile } from '../src/shared/ship-geometry';
import { headingDifference, hullFits } from '../src/shared/ship-navigation';
import { shipMotionLimits } from '../src/shared/ship-handling';
import { coursePerformance } from '../src/shared/ship-wind';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../src/shared/sim';
import { seconds, SIM_TICKS_PER_SECOND } from '../src/shared/time';
import { windAt } from '../src/shared/wind-field';
import type { ShipEquipmentKind, Unit, UnitKind } from '../src/shared/types';

type Game = ReturnType<typeof createGame>;
type Point = { x: number; y: number };
type Fixture = { game: Game; focus: Unit; ships: Unit[]; target?: Unit; goal?: Point; corners?: Point[]; beforeStep?: (tick: number) => void };
export type CombatScene = { id: string; label: string; duration: number; category: 'combat' | 'course' | 'upwind'; setup: () => Fixture };

function sea(direction = Math.PI / 2, channel = false) {
  const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [], teams: { player: 'blue', enemy: 'red' } });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 8192, height: 8192, wind: { direction, speed: 80 },
    terrain: { cols: 256, rows: 256, cell: 32, cells: Array.from({ length: 256 * 256 }, (_, i) => !channel || Math.floor(i / 256) >= 101 && Math.floor(i / 256) < 150 ? '~' : '.').join('') } };
  return game;
}

function ship(game: Game, kind: UnitKind, x: number, y: number, owner = 'player', heading = 0) {
  const unit = game.spawnUnit(owner, kind, x, y); unit.sailing!.heading = heading;
  // Combat uses ordinary HP, fittings, cooldown and component damage. No
  // invulnerability, damage reset or artificial target position updates.
  return unit;
}
function move(game: Game, unit: Unit, point: Point, queued = false) {
  issuePlayerCommand(game, unit.owner, { type: 'move', unitIds: [unit.id], ...point, queued, avoidCombat: true });
}
function attack(game: Game, unit: Unit, target: Unit) {
  issuePlayerCommand(game, unit.owner, { type: 'attack', unitIds: [unit.id], targetId: target.id });
}
function battery(game: Game, unit: Unit) {
  for (const mount of shipMounts(unit).filter(mount => mount.id !== 'bow')) game.items.push({
    id: `battery-${unit.id}-${mount.id}`, kind: 'shipCannon', shipId: unit.id, mountId: mount.id,
    x: unit.x, y: unit.y, durability: SHIP_WEAPONS.shipCannon.hp, cooldownRemaining: 0,
  });
  rebuildShipFittings(game, unit);
}

export const combatScenes: CombatScene[] = [];
for (const close of [false, true]) combatScenes.push({ id: `bow-mutual-${close ? 'close' : 'far'}`, label: `Bow cannons, mutual attack from ${close ? 450 : 1400} units`, category: 'combat', duration: 90, setup: () => {
  const game = sea(), focus = ship(game, 'warship', 2600, 4000), target = ship(game, 'warship', close ? 3050 : 4000, 4000, 'enemy', Math.PI);
  attack(game, focus, target); attack(game, target, focus); return { game, focus, target, ships: [focus, target] };
} });
for (const mode of ['crossing', 'parallel', 'upwind', 'battery-crossing', 'battery-beam', 'mortar-crossing', 'mortar-close', 'flame-crossing'] as const) {
  combatScenes.push({ id: mode, label: mode, category: 'combat', duration: 90, setup: () => {
    const game = sea(mode === 'upwind' ? Math.PI : Math.PI / 2);
    const focus = ship(game, mode.startsWith('mortar') ? 'bombardShip' : mode.startsWith('flame') ? 'fireShip' : 'warship', 2600, 4000);
    if (mode.startsWith('battery')) battery(game, focus);
    const crossing = mode.includes('crossing'), beam = mode === 'battery-beam', close = mode === 'mortar-close';
    const target = ship(game, 'transport', close ? 2840 : beam ? 2600 : crossing ? 3400 : 3100, close ? 4000 : beam ? 4330 : crossing ? 3400 : 4150, 'enemy', crossing ? Math.PI / 2 : 0);
    if (!beam && !close) move(game, target, crossing ? { x: 3400, y: 7100 } : { x: 7200, y: 4150 });
    attack(game, focus, target); return { game, focus, target, ships: [focus, target] };
  } });
}
combatScenes.push({ id: 'moving-crew', label: 'Attack a walking deck gunner on a moving ship', category: 'combat', duration: 90, setup: () => {
  const game = sea(), focus = ship(game, 'warship', 2600, 4000), target = ship(game, 'transport', 3300, 4100, 'enemy');
  const crew = game.spawnUnit('enemy', 'archer', target.x, target.y); boardUnit(target, crew, game.units);
  move(game, target, { x: 7200, y: 4100 }); attack(game, focus, crew);
  return { game, focus, target: crew, ships: [focus, target], beforeStep: tick => {
    if (crew.hp > 0 && crew.deck && tick % seconds(4) === 0) issuePlayerCommand(game, 'enemy', { type: 'move', unitIds: [crew.id], ...localToWorld(target, { x: Math.floor(tick / seconds(4)) % 2 ? -40 : 40, y: 10 }), avoidCombat: true });
  } };
} });
combatScenes.push({ id: 'channel-three-v-three', label: 'Three versus three in a confined sea lane', category: 'combat', duration: 100, setup: () => {
  const game = sea(Math.PI / 2, true), allies = [0, 1, 2].map(i => ship(game, i === 2 ? 'bombardShip' : 'warship', 2400 - i * 120, 3580 + i * 330));
  const enemies = [0, 1, 2].map(i => ship(game, i === 2 ? 'fireShip' : 'warship', 4100 + i * 120, 3580 + i * 330, 'enemy', Math.PI));
  for (let i = 0; i < 3; i++) { attack(game, allies[i]!, enemies[i]!); attack(game, enemies[i]!, allies[i]!); }
  return { game, focus: allies[0]!, target: enemies[0]!, ships: [...allies, ...enemies] };
} });
for (const running of [false, true]) for (const degrees of [90, 180]) for (const distance of [700, 2200]) combatScenes.push({
  id: `${running ? 'cruise' : 'rest'}-${degrees}-${distance}`, label: `${running ? 'Cruising' : 'Stationary'}  ${degrees}° turn, ${distance} units`, category: 'course', duration: 200, setup: () => {
    const game = sea(0), focus = ship(game, 'warship', 4000, 4000);
    if (running) { move(game, focus, { x: 7200, y: 4000 }); for (let i = 0; i < seconds(8); i++) stepGame(game); }
    // A crosswind for the final leg separates helm geometry from the upwind tests.
    game.map.wind = { direction: degrees === 90 ? 0 : Math.PI / 2, speed: 80 };
    const angle = degrees * Math.PI / 180, goal = { x: focus.x + distance * Math.cos(angle), y: focus.y + distance * Math.sin(angle) };
    move(game, focus, goal); return { game, focus, ships: [focus], goal };
  },
});
for (const kind of ['cutter', 'transport', 'warship'] as const) for (const distance of [700, 1500]) combatScenes.push({
  id: `upwind-${kind}-${distance}`, label: `${kind}: ${distance} units straight upwind`, category: 'upwind', duration: 240, setup: () => {
    const game = sea(Math.PI), focus = ship(game, kind, 3200, 4000), goal = { x: 3200 + distance, y: 4000 };
    move(game, focus, goal); return { game, focus, ships: [focus], goal };
  },
});
for (const island of [false, true]) combatScenes.push({ id: island ? 'long-island-corner' : 'long-queued-corners', label: island ? 'Long voyage past an island corner' : 'Long voyage through queued right-angle corners', category: 'course', duration: 220, setup: () => {
  const game = sea(Math.PI / 4), focus = ship(game, 'warship', 1800, 4000), goal = { x: 6000, y: island ? 4000 : 5800 };
  if (island) {
    game.map.terrain!.cells = Array.from({ length: 256 * 256 }, (_, i) => i % 256 >= 100 && i % 256 < 120 && Math.floor(i / 256) >= 106 && Math.floor(i / 256) < 145 ? '.' : '~').join('');
    move(game, focus, goal); return { game, focus, ships: [focus], goal, corners: [{ x: 3200, y: 3392 }, { x: 3840, y: 3392 }] };
  }
  const corners = [{ x: 4200, y: 4000 }, { x: 4200, y: 5800 }];
  move(game, focus, corners[0]!); move(game, focus, corners[1]!, true); move(game, focus, goal, true);
  return { game, focus, ships: [focus], goal, corners };
} });

function weaponFrame(game: Game, unit: Unit, fallback?: Unit) {
  const order = unit.order, id = (order.type === 'attack' || order.type === 'attackMove') ? order.targetId : undefined;
  const target = game.units.find(candidate => candidate.id === id && candidate.hp > 0) ?? fallback;
  return installedWeapons(game, unit).map(item => {
    const pose = mountedWeaponPose(unit, item)!, mount = shipMounts(unit).find(mount => mount.id === item.mountId)!, def = SHIP_WEAPONS[item.kind as ShipEquipmentKind];
    const point = target && strikePoint(pose.pivot, target), gap = point ? Math.hypot(point.x - pose.pivot.x, point.y - pose.pivot.y) : Infinity;
    const live = unit.hp > 0 && (item.durability ?? 1) > 0 && target !== undefined && target.hp > 0;
    const inRange = live && gap <= def.range && gap >= (def.weapon.minRange ?? 0), inArc = live && !!point && shipGunCanAim(unit, item, point);
    return { id: item.id, kind: item.kind, mountId: item.mountId, ...pose, bearing: mount.bearing, halfArc: mount.halfArc, range: def.range, minRange: def.weapon.minRange ?? 0,
      cooldown: item.cooldownRemaining, durability: item.durability, aim: item.aim ? { ...item.aim } : undefined,
      targetId: target?.id, targetPoint: point ? { x: point.x, y: point.y } : undefined,
      inRange, inArc, ready: live && item.cooldownRemaining <= 1 && (item.mountId !== 'bow' || unit.cooldown <= 1),
      aimReady: !!point && !!item.aim && Math.hypot(item.aim.x - point.x, item.aim.y - point.y) < 1, fired: false };
  });
}

export function runCombatScene(scene: CombatScene, recordFrames = true) {
  const { game, focus, ships, target, goal, corners, beforeStep } = scene.setup();
  const initialSnapshot = snapshotGame(game), startTick = game.tick, origin = { x: focus.x, y: focus.y }, wind = windAt(game.map, focus);
  const initialGoalGap = goal ? Math.hypot(goal.x - focus.x, goal.y - focus.y) : 0;
  const frames: unknown[] = [], routeEvents: unknown[] = [], events: unknown[] = [], routes = new Map<string, string>();
  const seenEffects = new Set(game.effects.map(effect => effect.id));
  const metrics = { arrived: false, duration: 0, firstShot: null as number | null, firstDamage: null as number | null, shots: 0, teamShots: 0, teamHits: 0, teamDamage: 0,
    readyInArcNoShotSeconds: 0, aimReadyNoShotSeconds: 0, longestReadyInArcNoShotSeconds: 0, inRangeOutOfArcSeconds: 0, arcLosses: 0,
    totalYawDegrees: 0, rapidTurnReversals: 0, turnSignChanges: 0, stopEpisodes: 0, queuedCornerStops: 0, queuedCornerStopSeconds: 0, travel: 0, pathRatio: 0,
    queuedIdleTicks: 0, queuedPendingStopSeconds: 0, queuedLongestPendingStopSeconds: 0,
    cornerTurnLeadLengths: corners?.map(() => null as number | null) ?? [],
    early20CruiseSeconds: 0, early45UpwindAdvance: 0, early45LongestPendingStopSeconds: 0,
    finalGoalGap: null as number | null, finalTargetGap: null as number | null, upwindVMG: 0, usefulVMG: 0, negativeVMGSeconds: 0, lowSpeedSeconds: 0,
    turnByProgress: Array<number>(10).fill(0), turnWithinShipLengthOfCorner: 0, coastViolations: 0, maxHullOverlap: 0, routeRevisions: 0,
    minHp: focus.hp, sunk: [] as string[], shotsByMount: {} as Record<string, number> };
  let lastSign = 0, turnStarted = 0, turnAngle = 0, moving = false, missedRun = 0, lastArc = false, previousRoute = focus.sailing!.route;
  let earlyStoppedTicks = 0, queuedStoppedTicks = 0;
  const cornerIncomingEstablished = corners?.map(() => false) ?? [];
  const hullLength = shipProfile(focus)!.length, maximumSpeed = shipMotionLimits(focus).speed;
  const routeObjects = new Map(ships.map(unit => [unit.id, unit.sailing!.route])), routeRevisions = new Map(ships.map(unit => [unit.id, 0]));
  for (const unit of ships) if (!hullFits(game.map, unit)) throw new Error(`${scene.id}: ${unit.id} starts on land`);
  for (let a = 0; a < ships.length; a++) for (let b = a + 1; b < ships.length; b++) if ((hullContact(ships[a]!, ships[b]!)?.overlap ?? 0) > .1) throw new Error(`${scene.id}: initial hull overlap`);
  for (let tick = 0; tick < seconds(scene.duration); tick++) {
    beforeStep?.(tick);
    const posesBefore = new Map(ships.map(unit => [unit.id, { x: unit.x, y: unit.y, heading: unit.sailing!.heading }]));
    const previous = posesBefore.get(focus.id)!;
    const gunsBefore = new Map(ships.map(unit => [unit.id, weaponFrame(game, unit, unit === focus ? target : undefined)]));
    stepGame(game);
    const elapsed = (game.tick - startTick) / SIM_TICKS_PER_SECOND;
    const dx = focus.x - previous.x, dy = focus.y - previous.y, distance = Math.hypot(dx, dy), yaw = headingDifference(previous.heading, focus.sailing!.heading);
    metrics.travel += distance; metrics.totalYawDegrees += Math.abs(yaw) * 180 / Math.PI;
    const sign = Math.abs(yaw) * SIM_TICKS_PER_SECOND > .01 ? Math.sign(yaw) : 0;
    if (sign && lastSign && sign !== lastSign) { metrics.turnSignChanges++; if (tick - turnStarted < seconds(2) && Math.abs(turnAngle) > Math.PI / 120) metrics.rapidTurnReversals++; turnStarted = tick; turnAngle = 0; }
    if (sign) lastSign = sign; turnAngle += yaw;
    const nowMoving = distance * SIM_TICKS_PER_SECOND > 1;
    const journeyPending = goal ? Math.hypot(goal.x - focus.x, goal.y - focus.y) > 1 : focus.order.type !== 'idle';
    if (!nowMoving && moving && journeyPending) {
      metrics.stopEpisodes++;
      if (corners && focus.order.type === 'idle') metrics.queuedCornerStops++;
    }
    if (!nowMoving && corners && focus.order.type === 'idle' && journeyPending) metrics.queuedCornerStopSeconds += 1 / SIM_TICKS_PER_SECOND;
    // Measure the beginning of an order separately from eventual arrival.
    // A pursuit may legitimately never catch a faster target, but its ship
    // should establish useful sailing and keep moving when the target recedes.
    if (elapsed <= 20 && distance * SIM_TICKS_PER_SECOND > maximumSpeed * .5) metrics.early20CruiseSeconds += 1 / SIM_TICKS_PER_SECOND;
    if (elapsed <= 45) {
      metrics.early45UpwindAdvance = (focus.x - origin.x) * Math.cos(wind.from) + (focus.y - origin.y) * Math.sin(wind.from);
      earlyStoppedTicks = !nowMoving && journeyPending ? earlyStoppedTicks + 1 : 0;
      metrics.early45LongestPendingStopSeconds = Math.max(metrics.early45LongestPendingStopSeconds, earlyStoppedTicks / SIM_TICKS_PER_SECOND);
    }
    if (scene.id === 'long-queued-corners') {
      const queuePending = (focus.orderQueue?.length ?? 0) > 0;
      if (queuePending && focus.order.type === 'idle') metrics.queuedIdleTicks++;
      queuedStoppedTicks = queuePending && !nowMoving ? queuedStoppedTicks + 1 : 0;
      if (queuedStoppedTicks) metrics.queuedPendingStopSeconds += 1 / SIM_TICKS_PER_SECOND;
      metrics.queuedLongestPendingStopSeconds = Math.max(metrics.queuedLongestPendingStopSeconds, queuedStoppedTicks / SIM_TICKS_PER_SECOND);
      const cornerIndex = corners!.length - (focus.orderQueue?.length ?? 0);
      const corner = corners![cornerIndex], incomingOrigin = cornerIndex > 0 ? corners![cornerIndex - 1]! : origin;
      if (corner && focus.order.type === 'move' && focus.order.x === corner.x && focus.order.y === corner.y
        && metrics.cornerTurnLeadLengths[cornerIndex] === null) {
        const incoming = Math.atan2(corner.y - incomingOrigin.y, corner.x - incomingOrigin.x);
        const deviation = Math.abs(headingDifference(incoming, focus.sailing!.heading));
        if (deviation < Math.PI / 90) cornerIncomingEstablished[cornerIndex] = true;
        // First establish the incoming leg. Otherwise a late departure turn
        // at the previous mark could look like an early turn at the next one.
        if (cornerIncomingEstablished[cornerIndex] && deviation >= Math.PI / 18) {
          metrics.cornerTurnLeadLengths[cornerIndex] = ((corner.x - focus.x) * Math.cos(incoming) + (corner.y - focus.y) * Math.sin(incoming)) / hullLength;
        }
      }
    }
    moving = nowMoving;
    if (focus.hp > 0 && !hullFits(game.map, focus)) metrics.coastViolations++;
    for (let a = 0; a < ships.length; a++) for (let b = a + 1; b < ships.length; b++) if (ships[a]!.hp > 0 && ships[b]!.hp > 0) metrics.maxHullOverlap = Math.max(metrics.maxHullOverlap, hullContact(ships[a]!, ships[b]!)?.overlap ?? 0);
    if (focus.sailing!.route !== previousRoute) { if (focus.sailing!.route) metrics.routeRevisions++; previousRoute = focus.sailing!.route; }
    if (goal) {
      const gap = Math.hypot(goal.x - focus.x, goal.y - focus.y), progress = 1 - gap / initialGoalGap;
      metrics.turnByProgress[Math.min(9, Math.max(0, Math.floor(progress * 10)))]! += Math.abs(yaw) * 180 / Math.PI;
      const vmg = (dx * (goal.x - previous.x) + dy * (goal.y - previous.y)) / Math.max(1, Math.hypot(goal.x - previous.x, goal.y - previous.y)) * SIM_TICKS_PER_SECOND;
      if (vmg < -1) metrics.negativeVMGSeconds += 1 / SIM_TICKS_PER_SECOND;
      if (distance * SIM_TICKS_PER_SECOND < coursePerformance(focus, game.map).maxForwardSpeed * .25) metrics.lowSpeedSeconds += 1 / SIM_TICKS_PER_SECOND;
    }
    if (corners?.some(point => Math.hypot(point.x - focus.x, point.y - focus.y) < shipProfile(focus)!.length)) metrics.turnWithinShipLengthOfCorner += Math.abs(yaw) * 180 / Math.PI;
    const newEffects = game.effects.filter(effect => !seenEffects.has(effect.id));
    for (const effect of newEffects) {
      seenEffects.add(effect.id);
      if (effect.type === 'hit' || effect.type === 'muzzleFlash' || effect.type === 'grapeshot') {
        if (recordFrames) events.push({ tick: game.tick, ...effect });
        const victim = game.units.find(unit => unit.id === effect.unitId) ?? ships.find(unit => unit.id === effect.unitId) ?? (target?.id === effect.unitId ? target : undefined);
        if (effect.type === 'hit' && victim && victim.owner !== focus.owner && (effect.damage ?? 0) > 0) { metrics.teamHits++; metrics.teamDamage += effect.damage!; metrics.firstDamage ??= elapsed; }
      }
    }
    const frameShips = ships.map(unit => {
      const weapons = weaponFrame(game, unit, unit === focus ? target : undefined), before = gunsBefore.get(unit.id)!;
      for (const gun of weapons) {
        const old = before.find(item => item.id === gun.id);
        gun.fired = !!old && gun.cooldown > old.cooldown;
        if (gun.fired && unit.owner === focus.owner) metrics.teamShots++;
        if (gun.fired && unit === focus) { metrics.shots++; metrics.firstShot ??= elapsed; metrics.shotsByMount[gun.mountId!] = (metrics.shotsByMount[gun.mountId!] ?? 0) + 1; }
      }
      if (unit === focus) {
        const ready = weapons.filter(gun => gun.ready && gun.inRange && gun.inArc), missed = ready.length > 0 && !weapons.some(gun => gun.fired);
        if (missed) { metrics.readyInArcNoShotSeconds += 1 / SIM_TICKS_PER_SECOND; missedRun++; if (ready.some(gun => gun.aimReady)) metrics.aimReadyNoShotSeconds += 1 / SIM_TICKS_PER_SECOND; } else missedRun = 0;
        metrics.longestReadyInArcNoShotSeconds = Math.max(metrics.longestReadyInArcNoShotSeconds, missedRun / SIM_TICKS_PER_SECOND);
        const anyRange = weapons.some(gun => gun.inRange), anyArc = weapons.some(gun => gun.inRange && gun.inArc);
        if (anyRange && !anyArc) metrics.inRangeOutOfArcSeconds += 1 / SIM_TICKS_PER_SECOND;
        if (lastArc && anyRange && !anyArc) metrics.arcLosses++;
        lastArc = anyArc;
      }
      const route = unit.sailing!.route, signature = route ? JSON.stringify(route.points) : '';
      if (route !== routeObjects.get(unit.id)) { routeObjects.set(unit.id, route); if (route) routeRevisions.set(unit.id, routeRevisions.get(unit.id)! + 1); }
      if (signature !== routes.get(unit.id)) { routes.set(unit.id, signature); if (recordFrames) routeEvents.push({ tick: game.tick, id: unit.id, route: route ? structuredClone(route) : null }); }
      const oldPose = posesBefore.get(unit.id)!, surge = ((unit.x - oldPose.x) * Math.cos(unit.sailing!.heading) + (unit.y - oldPose.y) * Math.sin(unit.sailing!.heading)) * SIM_TICKS_PER_SECOND;
      return { id: unit.id, x: unit.x, y: unit.y, heading: unit.sailing!.heading, speed: unit.sailing!.speed, yaw: headingDifference(oldPose.heading, unit.sailing!.heading), surge,
        velocityX: unit.sailing!.velocityX, velocityY: unit.sailing!.velocityY, sail: unit.sailing!.sail ? { ...unit.sailing!.sail } : undefined,
        mode: unit.sailing!.sail?.mode, order: unit.order.type, orderQueue: unit.orderQueue ? structuredClone(unit.orderQueue) : [], pursuit: unit.sailing!.pursuit ? structuredClone(unit.sailing!.pursuit) : undefined,
        nextPoint: route?.points[0] ? structuredClone(route.points[0]) : undefined, routePoints: route?.points.length ?? 0,
        routeGoal: route ? { x: route.goalX, y: route.goalY } : undefined, routeRevision: routeRevisions.get(unit.id), cruise: route?.cruise,
        hp: unit.hp, owner: unit.owner, parts: unit.shipParts ? { ...unit.shipParts } : undefined, weapons };
    });
    if (recordFrames && tick % 2 === 0) frames.push({ tick: game.tick, ships: frameShips, projectiles: game.projectiles.map(projectile => ({ ...projectile })) });
    metrics.minHp = Math.min(metrics.minHp, focus.hp);
    if (goal && focus.order.type === 'idle' && Math.hypot(goal.x - focus.x, goal.y - focus.y) < 1) { metrics.arrived = true; break; }
    if (scene.category === 'combat' && (!ships.some(unit => unit.owner === 'player' && unit.hp > 0) || !ships.some(unit => unit.owner === 'enemy' && unit.hp > 0))) break;
  }
  metrics.duration = (game.tick - startTick) / SIM_TICKS_PER_SECOND;
  metrics.finalGoalGap = goal ? Math.hypot(goal.x - focus.x, goal.y - focus.y) : null;
  metrics.finalTargetGap = target ? Math.hypot(target.x - focus.x, target.y - focus.y) : null;
  metrics.pathRatio = initialGoalGap ? metrics.travel / initialGoalGap : 0;
  metrics.usefulVMG = initialGoalGap ? (initialGoalGap - metrics.finalGoalGap!) / metrics.duration : 0;
  metrics.upwindVMG = ((focus.x - origin.x) * Math.cos(wind.from) + (focus.y - origin.y) * Math.sin(wind.from)) / metrics.duration;
  metrics.sunk = ships.filter(unit => unit.hp <= 0).map(unit => unit.id);
  return { id: scene.id, label: scene.label, category: scene.category, focusId: focus.id, targetId: target?.id, goal, corners,
    map: game.map, hulls: ships.map(unit => ({ id: unit.id, kind: unit.kind, profile: shipProfile(unit) })), initialSnapshot, frames, routeEvents, events, metrics };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argument = (key: string) => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
  const only = argument('--only')?.split(','), output = resolve(argument('--out') ?? 'work/ship-combat-review.json');
  const scenes = combatScenes.filter(scene => !only || only.some(filter => scene.id.includes(filter))).map(scene => {
    const trace = runCombatScene(scene); process.stdout.write(`${scene.id} ${JSON.stringify(trace.metrics)}\n`); return trace;
  });
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify({ schema: 2, ticksPerSecond: SIM_TICKS_PER_SECOND, scenes }));
  process.stdout.write(`Wrote ${scenes.length} scenarios to ${output}\n`);
}
