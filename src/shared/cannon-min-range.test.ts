import { describe, expect, it } from 'vitest';
import { boardUnit, deckPlacement, syncDecks } from './decks';
import { createUnit } from './map';
import { SHIP_WEAPONS, initializeShipEquipment, installedWeapons, mountedTargetPoint, mountedWeaponPose, rebuildShipFittings, shipGunCanAim } from './ship-equipment';
import { shipProfile } from './ship-geometry';
import { strikePoint } from './combat-geometry';
import { createGame, issuePlayerCommand, stepGame, type Game } from './sim';
import type { Unit, UnitKind } from './types';

function sea() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.obstacles = [];
  game.effects = []; game.projectiles = []; game.scriptedVictory = true;
  game.map = { ...game.map, width: 4096, height: 4096, wind: { direction: Math.PI / 2, speed: 36 }, terrain: { cell: 32, cols: 128, rows: 128, cells: '~'.repeat(128 * 128) } };
  return game;
}
function crew(game: Game, ship: Unit, kind: UnitKind = 'footman') {
  const unit = createUnit(`crew-${game.units.length}-${kind}`, ship.owner, kind, ship.x, ship.y); game.units.push(unit);
  expect(boardUnit(ship, unit, game.units)).toBe(true);
  unit.order = { type: 'hold', x: unit.x, y: unit.y }; return unit;
}
/** Two armed ships of the line abreast, `gap` between their hulls, the enemy's crew on deck. */
function abreast(gap: number) {
  const game = sea();
  const source = game.spawnUnit('player', 'shipOfTheLine', 1500, 1500), target = game.spawnUnit('enemy', 'shipOfTheLine', 1500, 1500);
  source.sailing!.heading = target.sailing!.heading = 0;
  target.y = source.y + shipProfile(source)!.beam + gap;
  for (const ship of [source, target]) { delete ship.fittings; ship.order = { type: 'hold', x: ship.x, y: ship.y }; }
  initializeShipEquipment(game); for (const ship of [source, target]) rebuildShipFittings(game, ship);
  const defenders = [0, 1, 2, 3].map(() => crew(game, target));
  syncDecks(game.units);
  // Only the player's guns fire: the enemy's are cleared.
  game.items = game.items.filter(item => item.shipId !== target.id);
  let crewHits = 0;
  game.observer = { hit(attacker, struck) { if (attacker === source && defenders.some(unit => unit.id === struck.id)) crewHits++; } };
  return { game, source, target, crewHits: () => crewHits };
}

// @@@cannon-min-range
describe('a broadside holds its fire on a deck alongside', () => {
  it('takes the cannon min range from the shared weapon of every ship that carries it', () => {
    expect(SHIP_WEAPONS.shipCannon.weapon.minRange).toBe(125);
    expect(SHIP_WEAPONS.shipMortar.weapon.minRange).toBe(180);
    expect(SHIP_WEAPONS.flameProjector.weapon.minRange).toBeUndefined();
  });

  it('never strikes a crew grappled alongside, at the bridge\'s own span', () => {
    const { game, crewHits } = abreast(16);
    for (let tick = 0; tick < 400; tick++) stepGame(game);
    expect(crewHits()).toBe(0);
  });

  // The ball passes over what lies within the gun's dead zone, so a boarder on the gun's own deck, ahead of it, is safe
  // from it. (A whole hull across the bow no longer fits inside the dead zone of 125: see @@@hull-reach.)
  it('sends its ball over an enemy boarder on its own deck onto the hull beyond', () => {
    const game = sea();
    const ship = game.spawnUnit('player', 'warship', 1500, 1500), far = game.spawnUnit('enemy', 'transport', 1900, 1500);
    ship.sailing!.heading = 0; far.sailing!.heading = Math.PI / 2; far.order = { type: 'hold', x: far.x, y: far.y };
    // Its own (unarmed) crewman holds the ship, so the boarder does not take it.
    crew(game, ship).attackDamage = 0; const near = crew(game, ship); near.owner = 'enemy'; near.attackDamage = 0;
    near.deck = { shipId: ship.id, ...deckPlacement(ship, near, game.units, { x: 85, y: 0 })! }; syncDecks(game.units);
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [ship.id], targetId: far.id });
    ship.order = { type: 'attack', targetId: far.id };
    for (let tick = 0; tick < 200 && far.hp === far.maxHp; tick++) { stepGame(game); ship.x = 1500; ship.y = 1500; ship.sailing!.heading = 0; }
    expect(far.hp).toBeLessThan(far.maxHp);
    expect(near.hp).toBe(near.maxHp);
  });

});

// @@@hull-reach
describe('a gun reckons a ship and everyone on its deck by the whole hull', () => {
  /** Two armed, crewed ships of the line abreast, their nearest guns `gap` from the other hull; both fire. */
  function duel(gap: number) {
    const game = sea();
    const a = game.spawnUnit('player', 'shipOfTheLine', 1500, 1500), b = game.spawnUnit('enemy', 'shipOfTheLine', 1500, 1500);
    a.sailing!.heading = b.sailing!.heading = 0;
    for (const ship of [a, b]) delete ship.fittings;
    initializeShipEquipment(game); for (const ship of [a, b]) rebuildShipFittings(game, ship);
    // `gap` from the nearest gun to the other hull, as the dead zone and the range are reckoned (a broadside's pivots
    // stand inside its own hull's outline).
    b.y = a.y + 1000;
    const nearest = () => Math.min(...[[a, b], [b, a]].flatMap(([ship, other]) => installedWeapons(game, ship!).map(gun => {
      const pivot = mountedWeaponPose(ship!, gun)!.pivot, point = strikePoint(pivot, other!);
      return Math.hypot(point.x - pivot.x, point.y - pivot.y);
    })));
    b.y -= nearest() - gap;
    for (const ship of [a, b]) ship.order = { type: 'hold', x: ship.x, y: ship.y };
    const crews = new Map([a, b].map(ship => [ship.id, [0, 1, 2, 3].map(() => crew(game, ship))]));
    syncDecks(game.units);
    const hits = new Map([[a.id, 0], [b.id, 0]]);
    game.observer = { hit(attacker) { if (hits.has(attacker.id)) hits.set(attacker.id, hits.get(attacker.id)! + 1); } };
    // Each ship holds its pose: a hull turned to bring its guns to bear moves them out of the other's dead zone.
    const poses = [a, b].map(ship => ({ ship, x: ship.x, y: ship.y }));
    const step = () => { stepGame(game); for (const { ship, x, y } of poses) { ship.x = x; ship.y = y; ship.sailing!.heading = 0; } };
    return { game, a, b, crews, hits, step };
  }

  it('takes up neither the hull nor its crew while the hull\'s near side lies 80 off, in the dead zone, either way', () => {
    const { game, a, b, crews, hits, step } = duel(80);
    // The near battery sees the hull inside its dead zone; the far one, a beam farther off, sees it beyond its range.
    for (const [ship, other] of [[a, b], [b, a]] as const) for (const gun of installedWeapons(game, ship)) {
      const pivot = mountedWeaponPose(ship, gun)!.pivot;
      for (const body of [other, ...crews.get(other.id)!]) {
        const point = mountedTargetPoint(game, ship, gun, body);
        expect(point === undefined || Math.hypot(point.x - pivot.x, point.y - pivot.y) > SHIP_WEAPONS.shipCannon.range || !shipGunCanAim(ship, gun, point), `${ship.id} ${gun.mountId} ${body.id}`).toBe(true);
      }
    }
    for (let tick = 0; tick < 400; tick++) step();
    expect([...hits.values()]).toEqual([0, 0]);
  });

  it('lets both broadsides strike the other\'s near side when their guns lie 280 from it', () => {
    const { a, b, hits, step } = duel(280);
    for (let tick = 0; tick < 400 && [...hits.values()].some(count => count === 0); tick++) step();
    expect(hits.get(a.id)).toBeGreaterThan(0);
    expect(hits.get(b.id)).toBeGreaterThan(0);
  });
});

// @@@dead-zone-band
describe('ships of the line under attack orders close into their band and fire', () => {
  it('trades broadsides from 700 apart instead of lying off for good', () => {
    const game = sea();
    const a = game.spawnUnit('player', 'shipOfTheLine', 1800, 1500), b = game.spawnUnit('enemy', 'shipOfTheLine', 2500, 1500);
    a.sailing!.heading = 0; b.sailing!.heading = Math.PI;
    for (const ship of [a, b]) delete ship.fittings;
    initializeShipEquipment(game); for (const ship of [a, b]) rebuildShipFittings(game, ship);
    for (const ship of [a, b]) for (let i = 0; i < 4; i++) crew(game, ship);
    syncDecks(game.units);
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [a.id], targetId: b.id });
    issuePlayerCommand(game, 'enemy', { type: 'attack', unitIds: [b.id], targetId: a.id });
    let shots = 0;
    game.observer = { hit(attacker) { if (attacker === a || attacker === b) shots++; } };
    for (let tick = 0; tick < 40 * 20 && shots < 10; tick++) stepGame(game);
    expect(shots).toBeGreaterThanOrEqual(10);
  });
});

describe('boarders queue over one bridge and all cross', () => {
  function grappled() {
    const game = sea();
    const source = game.spawnUnit('player', 'shipOfTheLine', 1500, 1500), target = game.spawnUnit('enemy', 'shipOfTheLine', 1500, 1500);
    source.sailing!.heading = target.sailing!.heading = 0;
    target.y = source.y + shipProfile(source)!.beam + 12;
    for (const ship of [source, target]) { delete ship.fittings; ship.order = { type: 'hold', x: ship.x, y: ship.y }; }
    const boarders = [0, 1, 2, 3, 4].map(() => crew(game, source));
    syncDecks(game.units);
    issuePlayerCommand(game, 'player', { type: 'boardShip', unitIds: [source.id], targetId: target.id });
    for (let tick = 0; tick < 200 && source.sailing?.gangway?.phase !== 'ready'; tick++) stepGame(game);
    expect(source.sailing?.gangway?.phase).toBe('ready');
    return { game, source, target, boarders };
  }

  it('lets five cross though the first across stands fighting at the entry', () => {
    const { game, source, target, boarders } = grappled();
    // A defender who strikes nobody and cannot fall, standing where boarders head on the quarry's deck (toward its bow):
    // the first boarder across fights it and never settles on its spot, so it keeps its board order.
    const guard = crew(game, target); guard.attackDamage = 0; guard.invulnerable = true;
    guard.deck = { shipId: target.id, x: shipProfile(target)!.length * .3, y: 0 }; syncDecks(game.units);
    issuePlayerCommand(game, 'player', { type: 'board', unitIds: boarders.map(unit => unit.id), transportId: target.id });
    for (let tick = 0; tick < 60 * 20 && !boarders.every(unit => unit.deck?.shipId === target.id); tick++) stepGame(game);
    expect(boarders.filter(unit => unit.deck?.shipId === target.id)).toHaveLength(5);
    expect(source.sailing?.gangway?.phase).toBe('ready');
  });

  it('turns on an enemy who came over onto its own deck before crossing', () => {
    const { game, target, boarders } = grappled();
    const [boarder] = boarders;
    for (const unit of boarders.slice(1)) game.units.splice(game.units.indexOf(unit), 1);
    const intruder = createUnit('intruder', 'enemy', 'footman', boarder!.x, boarder!.y); game.units.push(intruder);
    expect(boardUnit(game.units.find(unit => unit.id === boarder!.deck!.shipId)!, intruder, game.units)).toBe(true);
    intruder.attackDamage = 0; intruder.hp = 20; intruder.order = { type: 'hold', x: intruder.x, y: intruder.y };
    syncDecks(game.units);
    issuePlayerCommand(game, 'player', { type: 'board', unitIds: [boarder!.id], transportId: target.id });
    for (let tick = 0; tick < 30 * 20 && game.units.includes(intruder); tick++) stepGame(game);
    expect(game.units.includes(intruder)).toBe(false);
    for (let tick = 0; tick < 30 * 20 && boarder!.deck?.shipId !== target.id; tick++) stepGame(game);
    expect(boarder!.deck?.shipId).toBe(target.id);
  });
});
