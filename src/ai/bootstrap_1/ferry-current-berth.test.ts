import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { createBuilding } from '../../shared/map';
import { currentBerthLandings, passengerLandingSpot } from '../../shared/naval';
import { shipPassengers, shipProfile } from '../../shared/ship-geometry';
import { sameGround } from '../../shared/terrain';
import { boardUnit } from '../../shared/decks';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS } from './policy';

function coastalReturn() {
  const game = createGame('bareDuel', { players: ['p0', 'p1'], aiPlayers: [] });
  game.units = []; game.buildings = []; game.resources = []; game.items = []; game.obstacles = [];
  game.scriptedVictory = true;
  game.map = { ...game.map, width: 3200, height: 3200,
    terrain: { cell: 32, cols: 100, rows: 100, cells: Array.from({ length: 10000 }, (_, index) => index % 100 < 40 ? '.' : index % 100 === 40 ? ',' : '~').join('') } };
  game.buildings.push(createBuilding('home', 'p0', 'townHall', 900, 900, true));
  const boat = game.spawnUnit('p0', 'carrier', 1370, 1600);
  boat.sailing!.heading = Math.PI / 2;
  for (let index = 0; index < 4; index++) {
    const passenger = game.spawnUnit('p0', 'archer', boat.x, boat.y);
    expect(boardUnit(boat, passenger, game.units)).toBe(true);
  }
  const memory = createAiPolicyMemory();
  memory.naval = { ferries: { [boat.id]: { purpose: 'assault', phase: 'return', targetId: 'cancelled-target',
    from: { x: 1264, y: 1600 }, to: { x: 2800, y: 1600 }, crewIds: [], sinceTick: 0 } } };
  return { game, boat, memory };
}

it.each(BOOTSTRAP_VERSIONS)('%s lands a returning ferry with portraits while keeping its valid ship goal and mission', version => {
  const { game, boat, memory } = coastalReturn();
  const before = structuredClone(memory.naval!.ferries![boat.id]!);
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory }, { teams: game.teams });
  // Keep the existing return decision and original public helm destination.
  expect(entries).toContainEqual(expect.objectContaining({ scriptId: 'naval', command:
    { type: 'unload', unitIds: [boat.id], ...before.from, avoidCombat: true } }));
  for (const entry of entries) issuePlayerCommand(game, 'p0', entry.command);
  const originalOrder = structuredClone(boat.order);
  const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(game), nextId: game.nextId, memory }));
  const restored = createGame('bareDuel'); restoreSnapshotIntoGame(restored, checkpoint.snapshot, checkpoint.nextId);
  const again = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory }, { teams: game.teams });
  const replay = planAiOwnerCommandEntries(snapshotGame(restored), { playerId: 'p0', version, memory: checkpoint.memory }, { teams: restored.teams });
  expect(replay).toEqual(again); expect(checkpoint.memory).toEqual(memory);
  expect(again.filter(entry => entry.command.type === 'unloadPassenger' && entry.command.transportId === boat.id)).toHaveLength(4);
  expect(again.some(entry => entry.command.type === 'unload' && entry.command.unitIds.includes(boat.id))).toBe(false);
  for (const entry of again) issuePlayerCommand(game, 'p0', entry.command);
  for (const entry of replay) issuePlayerCommand(restored, 'p0', entry.command);
  expect(snapshotGame(restored)).toEqual(snapshotGame(game)); expect(restored.nextId).toBe(game.nextId);
  expect(boat.order).toEqual(originalOrder);
  expect(memory.naval!.ferries![boat.id]).toMatchObject({ phase: before.phase, from: before.from, to: before.to });
});

function manual(suffix = 'static-92400') {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/ferry-manual-${suffix}.json.gz`, import.meta.url))).toString());
  expect(saved.provenance.classification).toContain('Manual public boat-only');
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const boat = game.units.find(unit => unit.id === 'unit-p0-carrier-3510')!;
  return { game, boat, saved };
}

it('uses real sequential portrait landings where the original whole-hull unload keeps turning', () => {
  const original = manual(), candidate = manual(), goal = { x: 2192, y: 6096 };
  const snapshot = snapshotGame(candidate.game), before = JSON.stringify(snapshot), originalOrder = structuredClone(candidate.boat.order);
  const landings = currentBerthLandings(snapshot.map, snapshot.units.find(unit => unit.id === candidate.boat.id)!, goal, snapshot.units);
  expect(landings).toHaveLength(7);
  expect(new Set(landings.map(landing => `${landing.point.x}:${landing.point.y}`)).size).toBe(7);
  expect(JSON.stringify(snapshot)).toBe(before);
  for (const { passengerId, point } of landings) {
    expect(passengerLandingSpot(candidate.game.map, candidate.boat, passengerId, candidate.game.units)).toEqual(point);
    issuePlayerCommand(candidate.game, 'p0', { type: 'unloadPassenger', transportId: candidate.boat.id, passengerId });
    const passenger = candidate.game.units.find(unit => unit.id === passengerId)!;
    expect(passenger.deck).toBeUndefined(); expect(passenger.x).toBe(point.x); expect(passenger.y).toBe(point.y);
    expect(sameGround(candidate.game.map, goal, passenger)).toBe(true);
    expect(candidate.boat.order).toEqual(originalOrder);
  }
  const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(candidate.game), nextId: candidate.game.nextId, memories: candidate.saved.memories }));
  const restored = createGame('bareDuel'); restoreSnapshotIntoGame(restored, checkpoint.snapshot, checkpoint.nextId);
  for (let tick = 0; tick < 45; tick++) { stepGame(original.game); stepGame(candidate.game); stepGame(restored); }
  expect(shipPassengers(original.game.units, original.boat)).toHaveLength(7);
  expect(shipPassengers(candidate.game.units, candidate.boat)).toHaveLength(0);
  expect(snapshotGame(restored)).toEqual(snapshotGame(candidate.game)); expect(restored.nextId).toBe(candidate.game.nextId);
  expect(checkpoint.memories).toEqual(candidate.saved.memories);
  expect(candidate.saved.memories.p0.naval.ferries[candidate.boat.id].phase).toBe('return');
  for (const { passengerId } of landings) expect(candidate.game.units.find(unit => unit.id === passengerId)!.hp)
    .toBe(candidate.saved.snapshot.units.find((unit: { id: string }) => unit.id === passengerId).hp);
});

it('accepts current exposed deck geometry while the stationary hull is turning in place', () => {
  const { game, boat } = manual();
  boat.sailing!.yawRate = .2;
  expect(currentBerthLandings(game.map, boat, { x: 2192, y: 6096 }, game.units)).toHaveLength(7);
});

it.each(['moving-90810', 'partial-90571'] as const)('does not promise landings at the real %s restriction', suffix => {
  const { game, boat } = manual(suffix);
  expect(currentBerthLandings(game.map, boat, { x: 2192, y: 6096 }, game.units)).toEqual([]);
});

it('does not repeat the same failed radius scan for an entire body-blocked deck', () => {
  const { game, boat } = manual('partial-90571');
  // The observed partial batch has ended its hull order. Restore only that
  // explicit unload for this query counterfactual; the real shore bodies stay.
  boat.order = { type: 'unload', x: 2192, y: 6096 };
  const passengers = shipPassengers(game.units, boat);
  expect(passengers).toHaveLength(8); expect(new Set(passengers.map(unit => unit.radius)).size).toBe(1);
  const scans = vi.spyOn(Array.prototype, 'some');
  const bodyScans = () => scans.mock.contexts.filter(array => Array.isArray(array) && array.includes(boat)).length;
  expect(passengerLandingSpot(game.map, boat, passengers[0]!.id, game.units)).toBeUndefined();
  const single = bodyScans();
  expect(single).toBeGreaterThan(0); scans.mockClear();
  expect(currentBerthLandings(game.map, boat, boat.order, game.units)).toEqual([]);
  expect(bodyScans()).toBe(single); scans.mockRestore();
});

it.each(['speed', 'velocity', 'empty', 'wrong-island', 'idle', 'foreign', 'cabin'] as const)
  ('does not scan or emit portrait landings for %s', restriction => {
    const { game, boat } = manual();
    let goal = { x: 2192, y: 6096 };
    if (restriction === 'speed') boat.sailing!.speed = 1;
    else if (restriction === 'velocity') boat.sailing!.velocityX = 1;
    else if (restriction === 'empty') game.units = game.units.filter(unit => !unit.deck || unit.deck.shipId !== boat.id);
    else if (restriction === 'wrong-island') goal = { x: 3760, y: 6480 };
    else if (restriction === 'idle') boat.order = { type: 'idle' };
    else for (const passenger of shipPassengers(game.units, boat)) {
      if (restriction === 'foreign') passenger.owner = 'p1';
      else passenger.cabin = { shipId: boat.id };
    }
    const scans = vi.spyOn(game.units, 'some');
    expect(currentBerthLandings(game.map, boat, goal, game.units)).toEqual([]);
    expect(scans).not.toHaveBeenCalled(); scans.mockRestore();
  });

it.each(BOOTSTRAP_VERSIONS)('%s preserves the real cancelled return instead of copying the manual enemy-shore intention', version => {
  const { game, boat, saved } = manual(), memory = saved.memories.p0;
  const mission = structuredClone(memory.naval.ferries[boat.id]);
  expect(mission.phase).toBe('return');
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory }, { teams: game.teams });
  expect(entries.some(entry => entry.command.type === 'unloadPassenger' && entry.command.transportId === boat.id)).toBe(false);
  expect(entries).toContainEqual(expect.objectContaining({ scriptId: 'naval', command:
    { type: 'unload', unitIds: [boat.id], ...mission.from, avoidCombat: true } }));
  expect(memory.naval.ferries[boat.id]).toMatchObject({ phase: 'return', from: mission.from, to: mission.to });
});


it.each(['coordinates', 'avoidCombat'] as const)('reissues the exact chosen return unload before portraits when %s differ', mismatch => {
  const { game, boat, memory } = coastalReturn(), mission = memory.naval!.ferries![boat.id]!;
  boat.order = { type: 'unload', ...mission.from, avoidCombat: true };
  if (mismatch === 'coordinates') boat.order.x += 1;
  else delete boat.order.avoidCombat;
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  expect(entries).toContainEqual(expect.objectContaining({ scriptId: 'naval', command:
    { type: 'unload', unitIds: [boat.id], ...mission.from, avoidCombat: true } }));
  expect(entries.some(entry => entry.command.type === 'unloadPassenger' && entry.command.transportId === boat.id)).toBe(false);
});

it.each(BOOTSTRAP_VERSIONS)('%s cancels a sailing mission with no target before using its otherwise valid unloading pose', version => {
  const { game, boat, memory } = coastalReturn(), mission = memory.naval!.ferries![boat.id]!;
  mission.phase = 'sailing'; mission.to = { ...mission.from }; mission.from = { x: 2800, y: 1600 };
  boat.order = { type: 'unload', ...mission.to };
  expect(currentBerthLandings(game.map, boat, mission.to, game.units)).toHaveLength(4);
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory }, { teams: game.teams });
  expect(entries.some(entry => entry.command.type === 'unloadPassenger' && entry.command.transportId === boat.id)).toBe(false);
  expect(mission.phase).toBe('return');
  expect(entries).toContainEqual(expect.objectContaining({ scriptId: 'naval', command:
    { type: 'unload', unitIds: [boat.id], ...mission.from, avoidCombat: true } }));
});


it.each(BOOTSTRAP_VERSIONS)('%s keeps a queued transfer between two ferries ahead of ferry portraits', version => {
  const { game, boat, memory } = coastalReturn();
  const passenger = shipPassengers(game.units, boat)[0]!;
  game.units = game.units.filter(unit => !unit.deck || unit.id === passenger.id);
  const target = game.spawnUnit('p0', 'carrier', boat.x + shipProfile(boat)!.beam, boat.y);
  target.sailing!.heading = boat.sailing!.heading;
  memory.naval!.ferries![target.id] = structuredClone(memory.naval!.ferries![boat.id]!);
  boat.order = { type: 'unload', ...memory.naval!.ferries![boat.id]!.from, avoidCombat: true };
  passenger.order = { type: 'hold', x: passenger.x, y: passenger.y };
  passenger.orderQueue = [{ type: 'board', transportId: target.id }];
  expect(currentBerthLandings(game.map, boat, boat.order, game.units)).toHaveLength(1);
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory }, { teams: game.teams });
  expect(entries).toContainEqual(expect.objectContaining({ scriptId: 'naval', command:
    { type: 'board', unitIds: [passenger.id], transportId: target.id } }));
  expect(entries.some(entry => entry.command.type === 'unloadPassenger' && entry.command.transportId === boat.id)).toBe(false);
  for (const entry of entries) issuePlayerCommand(game, 'p0', entry.command);
  // Native boarding owns the source helm. Preserve that operation and its
  // passenger task; a portrait planned from the stale unload would cancel it.
  expect(boat.order.type).toBe('idle');
  expect(passenger.order).toMatchObject({ type: 'board', transportId: target.id });
  expect(passenger.deck?.shipId).toBe(boat.id);
  expect(memory.naval!.ferries![boat.id]!.phase).toBe('return');
});


it('keeps a failed radius result only as the same shadow world gains another landed body', () => {
  const { game, boat } = manual('partial-90571');
  boat.order = { type: 'unload', x: 2192, y: 6096 };
  const passengers = shipPassengers(game.units, boat);
  // Geometry-only counterfactual: a smaller body can use a gap that the
  // original eight equal-radius passengers cannot. No rules are changed.
  passengers[1]!.radius = 8;
  const scans = vi.spyOn(Array.prototype, 'some');
  const bodyScans = () => scans.mock.contexts.filter(array => Array.isArray(array) && array.includes(boat)).length;
  expect(passengerLandingSpot(game.map, boat, passengers[0]!.id, game.units)).toBeUndefined();
  const small = passengerLandingSpot(game.map, boat, passengers[1]!.id, game.units);
  expect(small).toBeDefined();
  const twoRadii = bodyScans(); scans.mockClear();
  expect(currentBerthLandings(game.map, boat, boat.order, game.units)).toEqual([{ passengerId: passengers[1]!.id, point: small }]);
  expect(bodyScans()).toBe(twoRadii); scans.mockRestore();
  // A different real world must be queried anew rather than reusing failure.
  game.units = game.units.filter(unit => unit.deck || unit.kind === 'carrier' || unit.kind === 'warship');
  expect(currentBerthLandings(game.map, boat, boat.order, game.units).some(landing => landing.passengerId === passengers[0]!.id)).toBe(true);
});
