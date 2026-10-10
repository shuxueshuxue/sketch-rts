import { describe, expect, it } from 'vitest';
import { enemyCombatUnitsNear } from '../ai/policy/snapshot';
import { enemyCombatUnitsNear as productionCombatUnitsNear } from '../ai/policy-v2prod/snapshot';
import { createUnit } from '../shared/map';
import { createGame, snapshotGame } from '../shared/sim';
import { createSnapshotQuery } from './snapshot-query';

function scene() {
  const snapshot = snapshotGame(createGame('bareDuel', { aiPlayers: [] }));
  const player = snapshot.players.player;
  snapshot.players = { ...snapshot.players, north: { ...player }, foe: { ...player }, friend: { ...player }, dormant: { ...player } };
  snapshot.units = []; snapshot.buildings = []; snapshot.items = [];
  const teams = { north: 'blue', friend: 'blue', foe: 'red', dormant: 'red' };
  return { snapshot, teams };
}

describe('snapshot query allocation reductions', () => {
  it('keeps player lists fresh, isolated and ordered when opponent queries initialize the private cache first', () => {
    const { snapshot, teams } = scene();
    snapshot.units.push(createUnit('own', 'north', 'worker', 0, 0), createUnit('ally', 'friend', 'footman', 0, 0), createUnit('enemy', 'foe', 'footman', 0, 0));
    const query = createSnapshotQuery(snapshot, { teams });
    const opponents = query.opponentPlayerIds('foe');
    expect(opponents).toEqual(['north', 'friend']);
    opponents.reverse(); opponents.splice(0, opponents.length);
    expect(query.opponentPlayerIds('foe')).toEqual(['north', 'friend']);
    expect(query.opponentPlayerIds('foe')).not.toBe(opponents);
    const active = query.activePlayerIds();
    expect(active).toEqual(['north', 'foe', 'friend']);
    active.reverse(); active.pop();
    expect(query.activePlayerIds()).toEqual(['north', 'foe', 'friend']);
    expect(query.activePlayerIds()).not.toBe(active);
    expect(query.opponentPlayerIds('north')).toEqual(['foe']);
    expect(query.opponentPlayerIds('friend')).toEqual(['foe']);
    expect(query.opponentPlayerIds('foe')).toEqual(['north', 'friend']);
  });

  it('shares ordinary opponent range membership while retaining combat source order, ships, dead units and array isolation', () => {
    const { snapshot, teams } = scene();
    for (let index = 0; index < 96; index += 1) {
      const kind = index % 4 === 0 ? 'worker' : index === 3 ? 'transport' : 'footman';
      const unit = createUnit(`foe-${95 - index}`, 'foe', kind, ((95 - index) % 12) * 64, Math.floor((95 - index) / 12) * 64);
      if (index === 5) unit.hp = 0;
      snapshot.units.push(unit);
    }
    snapshot.units.push(createUnit('own', 'north', 'footman', 0, 0), createUnit('ally', 'friend', 'archer', 0, 0),
      createUnit('neutral', 'neutral', 'wildling', 0, 0), createUnit('nan-foe', 'foe', 'footman', NaN, 0), createUnit('infinite-foe', 'foe', 'footman', Infinity, 0));
    const query = createSnapshotQuery(snapshot, { teams });
    for (const point of [{ x: 0, y: 0 }, { x: 256, y: 256 }, { x: 255.99999999999997, y: 64 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }]) {
      for (const range of [-1, -0, 0, Number.MIN_VALUE, 128, 256, 300, 2000, Infinity, -Infinity, NaN]) {
        const expected = query.opponentUnitsNear('north', point, range).filter(unit => unit.kind !== 'worker');
        const selected = query.opponentCombatUnitsNear('north', point, range);
        expect(selected).toEqual(expected);
        for (let index = 0; index < selected.length; index += 1) expect(selected[index]).toBe(expected[index]);
        selected.reverse(); selected.splice(0, selected.length);
        expect(query.opponentCombatUnitsNear('north', point, range)).toEqual(expected);
        expect(enemyCombatUnitsNear(snapshot, 'north', point, range, teams)).toEqual(expected);
        expect(productionCombatUnitsNear(snapshot, 'north', point, range, teams)).toEqual(expected);
      }
    }
    const all = query.opponentCombatUnitsNear('north', { x: 0, y: 0 }, Infinity);
    expect(all).toContain(snapshot.units.find(unit => unit.kind === 'transport'));
    expect(all).toContain(snapshot.units.find(unit => unit.hp === 0));
    expect(all.some(unit => unit.owner !== 'foe' || unit.kind === 'worker')).toBe(false);
  });

  it('can initialize the combat query before the ordinary query without changing either result', () => {
    const { snapshot, teams } = scene();
    snapshot.units.push(createUnit('worker', 'foe', 'worker', 0, 0), createUnit('fighter', 'foe', 'footman', 3, 4), createUnit('ally', 'friend', 'footman', 0, 0));
    const query = createSnapshotQuery(snapshot, { teams });
    const selected = query.opponentCombatUnitsNear('north', { x: 0, y: 0 }, 5);
    expect(selected.map(unit => unit.id)).toEqual(['fighter']);
    expect(query.opponentUnitsNear('north', { x: 0, y: 0 }, 5).map(unit => unit.id)).toEqual(['worker', 'fighter']);
    selected.push(snapshot.units[0]!);
    expect(query.opponentCombatUnitsNear('north', { x: 0, y: 0 }, 5).map(unit => unit.id)).toEqual(['fighter']);
  });
});
