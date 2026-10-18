import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { sameGround, setBuildingBodies } from '../../shared/terrain';
import { workingWeaponGeometry } from '../../shared/combat-fire-geometry';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS } from './policy';
import { planLandedCombat } from './landed-combat';
import { landedShipFireEscape } from './landed-ship-fire';

function restored() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/landed-ship-fire55800.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const snapshot = snapshotGame(game);
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  const unit = snapshot.units.find(unit => unit.id === 'unit-p0-knight-8083')!;
  const ship = snapshot.units.find(unit => unit.id === 'unit-p2-warship-1107')!;
  return { saved, snapshot, unit, ship, options: { memory: saved.memories.p0, teams: game.teams } };
}

it.each(BOOTSTRAP_VERSIONS)('%s publishes an actual shore escape despite the firing ship being across land connectivity', version => {
  const { snapshot, unit, ship, options } = restored();
  expect(sameGround(snapshot.map, unit, ship)).toBe(false);
  expect(workingWeaponGeometry(snapshot, ship, unit).some(weapon => weapon.covers)).toBe(true);
  const before = JSON.stringify(snapshot);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory: options.memory }, { teams: options.teams });
  const commands = entries.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(unit.id));
  expect(commands).toHaveLength(1);
  expect(commands[0]!.command).toMatchObject({ type: 'move', avoidCombat: true, unitIds: [unit.id] });
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('leaves a reserved patient and a released medic with their recovery owner', () => {
  for (const medical of [false, true]) {
    const { snapshot, unit, options } = restored();
    const commands = planLandedCombat(snapshot, 'p0', options, new Set(medical ? [] : [unit.id]), new Set(medical ? [unit.id] : []));
    // Medical release can publish its own command; it must not receive this shore step.
    const escape = landedShipFireEscape(snapshot, unit, [snapshot.units.find(ship => ship.id === 'unit-p2-warship-1107')!]);
    expect(commands).not.toContainEqual(escape);
  }
});

it('does not turn an allied ship into a hostile shore threat', () => {
  const { snapshot, unit, ship, options } = restored();
  ship.owner = unit.owner;
  expect(planLandedCombat(snapshot, 'p0', options, new Set()).some(command => 'unitIds' in command && command.unitIds.includes(unit.id))).toBe(false);
});

it('preserves a queued order and a unit already in a cabin', () => {
  const { snapshot, unit, ship } = restored();
  unit.orderQueue = [{ type: 'move', x: unit.x, y: unit.y }];
  expect(landedShipFireEscape(snapshot, unit, [ship])).toBeUndefined();
  unit.orderQueue = [];
  unit.cabin = { shipId: ship.id };
  expect(landedShipFireEscape(snapshot, unit, [ship])).toBeUndefined();
});
