import { afterEach, expect, it, vi } from 'vitest';
import { createGame, snapshotGame } from '../../shared/sim';
import { CommandFrameRuntime } from '../../shared/sim/command-frame-runtime';
import { AiPlanObserver } from '../plan-observer';
import { planAiOwnerCommandEntriesWithTrace } from '../plan-trace-planner';
import { createAiRuntime, createInlineAiThinkExecutor, createPresetAiRuntimeFramePlanner } from '../runtime';
import { createAiThinkHost } from '../think-worker/host';
import type { AiThinkReply } from '../think-worker/protocol';
import { LAND_OBJECTIVE_FAMILY } from './land-objectives';
import * as situationModule from './situation';

afterEach(() => vi.restoreAllMocks());

const versions = ['v9_knight', 'v9_archer', 'v9_summoner'] as const;

it.each(versions)('%s never constructs Situation or land quotes on the default inline room path', version => {
  const constructionsBefore = situationModule.situationConstructionCount();
  const situation = vi.spyOn(situationModule, 'evaluateSituation');
  const land = vi.spyOn(LAND_OBJECTIVE_FAMILY, 'generate');
  const game = createGame('bareDuel', { aiPlayers: ['enemy'], aiVersions: { enemy: version } });
  const ai = createAiRuntime(['enemy'], { versions: { enemy: version } });
  const executor = createInlineAiThinkExecutor(ai);
  const thinks = vi.spyOn(executor, 'submit');
  const observer = new AiPlanObserver(game, ai.controlledPlayers, executor);
  const runtime = new CommandFrameRuntime({ game, roomId: 'land-default-inline', rejectionLabel: 'test',
    aiPlanner: createPresetAiRuntimeFramePlanner(game, ai, { executor }) });
  try {
    for (let tick = 0; tick < 90; tick++) {
      runtime.tick();
      observer.step();
    }
    expect(thinks.mock.calls.length).toBeGreaterThan(1);
    expect(observer.active).toBe(false);
    expect(situation.mock.calls.length).toBe(0);
    expect(situationModule.situationConstructionCount() - constructionsBefore).toBe(0);
    expect(land.mock.calls.length).toBe(0);
    expect(ai.memories.enemy?.strategy?.observation).toBeUndefined();
    expect(ai.memories.enemy).not.toHaveProperty('strategyAllocation');
  } finally {
    observer.dispose();
  }
});

it.each(versions)('%s never constructs Situation or land quotes on the unobserved room worker host', version => {
  const constructionsBefore = situationModule.situationConstructionCount();
  const situation = vi.spyOn(situationModule, 'evaluateSituation');
  const land = vi.spyOn(LAND_OBJECTIVE_FAMILY, 'generate');
  const game = createGame('bareDuel', { aiPlayers: ['enemy'], aiVersions: { enemy: version } });
  const snapshot = snapshotGame(game);
  const { terrain: _terrain, landmarks: _landmarks, ...map } = snapshot.map;
  const host = createAiThinkHost(), replies: AiThinkReply[] = [];
  host.open({ type: 'open', session: 'land-default-worker', map: snapshot.map }, reply => replies.push(reply));
  try {
    host.think({ type: 'think', session: 'land-default-worker', tick: snapshot.tick, deliveryTick: snapshot.tick + 2,
      snapshot: { ...snapshot, map }, requests: [{ playerId: 'enemy', version }] });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toHaveProperty('commands');
    expect(replies[0]).not.toHaveProperty('error');
    expect(replies[0]).not.toHaveProperty('observations');
    expect(situation.mock.calls.length).toBe(0);
    expect(situationModule.situationConstructionCount() - constructionsBefore).toBe(0);
    expect(land.mock.calls.length).toBe(0);
  } finally {
    host.close({ type: 'close', session: 'land-default-worker' });
  }
});

it('counts both Situation construction and the default land family when explicitly requested with WithTrace', () => {
  const constructionsBefore = situationModule.situationConstructionCount();
  const situation = vi.spyOn(situationModule, 'evaluateSituation');
  const land = vi.spyOn(LAND_OBJECTIVE_FAMILY, 'generate');
  const snapshot = snapshotGame(createGame('bareDuel', { aiPlayers: ['enemy'] }));
  const ai = createAiRuntime(['enemy'], { versions: { enemy: 'v9_archer' } });
  const result = planAiOwnerCommandEntriesWithTrace(snapshot,
    { playerId: 'enemy', version: 'v9_archer', memory: ai.memories.enemy! });
  expect(result.trace.strategy).toBeDefined();
  expect(situation.mock.calls.length).toBe(1);
  expect(situationModule.situationConstructionCount() - constructionsBefore).toBe(1);
  expect(land.mock.calls.length).toBe(1);
});
