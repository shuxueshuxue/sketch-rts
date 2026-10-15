import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { navalBudgetReserve } from '../policy/naval';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapEconomy, rankBootstrapGoals } from './economy';

it('saves the actual ordinary-opening cannon-ship budget after protecting the colony hall', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/naval-saving-ordinary-20715.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', { memory: structuredClone(saved.memories.p0), teams: game.teams });
  const ranked = rankBootstrapGoals(snapshot, 'p0', { ...options, memory: structuredClone(options.memory) });
  expect(ranked[0]).toMatchObject({ id: 'naval:bombardShip', cost: 800, save: true });
  expect(snapshot.players.p0!.gold).toBe(801.83);
  expect(navalBudgetReserve(snapshot, 'p0', options)).toBe(400);
  expect(saved.provenance.originalPurchases.map((entry: { command: { type: string } }) => entry.command.type)).toEqual(['build', 'research']);
  expect(planBootstrapEconomy(snapshot, 'p0', options)).toEqual([]);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('keeps the actual colony hall purchasable while an earlier artillery goal saves the other funds', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/naval-saving-hall-32940.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', {
    memory: structuredClone(saved.memories.p0), teams: game.teams,
  });
  expect(snapshot.players.p0!.gold).toBe(568.51);
  expect(navalBudgetReserve(snapshot, 'p0', options)).toBe(400);
  const commands = planBootstrapEconomy(snapshot, 'p0', options);
  expect(commands).toEqual(saved.provenance.originalEntries.map((entry: { command: unknown }) => entry.command));
  expect(commands).toContainEqual({ type: 'build', unitId: 'unit-p0-worker-3', buildingKind: 'townHall', x: 8208, y: 7120 });
  for (const command of commands) issuePlayerCommand(game, 'p0', command);
  expect(game.units.find(unit => unit.id === 'unit-p0-worker-3')!.order).toMatchObject({ type: 'build', buildingKind: 'townHall' });
  // Native construction pays on founding after the walk, not on issuing it.
  expect(game.players.p0!.gold).toBeCloseTo(453.51);
  for (let tick = 0; tick < 1200; tick++) stepGame(game);
  expect(game.buildings.some(building => building.owner === 'p0' && building.kind === 'townHall'
    && building.x === 8208 && building.y === 7120 && building.complete)).toBe(true);
});
