import { createBuilding } from '../../shared/map';
import { shipProfile } from '../../shared/ship-geometry';
import { trainingRecruitPrototype } from '../../shared/sim';
import { goalValueKey } from './goal-facts';
import type { GoalHullCandidate } from './goal-grounding-ports';
import type { GoalCoarseFutureHullReader } from './goal-coarse-transport';
import type { GoalCohortMember, GoalEntityReference, GoalGroundingReader, GoalPlanningContext } from './goal-planner-types';
import type { RegionIndex } from './regions';

/** Think-local assessment registry. A prepared coast contact is an optimistic
 * exit origin, not a native launch proof or a born unit. Exact transport still
 * requires the real hull; production and spawn-exit retain their own facts. */
export function createGoalFutureHullSource(context: GoalPlanningContext, regions: RegionIndex,
  productionOptions: GoalGroundingReader['productionOptions']) {
  const members = new Map<string, GoalCohortMember>();
  const hulls: GoalCoarseFutureHullReader = (seaId, _from, mass) => {
    const sea = context.situation.seas.find(sea => sea.id === seaId);
    const requestId = `future-hull-metadata:${seaId}`;
    const pending = (code: string) => ({ state: 'pending' as const, requestIds: [requestId],
      reason: { code, factIds: [], values: {} } });
    if (context.precision !== 'coarse' || !sea || regions.scannedRows !== regions.totalRows)
      return pending('future-hull-prepared-coast-required');
    const candidates: GoalHullCandidate[] = [];
    const deferred: NonNullable<Extract<ReturnType<GoalCoarseFutureHullReader>, { state: 'met' }>['deferred']>[number][] = [];
    for (const kind of ['transport', 'carrier'] as const) {
      const production = productionOptions(kind, { seaId, point: sea.anchor });
      if (production.state === 'pending') {
        deferred.push({ id: `${requestId}:${kind}`, requestIds: production.requestIds, reason: production.reason }); continue;
      }
      if (production.state !== 'met') continue;
      deferred.push(...(production.deferred ?? []));
      for (const option of production.candidates) {
        const shore = regions.shores.filter(shore => shore.seaId === seaId && (!option.at.landId || shore.landId === option.at.landId))
          .sort((a, b) => Math.hypot(a.ground.x - option.at.point.x, a.ground.y - option.at.point.y)
            - Math.hypot(b.ground.x - option.at.point.x, b.ground.y - option.at.point.y)
            || a.water.y - b.water.y || a.water.x - b.water.x)[0];
        if (!shore) continue;
        const producerRef = option.producer;
        const actual = producerRef.kind === 'existing' ? context.snapshot.buildings.find(building => building.id === producerRef.entityId) : undefined;
        const producer = actual ?? createBuilding('goal-future-producer-assessment', context.owner, option.buildingKind,
          option.at.point.x, option.at.point.y, true);
        const assessment = trainingRecruitPrototype(context.snapshot, producer, { unitKind: kind, remaining: 0 });
        const capacity = shipProfile(assessment)?.loadCapacity ?? 0;
        if (capacity < mass) continue;
        assessment.x = shore.water.x; assessment.y = shore.water.y;
        const reference: GoalEntityReference = { kind: 'binding', name: `future-hull:${goalValueKey([kind, option.producer, seaId])}` };
        members.set(goalValueKey(reference), { reference, assessment });
        candidates.push({ id: `future-hull:${option.id}:${kind}`, reference, seaId, assessment,
          availableTick: context.tick, capacity, cargoUnitIds: [], preconditions: option.preconditions, factIds: option.factIds });
      }
    }
    return candidates.length ? { state: 'met', candidates, factIds: candidates.flatMap(hull => hull.factIds),
      ...(deferred.length ? { deferred } : {}) } : deferred.length ? { state: 'pending',
      requestIds: [...new Set(deferred.flatMap(row => row.requestIds))], reason: { code: 'future-hull-production-pending', factIds: [], values: {} } }
      : pending('future-hull-production-metadata-missing');
  };
  return { hulls, member: (reference: GoalEntityReference) => members.get(goalValueKey(reference)) };
}
