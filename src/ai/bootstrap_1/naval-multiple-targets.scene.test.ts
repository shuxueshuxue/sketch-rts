import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { AiPolicyMemory } from '../memory';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import { planAiCommandFrameFromSnapshot } from '../runtime';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapNaval } from './expedition-recovery';
import { navalWant } from '../policy/naval';
import { sameGround, setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { createGame, restoreSnapshotIntoGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { trainingJobs } from '../../shared/building-jobs';

function frame(name: string) {
  const saved = JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as {
    snapshot: GameSnapshot; nextId?: number; memories: Record<string, AiPolicyMemory>; versions: Record<string, BootstrapAiVersion>;
  };
  setBuildingBodies(saved.snapshot.map, standingBodies(saved.snapshot));
  return saved;
}

it.each([
  { tick: 11580, owner: 'enemy', budget: 248.58, yard: 'building-enemy-shipyard-2447' },
  { tick: 9365, owner: 'enemy2', budget: 282, yard: 'building-enemy2-shipyard-3225' },
])('funds the first transport in the unedited elderwood frame at $tick / $owner', ({ tick, owner, budget, yard }) => {
  const saved = frame(`elderwood-ship-admission-${tick}`), { snapshot } = saved;
  const unpaid = snapshot.units.filter(unit => unit.owner === owner && unit.order.type === 'build'
    && unit.order.buildingKind === 'defenseTower').length * 125;
  expect(snapshot.players[owner]!.gold - unpaid).toBeCloseTo(budget, 2);
  const result = planAiCommandFrameFromSnapshot(snapshot, [{ playerId: owner, version: saved.versions[owner]!,
    memory: saved.memories[owner]! }], { teams: snapshot.teams! });
  expect(result.commands.some(entry => entry.command.type === 'train'
    && entry.command.buildingId === yard && entry.command.unitKind === 'transport')).toBe(true);
  const game = createGame('bareDuel', { players: Object.keys(snapshot.players), aiPlayers: [] });
  restoreSnapshotIntoGame(game, snapshot, saved.nextId!);
  issueCommandFrame(game, result.commands);
  expect(trainingJobs(game.buildings.find(building => building.id === yard)!).some(job => job.unitKind === 'transport')).toBe(true);
});

it('funds the unused southeast bay while preserving the real southwest convoy and its engineers', () => {
  const saved = frame('templeSpring-multiple-targets-900'), owner = 'enemy', { snapshot } = saved;
  const memory = saved.memories[owner]!, options = bootstrapPolicyContext(snapshot, owner, saved.versions[owner]!, { memory, teams: snapshot.teams! });
  const live = structuredClone(memory.naval!.ferries);
  const want = navalWant(snapshot, owner, options)!;
  expect(want).toMatchObject({ id: 'naval:transport', expedition: true });
  const command = want.issue(new Set());
  expect(command).toEqual({ type: 'train', buildingId: 'building-enemy-shipyard-7911', unitKind: 'transport' });
  expect(memory.naval!.ferries).toEqual(live);
  const yard = snapshot.buildings.find(building => building.id === 'building-enemy-shipyard-7911')!;
  const southwest = snapshot.units.find(unit => unit.id === 'unit-enemy-transport-2943')!;
  const southeast = memory.naval!.expeditions!.find(plan => plan.mineId === 'gold-gen-9')!;
  expect(sameGround(snapshot.map, southwest, southeast.landing, 'sea')).toBe(false);
  expect(Math.hypot(yard.x - southeast.landing.x, yard.y - southeast.landing.y)).toBeLessThan(1800);
});

it('dispatches the actual empty ring ferry to another island after completing its first colony', () => {
  const saved = frame('ringwater-multiple-targets-900'), owner = 'player-4', { snapshot } = saved;
  const memory = saved.memories[owner]!, options = bootstrapPolicyContext(snapshot, owner, saved.versions[owner]!, { memory, teams: snapshot.teams! });
  const boatId = 'unit-player-4-transport-4770';
  expect(memory.naval!.conquests!['gold-gen-8']!.stage).toBe('complete');
  expect(memory.naval!.ferries?.[boatId]).toBeUndefined();
  planBootstrapNaval(snapshot, owner, options);
  const mission = memory.naval!.ferries?.[boatId];
  expect(mission?.purpose).toBe('advance');
  expect(mission?.targetId).not.toBe('gold-gen-8');
  expect(mission?.phase).toBe('loading');
});
