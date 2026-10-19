import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../planner-context';
import { runAiGameLoop } from '../game-runner';
import { bootstrapScripts } from './policy';
import { MINING_RALLY_RADIUS } from './mining-rally';

const saved: { snapshot: GameSnapshot; nextId: number; activePlayers: string[]; memories: Record<string, AiPolicyMemory> } =
  JSON.parse(readFileSync(new URL('./fixtures/defense-rally-14m48.json', import.meta.url), 'utf8'));
const subject = 'v9_archer';
const defenders = saved.snapshot.units.filter(unit => unit.owner === subject && unit.kind !== 'worker'
  && !['priest', 'summoner', 'witch', 'ashHexer', 'fieldMedic'].includes(unit.kind)
  && unit.id !== 'unit-v9_archer-sparkArcher-2014').map(unit => unit.id);

function replay(anchored: boolean) {
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories), memoryProvider = createAiMemoryProvider(memories);
  let point: { x: number; y: number } | undefined, maxGathered = 0, firstGatheredTick: number | undefined;
  const halls = new Set<string>();
  const result = runAiGameLoop({ name: 'real-mine-rally-14m48', game, maxTicks: 20760, thinkInterval: 15,
    agents: {
      p1: { controller: 'external-agent', team: 'rivals', race: 'grove', version: 'v9' },
      v9_archer: { controller: 'external-agent', team: 'v9_archer-side', race: 'ember', version: 'v9_archer' },
    }, commandPlanner: ({ snapshot, owner, agent, source, teams }) => planAiOwnerCommandEntries(snapshot,
      { playerId: owner, source, version: agent.version,
        ...(!anchored && owner === subject ? { scripts: bootstrapScripts('v9_archer').filter(script => script.id !== 'miningRally') } : {}) },
      { teams, memoryProvider }),
  }, { onStep({ game }) {
    const anchor = memories[subject]?.miningDefense;
    if (anchor) { point ??= anchor.point; halls.add(anchor.hallId); }
    // Both runs are measured at the same first threatened hall's mouth, regardless of the mode label.
    const post = point ?? { x: 2681.6543031765154, y: 4102.184899904971 };
    maxGathered = Math.max(maxGathered, game.units.filter(unit => defenders.includes(unit.id)
      && Math.hypot(unit.x - post.x, unit.y - post.y) <= MINING_RALLY_RADIUS).length);
    if (maxGathered === defenders.length) firstGatheredTick ??= game.tick;
  } });
  return { result, maxGathered, firstGatheredTick, halls };
}

it('brings all 19 real 14:48 defenders to one mine mouth before changing the defensive base', () => {
  expect(defenders).toHaveLength(19);
  const before = replay(false), after = replay(true);
  expect(before.maxGathered).toBeLessThan(19);
  expect(after.maxGathered).toBe(19);
  expect(after.firstGatheredTick).toBeLessThanOrEqual(saved.snapshot.tick + 90 * 20);
  expect([...after.halls]).toEqual(['building-v9_archer-townhall']);
}, 30000);
