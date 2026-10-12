import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, UNIT_DEFS, resolveVariant, unitRules } from './catalog';
import { resolveUnitDamage } from './damage';
import { DAMAGE_PROFILES as P } from './damage-types';
import { createBuilding } from './map';
import { shipProfile } from './ship-geometry';
import { addWorldEffect, createGame, issuePlayerCommand, removeUnit, restoreSnapshotIntoGame, snapshotGame, spawnVariantUnit, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { passengerDamageMultiplier } from './deck-combat';
import { boardUnit } from './decks';
import { TRANSPORT_COMBAT } from './transport-role';
import type { Building, Unit } from './types';

function battle() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = []; game.resources = []; game.obstacles = [];
  game.projectiles = []; game.effects = []; game.scriptedVictory = true;
  game.map.width = 2000; game.map.height = 1600; delete game.map.terrain;
  return game;
}

function until(game: ReturnType<typeof battle>, done: () => boolean) {
  for (let tick = 0; tick < 160 && !done(); tick++) stepGame(game);
  expect(done()).toBe(true);
}

function attackHull(kind: 'transport' | 'carrier', sourceKind: 'archer' | 'priest' | 'catapult' | 'footman' | 'defenseTower', oldRules = false) {
  const game = battle();
  if (oldRules) game.variants = { old: resolveVariant({ base: kind, rangedDamageTaken: 1, ...(kind === 'carrier' ? { armor: 'heavy' } : {}) }) };
  const hull = oldRules ? spawnVariantUnit(game, 'enemy', 'old', 900, 900) : game.spawnUnit('enemy', kind, 900, 900);
  hull.order = { type: 'hold', x: hull.x, y: hull.y };
  const attacker: Unit | Building = sourceKind === 'defenseTower'
    ? createBuilding('tower', 'player', sourceKind, 900, 1150, true)
    : game.spawnUnit('player', sourceKind, sourceKind === 'catapult' ? 1320 : 900,
      sourceKind === 'footman' ? hull.y + shipProfile(hull)!.beam / 2 + UNIT_DEFS.footman.radius + 10 : 1100);
  if (sourceKind === 'defenseTower') game.buildings.push(attacker as Building);
  else issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [attacker.id], targetId: hull.id });
  let hit: number | undefined;
  game.observer = { hit: (source, target, damage) => { if (source.id === attacker.id && target.id === hull.id && hit === undefined) hit = damage; } };
  if (sourceKind !== 'footman') {
    until(game, () => game.projectiles.some(shot => shot.attackerId === attacker.id));
    const shot = game.projectiles.find(shot => shot.attackerId === attacker.id)!;
    expect(shot.damageProfile).toEqual(sourceKind === 'defenseTower' ? P.TOWER_ARROW : sourceKind === 'priest' ? P.MAGIC_RANGED : sourceKind === 'catapult' ? P.RANGED_BLUNT : P.RANGED_PIERCE);
    // Protection is settled at impact even when the original attacker is gone.
    if (sourceKind === 'defenseTower') game.buildings = [];
    else removeUnit(game, attacker.id);
    game.entityById?.delete(attacker.id);
  }
  const hp = hull.hp;
  until(game, () => hit !== undefined);
  expect(hp - hull.hp).toBeCloseTo(hit!);
  expect(hull.owner).toBe('enemy');
  return hit!;
}

describe('shared troop-ferry combat rules', () => {
  it('keeps the shared role for saved full variant rules that predate these fields without removing authored armor', () => {
    const game = battle(), rules = resolveVariant({ base: 'carrier', armor: 'heavy' });
    delete rules.rangedDamageTaken; delete rules.passengerDamageMultiplier;
    game.variants = { savedFerry: rules };
    const hull = spawnVariantUnit(game, 'player', 'savedFerry', 900, 900), crew = game.spawnUnit('player', 'archer', 900, 900);
    expect(boardUnit(hull, crew, game.units)).toBe(true);
    expect(unitRules(game, hull).armor).toBe('heavy');
    expect(resolveUnitDamage(game, hull, 100, P.RANGED_PIERCE).damage).toBe(50);
    expect(passengerDamageMultiplier(game, crew)).toBe(TRANSPORT_COMBAT.passengerDamageMultiplier);
    delete rules.armor;
    expect(resolveUnitDamage(game, hull, 100, P.RANGED_PIERCE).damage).toBe(70);
    rules.passengerDamageMultiplier = .4;
    expect(passengerDamageMultiplier(game, crew)).toBe(.4);
  });

  it.each(['transport', 'carrier'] as const)('%s protects ordinary arrows, magic, siege and tower shots while taking full melee damage in stepGame', kind => {
    for (const source of ['archer', 'priest', 'catapult', 'defenseTower', 'footman'] as const) {
      const raw = source === 'defenseTower' ? BUILDING_DEFS.defenseTower.attackDamage! : UNIT_DEFS[source].attackDamage;
      const ranged = source !== 'footman';
      const current = attackHull(kind, source);
      expect(current).toBe(ranged ? Math.round(raw * TRANSPORT_COMBAT.rangedDamageTaken) : raw);
      const previous = attackHull(kind, source, true);
      expect(previous).toBe(kind === 'carrier' && ranged ? Math.round(raw * (source === 'defenseTower' ? .7 : .5)) : raw);
    }
  });

  it.each(['transport', 'carrier'] as const)('%s takes full active spell damage through stepGame', kind => {
    const game = battle(), hull = game.spawnUnit('enemy', kind, 900, 900);
    hull.order = { type: 'hold', x: hull.x, y: hull.y };
    addWorldEffect(game, 'storm', hull.x, hull.y, 1, { owner: 'player', damage: 100, damageProfile: P.LIGHTNING, radius: 1, tickEvery: 1 });
    const hp = hull.hp;
    stepGame(game);
    expect(hp - hull.hp).toBe(100);
  });

  it('preserves explicit campaign heavy armor, takes the strongest single ranged defense, and restores an in-flight hit', () => {
    const game = battle();
    game.variants = { armoredFerry: resolveVariant({ base: 'carrier', armor: 'heavy' }) };
    const hull = spawnVariantUnit(game, 'enemy', 'armoredFerry', 900, 900), archer = game.spawnUnit('player', 'archer', 900, 1100);
    hull.order = { type: 'hold', x: hull.x, y: hull.y };
    expect(unitRules(game, hull).armor).toBe('heavy');
    expect(resolveUnitDamage(game, hull, 100, P.RANGED_PIERCE).damage).toBe(50);
    expect(resolveUnitDamage(game, hull, 100, P.TOWER_ARROW).damage).toBe(70);
    expect(resolveUnitDamage(game, hull, 100, P.MELEE_CUT).damage).toBe(100);
    expect(resolveUnitDamage(game, hull, 100, P.LIGHTNING).damage).toBe(100);
    issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [archer.id], targetId: hull.id });
    until(game, () => game.projectiles.length > 0);
    const shot = game.projectiles[0]!;
    removeUnit(game, archer.id);
    const restored = battle(); restoreSnapshotIntoGame(restored, snapshotGame(game), game.nextId);
    restored.scriptedVictory = true;
    expect(unitRules(restored, restored.units[0]!).armor).toBe('heavy');
    const hp = hull.hp;
    while (hull.hp === hp && game.tick < 160) { stepGame(game); stepGame(restored); expect(checksumGame(restored)).toBe(checksumGame(game)); }
    expect(hp - hull.hp).toBe(Math.round(shot.damage * .5));
    // An authored stronger transport-role upgrade also survives the common group.
    game.variants.armoredFerry = resolveVariant({ base: 'carrier', armor: 'heavy', rangedDamageTaken: .4 });
    expect(resolveUnitDamage(game, hull, 100, P.RANGED_PIERCE).damage).toBe(40);
    expect(resolveUnitDamage(game, hull, 100, P.TOWER_ARROW).damage).toBe(40);
  });
});
