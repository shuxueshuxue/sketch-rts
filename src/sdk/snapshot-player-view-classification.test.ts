import { describe, expect, it } from 'vitest';
import { createBuilding, createUnit } from '../shared/map';
import { createGame, snapshotGame } from '../shared/sim';
import { createSnapshotQuery } from './snapshot-query';

function scene() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = [
    createUnit('foe-worker', 'enemy', 'worker', 900, 500),
    createUnit('own-fighter', 'player', 'footman', 500, 500),
    createUnit('neutral', 'neutral', 'wildling', 800, 800),
    createUnit('ally-fighter', 'friend', 'archer', 600, 500),
    createUnit('foe-ship', 'enemy', 'transport', 1000, 1000),
    createUnit('own-worker', 'player', 'worker', 520, 500),
    createUnit('foe-fighter', 'enemy', 'footman', 950, 500),
  ];
  game.units[6]!.hp = 0;
  game.buildings = [
    createBuilding('foe-unfinished', 'enemy', 'barracks', 1200, 500, false),
    createBuilding('own-hall', 'player', 'townHall', 500, 600, true),
    createBuilding('ally-hall', 'friend', 'townHall', 650, 600, true),
    createBuilding('foe-hall', 'enemy', 'townHall', 1300, 600, true),
  ];
  game.items = [
    { id: 'ground', kind: 'guardianScroll', cooldownRemaining: 0, x: 520, y: 500 },
    { id: 'carried', kind: 'lightningRod', cooldownRemaining: 0, x: 500, y: 500, carrierId: 'own-fighter' },
  ];
  const snapshot = snapshotGame(game);
  return { snapshot, teams: { player: 'north', friend: 'north', enemy: 'south' } };
}

const ids = (entities: { id: string }[]) => entities.map(entity => entity.id);

describe('snapshot player view classification', () => {
  it('retains mixed source order, boats, dead units and independent selected arrays', () => {
    const { snapshot, teams } = scene();
    const query = createSnapshotQuery(snapshot, { teams });
    const enemy = query.playerUnits('player', 'enemy');
    const view = query.forPlayer('player');
    expect(ids(enemy)).toEqual(['foe-worker', 'foe-ship', 'foe-fighter']);
    expect(ids(view.own.units)).toEqual(['own-fighter', 'own-worker']);
    expect(ids(view.own.workers)).toEqual(['own-worker']);
    expect(ids(view.allied.units)).toEqual(['ally-fighter']);
    expect(ids(view.enemy.combatUnits)).toEqual(['foe-ship', 'foe-fighter']);
    expect(ids(view.enemy.completeBuildings)).toEqual(['foe-hall']);
    expect(ids(view.neutral.units)).toEqual(['neutral']);
    expect(ids(query.playerUnits('player', 'enemy', 'worker'))).toEqual(['foe-worker']);
    expect(ids(query.playerBuildings('player', 'enemy'))).toEqual(['foe-unfinished', 'foe-hall']);
    expect(ids(query.playerBuildings('player', 'enemy', true))).toEqual(['foe-hall']);
    expect(view.resources.all).toBe(snapshot.resources);
    expect(view.mercenaryCamps.all).toBe(snapshot.mercenaryCamps);
    expect(ids(view.items.ground)).toEqual(['ground']);
    expect(ids(view.items.carried)).toEqual(['carried']);
    enemy.reverse(); enemy.length = 0;
    for (const relation of ['own', 'allied', 'enemy'] as const) {
      for (const field of ['units', 'workers', 'combatUnits', 'buildings', 'completeBuildings'] as const) view[relation][field].length = 0;
    }
    view.neutral.units.length = 0;
    view.items.ground.length = view.items.carried.length = 0;
    expect(ids(query.playerUnits('player', 'enemy'))).toEqual(['foe-worker', 'foe-ship', 'foe-fighter']);
    expect(ids(query.playerUnits('player', 'own', 'combat'))).toEqual(['own-fighter']);
    expect(ids(query.neutralUnitsFor('player'))).toEqual(['neutral']);
    expect(ids(query.forPlayer('player').items.carried)).toEqual(['carried']);
    expect(query.playerUnits('player', 'enemy')[0]).toBe(snapshot.units[0]);
    expect(ids(snapshot.units)).toEqual(['foe-worker', 'own-fighter', 'neutral', 'ally-fighter', 'foe-ship', 'own-worker', 'foe-fighter']);
  });

  it('initializes the full classification on a narrow read while keeping live fields and independent owner caches', () => {
    const { snapshot, teams } = scene();
    const query = createSnapshotQuery(snapshot, { teams });
    query.unitsFor('enemy');
    const worker = snapshot.units[0]!, unfinished = snapshot.buildings[0]!;
    worker.owner = 'friend';
    expect(ids(query.playerUnits('player', 'enemy', 'combat'))).toEqual(['foe-ship', 'foe-fighter']);
    worker.kind = 'footman';
    worker.hp = 17;
    unfinished.complete = true;
    teams.enemy = 'north';
    snapshot.units.push(createUnit('late-foe', 'enemy', 'worker', 1100, 500));
    snapshot.items.push({ id: 'late-ground', kind: 'guardianScroll', cooldownRemaining: 0, x: 500, y: 500 });
    const cached = query.forPlayer('player');
    expect(ids(cached.allied.workers)).toEqual(['foe-worker']);
    expect(cached.allied.workers[0]).toBe(worker);
    expect(cached.allied.workers[0]!.hp).toBe(17);
    expect(cached.allied.workers[0]!.kind).toBe('footman');
    expect(ids(cached.enemy.units)).toEqual(['foe-ship', 'foe-fighter']);
    expect(ids(cached.enemy.completeBuildings)).toEqual(['foe-hall']);
    expect(ids(cached.items.ground)).toEqual(['ground']);
    expect(ids(query.unitsFor('enemy'))).toEqual(['foe-worker', 'foe-ship', 'foe-fighter']);
    const next = createSnapshotQuery(snapshot, { teams }).forPlayer('player');
    expect(next.enemy.units).toEqual([]);
    expect(ids(next.allied.combatUnits)).toEqual(['foe-worker', 'ally-fighter', 'foe-ship', 'foe-fighter']);
    expect(ids(next.allied.workers)).toEqual(['late-foe']);
    expect(ids(next.allied.completeBuildings)).toEqual(['foe-unfinished', 'ally-hall', 'foe-hall']);
    expect(ids(next.items.ground)).toEqual(['ground', 'late-ground']);
  });

  it('skips sparse slots and gives a neutral viewer both its own and neutral memberships', () => {
    const { snapshot, teams } = scene();
    delete snapshot.units[3];
    delete snapshot.buildings[0];
    snapshot.units.length += 2;
    snapshot.buildings.length += 2;
    const query = createSnapshotQuery(snapshot, { teams });
    expect(ids(query.playerUnits('player', 'enemy'))).toEqual(['foe-worker', 'foe-ship', 'foe-fighter']);
    expect(query.forPlayer('player').allied.units).toEqual([]);
    expect(ids(query.playerBuildings('player', 'enemy'))).toEqual(['foe-hall']);
    const neutral = query.forPlayer('neutral');
    expect(ids(neutral.own.units)).toEqual(['neutral']);
    expect(ids(neutral.neutral.units)).toEqual(['neutral']);
    expect(neutral.own.units).not.toBe(neutral.neutral.units);
    expect(neutral.own.units[0]).toBe(neutral.neutral.units[0]);
    neutral.own.units.length = 0;
    expect(ids(query.neutralUnitsFor('neutral'))).toEqual(['neutral']);
  });

  it('retains independent relations for non-reflexive numeric team values', () => {
    const { snapshot } = scene();
    const teams = { player: NaN, friend: NaN, enemy: 'south' } as unknown as Record<string, string>;
    const query = createSnapshotQuery(snapshot, { teams });
    const view = query.forPlayer('player');
    expect(view.team).toBeNaN();
    expect(ids(view.own.units)).toEqual(['own-fighter', 'own-worker']);
    expect(ids(view.enemy.units)).toEqual(['foe-worker', 'own-fighter', 'ally-fighter', 'foe-ship', 'own-worker', 'foe-fighter']);
    expect(view.allied.units).toEqual([]);
    expect(view.enemy.buildings).toContain(view.own.buildings[0]);
    expect(query.playerUnits('player', 'enemy')).toContain(snapshot.units[1]);
    expect(ids(query.neutralUnitsFor('player'))).toEqual(['neutral']);
  });

  it('handles custom owners named like object prototype properties without changing team lookup', () => {
    const { snapshot } = scene();
    snapshot.units = [createUnit('prototype-owner', '__proto__', 'worker', 0, 0), createUnit('constructor-owner', 'constructor', 'footman', 0, 0), createUnit('string-owner', 'toString', 'archer', 0, 0)];
    snapshot.buildings = [];
    const query = createSnapshotQuery(snapshot, { teams: {} });
    const view = query.forPlayer('__proto__');
    expect(view.team).toBe(Object.prototype);
    expect(ids(view.own.workers)).toEqual(['prototype-owner']);
    expect(ids(view.enemy.combatUnits)).toEqual(['constructor-owner', 'string-owner']);
    expect(view.allied.units).toEqual([]);
    expect(ids(query.playerUnits('unassigned', 'enemy'))).toEqual(['prototype-owner', 'constructor-owner', 'string-owner']);
  });
});
