import { describe, expect, it } from 'vitest';
import { createBuilding, createUnit } from '../../shared/map';
import { createGame, snapshotGame } from '../../shared/sim';
import * as policy from './snapshot';
import * as production from '../policy-v2prod/snapshot';

describe('AI selected player view lists', () => {
  it.each([
    { name: 'policy', helpers: policy, fighters: ['fighter'] },
    { name: 'production', helpers: production, fighters: ['fighter', 'deck-fighter', 'boat'] },
  ])('keeps $name ownership, naval treatment and sortable list isolation', ({ helpers, fighters }) => {
    const game = createGame('bareDuel', { aiPlayers: [] });
    game.units = [
      createUnit('worker', 'enemy', 'worker', 900, 500),
      createUnit('fighter', 'enemy', 'footman', 900, 550),
      createUnit('ally', 'friend', 'archer', 700, 500),
      createUnit('deck-fighter', 'enemy', 'footman', 1000, 1000),
      createUnit('boat', 'enemy', 'transport', 1000, 1000),
      createUnit('neutral', 'neutral', 'wildling', 800, 800),
    ];
    game.units[3]!.deck = { shipId: 'boat', x: 0, y: 0 };
    game.buildings = [createBuilding('foe-hall', 'enemy', 'townHall', 1200, 500, true), createBuilding('ally-hall', 'friend', 'townHall', 700, 600, true)];
    const snapshot = snapshotGame(game);
    const teams = { player: 'north', friend: 'north', enemy: 'south' };
    const combat = helpers.enemyCombatUnits(snapshot, 'player', teams);
    expect(combat.map(unit => unit.id)).toEqual(fighters);
    combat.length = 0;
    expect(helpers.enemyCombatUnits(snapshot, 'player', teams).map(unit => unit.id)).toEqual(fighters);
    const enemies = helpers.enemyUnits(snapshot, 'player', teams);
    expect(enemies.map(unit => unit.id)).toEqual(['worker', 'fighter', 'deck-fighter', 'boat']);
    enemies.reverse(); enemies.length = 0;
    expect(helpers.enemyUnits(snapshot, 'player', teams).map(unit => unit.id)).toEqual(['worker', 'fighter', 'deck-fighter', 'boat']);
    const workers = helpers.enemyWorkers(snapshot, 'player', teams);
    expect(workers[0]).toBe(snapshot.units[0]);
    workers.length = 0;
    expect(helpers.enemyWorkers(snapshot, 'player', teams).map(unit => unit.id)).toEqual(['worker']);
    const buildings = helpers.enemyBuildings(snapshot, 'player', teams);
    expect(buildings.map(building => building.id)).toEqual(['foe-hall']);
    buildings.length = 0;
    expect(helpers.enemyBuildings(snapshot, 'player', teams)[0]).toBe(snapshot.buildings[0]);
    const neutral = helpers.neutralUnits(snapshot, 'player');
    expect(neutral.map(unit => unit.id)).toEqual(['neutral']);
    neutral.length = 0;
    expect(helpers.neutralUnits(snapshot, 'player')[0]).toBe(snapshot.units[5]);
  });
});
