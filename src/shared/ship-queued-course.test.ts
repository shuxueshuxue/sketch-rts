import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { headingDifference, hullFits } from './ship-navigation';
import { hullContact, shipProfile } from './ship-geometry';
import { followQueuedShipCourse } from './ship-queued-course';
import { shipMotionLimits } from './ship-handling';
import { seconds } from './time';
import type { UnitKind, UnitOrder } from './types';

function scene(kind: UnitKind = 'transport') {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  game.scriptedVictory = true;
  game.map = { ...game.map, width: 8000, height: 6000, wind: { direction: Math.PI / 4, speed: 80 },
    terrain: { cell: 100, cols: 80, rows: 60, cells: '~'.repeat(4800) } };
  const boat = game.spawnUnit('player', kind, 1500, 1500);
  boat.sailing!.heading = 0;
  for (const [index, point] of [{ x: 3000, y: 1500 }, { x: 3000, y: 3000 }, { x: 4500, y: 3000 }].entries())
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [boat.id], ...point, avoidCombat: true, queued: index > 0 });
  return { game, boat };
}

describe('continuous queued ship moves', () => {
  it.each(['cutter', 'transport', 'warship', 'carrier', 'bombardShip', 'fireShip'] as const)('%s rounds two queued corners without an intermediate idle or speed reset', kind => {
    const { game, boat } = scene(kind), maximum = shipMotionLimits(boat).speed, length = shipProfile(boat)!.length;
    let handoffs = 0, priorOrder = boat.order, cruising = false;
    let totalYaw = 0, travel = 0, firstTurnX: number | undefined, secondTurnY: number | undefined;
    for (let tick = 0; tick < seconds(220) && boat.order.type !== 'idle'; tick++) {
      const before = { x: boat.x, y: boat.y, heading: boat.sailing!.heading };
      stepGame(game);
      totalYaw += Math.abs(headingDifference(before.heading, boat.sailing!.heading));
      travel += Math.hypot(boat.x - before.x, boat.y - before.y);
      if (handoffs === 0 && boat.sailing!.heading > .05) firstTurnX ??= boat.x;
      if (handoffs === 1 && boat.sailing!.heading < Math.PI / 2 - .05) secondTurnY ??= boat.y;
      cruising ||= boat.sailing!.speed > maximum * .8;
      if (cruising && boat.orderQueue!.length > 0)
        expect(boat.sailing!.speed).toBeGreaterThan(maximum * .2);
      expect(hullFits(game.map, boat)).toBe(true);
      if (boat.order !== priorOrder) {
        if (boat.order.type === 'move') {
          handoffs++;
          expect(boat.sailing!.speed).toBeGreaterThan(maximum * .2);
          expect(boat.sailing!.route!.goalX).toBe(boat.order.x);
          expect(boat.sailing!.route!.goalY).toBe(boat.order.y);
          const tangent = handoffs === 1 ? Math.PI / 2 : 0;
          expect(Math.abs(headingDifference(tangent, boat.sailing!.heading))).toBeLessThan(.08);
        } else {
          expect(boat.order.type).toBe('idle');
          expect(boat.orderQueue).toHaveLength(0);
          expect(Math.hypot(boat.x - 4500, boat.y - 3000)).toBeLessThan(1);
        }
        priorOrder = boat.order;
      }
    }
    expect(handoffs).toBe(2);
    // Both bends begin before the requested intersection and finish on the
    // outgoing tangent. A late large vertex turn or a full orbit fails here.
    expect(3000 - firstTurnX!).toBeGreaterThan(length * .4);
    expect(3000 - secondTurnY!).toBeGreaterThan(length * .4);
    expect(totalYaw).toBeLessThan(Math.PI + .6);
    expect(travel).toBeLessThan(4500);
    expect(boat.order.type).toBe('idle');
    expect(Math.hypot(boat.x - 4500, boat.y - 3000)).toBeLessThan(1);
  });

  it('passes three collinear move marks at cruising speed', () => {
    const { game, boat } = scene();
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [boat.id], x: 2500, y: 1500, avoidCombat: true });
    for (const x of [3500, 4500])
      issuePlayerCommand(game, 'player', { type: 'move', unitIds: [boat.id], x, y: 1500, avoidCombat: true, queued: true });
    let handoffs = 0, previous = boat.order;
    for (let tick = 0; tick < seconds(80) && (boat.order as UnitOrder).type !== 'idle'; tick++) {
      stepGame(game);
      expect(Math.abs(headingDifference(0, boat.sailing!.heading))).toBeLessThan(.001);
      if (boat.order !== previous && boat.order.type === 'move') {
        handoffs++;
        expect(boat.sailing!.speed).toBeGreaterThan(shipMotionLimits(boat).speed * .8);
      }
      previous = boat.order;
    }
    expect(handoffs).toBe(2); expect(boat.order.type).toBe('idle');
    expect(Math.hypot(boat.x - 4500, boat.y - 1500)).toBeLessThan(1);
  });

  it.each(['cutter', 'transport', 'warship', 'carrier', 'bombardShip', 'fireShip'] as const)('%s joins its queued bends after an oblique departure', kind => {
    const { game, boat } = scene(kind);
    boat.sailing!.heading = Math.PI / 2;
    for (const [index, point] of [{ x: 2200, y: 1500 }, { x: 2200, y: 2200 }, { x: 2900, y: 2200 }].entries())
      issuePlayerCommand(game, 'player', { type: 'move', unitIds: [boat.id], ...point, avoidCombat: true, queued: index > 0 });
    let handoffs = 0, previous = boat.order, totalYaw = 0;
    for (let tick = 0; tick < seconds(80) && (boat.order as UnitOrder).type !== 'idle'; tick++) {
      const heading = boat.sailing!.heading;
      stepGame(game);
      totalYaw += Math.abs(headingDifference(heading, boat.sailing!.heading));
      expect(hullFits(game.map, boat)).toBe(true);
      if (boat.order !== previous) {
        if (boat.order.type === 'move') {
          handoffs++;
          expect(boat.sailing!.speed).toBeGreaterThan(shipMotionLimits(boat).speed * .2);
        } else expect(boat.orderQueue).toHaveLength(0);
        previous = boat.order;
      }
    }
    expect(handoffs).toBe(2); expect(boat.order.type).toBe('idle');
    expect(totalYaw).toBeLessThan(Math.PI * 2 + .1);
    expect(Math.hypot(boat.x - 2900, boat.y - 2200)).toBeLessThan(1);
  });

  it('preserves each queued move while yielding to a live crossing hull', () => {
    const { game, boat } = scene(), other = game.spawnUnit('player', 'cutter', 2925, 2500);
    other.sailing!.heading = -Math.PI / 2;
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [other.id], x: 2925, y: 900, avoidCombat: true });
    const activated: {x:number;y:number}[] = [];
    let previous = boat.order, intermediateIdles = 0, avoidanceTicks = 0;
    for (let tick = 0; tick < seconds(100); tick++) {
      stepGame(game);
      expect(hullContact(boat, other)?.overlap ?? 0).toBeLessThan(.1);
      expect(hullFits(game.map, boat)).toBe(true); expect(hullFits(game.map, other)).toBe(true);
      if (boat.sailing!.route?.avoidHeading !== undefined) avoidanceTicks++;
      if (boat.order !== previous) {
        if (boat.order.type === 'move') activated.push({ x: boat.order.x, y: boat.order.y });
        else if (boat.order.type === 'idle' && boat.orderQueue!.length) intermediateIdles++;
        previous = boat.order;
      }
      if (boat.order.type === 'idle' && other.order.type === 'idle') break;
    }
    expect(avoidanceTicks).toBeGreaterThan(0);
    // Frozen traffic blocks the prospective outgoing leg until too late to
    // round it. One ordinary arrival boundary is allowed for that crossing;
    // repeated stops or discarded/repeated queue heads are not.
    expect(intermediateIdles).toBeLessThanOrEqual(1);
    expect(activated).toEqual([{ x: 3000, y: 3000 }, { x: 4500, y: 3000 }]);
    expect(boat.order.type).toBe('idle'); expect(other.order.type).toBe('idle');
    expect(boat.orderQueue).toHaveLength(0);
    expect(Math.hypot(boat.x - 4500, boat.y - 3000)).toBeLessThan(1);
  });

  it('preserves the pending corner and consumes its move once after snapshot restoration', () => {
    const { game, boat } = scene();
    for (let tick = 0; tick < seconds(60) && boat.sailing!.heading < .15; tick++) stepGame(game);
    expect(boat.sailing!.route?.queuedX).toBe(3000);
    expect(boat.sailing!.route?.points.some(point => point.queuedTurn)).toBe(true);
    const saved = snapshotGame(game), resumed = scene().game;
    restoreSnapshotIntoGame(resumed, saved, game.nextId);
    expect(resumed.units[0]!.sailing!.route!.points).not.toBe(boat.sailing!.route!.points);
    for (let tick = 0; tick < seconds(130); tick++) {
      stepGame(game); stepGame(resumed);
      if (tick % 20 === 0) expect(checksumGame(resumed)).toBe(checksumGame(game));
    }
    expect(boat.order.type).toBe('idle');
    expect(boat.orderQueue).toHaveLength(0);
    expect(checksumGame(resumed)).toBe(checksumGame(game));
  });

  it.each([
    ['arrival heading', { type: 'move', x: 3000, y: 3000, heading: Math.PI / 2 }],
    ['boarding rendezvous', { type: 'move', x: 3000, y: 3000, rendezvousFor: 'crew' }],
    ['deck destination', { type: 'move', x: 3000, y: 3000, deckShipId: 'other' }],
    ['combat policy change', { type: 'move', x: 3000, y: 3000 }],
    ['hold action', { type: 'hold', x: 3000, y: 1500 }],
    ['unload action', { type: 'unload', x: 3000, y: 1500 }],
  ] as const)('keeps a %s boundary instead of consuming later moves', (_label, next) => {
    const { game, boat } = scene();
    boat.orderQueue![0] = next as UnitOrder;
    const queue = boat.orderQueue!.slice(), order = boat.order;
    expect(followQueuedShipCourse(boat, game.map, game.units, 1)).toBe(false);
    expect(boat.order).toBe(order);
    expect(boat.orderQueue).toEqual(queue);
    expect(boat.sailing!.route?.queuedX).toBeUndefined();
  });

  it('keeps an exact current heading and an upwind incoming leg under ordinary navigation', () => {
    const { game, boat } = scene();
    if (boat.order.type !== 'move') throw new Error('expected move');
    boat.order.heading = Math.PI / 2;
    expect(followQueuedShipCourse(boat, game.map, game.units, 1)).toBe(false);
    delete boat.order.heading;
    game.map.wind = { direction: Math.PI, speed: 80 };
    expect(followQueuedShipCourse(boat, game.map, game.units, 1)).toBe(false);
    expect(boat.orderQueue).toHaveLength(2);
  });

  it('reaches a commanded arrival attitude before activating the next move', () => {
    const { game, boat } = scene();
    if (boat.order.type !== 'move') throw new Error('expected move');
    boat.order.heading = Math.PI / 2;
    for (let tick = 0; tick < seconds(80) && (boat.order as UnitOrder).type !== 'idle'; tick++) stepGame(game);
    expect(boat.order.type).toBe('idle');
    expect(boat.orderQueue).toHaveLength(2);
    expect(Math.hypot(boat.x - 3000, boat.y - 1500)).toBeLessThan(1);
    expect(Math.abs(headingDifference(Math.PI / 2, boat.sailing!.heading))).toBeLessThan(1e-7);
    stepGame(game);
    expect(boat.order).toEqual({ type: 'move', x: 3000, y: 3000, avoidCombat: true });
    expect(boat.orderQueue).toHaveLength(1);
  });

  it('invalidates a pending rounded passage when the wind changes, without consuming either order', () => {
    const { game, boat } = scene();
    stepGame(game);
    expect(boat.sailing!.route?.queuedX).toBe(3000);
    const order = boat.order, queue = boat.orderQueue!.slice();
    game.map.wind = { direction: Math.PI, speed: 80 };
    expect(followQueuedShipCourse(boat, game.map, game.units, 1)).toBe(false);
    expect(boat.sailing!.route).toBeUndefined();
    expect(boat.order).toBe(order); expect(boat.orderQueue).toEqual(queue);
    stepGame(game);
    expect(boat.sailing!.route?.points.some(point => point.tack)).toBe(true);
    expect(boat.orderQueue).toEqual(queue);
  });

  it('invalidates the preview if its queue head changes mid-voyage', () => {
    const { game, boat } = scene();
    stepGame(game);
    expect(boat.sailing!.route?.queuedX).toBe(3000);
    const replacement: UnitOrder = { type: 'move', x: 4500, y: 1600, avoidCombat: true };
    boat.orderQueue![0] = replacement;
    expect(followQueuedShipCourse(boat, game.map, game.units, 1)).toBe(false);
    expect(boat.sailing!.route).toBeUndefined();
    expect(boat.orderQueue![0]).toBe(replacement);
  });

  it.each(['current', 'next'] as const)('preserves a %s destination on another hull as an exact contact boundary', which => {
    const { game, boat } = scene();
    const point = which === 'current' ? boat.order : boat.orderQueue![0]!;
    if (point.type !== 'move') throw new Error('expected move');
    game.spawnUnit('player', 'transport', point.x, point.y);
    const queue = boat.orderQueue!.slice();
    expect(followQueuedShipCourse(boat, game.map, game.units, 1)).toBe(false);
    expect(boat.sailing!.route?.queuedX).toBeUndefined();
    expect(boat.orderQueue).toEqual(queue);
  });

  it('checks other hulls over the full future rounded passage', () => {
    const { game, boat } = scene();
    const obstacle = game.spawnUnit('player', 'cutter', 2930, 1560);
    obstacle.sailing!.heading = Math.PI / 2;
    const queue = boat.orderQueue!.slice();
    expect(followQueuedShipCourse(boat, game.map, game.units, 1)).toBe(false);
    expect(hullContact(boat, obstacle)?.overlap ?? 0).toBe(0);
    expect(boat.orderQueue).toEqual(queue);
  });

  it('keeps an immobilized ship and its queued orders stationary', () => {
    const { game, boat } = scene(), order = boat.order, queue = boat.orderQueue!.slice();
    expect(followQueuedShipCourse(boat, game.map, game.units, 0)).toBe(false);
    expect(boat.x).toBe(1500); expect(boat.y).toBe(1500);
    expect(boat.order).toBe(order); expect(boat.orderQueue).toEqual(queue);
  });

  it('rejects a rounded bend when its full swept hull would cut across an island', () => {
    const { game, boat } = scene();
    // The obstacle is inside the geometric shortcut, away from the requested
    // corner's two straight approaches. The ordinary navigator must route it.
    game.map.terrain!.cells = Array.from(game.map.terrain!.cells, (cell, index) => {
      const x = index % 80, y = Math.floor(index / 80);
      return x >= 27 && x <= 29 && y >= 16 && y <= 18 ? '.' : cell;
    }).join('');
    expect(followQueuedShipCourse(boat, game.map, game.units, 1)).toBe(false);
    expect(boat.orderQueue).toHaveLength(2);
  });
});
