import { expect, it } from 'vitest';
import { createGame, snapshotGame } from '../../shared/sim';
import { neutralCampPointContacts, neutralCampRouteContacts } from './neutral-camp-contact';
import { neutralCampExposure } from './neutral-camp-exposure';

function scene() {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const walker = game.spawnUnit('player', 'footman', 200, 1000);
  game.spawnUnit('neutral', 'wildling', 1000, 1000);
  return { snapshot: snapshotGame(game), id: walker.id };
}
it('distinguishes walking into an alert radius from stopping in automatic acquisition range', () => {
  const { snapshot, id } = scene(), unit = snapshot.units.find(unit => unit.id === id)!;
  expect(neutralCampRouteContacts(snapshot, unit, [unit, { x: 800, y: 1000 }], { arrivalMode: 'move' })).toEqual([]);
  const idle = neutralCampPointContacts(snapshot, unit, { x: 800, y: 1000 });
  expect(idle.map(contact => contact.reason)).toEqual(['self-acquire']);
  const road = neutralCampRouteContacts(snapshot, unit, [unit, { x: 1300, y: 1000 }], { arrivalMode: 'move' });
  expect(road.some(contact => contact.reason === 'camp-alert' && contact.distance === 0)).toBe(true);
});
it('exempts one explicit target camp without exempting unrelated camps', () => {
  const { snapshot, id } = scene(), unit = snapshot.units.find(unit => unit.id === id)!;
  const facts = neutralCampExposure(snapshot), exemptMemberIds = new Set(facts.camps[0]!.memberIds);
  expect(neutralCampPointContacts(snapshot, unit, { x: 1000, y: 1000 }, { facts, exemptMemberIds })).toEqual([]);
  expect(neutralCampPointContacts(snapshot, unit, { x: 1000, y: 1000 }, { facts })).not.toEqual([]);
});
it('reports bounded active pursuit as a separate possible contact rather than cold-camp exclusion', () => {
  const { snapshot, id } = scene(), unit = snapshot.units.find(unit => unit.id === id)!, guard = snapshot.units.find(unit => unit.owner === 'neutral')!;
  const point = { x: 1300, y: 1000 };
  expect(neutralCampRouteContacts(snapshot, unit, [point, { x: 1310, y: 1000 }], { arrivalMode: 'move' })).toEqual([]);
  guard.order = { type: 'attack', targetId: unit.id, leashX: 1000, leashY: 1000 };
  expect(neutralCampRouteContacts(snapshot, unit, [point, { x: 1310, y: 1000 }], { arrivalMode: 'move', horizonTicks: 100 })
    .some(contact => contact.reason === 'active-pursuit')).toBe(true);
});
