import { expect, it } from 'vitest';
import { createGame, snapshotGame } from '../../shared/sim';
import type { Objective } from './types';
import type { DecisionFacts } from './decision';
import { assemblyContinuationValueCap } from './assembly-value-cap';
import { discountedFlow } from './utility';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';

it('proves a formal same-window mining cap from native admission and ore, independently of fill or quoted score', () => {
  const snapshot = snapshotGame(createGame('bareDuel', { aiPlayers: [] })), mine = snapshot.resources.find(resource => resource.kind === 'goldMine')!;
  const objective: DecisionFacts<Objective> = { id: 'formal-island', owner: 'player', kind: 'ConquerIsland',
    target: { entityId: mine.id, point: { x: mine.x, y: mine.y } },
    effects: [{ kind: 'mining-established', mineId: mine.id, completeHall: true, garrisonHandoff: true }],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 0, persistenceBonus: 7, score: null },
    status: 'active', sinceTick: 0, rank: null, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } };
  const window = { taskTicks: 600, holdingTicks: 2400, horizonTicks: 3000, discountTicks: 2400 };
  const before = JSON.stringify({ snapshot, objective, window }), cap = assemblyContinuationValueCap(snapshot, objective, window);
  expect(cap.status).toBe('known');
  if (cap.status !== 'known') throw new Error('Expected native mining cap');
  const upper = discountedFlow({ goldPerTick: GOLD_MINE_RULES.goldPerTrip / (GOLD_MINE_RULES.entrySeconds * SIM_TICKS_PER_SECOND),
    remainingGold: mine.amount, startsInTicks: 0, window });
  expect(cap.gold).toBe(upper + 7);
  expect(cap.components.reduce((sum, component) => sum + component.valueGold, 0)).toBe(cap.gold);
  expect(assemblyContinuationValueCap(snapshot, { ...objective, utility: { ...objective.utility, successProbability: 1, score: 999999 } }, window)).toEqual(cap);
  expect(assemblyContinuationValueCap({ ...snapshot, resources: [] }, objective, window).status).toBe('unknown');
  expect(assemblyContinuationValueCap(snapshot, { ...objective, effects: [{ kind: 'entity-destroyed', entityId: 'another-payoff' }] }, window).status).toBe('unknown');
  expect(JSON.stringify({ snapshot, objective, window })).toBe(before);
});
