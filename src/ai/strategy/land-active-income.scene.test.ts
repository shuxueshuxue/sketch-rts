import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../../shared/catalog';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { withNativeLandRoadReuse } from '../policy/land-road';
import { generateLandObjectives, decomposeLandObjective } from './land-objectives';
import { evaluateSituation } from './situation';
import { discountGold } from './utility';
import type { PlanningContext, Situation } from './types';

const mineId = 'gold-mainland-2', objectiveId = `ExpandLand:player-4:${mineId}`;
let context: PlanningContext, situation: Situation;
beforeAll(() => {
  const frames = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases;
  const frame = structuredClone(frames.find((frame: { event: string }) => frame.event === 'Ne'));
  expect(frame.snapshot.tick).toBe(17991);
  expect(frame.memory.landExpansion).toMatchObject({ mineId, stage: 'assemble', combat: {} });
  context = { snapshot: frame.snapshot, owner: frame.owner, memory: frame.memory };
  setBuildingBodies(context.snapshot.map, standingBodies(context.snapshot));
  situation = withNativeLandRoadReuse(() => evaluateSituation(context.snapshot, context.owner, context.memory));
});

it('Ne 17991 retains the existing 800-gold mining opportunity when the active expansion has no local worker', () => {
  const before = JSON.stringify({ context, situation });
  const opportunity = situation.opportunities.find(item => item.kind === 'neutral-mine' && item.target.entityId === mineId)!;
  expect(opportunity.valueGold).toBeCloseTo(800);
  expect(situation.units.some(unit => unit.owner === context.owner && unit.roles.includes('worker')
    && unit.location.kind === 'land' && unit.location.landId === opportunity.target.landId)).toBe(false);
  const goal = generateLandObjectives(situation, context).find(goal => goal.id === objectiveId)!;
  const methods = decomposeLandObjective(situation, goal, context);
  const income = goal.utility.benefit.find(term => term.code === 'mining-income')!;
  // Preserve the shared ETA discount: 800 is the source potential, not cash
  // already earned or an undiscounted utility payment at departure.
  expect(income.value).toBeCloseTo(discountGold(opportunity.valueGold,
    methods[0]!.estimatedTicks! + BUILDING_DEFS.townHall.buildTime));
  expect(income.value).toBeGreaterThan(0);
  expect(goal.status).toBe('blocked');
  expect(goal.utility.score).toBeNull();
  expect(goal.conditionalQuote?.potentialUtility).toBeNull();
  expect(JSON.stringify({ context, situation })).toBe(before);
});

it('keeps absent mining potential unknown rather than emitting a zero-income quote or a cash-wait subgoal', () => {
  const unknownIncome = { ...situation,
    opportunities: situation.opportunities.filter(item => item.target.entityId !== mineId) };
  const before = JSON.stringify({ context, situation: unknownIncome });
  const goal = generateLandObjectives(unknownIncome, context).find(goal => goal.id === objectiveId)!;
  const methods = decomposeLandObjective(unknownIncome, goal, context);
  expect(goal.utility.benefit.find(term => term.code === 'mining-income')).toBeUndefined();
  expect(goal.reasons).toContainEqual(expect.objectContaining({ code: 'mining-income-unknown' }));
  expect(goal.status).toBe('blocked');
  expect(goal.utility.score).toBeNull();
  expect(goal.conditionalQuote?.potentialUtility).toBeNull();
  expect(methods.every(method => method.preconditions.some(condition => condition.status === 'unknown'
    && condition.reason.code === 'mining-income-unknown' && condition.demand === null))).toBe(true);
  expect(methods.flatMap(method => method.subgoals).some(child => child.kind === 'wait-income')).toBe(false);
  expect(JSON.stringify({ context, situation: unknownIncome })).toBe(before);
});
