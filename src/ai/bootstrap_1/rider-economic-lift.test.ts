import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { boardUnit } from '../../shared/decks';
import { bootstrapPolicyContext, BOOTSTRAP_VERSIONS } from './policy';
import { planRiderCrossing } from './rider-crossing';
import { planBootstrapNaval } from './expedition-recovery';
import { navalServices } from '../policy/naval-services';

const ferryId = 'unit-p0-carrier-3510', riderId = 'unit-p0-horseArcher-5279';
function checkpoint(phase: 'before' | 'after') {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-economic-rider-lift.json.gz', import.meta.url))).toString());
  const saved = fixture[phase], game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  return { game, memory: saved.memory, provenance: fixture.provenance };
}

it.each(BOOTSTRAP_VERSIONS)('%s preserves the real last idle ferry before the 49125 creep assignment', version => {
  const { game, memory, provenance } = checkpoint('before'), snapshot = snapshotGame(game);
  expect(provenance.sourceCommit).toBe('73d6c4a35d8b52b8f8dadbb9b754db5cfe0a3de5');
  expect(provenance.matchedCurrentCandidateAt49200.allPolicyMemoriesMatch).toBe(true);
  expect(snapshot.tick).toBe(49125);
  expect(game.nextId).toBe(6441);
  expect(memory.naval.ferries[ferryId]).toBeUndefined();
  expect(memory.naval.island.plan.mineId).toBe('gold-seat2-main');
  const previous = structuredClone(memory.naval.ferries), original = JSON.stringify(snapshot);
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory, teams: game.teams });
  const serviceIds = navalServices(snapshot, 'p0', options).reserved, previousServices = new Set(serviceIds);
  expect(planRiderCrossing(snapshot, 'p0', options)).toEqual([]);
  expect(serviceIds).toEqual(previousServices);
  expect(memory.naval.ferries).toEqual(previous);
  expect(JSON.stringify(snapshot)).toBe(original);
});

it.each(BOOTSTRAP_VERSIONS)('%s releases the real 49200 preboarding creep with a public stop', version => {
  const { game, memory } = checkpoint('after'), snapshot = snapshotGame(game);
  const previous = structuredClone(memory.naval.ferries);
  expect(snapshot.players.p0!.gold).toBe(407.25);
  expect(snapshot.units.filter(unit => unit.owner === 'p0' && unit.kind === 'worker' && unit.order.type === 'idle')).toHaveLength(22);
  expect(previous[ferryId].purpose).toBe('creep');
  const original = JSON.stringify(snapshot);
  const commands = planRiderCrossing(snapshot, 'p0', bootstrapPolicyContext(snapshot, 'p0', version, { memory, teams: game.teams }));
  expect(commands).toEqual([{ type: 'stop', unitIds: [riderId] }]);
  expect(memory.naval.ferries[ferryId]).toBeUndefined();
  for (const [id, mission] of Object.entries(previous)) if (id !== ferryId) expect(memory.naval.ferries[id]).toEqual(mission);
  expect(JSON.stringify(snapshot)).toBe(original);
  for (const command of commands) issuePlayerCommand(game, 'p0', command);
  stepGame(game);
  expect(game.units.find(unit => unit.id === riderId)!.order.type).toBe('idle');
  expect(game.units.find(unit => unit.id === riderId)!.deck).toBeUndefined();
});

it.each(['rich-income', 'spare-ferry', 'economic-voyage', 'low-cash', 'loaded', 'unloading', 'sailing', 'active-combat', 'damaged'] as const)
('keeps the existing creep when %s', reason => {
  const { game, memory } = checkpoint('after');
  const boat = game.units.find(unit => unit.id === ferryId)!, rider = game.units.find(unit => unit.id === riderId)!;
  if (reason === 'rich-income') game.resources.find(mine => mine.id === 'gold-seat0-main')!.amount = 10000;
  if (reason === 'low-cash') game.players.p0!.gold = 399;
  if (reason === 'spare-ferry') game.spawnUnit('p0', 'carrier', boat.x - 200, boat.y);
  if (reason === 'economic-voyage') {
    const mission = memory.naval.ferries['unit-p0-carrier-3824'];
    mission.phase = 'sailing'; mission.targetId = 'gold-seat2-main';
  }
  if (reason === 'loaded') expect(boardUnit(boat, rider, game.units)).toBe(true);
  if (reason === 'unloading') boat.order = { type: 'unload', ...memory.naval.ferries[ferryId].from };
  if (reason === 'sailing') memory.naval.ferries[ferryId].phase = 'sailing';
  if (reason === 'active-combat') rider.order = { type: 'attackMove', x: 6000, y: 3000 };
  if (reason === 'damaged') boat.hp -= 20;
  const previous = structuredClone(memory.naval.ferries[ferryId]), snapshot = snapshotGame(game);
  const commands = planRiderCrossing(snapshot, 'p0', bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory, teams: game.teams }));
  expect(commands).toEqual([]);
  expect(memory.naval.ferries[ferryId]).toEqual(previous);
});

it.each(['rich-income', 'low-cash', 'economic-voyage', 'spare-ferry'] as const)('still starts optional clearing with %s', reason => {
  const { game, memory } = checkpoint('before'), boat = game.units.find(unit => unit.id === ferryId)!;
  if (reason === 'rich-income') game.resources.find(mine => mine.id === 'gold-seat0-main')!.amount = 10000;
  if (reason === 'low-cash') game.players.p0!.gold = 399;
  if (reason === 'spare-ferry') game.spawnUnit('p0', 'carrier', boat.x - 200, boat.y);
  if (reason === 'economic-voyage') {
    const mission = memory.naval.ferries['unit-p0-carrier-3824'];
    mission.phase = 'sailing'; mission.targetId = 'gold-seat2-main';
  }
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory, teams: game.teams });
  expect(planRiderCrossing(snapshot, 'p0', options)).toEqual([]);
  expect(Object.values(memory.naval.ferries).some((mission: any) => mission.purpose === 'creep')).toBe(true);
});

it.each(BOOTSTRAP_VERSIONS)('%s uses the released ferry for engineers through ordinary command frames', version => {
  const { game, memory } = checkpoint('after');
  let stopped = false, workerBoarding = false, economicMission = false;
  const originalLosses = game.match.stats.unitsLost.p0;
  for (let elapsed = 0; elapsed < 300; elapsed++) {
    if (elapsed % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'p0', version, { memory, teams: game.teams });
      const commands = planBootstrapNaval(snapshot, 'p0', options);
      stopped ||= commands.some(command => command.type === 'stop' && command.unitIds.includes(riderId));
      workerBoarding ||= commands.some(command => command.type === 'board' && command.transportId === ferryId
        && command.unitIds.some(id => snapshot.units.some(unit => unit.id === id && unit.kind === 'worker')));
      economicMission ||= memory.naval.ferries[ferryId]?.purpose === 'settle' && memory.naval.ferries[ferryId]?.targetId === 'gold-seat2-main';
      for (const command of commands) issuePlayerCommand(game, 'p0', command);
    }
    stepGame(game);
  }
  expect(stopped).toBe(true);
  expect(economicMission).toBe(true);
  expect(workerBoarding).toBe(true);
  expect(game.units.find(unit => unit.id === riderId)!.deck?.shipId).not.toBe(ferryId);
  expect(game.match.stats.unitsLost.p0).toBe(originalLosses);
}, 60000);
