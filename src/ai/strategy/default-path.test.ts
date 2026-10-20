import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, snapshotGame, warmGameCaches } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planAiCommandFrameFromSnapshot } from '../runtime';
import { planAiOwnerCommandEntriesWithTrace } from '../plan-trace-planner';
import { createAiThinkHost } from '../think-worker/host';
import type { AiThinkReply } from '../think-worker/protocol';
import * as situation from './situation';

afterEach(() => vi.restoreAllMocks());

describe('default room strategy construction', () => {
  for (const version of ['v9_archer', 'v9_summoner', 'v9_knight'] as const) {
    it(`${version} constructs zero Situations on ordinary inline and think-host paths`, () => {
      const game = createGame('sapphireArchipelago', { players: ['player', 'enemy'], aiPlayers: ['enemy'],
        aiVersions: { enemy: version } });
      warmGameCaches(game);
      const snapshot = snapshotGame(game), memory = createAiPolicyMemory();
      const builds = vi.spyOn(situation, 'evaluateSituation');
      const initialBuilds = situation.situationConstructionCount();
      const frame = planAiCommandFrameFromSnapshot(snapshot, [{ playerId: 'enemy', version, memory }]);
      expect(frame.commands).toBeDefined();
      expect(builds).toHaveBeenCalledTimes(0);
      expect(memory.strategy).toBeUndefined();

      const replies: AiThinkReply[] = [], host = createAiThinkHost();
      host.open({ type: 'open', session: version, map: structuredClone(snapshot.map) }, reply => replies.push(reply));
      const { terrain: _terrain, landmarks: _landmarks, ...map } = snapshot.map;
      host.think({ type: 'think', session: version, tick: snapshot.tick, deliveryTick: snapshot.tick + 3,
        snapshot: { ...snapshot, map }, requests: [{ playerId: 'enemy', version }] });
      expect(replies).toHaveLength(1);
      expect(replies[0]).toHaveProperty('commands');
      expect(replies[0]).not.toHaveProperty('error');
      expect(builds).toHaveBeenCalledTimes(0);
      host.close({ type: 'close', session: version });
      expect(situation.situationConstructionCount() - initialBuilds).toBe(0);
    });
  }

  it('counts the same evaluator when strategic observation is explicitly requested', () => {
    const game = createGame('sapphireArchipelago', { players: ['player', 'enemy'], aiPlayers: ['enemy'] });
    const memory = createAiPolicyMemory(), builds = vi.spyOn(situation, 'evaluateSituation');
    const initialBuilds = situation.situationConstructionCount();
    const result = planAiOwnerCommandEntriesWithTrace(snapshotGame(game), { playerId: 'enemy', version: 'v9_archer', memory });
    expect(builds).toHaveBeenCalledTimes(1);
    expect(situation.situationConstructionCount() - initialBuilds).toBe(1);
    expect(result.trace.strategy).toBeDefined();
    expect(memory.strategy?.observation).toBeDefined();
  });
});
