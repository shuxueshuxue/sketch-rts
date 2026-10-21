import { BUILDING_DEFS, RACE_DEFS, trainingBuildingFor, unitMover } from '../../shared/catalog';
import { isTransportKind } from '../../shared/transport-role';
import type { BuildingKind, TrainableUnitKind, UnitKind } from '../../shared/types';
import { declareGoalBuilding, declareGoalTraining, declareGoalWaitIncome } from './goal-economy-actions';
import { withGoalSafetyPreconditionWindows } from './goal-safety-preconditions';
import type { GoalActionDeclaration, GoalActionProvider, GoalEntityReference, GoalFact, GoalPlanningContext } from './goal-planner-types';
import type { Target } from './types';

const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const uniqueActions = (actions: readonly (GoalActionDeclaration | null)[]) => [...new Map(actions.filter((action): action is GoalActionDeclaration => !!action)
  .map(action => [action.id, action])).values()].sort((a, b) => order(a.id, b.id));
const samePoint = (a: Target, b: Target) => a.point.x === b.point.x && a.point.y === b.point.y
  && (!b.landId || a.landId === b.landId) && (!b.seaId || a.seaId === b.seaId);

function anchors(context: GoalPlanningContext, mover: 'land' | 'sea'): readonly Target[] {
  return mover === 'land' ? [...context.situation.lands].sort((a, b) => order(a.id, b.id)).map(land => ({ landId: land.id, point: land.anchor }))
    : [...context.situation.seas].sort((a, b) => order(a.id, b.id)).map(sea => ({ seaId: sea.id, point: sea.anchor }));
}

function builds(kind: BuildingKind, near: Target, byTick: number, context: GoalPlanningContext,
  filter?: (at: Target) => boolean): readonly GoalActionDeclaration[] {
  if (!context.grounding) return [];
  const sites = context.grounding.buildSites(kind, near);
  if (sites.state !== 'met') return [];
  return uniqueActions(sites.candidates.filter(site => !filter || filter(site.at)).map(site => {
    const from = site.route?.predicate.kind === 'route' ? site.route.predicate.from : undefined;
    return from || site.worker.kind === 'pool-member' ? declareGoalBuilding({ buildingKind: kind, at: site.at,
      worker: { ref: site.worker, ...(from ? { from } : {}) }, byTick, siteBinding: site }, context) : null;
  }));
}

function training(kind: UnitKind, count: number, near: Target, byTick: number, context: GoalPlanningContext): readonly GoalActionDeclaration[] {
  const race = context.snapshot.players[context.owner]?.race;
  if (!context.grounding || !race || !RACE_DEFS[race].trainableUnits.includes(kind as TrainableUnitKind)) return [];
  const options = context.grounding.productionOptions(kind, near);
  if (options.state !== 'met') return [];
  return uniqueActions(options.candidates.flatMap(option => {
    // One-unit contributors let multiple producers combine their flows. The
    // full requested batch remains a separate native action alternative.
    return [...new Set([1, count])].map(batch => {
      const action = declareGoalTraining({ unitKind: kind as TrainableUnitKind, count: batch, producer: option.producer,
        at: option.at, byTick }, context);
      return action && withGoalSafetyPreconditionWindows({ ...action, preconditions: [...new Map([...action.preconditions, ...option.preconditions]
        .map(fact => [fact.id, fact])).values()].sort((a, b) => order(a.id, b.id)) }, context.tick);
    });
  }));
}

/** Enumerate single native economic actions. Missing prerequisites are world
 * predicates for regression; this provider never calls another provider or
 * arranges build/train/wait into an ordered recipe. Grounding's pending and
 * deferred alternatives are observed by the common fact source. */
export const goalEconomyActionProvider: GoalActionProvider = {
  id: 'goal:economy',
  actionsFor(effect: GoalFact, context: GoalPlanningContext) {
    const predicate = effect.predicate, race = context.snapshot.players[context.owner]?.race;
    if (!race) return [];
    const byTick = 'byTick' in predicate ? predicate.byTick : (context.planThroughTick ?? context.tick + context.situation.horizonTicks);
    if (predicate.kind === 'gold') return uniqueActions([declareGoalWaitIncome(effect, context)]);
    if (predicate.kind === 'hall-complete') {
      const mine = context.snapshot.resources.find(resource => resource.id === predicate.mineId && resource.amount > 0);
      return mine ? builds('townHall', { ...predicate.at, entityId: mine.id }, byTick, context) : [];
    }
    if (predicate.kind === 'building-complete') return builds(predicate.buildingKind, predicate.at, byTick, context,
      at => samePoint(at, predicate.at) && (predicate.building?.kind !== 'existing' || at.entityId === predicate.building.entityId));
    if (predicate.kind === 'production') {
      const kind = trainingBuildingFor(race, predicate.unitKind);
      if (!kind) return [];
      // An existing producer can only be completed at its actual foundation;
      // a new building cannot fabricate an already named world entity.
      const producer = predicate.producer;
      const existing = producer?.kind === 'existing' ? context.snapshot.buildings.find(building => building.id === producer.entityId
        && building.owner === context.owner && building.hp > 0 && !building.complete) : undefined;
      if (producer?.kind === 'existing' && !existing) return [];
      const locations = predicate.at ? [predicate.at] : anchors(context, unitMover(predicate.unitKind));
      return uniqueActions(locations.flatMap(near => builds(kind, near, byTick, context,
        at => !existing || at.entityId === existing.id)));
    }
    if (predicate.kind === 'shipyard-for') return uniqueActions(anchors(context, 'sea').filter(at => at.seaId === predicate.seaId)
      .flatMap(near => builds('shipyard', near, byTick, context)));
    if (predicate.kind === 'supply-cap' || predicate.kind === 'population-room') return uniqueActions(
      RACE_DEFS[race].buildableBuildings.filter(kind => BUILDING_DEFS[kind].supplyProvided > 0)
        .flatMap(kind => anchors(context, 'land').flatMap(near => builds(kind, near, byTick, context))));
    if (predicate.kind === 'unit-available') return training(predicate.unitKind, predicate.count, predicate.at, byTick, context);
    if (predicate.kind === 'worker-at') return predicate.worker?.kind === 'existing' ? [] : training('worker', predicate.count, predicate.at, byTick, context);
    if (predicate.kind === 'transport-in') return predicate.transport?.kind === 'existing' ? [] : uniqueActions(anchors(context, 'sea').filter(at => at.seaId === predicate.seaId)
      .flatMap(near => RACE_DEFS[race].trainableUnits.filter(isTransportKind).flatMap(kind => training(kind, 1, near, byTick, context))
        .filter(action => action.flows.some(flow => flow.resource.kind === 'transport-capacity' && flow.delta > 0))));
    if (predicate.kind === 'force-available') {
      if (predicate.cohort?.length) return []; // training cannot change named existing members' physical strength
      const current = context.readFact(effect);
      return uniqueActions(RACE_DEFS[race].trainableUnits.filter(kind => unitMover(kind) === 'land')
        .flatMap(kind => training(kind, 1, predicate.at, byTick, context)).flatMap(action => {
          const contribution = action.flows.find(flow => flow.resource.kind === 'force' && flow.resource.scope === 'pool' && flow.delta > 0)?.delta;
          if (!contribution) return [];
          // Camp-force is non-additive. Return native positive recruitment
          // contributions; shared whole-cohort assessment decides sufficiency.
          if (predicate.metric !== 'combat-rating' || current.quantity === undefined || !Number.isFinite(current.quantity)) return [action];
          const count = Math.max(1, Math.ceil((predicate.minimum - current.quantity) / contribution));
          if (count === 1) return [action];
          const producer = action.executor.parameters.producer as GoalEntityReference;
          const at = action.executor.parameters.at as Target;
          const batch = declareGoalTraining({ unitKind: kindFrom(action), count, producer, at, byTick }, context);
          return [action, batch && withGoalSafetyPreconditionWindows({ ...batch, preconditions: [...new Map([...batch.preconditions,
            ...action.preconditions.filter(fact => fact.predicate.kind !== 'gold' && fact.predicate.kind !== 'population-room')]
            .map(fact => [fact.id, fact])).values()].sort((a, b) => order(a.id, b.id)) }, context.tick)];
        }));
    }
    return [];
  },
};

function kindFrom(action: GoalActionDeclaration): TrainableUnitKind {
  return action.executor.parameters.unitKind as TrainableUnitKind;
}
