import { BUILDING_DEFS, unitMover } from '../../shared/catalog';
import { bodyMass } from '../../shared/physical-body';
import type { Unit } from '../../shared/types';
import { assessAllocatedForce } from './allocated-force';
import type { AllocationMethodProvider, AllocationMethodQuoteInput, AllocationPrecondition, AllocationReason,
  ExecutableMethod, PlannedVoyage } from './allocation-types';
import { materializeVoyages } from './materialize-voyages';
import { materializeMiningWorkforce } from './materialize-mining-workforce';
import { conquestFacts, conquestHallAt } from './conquest-facts';
import { quoteConquestMethod } from './conquest-quotation';
import { strategicTargetCamp } from './target-camp';
import type { ResourceDemand, Target } from './types';
import { defenseMethodProvider } from './defense-methods';

const reason = (code: string, factIds: readonly string[] = [], values: AllocationReason['values'] = {}): AllocationReason => ({ code, factIds, values });
const ids = (units: readonly Unit[]) => units.map(unit => unit.id).sort();
function forceDemand(input: Pick<AllocationMethodQuoteInput, 'snapshot' | 'objective'>): ResourceDemand {
  const camp = input.objective.kind === 'ConquerIsland' ? strategicTargetCamp(input.snapshot, input.objective.target) : undefined;
  const required = camp ? assessAllocatedForce(input.objective.owner, [], { metric: 'camp-force', camp }).requiredForce
    : input.objective.effects.find(effect => effect.kind === 'force-present')?.minimumStrength ?? 1;
  return { kind: 'force', metric: camp ? 'camp-force' : 'field-strength', strength: required,
    roles: ['frontline', 'ranged'], at: input.objective.target, neededByTick: null, permanent: true };
}
function action(id: string, executor: string, intent: ExecutableMethod['actions'][number]['intent'], target: Target,
  demands: readonly ResourceDemand[], dependsOn: readonly string[] = [], spendIds: readonly string[] = []): ExecutableMethod['actions'][number] {
  return { id, executor, intent, target, demands, dependsOn, spendIds, completionEffects: [] };
}

export const conquestMethodProvider: AllocationMethodProvider = {
  id: 'strategy.conquest-methods',
  buildMethods(input) {
    const { objective, snapshot } = input;
    if (objective.kind !== 'ConquerIsland' && objective.kind !== 'ReinforceFront') return [];
    const conquest = objective.kind === 'ConquerIsland', id = `${objective.id}/method:${conquest ? 'staged-beachhead' : 'cross-sea-reinforcement'}`;
    const demand = forceDemand(input), camp = conquest ? strategicTargetCamp(snapshot, objective.target) : undefined, hall = conquestHallAt(input);
    const priorClear = input.executions.find(execution => execution.methodId === id && execution.intent.kind === 'clear-camp');
    const priorBuild = input.executions.find(execution => execution.methodId === id && execution.executor === 'strategy.build-hall');
    const retainBuild = priorBuild && !['complete', 'failed', 'abandoned'].includes(priorBuild.status);
    const needsBuild = conquest && (!hall?.complete || retainBuild);
    const hallCapital = !hall || !!priorBuild;
    const worker: ResourceDemand = { kind: 'workers', count: 1, at: objective.target };
    const capital: ResourceDemand = { kind: 'gold', amount: BUILDING_DEFS.townHall.cost }, spendId = `${objective.id}/hall-capital`;
    const deliver = `${id}/deliver-force`, clear = `${id}/clear-camp`, engineer = `${id}/deliver-workers`, wait = `${id}/wait-hall-capital`, build = `${id}/build-hall`;
    const actions = [action(deliver, 'strategy.transport', { kind: 'deliver-force' }, objective.target, [demand])];
    const clearingIntent = conquest ? camp ? { kind: 'clear-camp' as const, memberIds: camp.creeps.map(unit => unit.id).sort() }
      : priorClear?.intent.kind === 'clear-camp' ? priorClear.intent : { kind: 'clear-camp' as const, memberIds: [] } : undefined;
    if (clearingIntent) actions.push(action(clear, 'strategy.clear-camp', clearingIntent, objective.target, [demand], [deliver]));
    const cleared = clearingIntent ? clear : deliver;
    if (conquest) actions.push(action(engineer, 'strategy.transport', { kind: 'deliver-workers' }, objective.target, [worker], [cleared]));
    if (needsBuild) {
      if (hallCapital) actions.push(action(wait, 'strategy.wait-income', { kind: 'wait-income' }, objective.target, [capital], [cleared], [spendId]));
      actions.push(action(build, 'strategy.build-hall', { kind: 'build-hall' }, objective.target, [worker, ...(hallCapital ? [capital] : [])],
        [engineer, ...(hallCapital ? [wait] : [])], hallCapital ? [spendId] : []));
    }
    const terminal = action(`${id}/garrison`, conquest ? 'strategy.establish-garrison' : 'strategy.establish-force',
      { kind: 'establish-garrison' }, objective.target,
      [conquest ? { kind: 'force', metric: 'field-strength', strength: 1, roles: ['frontline', 'ranged'], at: objective.target, neededByTick: null, permanent: true } : demand],
      [needsBuild ? build : cleared]);
    actions.push({ ...terminal, completionEffects: conquest ? [] : objective.effects });
    if (conquest) actions.push({ ...action(`${id}/start-mining`, 'strategy.start-mining', { kind: 'start-mining' },
      objective.target, [worker], [terminal.id, needsBuild ? build : engineer]), completionEffects: objective.effects });
    return [{ id, objectiveId: objective.id, providerId: this.id, preference: 0, kind: conquest ? 'staged-beachhead' : 'cross-sea-reinforcement',
      demands: [demand, ...(conquest ? [worker] : [])], actions,
      spends: needsBuild && hallCapital ? [{ spendId, amountGold: BUILDING_DEFS.townHall.cost,
        includedUtilityTermCodes: ['hall-after-clearing'], externalReservationIds: ['naval:islandHall'] }] : [],
      preconditions: [], subgoals: [], estimatedTicks: null, status: 'candidate', reasons: [] }];
  },
  materialize(input) {
    const { snapshot, situation, method } = input, selected = new Set(input.unitIds);
    const units = snapshot.units.filter(unit => selected.has(unit.id) && unit.owner === situation.owner && unit.hp > 0);
    const fighters = units.filter(unit => unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && unit.attackDamage > 0 && unit.expiresTick === undefined);
    const workers = units.filter(unit => unit.kind === 'worker');
    const actions: ExecutableMethod['actions'][number][] = [], voyages: PlannedVoyage[] = [];
    const missing: AllocationPrecondition[] = [], spends = [...method.spends];
    let latestArrival = 0;
    const stepKinds = new Map(method.actions.map(step => [step.id, step.executor]));
    const replaced = new Map<string, readonly string[]>();
    const miningTerminal = `${method.id}/start-mining`;
    for (const step of method.actions.filter(step => step.executor !== 'strategy.train-transport' && step.executor !== 'strategy.assemble'
      && step.executor !== 'strategy.train-worker' && (step.executor !== 'strategy.start-mining' || step.id === miningTerminal))) {
      if (step.executor === 'strategy.transport') {
        const members = step.intent.kind === 'deliver-workers' ? workers : fighters;
        const plan = materializeVoyages(input, step.id, ids(members));
        latestArrival = Math.max(latestArrival, plan.latestArrivalTicks ?? 0);
        const parentDependencies = step.dependsOn.filter(id => !['strategy.train-transport', 'strategy.assemble'].includes(stepKinds.get(id) ?? ''));
        missing.push(...plan.missing); spends.push(...plan.spends); voyages.push(...plan.voyages);
        if (!plan.voyages.length && !plan.missing.length) { replaced.set(step.id, parentDependencies); continue; }
        actions.push(...plan.actions);
        const dependencies = [...parentDependencies];
        for (const voyage of plan.voyages) {
          const assemble = `${voyage.id}/assemble`;
          actions.push({ ...action(assemble, 'strategy.assemble', { kind: 'borrow-force' }, voyage.departureGround, [], parentDependencies), unitIds: voyage.unitIds });
          dependencies.push(assemble);
          if (voyage.ship.kind === 'production') dependencies.push(voyage.ship.actionId);
        }
        const demands: ResourceDemand[] = [...step.demands.filter(demand => demand.kind !== 'transport'), ...plan.voyages.map(voyage => ({ kind: 'transport' as const, seaId: voyage.crossing.seaId,
          payloadMass: voyage.unitIds.reduce((sum, id) => sum + bodyMass(units.find(unit => unit.id === id)!), 0),
          departure: voyage.departure.point, landing: voyage.destination.point }))];
        actions.push({ ...step, demands, dependsOn: [...new Set(dependencies)], unitIds: ids(members) });
      } else actions.push({ ...step, unitIds: step.executor === 'strategy.wait-income' ? []
        : ids(step.executor === 'strategy.build-hall' || step.executor === 'strategy.start-mining' ? workers : fighters) });
    }
    const dependencies = (id: string): readonly string[] => replaced.has(id) ? replaced.get(id)!.flatMap(dependencies) : [id];
    const final = [...new Map(actions.map(step => [step.id, { ...step, dependsOn: [...new Set(step.dependsOn.flatMap(dependencies))] }])).values()];
    const planned = { ...method, actions: final, voyagePlans: voyages, estimatedTicks: missing.length ? null : latestArrival,
      spends: [...new Map(spends.map(spend => [spend.spendId, spend])).values()],
      preconditions: [...method.preconditions.filter(condition => !condition.id.includes('/materialized:') && !condition.id.includes('/workforce:')), ...missing.map(condition => ({ ...condition,
        id: `${method.id}/materialized:${condition.id}` }))] };
    if (input.objective.kind !== 'ConquerIsland') return planned;
    const facts = conquestFacts({ ...input, method: planned });
    const workforce = materializeMiningWorkforce({ ...input, method: { ...planned,
      actions: [...planned.actions, ...method.actions.filter(action => action.executor === 'strategy.train-worker')] } }, facts.forecast,
      miningTerminal, planned.actions.find(action => action.executor === 'strategy.build-hall')?.id ?? null, `${method.id}/garrison`);
    return { ...planned, actions: [...planned.actions.filter(action => action.id !== miningTerminal), ...workforce.actions],
      spends: [...new Map([...planned.spends, ...workforce.spends].map(spend => [spend.spendId, spend])).values()],
      preconditions: [...planned.preconditions, ...workforce.missing.map(condition => ({ ...condition, id: `${method.id}/workforce:${condition.id}` }))] };
  },
  quote(input) {
    if (input.objective.kind === 'ConquerIsland') return quoteConquestMethod(input);
    const site = input.situation.assets.find(asset => asset.id === input.objective.target.entityId);
    // Owned front reinforcement uses the same site protection counterfactual.
    // An unpriced offensive front is not force multiplied by a time fee.
    if (site?.owner === input.situation.owner) return defenseMethodProvider.quote(input);
    const why = reason('reinforcement-front-protection-value-unquoted', [input.objective.target.entityId ?? input.objective.id]);
    return { methodId: input.method.id, status: 'blocked', force: null, utility: null, potentialUtility: null,
      reason: why, missingPreconditions: [{ id: `${input.method.id}/${why.code}`, kind: 'force', status: 'unknown',
        reason: why, demand: input.method.demands[0] ?? null, subgoalIds: [] }] };
  },
};
