import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { planAiOwnerCommandEntries } from '../planner-context';
import { sameGround } from '../../shared/terrain';

const boatId = 'unit-p0-transport-1070';
const versions = ['v9_archer', 'v9_summoner', 'v9_knight'] as const;
function saved() {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/clear-colony-8400.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, fixture.before.snapshot, fixture.before.nextId);
  const memory = structuredClone(fixture.before.memories.p0);
  const target = game.resources.find(resource => resource.id === memory.naval.ferries[boatId].targetId)!;
  const boarders = game.units.filter(unit => unit.order.type === 'board' && unit.order.transportId === boatId);
  return { fixture, game, memory, target, boarders };
}

it.each(versions)('%s sends the loaded settlers to the clear mine without waiting for optional soldiers', version => {
  const { game, memory, boarders } = saved();
  expect(boarders.map(unit => unit.kind).sort()).toEqual(['archer', 'footman']);
  const workers = game.units.filter(unit => unit.deck?.shipId === boatId && unit.kind === 'worker');
  expect(workers).toHaveLength(2);
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory }, { teams: game.teams });
  expect(entries).toContainEqual(expect.objectContaining({ scriptId: 'naval', command: {
    type: 'unload', unitIds: [boatId], ...memory.naval.ferries[boatId].to,
  } }));
  expect(memory.naval.ferries[boatId].phase).toBe('sailing');
  issueCommandFrame(game, entries);
  expect(game.units.find(unit => unit.id === boatId)!.order.type).toBe('unload');
  for (const soldier of boarders) expect(soldier.order.type).not.toBe('board');
  for (const worker of workers) expect(worker.deck?.shipId).toBe(boatId);
});

it.each(versions)('%s does not recruit another escort for an already loaded clear colony', version => {
  const { game, memory, boarders } = saved();
  for (const soldier of boarders) soldier.order = { type: 'idle' };
  memory.naval.ferries[boatId].crewIds = [];
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory }, { teams: game.teams });
  expect(entries.some(entry => entry.command.type === 'board' && entry.command.transportId === boatId)).toBe(false);
  expect(entries.some(entry => entry.command.type === 'unload' && entry.command.unitIds.includes(boatId))).toBe(true);
});

it.each(versions)('%s keeps the escort rendezvous when an armed neutral guards the mine', version => {
  const { game, memory, target, boarders } = saved();
  const guard = game.spawnUnit('neutral', 'ogreWarrior', target.x, target.y + 100);
  expect(sameGround(game.map, guard, target)).toBe(true);
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory }, { teams: game.teams });
  expect(entries.some(entry => entry.command.type === 'unload' && entry.command.unitIds.includes(boatId))).toBe(false);
  expect(entries.some(entry => entry.command.type === 'stop' && entry.command.unitIds.some(id => boarders.some(unit => unit.id === id)))).toBe(false);
  expect(memory.naval.ferries[boatId].phase).toBe('loading');
});

it('the issued colony departure moves the real hull with both engineers still alive', () => {
  const { game, memory } = saved();
  const boat = game.units.find(unit => unit.id === boatId)!;
  const before = { x: boat.x, y: boat.y };
  const workers = game.units.filter(unit => unit.deck?.shipId === boatId && unit.kind === 'worker').map(unit => unit.id);
  const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version: 'v9_archer', memory }, { teams: game.teams });
  issueCommandFrame(game, entries);
  for (let tick = 0; tick < 600; tick++) stepGame(game);
  expect(Math.hypot(boat.x - before.x, boat.y - before.y), JSON.stringify({ before, boat })).toBeGreaterThan(100);
  for (const id of workers) expect(game.units.find(unit => unit.id === id)?.hp).toBeGreaterThan(0);
}, 15000);
