import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { unitMover } from '../../shared/catalog';
import { createGame, issueCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { planCampTravel } from './camp-travel';
import { campNavigationContinuations, routeCampNavigation } from './camp-navigation';
import { neutralCampPointContacts } from '../situation/neutral-camp-contact';

it('keeps a construction action through the actual detour and resumes it only after arrival', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const worker = game.spawnUnit('player', 'worker', 500, 1000); game.spawnUnit('neutral', 'wildling', 1000, 1000);
  const memory = createAiPolicyMemory(), command = { type: 'build' as const, unitId: worker.id, buildingKind: 'farm' as const, x: 1500, y: 1000 };
  let snapshot = snapshotGame(game);
  const first = routeCampNavigation(snapshot, 'player', { memory }, [{ scriptId: 'builder', command }], new Map());
  expect(first.some(entry => entry.command.type === 'move' && entry.command.queued)).toBe(true);
  expect(first.some(entry => entry.command.type === 'build')).toBe(false);
  expect(memory.unitClaims[worker.id]?.campTravel?.command).toEqual(command);
  for (const entry of first) issueCommand(game, entry.command);
  const prior = campNavigationContinuations(memory);
  expect(routeCampNavigation(snapshotGame(game), 'player', { memory }, [], prior)).toEqual([]);
  for (let tick = 0; tick < 1000 && (worker.order.type !== 'idle' || worker.orderQueue?.length); tick++) stepGame(game);
  snapshot = snapshotGame(game);
  const resumed = routeCampNavigation(snapshot, 'player', { memory }, [], campNavigationContinuations(memory));
  expect(resumed).toContainEqual({ scriptId: 'builder', command });
  expect(game.units.find(unit => unit.id === worker.id)?.hp).toBe(worker.maxHp);
});

it('rechecks a stopped real landing party against current camp positions and chooses another station', () => {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/camp-exposure-twoShores-p2-12547.json.gz', import.meta.url))).toString());
  const game = createGame('twoShores', { players: ['p0', 'p1', 'p2', 'p3'], aiPlayers: [] });
  restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId);
  const snapshot = snapshotGame(game), members = snapshot.units.filter(unit => unit.owner === frame.owner && !unit.deck && unit.kind !== 'worker' && unitMover(unit.kind) === 'land');
  // Use the original landing frame; verify a present exposed station, rather than a fabricated distant camp.
  const exposed = members.find(unit => neutralCampPointContacts(snapshot, unit, unit).some(contact => contact.reason !== 'active-pursuit'));
  expect(exposed).toBeDefined();
  if (!exposed) return;
  const plan = planCampTravel(snapshot, exposed, exposed, { parentId: 'island-station', party: members, arrivalRange: 480, valueGoldPerTick: 0 });
  expect(['relocate', 'detour']).toContain(plan.kind);
  expect(neutralCampPointContacts(snapshot, exposed, plan.goal).filter(contact => contact.reason !== 'active-pursuit')).toEqual([]);
});

it('does not mutate the snapshot when applying the shared room navigation boundary to the real assemble frame', () => {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/camp-exposure-veiledHill-p0-2640.json.gz', import.meta.url))).toString());
  const game = createGame('veiledHill', { players: ['p0', 'p1'], aiPlayers: [] }); restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId);
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: frame.owner, version: frame.version, memory: structuredClone(frame.memory) });
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(entries.length).toBeGreaterThan(0);
});

it('preserves a deliberate native attack-move onto a guard while checking transit and staging separately', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const fighter = game.spawnUnit('player', 'footman', 500, 1000), guard = game.spawnUnit('neutral', 'wildling', 1000, 1000);
  const command = { type: 'attackMove' as const, unitIds: [fighter.id], x: guard.x, y: guard.y };
  const entries = [{ scriptId: 'engagement', command }];
  expect(routeCampNavigation(snapshotGame(game), 'player', { memory: createAiPolicyMemory() }, entries, new Map())).toEqual(entries);
});

it('does not resume an earlier navigation goal after a later local escape supersedes its queued order', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const worker = game.spawnUnit('player', 'worker', 500, 1000); game.spawnUnit('neutral', 'wildling', 1000, 1000);
  const memory = createAiPolicyMemory();
  const escape = { type: 'move' as const, unitIds: [worker.id], x: 200, y: 1200, avoidCombat: true };
  const entries = routeCampNavigation(snapshotGame(game), 'player', { memory }, [
    { scriptId: 'builder', command: { type: 'build', unitId: worker.id, buildingKind: 'farm', x: 1500, y: 1000 } },
    { scriptId: 'local-rescue', command: escape },
  ], new Map());
  expect(entries.at(-1)?.command).toEqual(escape);
  expect(memory.unitClaims[worker.id]?.campTravel).toBeUndefined();
  for (const entry of entries) issueCommand(game, entry.command);
  expect(routeCampNavigation(snapshotGame(game), 'player', { memory }, [], campNavigationContinuations(memory))).toEqual([]);
});

it('retains a blocked build while already standing at a safe rally point', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const worker = game.spawnUnit('player', 'worker', 500, 1000); game.spawnUnit('neutral', 'ogreMage', 1000, 1000);
  const memory = createAiPolicyMemory();
  const command = { type: 'build' as const, unitId: worker.id, buildingKind: 'farm' as const, x: 1000, y: 1000 };
  const entries = routeCampNavigation(snapshotGame(game), 'player', { memory }, [{ scriptId: 'builder', command }], new Map());
  expect(entries).toEqual([{ scriptId: 'builder', command: { type: 'holdPosition', unitIds: [worker.id] } }]);
  expect(memory.unitClaims[worker.id]?.campTravel?.command).toEqual(command);
  expect(memory.unitClaims[worker.id]?.campTravel?.subgoal?.status).toBe('blocked');
});

it('issues a relocated hold after arrival so the native guard point is the actual station', () => {
  const game = createGame('bareDuel', { aiPlayers: [] }); game.units = []; game.buildings = []; delete game.map.terrain;
  const archer = game.spawnUnit('player', 'archer', 700, 1000); game.spawnUnit('neutral', 'wildling', 1000, 1000);
  archer.attackRange = 320;
  const memory = createAiPolicyMemory(), ranges = new Map([['station', 60]]);
  const entries = routeCampNavigation(snapshotGame(game), 'player', { memory },
    [{ scriptId: 'station', command: { type: 'holdPosition', unitIds: [archer.id] } }], new Map(), ranges);
  expect(entries.some(entry => entry.command.type === 'move')).toBe(true);
  expect(entries.some(entry => entry.command.type === 'holdPosition')).toBe(false);
  // Another party finishes the blocker during this walk. Isolate the native
  // hold's position binding from further changes in camp pursuit geometry.
  game.units = game.units.filter(unit => unit.owner !== 'neutral');
  for (const entry of entries) issueCommand(game, entry.command);
  for (let tick = 0; tick < 100 && archer.order.type !== 'idle'; tick++) stepGame(game);
  const arrived = { x: archer.x, y: archer.y };
  const resumed = routeCampNavigation(snapshotGame(game), 'player', { memory }, [], campNavigationContinuations(memory), ranges);
  expect(resumed).toContainEqual({ scriptId: 'station', command: { type: 'holdPosition', unitIds: [archer.id] } });
  for (const entry of resumed) issueCommand(game, entry.command);
  expect(archer.order).toMatchObject({ type: 'hold', ...arrived });
  expect(arrived.x).toBeLessThan(700);
});
