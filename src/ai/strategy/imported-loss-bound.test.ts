import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { buildStrategyDecision } from './decision';
import { importedMiningLossUpperBound } from './imported-loss-bound';
import { discountedFlow, valuationWindow } from './utility';

it('bounds the real E01 ferry target by full native capacity in the requesting window', () => {
  const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory }
    = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/e01-before-ferry.json.gz', import.meta.url))).toString());
  const decision = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory });
  const targetId = 'gold-gen-3', window = valuationWindow(1200);
  const bound = importedMiningLossUpperBound(decision.situation, decision.objectives, targetId, window)!;
  const mine = decision.situation.assets.find(asset => asset.id === targetId)!;
  expect(bound.targetId).toBe(targetId);
  expect(bound.gold).toBeGreaterThan(0);
  expect(bound.components[0]!.valueGold).toBe(discountedFlow({ goldPerTick: mine.miningCapacity!.goldPerTickCap,
    remainingGold: mine.remainingGold, startsInTicks: 0, window }));
  expect(bound.gold).toBe(bound.components.reduce((sum, term) => sum + term.valueGold, 0));
  expect(bound.window).toEqual(window);
  expect(JSON.stringify(importedMiningLossUpperBound(JSON.parse(JSON.stringify(decision.situation)),
    JSON.parse(JSON.stringify(decision.objectives)), targetId, window))).toBe(JSON.stringify(bound));
  expect(importedMiningLossUpperBound(decision.situation, decision.objectives, 'unobserved-mine', window)).toBeNull();
  expect(importedMiningLossUpperBound(decision.situation, [], targetId, window)).toBeNull();
  expect(importedMiningLossUpperBound(decision.situation, decision.objectives, 'building-p0-townhall', window)).toBeNull();
});
