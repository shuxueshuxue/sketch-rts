import { describe, expect, it } from 'vitest';
import { ABILITY_DEFS, BUILDABLE_BUILDING_KINDS, BUILDING_DEFS, RACE_DEFS, RACE_IDS, RACE_TECH_RULES, TRAINABLE_UNIT_KINDS, UNIT_DEFS, UPGRADE_DEFS, canResearchAt, canTrainAt, requiredSupplyCap, trainableUnitsAt, trainingBuildingFor } from './catalog';
import { isGameCommand } from './command-schema';
import { createBuilding } from './map';
import { createGame, issueCommand, snapshotGame, stepGame } from './sim';
import { checkCommandLegality } from './sim/command-validation';
import type { BuildingKind, RaceId } from './types';

function productionGame(race: RaceId, producer: BuildingKind) {
  const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [], races: { player: race } });
  const building = createBuilding('production-test', 'player', producer, 700, 700, true);
  game.buildings.push(building);
  for (let n = 0; n < 10; n++) game.buildings.push(createBuilding(`farm-${n}`, 'player', 'farm', 500 + n * 64, 1100, true));
  game.players.player!.supplyCap = 68;
  game.players.player!.gold = 5000;
  return { game, building };
}

describe('shared units and race production', () => {
  it('has one combat definition and one ability for each shared caster role', () => {
    expect(UNIT_DEFS.priest).toMatchObject({ hp: 90, cost: 135, abilities: ['heal'] });
    expect(UNIT_DEFS.summoner).toMatchObject({ hp: 95, cost: 180, abilities: ['summon'] });
    for (const removed of ['emberAcolyte', 'pyreCaller']) expect(UNIT_DEFS).not.toHaveProperty(removed);
    for (const removed of ['emberMend', 'cinderSoul']) expect(ABILITY_DEFS).not.toHaveProperty(removed);
    expect(ABILITY_DEFS.summon).toMatchObject({ behavior: 'summon', summonKind: 'spirit' });
    expect(requiredSupplyCap('priest')).toBe(42);
    expect(requiredSupplyCap('summoner')).toBe(42);
    expect(UNIT_DEFS.sparkArcher).toBeDefined();
    expect(UNIT_DEFS.ashHexer.abilities).toEqual(['ashCurse']);
  });

  it('derives all command and building lists from complete production relationships', () => {
    const all = new Set<string>();
    for (const race of RACE_IDS) {
      expect([...RACE_DEFS[race].trainableUnits].sort()).toEqual(Object.keys(RACE_TECH_RULES[race].units).sort());
      for (const kind of RACE_DEFS[race].trainableUnits) {
        all.add(kind);
        const producer = trainingBuildingFor(race, kind)!;
        expect(RACE_DEFS[race].buildableBuildings).toContain(producer);
        expect(trainableUnitsAt(race, producer)).toContain(kind);
        expect(BUILDING_DEFS[producer].trains).toContain(kind);
        expect(isGameCommand({ type: 'train', buildingId: 'test', unitKind: kind })).toBe(true);
      }
    }
    expect([...all].sort()).toEqual([...TRAINABLE_UNIT_KINDS].sort());
    for (const building of BUILDABLE_BUILDING_KINDS) {
      expect(BUILDING_DEFS[building].trains).toEqual(TRAINABLE_UNIT_KINDS.filter(kind => RACE_IDS.some(race => canTrainAt(race, building, kind))));
    }
  });

  it.each(['grove', 'ember'] as const)('%s trains the same casters at its own producer and charges their shared price', race => {
    const producer = race === 'grove' ? 'sanctum' : 'cinderSpire';
    for (const kind of ['priest', 'summoner'] as const) {
      const { game, building } = productionGame(race, producer);
      const command = { type: 'train', buildingId: building.id, unitKind: kind } as const;
      expect(checkCommandLegality(snapshotGame(game), 'player', command)).toBeUndefined();
      const gold = game.players.player!.gold;
      issueCommand(game, command);
      expect(building.queue[0]).toMatchObject({ unitKind: kind, paidGold: UNIT_DEFS[kind].cost });
      expect(game.players.player!.gold).toBe(gold - UNIT_DEFS[kind].cost);
      for (let tick = 0; tick <= UNIT_DEFS[kind].trainTime; tick++) stepGame(game);
      const trained = game.units.find(unit => unit.owner === 'player' && unit.kind === kind);
      expect(trained).toMatchObject({ kind, maxHp: UNIT_DEFS[kind].hp, attackDamage: UNIT_DEFS[kind].attackDamage });
    }
  });

  it.each(['grove', 'ember'] as const)('%s cannot combine a globally valid producer with another race production edge', race => {
    const otherProducer = race === 'grove' ? 'cinderSpire' : 'sanctum';
    const { game, building } = productionGame(race, otherProducer);
    // A scenario can hand the player an otherwise inaccessible building; this must not authorize its production.
    for (const kind of ['priest', 'summoner'] as const) {
      expect(BUILDING_DEFS[otherProducer].trains).toContain(kind);
      expect(RACE_DEFS[race].trainableUnits).toContain(kind);
      expect(canTrainAt(race, otherProducer, kind)).toBe(false);
      const command = { type: 'train', buildingId: building.id, unitKind: kind } as const;
      expect(checkCommandLegality(snapshotGame(game), 'player', command)?.transient).toBe(false);
      expect(() => issueCommand(game, command)).toThrow('cannot train');
    }
    expect(building.queue).toHaveLength(0);
    expect(game.players.player!.gold).toBe(5000);
  });

  it.each(['grove', 'ember'] as const)('%s still needs the existing supply technology bar for shared casters', race => {
    const { game, building } = productionGame(race, trainingBuildingFor(race, 'summoner')!);
    game.players.player!.supplyCap = 41;
    const command = { type: 'train', buildingId: building.id, unitKind: 'summoner' } as const;
    expect(checkCommandLegality(snapshotGame(game), 'player', command)).toEqual({ message: 'Need a supply cap of 42 to train summoner', transient: true });
    expect(() => issueCommand(game, command)).toThrow('Need a supply cap of 42');
  });

  it('shares worker and all seven hulls while preserving distinct workshop rosters', () => {
    for (const race of RACE_IDS) {
      expect(trainingBuildingFor(race, 'worker')).toBe('townHall');
      expect(trainableUnitsAt(race, 'shipyard')).toEqual(['transport', 'warship', 'shipOfTheLine', 'cutter', 'bombardShip', 'fireShip', 'carrier']);
    }
    expect(trainableUnitsAt('grove', 'workshop')).toEqual(['golem', 'ballista']);
    expect(trainableUnitsAt('ember', 'workshop')).toEqual(['siegeRam', 'catapult', 'organGun']);
    expect(trainingBuildingFor('grove', 'spirit')).toBeUndefined();
    expect(isGameCommand({ type: 'train', buildingId: 'test', unitKind: 'pyreCaller' })).toBe(false);
    expect(isGameCommand({ type: 'cast', unitId: 'test', ability: 'cinderSoul' })).toBe(false);
  });
});

describe('research locations from building rules', () => {
  it('derives all research producers from one declaration without losing shared workshop research', () => {
    for (const [upgrade, def] of Object.entries(UPGRADE_DEFS)) {
      expect(def.researchBuildingKinds).toEqual(BUILDABLE_BUILDING_KINDS.filter(building => BUILDING_DEFS[building].researches.some(kind => kind === upgrade)));
    }
    expect(canResearchAt('ember', 'workshop', 'rangeTraining')).toBe(true);
    expect(canResearchAt('ember', 'cinderSpire', 'rangeTraining')).toBe(true);
    expect(canResearchAt('grove', 'workshop', 'rangeTraining')).toBe(true);
    expect(canResearchAt('grove', 'cinderSpire', 'rangeTraining')).toBe(false);
  });

  it.each(['grove', 'ember'] as const)('%s cannot research through another race production building', race => {
    const otherProducer = race === 'grove' ? 'emberForge' : 'barracks';
    const { game, building } = productionGame(race, otherProducer);
    const command = { type: 'research', buildingId: building.id, upgradeKind: 'weaponTraining' } as const;
    expect(checkCommandLegality(snapshotGame(game), 'player', command)?.transient).toBe(false);
    expect(() => issueCommand(game, command)).toThrow('cannot research');
    expect(building.researchQueue).toHaveLength(0);
    expect(game.players.player!.gold).toBe(5000);
  });
});
