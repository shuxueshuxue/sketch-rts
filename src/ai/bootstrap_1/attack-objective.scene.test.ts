import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame } from '../../shared/sim';
import type { GameSnapshot } from '../../shared/types';
import { runGameLoop } from '../../sdk/game-runner';
import type { AiGameAgent } from '../game-runner';
import type { AiPolicyMemory } from '../memory';
import { navalObservedPlanner } from '../benchmark/naval-room-worker';
import { expansionMissionUnitIds } from './expansion-mission';

const saved = JSON.parse(readFileSync(new URL('./fixtures/summoner-attack-2m32.json', import.meta.url), 'utf8')) as {
  snapshot: GameSnapshot; nextId: number; activePlayers: string[];
  memories: Record<string, AiPolicyMemory>; agents: Record<string, AiGameAgent>; thinkInterval: number;
};

it('takes a real expansion attack through defense, explicit withdrawal and a later demolished outpost', () => {
  // Current-main v5-final-1, summoner ladder-12 grove vs v9, tick 3037.
  // The rising natural is too far away to intercept before it completes. The
  // wave must still prefer an income, retain that goal through defense, and
  // never call dispatch itself a completed attack.
  const game = createGame(saved.snapshot.map.id, { players: saved.activePlayers });
  restoreSnapshotIntoGame(game, structuredClone(saved.snapshot), saved.nextId);
  game.activePlayers = [...saved.activePlayers];
  const memories = structuredClone(saved.memories);
  let first: { targetId: string; sinceTick: number } | undefined;
  let paused = false, resumed = false, parallel = false;
  const results: NonNullable<AiPolicyMemory['landAttackResult']>[] = [];
  runGameLoop({ name: 'summoner-12-attack-results', game, agents: saved.agents,
    maxTicks: 15000, thinkInterval: saved.thinkInterval, commandPlanner: navalObservedPlanner(memories),
  }, { onStep({ game }) {
    const memory = memories.v9_summoner!, task = memory.landAttack;
    if (task) {
      first ??= { targetId: task.targetId, sinceTick: task.sinceTick };
      if (task.sinceTick === first.sinceTick) {
        expect(task.targetId).toBe(first.targetId);
        if (task.paused === 'defense') paused = true;
        if (paused && !task.paused) resumed = true;
      }
      if (!task.paused && memory.v6?.general?.mode === 'attack') {
        expect(memory.v6.general.targetHallId).toBe(task.targetId);
        const reserved = expansionMissionUnitIds(memory);
        if (reserved.length && !memory.landExpansion?.paused && memory.landExpansion?.stage !== 'complete') {
          expect(task.general.group?.some(id => reserved.includes(id))).toBe(false);
          parallel = true;
        }
      }
    }
    const result = memory.landAttackResult;
    if (result && results.at(-1)?.tick !== result.tick) {
      if (result.result === 'destroyed') expect(game.buildings.some(building => building.id === result.targetId)).toBe(false);
      if (result.result === 'withdrew') expect(result.reason).toMatch(/^general:retreat/);
      results.push({ ...result });
    }
  } });
  expect(first?.targetId).toBe('building-p1-townHall-1216');
  expect(paused && resumed).toBe(true);
  expect(parallel).toBe(true);
  expect(results[0]).toMatchObject({ targetId: first!.targetId, result: 'withdrew' });
  expect(results.some(result => result.result === 'destroyed' && result.targetId !== 'building-p1-townhall')).toBe(true);
  expect(game.buildings.find(building => building.id === 'building-p1-townhall')?.hp).toBeGreaterThan(0);
}, 60000);
