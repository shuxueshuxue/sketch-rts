import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { bootstrapPolicyContext } from './policy';
import { committedColonyCapital } from './committed-colony-capital';
import { planBootstrapEconomy } from './economy';
import { navalBudgetReserve } from '../policy/naval';

function field(version: 'v9_archer' | 'v9_summoner' | 'v9_knight' = 'v9_knight') {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/knight-committed-colony-30525.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const snapshot = snapshotGame(game);
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory: structuredClone(saved.memories.p0), teams: game.teams });
  return { snapshot, options };
}

it('preserves the real outbound foundation instead of buying two190 knights after the landing', () => {
  const { snapshot, options } = field(), before = JSON.stringify(snapshot);
  expect(snapshot.players.p0!.gold).toBe(453.43);
  expect(navalBudgetReserve(snapshot, 'p0', options)).toBe(0);
  expect(committedColonyCapital(snapshot, 'p0', options)).toBe(400);
  expect(planBootstrapEconomy(snapshot, 'p0', options).filter(c => c.type === 'train' && c.unitKind === 'knight')).toEqual([]);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s releases abandoned or unlaunched commitments', version => {
  const { snapshot, options } = field(version);
  expect(committedColonyCapital(snapshot, 'p0', options)).toBe(400);
  for (const m of Object.values(options.memory.naval!.ferries!)) m.phase = 'return';
  expect(committedColonyCapital(snapshot, 'p0', options)).toBe(0);
  for (const m of Object.values(options.memory.naval!.ferries!)) m.phase = 'loading';
  expect(committedColonyCapital(snapshot, 'p0', options)).toBe(0);
});

it('releases funding when founders are gone, target mines are exhausted, or income has resumed', () => {
  for (const change of ['founders', 'mines', 'income'] as const) {
    const { snapshot, options } = field();
    if (change === 'founders') {
      snapshot.units = snapshot.units.filter(u => u.kind !== 'worker');
      for (const m of Object.values(options.memory.naval!.ferries!)) m.crewIds = [];
    }
    if (change === 'mines') for (const m of Object.values(options.memory.naval!.ferries!)) {
      const mine = snapshot.resources.find(r => r.id === m.targetId); if (mine) mine.amount = 0;
    }
    if (change === 'income') {
      const hall = snapshot.buildings.find(b => b.owner === 'p0' && b.kind === 'townHall')!;
      const mine = snapshot.resources.reduce((a, b) => Math.hypot(a.x-hall.x,a.y-hall.y) < Math.hypot(b.x-hall.x,b.y-hall.y) ? a : b);
      mine.amount = 1000;
    }
    expect(committedColonyCapital(snapshot, 'p0', options)).toBe(0);
  }
});
