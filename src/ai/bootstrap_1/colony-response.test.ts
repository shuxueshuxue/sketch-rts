import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { bootstrapPolicyContext } from './policy';
import { colonyResponseDefense } from './colony-response';
import { planNavalTacticsWithAssignments } from '../policy/naval';

function field() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/knight-colony-response-30000.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const snapshot = snapshotGame(game);
  const target = snapshot.resources.find(m => m.id === 'gold-mainland-3')!;
  return { saved, snapshot, target, game };
}

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s sees actual reachable responders beyond the empty400 perimeter', version => {
  const { saved, snapshot, target, game } = field(), before = JSON.stringify(snapshot);
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory: structuredClone(saved.memories.p0), teams: game.teams });
  expect(snapshot.units.filter(u => u.owner === 'p2' && u.kind === 'footman' && !u.deck
    && Math.hypot(u.x-target.x,u.y-target.y)<400)).toHaveLength(0);
  expect(colonyResponseDefense(snapshot, 'p0', options, target)).toBeGreaterThan(0);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('does not treat embarked or allied troops as current land responders', () => {
  for (const mode of ['embarked', 'allied'] as const) {
    const { saved, snapshot, target, game } = field();
    if (mode === 'embarked') snapshot.units = snapshot.units.filter(u => u.deck || u.owner === 'p0' || u.owner === 'neutral');
    const teams = mode === 'allied' ? { ...game.teams, p0: 'allied', p1: 'allied', p2: 'allied' } : game.teams;
    const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_knight', { memory: structuredClone(saved.memories.p0), teams });
    expect(colonyResponseDefense(snapshot, 'p0', options, target)).toBe(0);
  }
});

it('does not demand escorts for land troops that cannot arrive during construction', () => {
  const { saved, snapshot, target, game } = field();
  for (const u of snapshot.units) if (u.owner !== 'p0') u.speed = 0.01;
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_knight', { memory: saved.memories.p0, teams: game.teams });
  expect(colonyResponseDefense(snapshot, 'p0', options, target)).toBe(0);
});

it('withdraws the actual unescorted convoy through the native ferry owner while the ordinary perimeter lets it sail', () => {
  for (const response of [false, true]) {
    const { saved, snapshot, game } = field();
    const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_knight', { memory: structuredClone(saved.memories.p0), teams: game.teams });
    const boatId = 'unit-p0-transport-1067';
    expect(options.memory.naval!.ferries![boatId]!.phase).toBe('sailing');
    planNavalTacticsWithAssignments(snapshot, 'p0', options, {
      settlementEscort: 'when-defended', orderCrew: troops => troops, mineEligible: () => true,
      targetAvailable: () => true, transportReady: () => true, troopAvailable: () => true,
      ...(response ? { settlementResponse: target => colonyResponseDefense(snapshot, 'p0', options, target) } : {}),
    });
    expect(options.memory.naval!.ferries![boatId]!.phase).toBe(response ? 'return' : 'sailing');
  }
});
