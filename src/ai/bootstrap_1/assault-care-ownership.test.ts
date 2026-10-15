import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { shipPassengers } from '../../shared/ship-geometry';
import { sameGround, walkableGoal } from '../../shared/terrain';
import { planAiOwnerCommandEntries } from '../planner-context';
import { coastOnWater } from '../policy/naval';
import { mobileCare } from './mobile-care';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';

const patientId = 'unit-p0-archer-2411', healerId = 'unit-p0-priest-7778', boatId = 'unit-p0-carrier-3824';
function field(withMedic = false) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-stranded-assault-reinforcements.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  // Explicit counterfactual on the real boardable army: one critical soldier,
  // with or without its existing mainland medic, and the ferry requests this island.
  const patient = game.units.find(unit => unit.id === patientId)!, boat = game.units.find(unit => unit.id === boatId)!;
  patient.hp = 20;
  if (!withMedic) game.units = game.units.filter(unit => unit.id !== healerId);
  const memory = saved.memories.p0;
  memory.naval.ferries[boat.id].pickup = coastOnWater(snapshotGame(game), patient, boat);
  return { game, memory, patient };
}

it.each(BOOTSTRAP_VERSIONS)('%s does not recruit a mainland critical-care patient into a new assault', version => {
  const { game, memory } = field(), snapshot = snapshotGame(game), original = JSON.stringify(snapshot);
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory, teams: game.teams });
  expect(mobileCare.claimsUnits!(snapshot, 'p0', options).has(patientId)).toBe(true);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory }, { teams: game.teams });
  const boards = entries.filter(entry => entry.command.type === 'board').flatMap(entry => entry.command.type === 'board' ? entry.command.unitIds : []);
  expect(boards.length).toBeGreaterThan(0);
  expect(boards).not.toContain(patientId);
  expect(memory.naval.ferries[boatId].crewIds).not.toContain(patientId);
  expect(entries.some(entry => entry.scriptId === 'mobileCare' && 'unitIds' in entry.command && entry.command.unitIds.includes(patientId))).toBe(true);
  expect(JSON.stringify(snapshot)).toBe(original);
});

it.each(BOOTSTRAP_VERSIONS)('%s keeps the existing healer with its mainland critical-care patient', version => {
  const { game, memory } = field(true), snapshot = snapshotGame(game);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory }, { teams: game.teams });
  const boards = entries.filter(entry => entry.command.type === 'board').flatMap(entry => entry.command.type === 'board' ? entry.command.unitIds : []);
  expect(boards.length).toBeGreaterThan(0);
  expect(boards).not.toContain(patientId);
  expect(boards).not.toContain(healerId);
  expect(memory.naval.ferries[boatId].crewIds).not.toContain(patientId);
  expect(memory.naval.ferries[boatId].crewIds).not.toContain(healerId);
});

it('keeps an already requested boarding task when its passenger becomes critical', () => {
  const { game, memory, patient } = field();
  patient.order = { type: 'board', transportId: boatId };
  memory.naval.ferries[boatId].crewIds = [patientId];
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory, teams: game.teams });
  expect(mobileCare.claimsUnits!(snapshot, 'p0', options).has(patientId)).toBe(false);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  expect(memory.naval.ferries[boatId].crewIds).toContain(patientId);
  expect(entries.some(entry => entry.scriptId === 'mobileCare' && 'unitIds' in entry.command && entry.command.unitIds.includes(patientId))).toBe(false);
});

it('does not send a new assault pickup to an island containing only a care patient and necessary healer', () => {
  const { game, memory, patient } = field(true);
  // Leave the real other-island armies intact. On this source island the
  // counterfactual battle has left only the patient, its medic and workers.
  game.units = game.units.filter(unit => unit.owner !== 'p0' || unit.kind === 'worker' || unit.deck
    || unit.id === patientId || unit.id === healerId || !sameGround(game.map, unit, patient));
  delete memory.naval.ferries[boatId].pickup;
  const snapshot = snapshotGame(game);
  planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  const pickup = memory.naval.ferries[boatId].pickup;
  if (pickup) expect(sameGround(snapshot.map, walkableGoal(snapshot.map, pickup.x, pickup.y), patient)).toBe(false);
  expect(memory.naval.ferries[boatId].crewIds).not.toContain(patientId);
  expect(memory.naval.ferries[boatId].crewIds).not.toContain(healerId);
});

it('allows an existing evacuation mission to take a critical survivor and its healer', () => {
  const { game, memory, patient } = field(true);
  const boat = game.units.find(unit => unit.id === boatId)!;
  const refuge = game.buildings.find(building => building.owner === 'p0' && building.kind === 'townHall'
    && !sameGround(game.map, building, patient))!;
  // Explicit existing survival transport, not a new assault recruitment.
  const mission = memory.naval.ferries[boatId];
  mission.purpose = 'evacuate'; mission.targetId = refuge.id;
  mission.to = coastOnWater(snapshotGame(game), refuge, boat);
  const snapshot = snapshotGame(game);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  const boards = entries.filter(entry => entry.command.type === 'board' && entry.command.transportId === boatId)
    .flatMap(entry => entry.command.type === 'board' ? entry.command.unitIds : []);
  expect(boards).toContain(patientId);
  expect(boards).toContain(healerId);
});
