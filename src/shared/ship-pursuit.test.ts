import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { strikeGap } from './combat-geometry';
import { boardUnit, deckPlacement, syncDecks } from './decks';
import { interceptTime, shipCanTurnForAttack, shipNavigationTarget, shipPursuitGoal } from './ship-pursuit';
import { checksumGame } from './sim/checksum';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';

function pair() {
  const ship = createUnit('pursuer', 'player', 'warship', 500, 700);
  const target = createUnit('quarry', 'enemy', 'transport', 1000, 700);
  ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  target.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  const units = [ship, target];
  const place = (gap: number) => { target.x += gap - strikeGap(ship, target); };
  return { ship, target, units, place };
}

function scene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = []; game.resources = []; game.scriptedVictory = true;
  game.map.width = 2400; game.map.height = 2000;
  game.map.terrain = { cell: 40, cols: 60, rows: 50, cells: '~'.repeat(3000) };
  game.map.wind = { direction: Math.PI / 2, speed: 80 };
  return game;
}

describe('ship tactical pursuit', () => {
  it('leads a crossing target and bounds predictions for an escaping faster ship', () => {
    expect(interceptTime(100, 0, 0, 30, 50)).toBeCloseTo(2.5);
    expect(interceptTime(100, 0, 70, 0, 50)).toBeGreaterThan(0);
    expect(interceptTime(10000, 0, 70, 0, 50)).toBe(6);
    expect(interceptTime(0, 0, 0, 0, 0)).toBe(0);
    const { ship, target, units } = pair();
    target.sailing!.velocityY = 40;
    const goal = shipPursuitGoal(ship, target, units, 312)!;
    expect(goal.y).toBeGreaterThan(target.y);
    expect(goal.intent).toBe('pursuit');
    expect(goal).not.toHaveProperty('heading');
  });

  it('keeps the carrying hull as the navigation target when gunnery changes crew', () => {
    const { ship, target, units } = pair();
    const a = createUnit('crew-a', 'enemy', 'footman', target.x, target.y);
    const b = createUnit('crew-b', 'enemy', 'archer', target.x, target.y);
    units.push(a, b); boardUnit(target, a, units); boardUnit(target, b, units); syncDecks(units);
    expect(shipNavigationTarget(a, units)).toBe(target);
    const first = shipPursuitGoal(ship, a, units, 312)!;
    target.sailing!.heading += .4; syncDecks(units);
    const next = shipPursuitGoal(ship, b, units, 312)!;
    expect(first.targetId).toBe(target.id); expect(next.targetId).toBe(target.id);
    expect(ship.sailing!.pursuit!.targetId).toBe(target.id);
  });

  it('holds engagement across the firing boundary and resumes only outside its wider band', () => {
    const { ship, target, units, place } = pair();
    place(240); expect(shipPursuitGoal(ship, target, units, 312)).toBeUndefined();
    expect(shipCanTurnForAttack(ship)).toBe(true);
    for (const gap of [309, 316, 310, 318, 311]) {
      place(gap); expect(shipPursuitGoal(ship, target, units, 312)).toBeUndefined();
      expect(ship.sailing!.pursuit!.phase).toBe('engage');
    }
    place(340); expect(shipPursuitGoal(ship, target, units, 312)).toBeDefined();
    expect(shipCanTurnForAttack(ship)).toBe(false);
  });

  it('keeps moving targets under navigation control inside weapon range', () => {
    const { ship, target, units, place } = pair(); place(240);
    target.sailing!.velocityX = 20;
    let goal = shipPursuitGoal(ship, target, units, 312)!;
    expect(ship.sailing!.pursuit!.phase).toBe('engage');
    expect(goal.targetSpeed).toBeGreaterThan(0); expect(shipCanTurnForAttack(ship)).toBe(false);
    target.sailing!.velocityX = 2;
    goal = shipPursuitGoal(ship, target, units, 312)!;
    expect(goal.targetSpeed).toBeGreaterThan(0);
    target.sailing!.velocityX = 0; target.order = { type: 'move', x: 1800, y: 700 };
    expect(shipPursuitGoal(ship, target, units, 312)).toBeDefined();
    expect(shipCanTurnForAttack(ship)).toBe(false);
    target.order = { type: 'idle' };
    expect(shipPursuitGoal(ship, target, units, 312)).toBeUndefined();
    expect(shipCanTurnForAttack(ship)).toBe(true);
  });

  it('brakes a stationary engagement before handing hull rotation to gunnery', () => {
    const { ship, target, units, place } = pair(); place(240); ship.sailing!.speed = 30;
    expect(shipPursuitGoal(ship, target, units, 312)!.targetSpeed).toBe(0);
    expect(shipCanTurnForAttack(ship)).toBe(false);
    ship.sailing!.speed = .5;
    expect(shipPursuitGoal(ship, target, units, 312)).toBeUndefined();
    expect(shipCanTurnForAttack(ship)).toBe(true);
  });

  it('keeps a stopped leader’s waiting station fixed when the follower changes bearing', () => {
    const { ship, target, units } = pair(); target.sailing!.heading = Math.PI / 3;
    const first = shipPursuitGoal(ship, target, units, 140, 0, true)!;
    ship.x -= 100; ship.y += 200;
    const next = shipPursuitGoal(ship, target, units, 140, 0, true)!;
    expect(next.x).toBeCloseTo(first.x); expect(next.y).toBeCloseTo(first.y);
    expect(next.targetId).toBe(target.id);
  });

  it('brakes beside a stopped leader in upwind conditions without circling its stand-off point', () => {
    const game = scene(); game.map.wind = { direction: Math.PI, speed: 80 };
    const ship = game.spawnUnit('player', 'warship', 940, 1120), target = game.spawnUnit('player', 'transport', 1200, 1000);
    ship.sailing!.heading = -Math.PI / 2; ship.sailing!.speed = 40;
    ship.sailing!.velocityY = -40; target.order = { type: 'hold', x: target.x, y: target.y };
    issuePlayerCommand(game, 'player', { type: 'follow', unitIds: [ship.id], targetId: target.id });
    for (let i = 0; i < 160; i++) stepGame(game);
    expect(ship.order.type).toBe('follow'); expect(ship.sailing!.speed).toBe(0);
    expect(ship.sailing!.pursuit).toMatchObject({ targetId: target.id, phase: 'engage', moving: false });
    expect(Math.hypot(ship.x - target.x, ship.y - target.y)).toBeGreaterThan(220);
    expect(Math.hypot(ship.x - target.x, ship.y - target.y)).toBeLessThan(310);
    const stopped = { x: ship.x, y: ship.y };
    for (let i = 0; i < 160; i++) stepGame(game);
    expect(ship.x).toBe(stopped.x); expect(ship.y).toBe(stopped.y);
  });

  it('preserves pursuit state independently in snapshots and resumes the same simulation', () => {
    const game = scene(), ship = game.spawnUnit('player', 'warship', 600, 700), target = game.spawnUnit('enemy', 'transport', 1200, 800);
    target.order = { type: 'move', x: 1300, y: 1700, avoidCombat: true };
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: target.id });
    for (let i = 0; i < 40; i++) stepGame(game);
    const snapshot = snapshotGame(game), saved = snapshot.units.find(unit => unit.id === ship.id)!.sailing!.pursuit!;
    expect(saved.targetId).toBe(target.id); expect(saved).not.toBe(ship.sailing!.pursuit);
    const restored = scene(); restoreSnapshotIntoGame(restored, snapshot, game.nextId);
    expect(restored.units.find(unit => unit.id === ship.id)!.sailing!.pursuit).not.toBe(saved);
    for (let i = 0; i < 100; i++) { stepGame(game); stepGame(restored); expect(checksumGame(restored)).toBe(checksumGame(game)); }
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 1000, y: 1000 });
    expect(ship.sailing!.pursuit).toBeUndefined();
  });

  for (const heading of [0, Math.PI / 2]) for (const sideOnly of [false, true]) {
    it(`reaches a firing position for crew on the far deck (heading=${heading}, sideOnly=${sideOnly})`, () => {
      const game = scene(); game.map.wind = { direction: 0, speed: 80 };
      const ship = game.spawnUnit('player', 'warship', 800, 1000), target = game.spawnUnit('enemy', 'carrier', 1200, 1000);
      const crew = game.spawnUnit('enemy', 'footman', target.x, target.y);
      target.hp = target.maxHp = crew.hp = crew.maxHp = 100000;
      boardUnit(target, crew, game.units);
      const at = deckPlacement(target, crew, game.units, { x: 85, y: 25 })!;
      crew.deck = { shipId: target.id, ...at }; syncDecks(game.units);
      crew.order = { type: 'hold', x: crew.x, y: crew.y }; crew.cooldown = 99999;
      target.order = { type: 'hold', x: target.x, y: target.y }; ship.sailing!.heading = heading;
      game.items = game.items.filter(item => item.shipId !== target.id && (!sideOnly || item.shipId !== ship.id));
      if (sideOnly) game.items.push({ id: 'side-gun', kind: 'shipCannon', shipId: ship.id, mountId: 'starboard0', durability: 90, x: ship.x, y: ship.y, cooldownRemaining: 0 });
      issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: target.id });
      let fired = false;
      for (let i = 0; i < 600; i++) {
        stepGame(game);
        if (game.projectiles.some(projectile => projectile.attackerId === ship.id)) fired = true;
      }
      expect(ship.sailing!.pursuit!.targetId).toBe(target.id);
      expect(fired).toBe(true);
    });
  }
});
