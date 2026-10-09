import { describe, expect, it } from 'vitest';
import { boardUnit, syncDecks } from './decks';
import { combatCapability } from './combat-capabilities';
import { installedWeapons } from './ship-equipment';
import { hullFits } from './ship-navigation';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { prepareShipDefenseFrame, SHIP_GUARD_LEASH, SHIP_GUARD_RETURN_RADIUS } from './ship-defense';
import { seconds } from './time';

function sea() {
  const game = createGame('bareDuel', { aiPlayers: [], players: ['player', 'enemy', 'ally'] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.scriptedVictory = true;
  game.map.width = game.map.height = 6000;
  game.map.terrain = { cell: 40, cols: 150, rows: 150, cells: '~'.repeat(22500) };
  game.map.wind = { direction: Math.PI / 2, speed: 80 };
  game.teams = { player: 'friends', ally: 'friends', enemy: 'foes' };
  return game;
}
function hold(unit: ReturnType<typeof sea>['units'][number]) { unit.order = { type: 'hold', x: unit.x, y: unit.y }; }

describe('automatic idle fleet defense', () => {
  it('sails an idle broadside battery to a firing station while its sheltered crew keep their task', () => {
    const game = sea(), ship = game.spawnUnit('player', 'shipOfTheLine', 2000, 2000);
    const target = game.spawnUnit('enemy', 'warship', 2550, 2000); hold(target);
    target.hp = target.maxHp = 10000;
    const crew = game.spawnUnit('player', 'footman', ship.x, ship.y);
    expect(boardUnit(ship, crew, game.units)).toBe(true); syncDecks(game.units);
    crew.cabin = { shipId: ship.id }; crew.order = { type: 'idle' };
    const guns = installedWeapons(game, ship), hp = target.hp;
    let travel = 0, fired = false;
    for (let tick = 0; tick < seconds(25) && target.hp === hp; tick++) {
      const before = { x: ship.x, y: ship.y }; stepGame(game);
      travel += Math.hypot(ship.x - before.x, ship.y - before.y);
      fired ||= guns.some(gun => gun.cooldownRemaining > 0);
      expect(hullFits(game.map, ship)).toBe(true);
    }
    expect(fired).toBe(true); expect(target.hp).toBeLessThan(hp);
    expect(travel).toBeGreaterThan(10);
    expect(ship.order.type).toBe('idle');
    expect(ship.sailing!.defense).toMatchObject({ originX: 2000, originY: 2000, targetId: target.id });
    expect(crew.cabin?.shipId).toBe(ship.id); expect(crew.order.type).toBe('idle');
  });

  it('keeps an acquired hull when another hostile passes slightly nearer', () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 2000, 2000);
    const first = game.spawnUnit('enemy', 'warship', 2450, 2000); hold(first);
    stepGame(game);
    expect(ship.sailing!.defense?.targetId).toBe(first.id);
    const second = game.spawnUnit('enemy', 'warship', 2420, 2170); hold(second);
    for (let tick = 0; tick < seconds(2); tick++) stepGame(game);
    expect(ship.sailing!.defense?.targetId).toBe(first.id);
  });

  it('abandons a faster escaping quarry and returns to its original guard station', () => {
    const game = sea(), ship = game.spawnUnit('player', 'shipOfTheLine', 2000, 2000);
    const target = game.spawnUnit('enemy', 'cutter', 2490, 2000);
    target.hp = target.maxHp = 10000; target.sailing!.heading = 0;
    issuePlayerCommand(game, 'enemy', { type: 'move', unitIds: [target.id], x: 5200, y: 2000, avoidCombat: true });
    let acquired = false, returning = false, farthest = 0;
    for (let tick = 0; tick < seconds(65); tick++) {
      stepGame(game); acquired ||= ship.sailing!.defense?.targetId === target.id;
      returning ||= Boolean(ship.sailing!.defense?.returning);
      farthest = Math.max(farthest, Math.hypot(ship.x - 2000, ship.y - 2000));
    }
    expect(acquired).toBe(true); expect(returning).toBe(true);
    expect(farthest).toBeLessThan(SHIP_GUARD_LEASH + 20);
    expect(Math.hypot(ship.x - 2000, ship.y - 2000)).toBeLessThanOrEqual(SHIP_GUARD_RETURN_RADIUS + 1);
    expect(ship.sailing!.defense?.targetId).toBeUndefined(); expect(ship.order.type).toBe('idle');
  });

  it('does not recruit allies, neutrals, unarmed ferries or cabin passengers into a chase', () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 2000, 2000);
    const ally = game.spawnUnit('ally', 'warship', 2450, 2000); hold(ally);
    const neutral = game.spawnUnit('neutral', 'warship', 2000, 2500); hold(neutral);
    const ferry = game.spawnUnit('player', 'carrier', 3000, 3000);
    const foe = game.spawnUnit('enemy', 'warship', 3450, 3000); hold(foe);
    const passenger = game.spawnUnit('player', 'archer', ferry.x, ferry.y);
    expect(boardUnit(ferry, passenger, game.units)).toBe(true); syncDecks(game.units);
    passenger.cabin = { shipId: ferry.id }; passenger.order = { type: 'idle' };
    for (let tick = 0; tick < seconds(2); tick++) stepGame(game);
    expect(ship.sailing!.defense?.targetId).toBeUndefined();
    expect({ x: ship.x, y: ship.y }).toEqual({ x: 2000, y: 2000 });
    expect(ferry.sailing!.defense).toBeUndefined(); expect(ferry.order.type).toBe('idle');
    expect({ x: ferry.x, y: ferry.y }).toEqual({ x: 3000, y: 3000 });
    expect(passenger.cabin?.shipId).toBe(ferry.id); expect(passenger.order.type).toBe('idle');
  });

  it('preserves a guard station and target through an independent save and restore', () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 2000, 2000);
    const target = game.spawnUnit('enemy', 'warship', 2450, 2000); hold(target);
    for (let tick = 0; tick < seconds(2); tick++) stepGame(game);
    const saved = snapshotGame(game), defense = { ...saved.units.find(unit => unit.id === ship.id)!.sailing!.defense! };
    ship.sailing!.defense!.originX += 100;
    expect(saved.units.find(unit => unit.id === ship.id)!.sailing!.defense).toEqual(defense);
    const restored = sea(); restoreSnapshotIntoGame(restored, saved, game.nextId);
    const copy = restored.units.find(unit => unit.id === ship.id)!;
    stepGame(restored);
    expect(copy.sailing!.defense).toEqual(defense);
    expect(copy.sailing!.defense).not.toBe(saved.units.find(unit => unit.id === ship.id)!.sailing!.defense);
  });

  it('keeps hold stationary and gives explicit movement and boarding priority', () => {
    const game = sea(), ship = game.spawnUnit('player', 'warship', 2000, 2000);
    const target = game.spawnUnit('enemy', 'warship', 2450, 2000); hold(target);
    hold(ship);
    for (let tick = 0; tick < seconds(1); tick++) stepGame(game);
    expect(ship.sailing!.defense).toBeUndefined(); expect({ x: ship.x, y: ship.y }).toEqual({ x: 2000, y: 2000 });
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 2000, y: 3500, avoidCombat: true });
    for (let tick = 0; tick < seconds(1); tick++) stepGame(game);
    expect(ship.order.type).toBe('move'); expect(ship.sailing!.defense).toBeUndefined();
    ship.order = { type: 'idle' };
    const crew = game.spawnUnit('player', 'footman', 1900, 1900); crew.order = { type: 'board', transportId: ship.id };
    let queries = 0;
    const frame = prepareShipDefenseFrame(game, (_ship, _range, visit) => { queries++; visit(target); });
    expect(frame.has(ship.id)).toBe(false); expect(ship.sailing!.defense).toBeUndefined();
    expect(queries).toBe(0);
  });

  it('uses a cutter intrinsic harpoon while retaining its idle order', () => {
    const game = sea(), cutter = game.spawnUnit('player', 'cutter', 2000, 2000);
    const foe = game.spawnUnit('enemy', 'warship', 2300, 2000); hold(foe);
    const hp = foe.hp;
    expect(combatCapability(game, cutter).armed).toBe(true);
    for (let tick = 0; tick < seconds(6); tick++) stepGame(game);
    expect(foe.hp).toBeLessThan(hp); expect(cutter.order.type).toBe('idle');
  });
});
