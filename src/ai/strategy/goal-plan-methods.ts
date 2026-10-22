import type { GameSnapshot, TrainableUnitKind } from '../../shared/types';
import { UNIT_DEFS } from '../../shared/catalog';
import type { AllocationMethodProvider, AllocationMethodQuoteInput, AllocationReason, ExecutableMethod, MethodAllocationQuote } from './allocation-types';
import { goalValueKey } from './goal-facts';
import { productionUsesOverlap } from './production-use';
import type { GoalActionNode, GoalEntityReference, GoalEntityResolver, GoalParameter, GoalPlan, GoalPlannerOutput } from './goal-planner-types';
import type { DecisionFacts } from './decision';
import type { Objective, ProductionUse, Target } from './types';
import { discountedValue, resolveValuation, valuationWindow } from './utility';
import { goalPlanCapital } from './goal-plan-capital';

const ID = 'goal:ready-plan-bundles';
const terminal = (state: string) => ['complete', 'failed', 'abandoned'].includes(state);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const reason = (code: string, factIds: readonly string[] = []): AllocationReason => ({ code, factIds, values: {} });
const refId = (ref: unknown) => record(ref) && ref.kind === 'existing' && typeof ref.entityId === 'string' ? ref.entityId : null;
function unresolved(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(unresolved);
  return record(value) && (value.kind === 'output' || value.kind === 'binding' || value.kind === 'pool-member' || Object.values(value).some(unresolved));
}
function target(value: unknown): Target | null {
  if (!record(value) || !record(value.point) || typeof value.point.x !== 'number' || typeof value.point.y !== 'number'
    || !Number.isFinite(value.point.x) || !Number.isFinite(value.point.y)) return null;
  return value as Target;
}
export type GoalPlanRequotation = Readonly<{ state: 'known'; plan: GoalPlan }>
  | Readonly<{ state: 'pending' | 'unmet'; reason: AllocationReason }>;
export type GoalPlanMethodInput = Readonly<{
  snapshot: GameSnapshot; objectives: readonly DecisionFacts<Objective>[]; output: GoalPlannerOutput;
  /** The common owner scope resolves buildings and fungible pool selections.
   * No domain executor or method materializer chooses an ungranted entity. */
  resolve?: GoalEntityResolver;
  /** Regresses on the same Situation/query/work scope after actual exclusions;
   * missing computation remains pending, never zero displacement. */
  requote?: (request: AllocationMethodQuoteInput, plan: GoalPlan) => GoalPlanRequotation;
}>;

/** All ready atoms of one plan share one remaining-chain price. Future costs
 * share one quote; capital is saved from actual cash after admission. */
export function createGoalPlanMethods(input: GoalPlanMethodInput): Readonly<{
  methods: readonly ExecutableMethod[]; provider: AllocationMethodProvider;
  deferred: readonly Readonly<{ planId: string; reason: AllocationReason }>[];
}> {
  const methods: ExecutableMethod[] = [], plans = new Map<string, GoalPlan>(), deferred: { planId: string; reason: AllocationReason }[] = [];
  for (const plan of [...input.output.plans].sort((a, b) => a.goal.id.localeCompare(b.goal.id))) {
    if (plan.status !== 'ready' || plan.valueGold === null || plan.valueGold <= 0 || !plan.readyActionIds.length) continue;
    const objective = input.objectives.find(objective => objective.id === plan.goal.id && objective.owner === plan.goal.owner);
    if (!objective || terminal(objective.status)) continue;
    const ready = plan.actions.filter(action => plan.readyActionIds.includes(action.id));
    if (ready.some(node => node.declaration.precision === 'coarse')) {
      deferred.push({ planId: plan.id, reason: reason('goal-selected-exact-refinement-pending', ready.map(node => node.id)) });
      continue;
    }
    const fixed = ready.flatMap(node => node.declaration.demands.flatMap(demand => demand.resource.kind === 'entity-control'
      && demand.resource.entity.kind === 'existing' ? [demand.resource.entity.entityId] : demand.resource.kind === 'unit' ? [demand.resource.unitId] : []));
    const resolved = new Map<string, Extract<GoalEntityReference, { kind: 'existing' }>>();
    const resolve = (value: GoalParameter): GoalParameter => {
      if (Array.isArray(value)) return value.map(resolve);
      if (!record(value)) return value;
      if (['existing', 'output', 'binding', 'pool-member'].includes(String(value.kind))) {
        const ref = value as GoalEntityReference;
        if (ref.kind === 'existing') return ref;
        const key = goalValueKey(ref), actual = resolved.get(key) ?? input.resolve?.(ref,
          { excludedUnitIds: [...new Set([...fixed, ...[...resolved.values()].map(value => value.entityId)])].sort() });
        if (!actual) return value; resolved.set(key, actual); return actual;
      }
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item as GoalParameter)]));
    };
    const capital = goalPlanCapital(plan);
    const pendingCapital = capital.pending.filter(item => !ready.some(action => action.id === item.actionId && action.declaration.kind === 'train'));
    if (pendingCapital.length) { deferred.push(...pendingCapital.map(item => ({ planId: plan.id, reason: item.reason }))); continue; }
    const actions: ExecutableMethod['actions'][number][] = [], spends: ExecutableMethod['spends'][number][] = capital.spends
      .map(({ paymentSchedule: _evidence, ...spend }) => spend);
    let blocked = false; const exclusive = new Set<string>();
    for (const node of ready) {
      if (node.state !== 'ready' || node.startTick === null || node.finishTick === null) { blocked = true; break; }
      const declaration = node.declaration, parameters = resolve(declaration.executor.parameters);
      if (declaration.precision === 'coarse') { blocked = true; break; }
      const demands = resolve(declaration.demands as unknown as GoalParameter) as unknown as typeof declaration.demands;
      if (!record(parameters) || unresolved(parameters) || unresolved(demands)) { blocked = true; break; }
      const unitIds: string[] = [];
      for (const demand of demands) {
        const id = demand.resource.kind === 'entity-control' ? refId(demand.resource.entity)
          : demand.resource.kind === 'unit' ? demand.resource.unitId : null;
        if (id && input.snapshot.units.some(unit => unit.id === id && unit.owner === plan.goal.owner && unit.hp > 0)) unitIds.push(id);
        else if (id) { blocked = true; break; }
      }
      if (blocked) break;
      const amount = declaration.flows.filter(flow => flow.resource.kind === 'gold' && flow.at === 'start' && flow.delta < 0)
        .reduce((sum, flow) => sum - flow.delta, 0);
      const actionId = `goal:${plan.goal.id}:${node.id}`, spendId = capital.byAction.get(node.id) ?? `goal-capital:${actionId}`;
      if (amount && !spends.some(spend => spend.spendId === spendId)) spends.push({ spendId, amountGold: amount, includedUtilityTermCodes: ['remaining-plan-actions'], externalReservationIds: [] });
      const producerId = declaration.kind === 'train' ? refId(parameters.producer) : null;
      const keys = [...new Set(unitIds)].map(id => `unit:${id}`); if (producerId) keys.push(`queue:${producerId}`);
      if (keys.some(key => exclusive.has(key))) { blocked = true; break; }
      keys.forEach(key => exclusive.add(key));
      const unitKind = parameters.unitKind;
      if (declaration.kind === 'train' && (!producerId || typeof unitKind !== 'string' || !(unitKind in UNIT_DEFS))) { blocked = true; break; }
      actions.push({ id: actionId, executor: `goal.${declaration.kind}`,
        intent: { kind: 'goal-action', goalId: plan.goal.id, declarationId: declaration.id, actionKind: declaration.kind,
          parameters, outputs: declaration.outputs },
        target: target(parameters.at) ?? target(parameters.target) ?? target(parameters.shelter) ?? objective.target,
        ...(producerId ? { production: { producer: { kind: 'existing', buildingId: producerId }, unitKind: unitKind as TrainableUnitKind,
          request: { kind: 'submit', spendId } } } : {}),
        demands: amount ? [{ kind: 'gold', amount }] : [], spendIds: amount ? [spendId] : [], dependsOn: [],
        completionEffects: [], unitIds: [...new Set(unitIds)].sort() });
    }
    if (blocked || actions.length !== ready.length) { deferred.push({ planId: plan.id, reason: reason('goal-ready-reference-unresolved', ready.map(node => node.id)) }); continue; }
    const id = `goal-bundle:${plan.goal.id}`;
    const unitIds = [...new Set(actions.flatMap(action => action.unitIds ?? []))].sort();
    methods.push({ id, objectiveId: objective.id, kind: 'goal-plan', stage: 'goal-plan', providerId: ID,
      goalBundle: { planId: plan.id, unitIds }, preference: 0, spends, actions, preconditions: [], subgoals: [], demands: [],
      estimatedTicks: Math.max(0, (plan.completedTick ?? input.snapshot.tick) - input.snapshot.tick), status: 'candidate', reasons: [] });
    plans.set(id, plan);
  }
  const provider: AllocationMethodProvider = { id: ID, buildMethods: () => methods,
    quote(request) {
      const original = plans.get(request.method.id);
      if (!original) return unavailable(request, 'goal-plan-not-recorded', false);
      const expected = request.method.goalBundle?.unitIds ?? [], actual = new Set(request.unitIds);
      const planProduction: ProductionUse[] = original.actions.flatMap(node => node.declaration.demands.flatMap(demand => {
        const resource = demand.resource;
        return resource.kind === 'production-lane' && resource.producer.kind === 'existing' && node.startTick !== null && node.finishTick !== null
          ? [{ buildingId: resource.producer.entityId, lane: 'training' as const, fromTicks: Math.max(0, node.startTick - input.snapshot.tick),
            throughTicks: Math.max(1, node.finishTick - input.snapshot.tick) }] : [];
      }));
      const excluded = expected.some(id => !actual.has(id) || request.valuation?.unavailableUnitIds?.includes(id))
        || productionUsesOverlap(planProduction, request.valuation?.unavailableProduction ?? []);
      const replacement = excluded ? input.requote?.({ ...request, valuation: { ...(request.valuation ?? { phase: 'gross' as const }),
        unavailableUnitIds: [...new Set([...(request.valuation?.unavailableUnitIds ?? []), ...expected.filter(id => !actual.has(id))])].sort() } }, original) : undefined;
      if (excluded && (!replacement || replacement.state !== 'known'))
        return unavailable(request, replacement?.reason.code ?? 'goal-counterfactual-facts-pending', replacement?.state !== 'unmet');
      const plan = replacement?.state === 'known' ? replacement.plan : original;
      if (plan.status !== 'ready' || plan.valueGold === null || plan.completedTick === null || plan.costGold === null || plan.successProbability === null)
        return unavailable(request, 'goal-remaining-plan-unquoted', plan.status !== 'blocked');
      const through = Math.max(input.snapshot.tick, ...plan.actions.map(action => action.finishTick ?? input.snapshot.tick));
      const window = valuationWindow(through - input.snapshot.tick, request.valuation);
      const production: ProductionUse[] = request.method.actions.flatMap(action => {
        const producer = action.production?.producer, node: GoalActionNode | undefined = plan.actions.find(node => action.intent.kind === 'goal-action' && node.id === action.intent.declarationId);
        return producer?.kind === 'existing' && node?.finishTick !== null && node?.finishTick !== undefined
          ? [{ buildingId: producer.buildingId, lane: 'training', fromTicks: 0, throughTicks: Math.max(1, node.finishTick - input.snapshot.tick) }] : [];
      });
      const valuation = resolveValuation({ objectiveId: plan.goal.id, methodId: request.method.id, unitIds: request.unitIds, production, window }, request.valuation);
      if (valuation.phase === 'net' && valuation.opportunity?.status !== 'known') return { ...unavailable(request, 'goal-opportunity-facts-pending', true), valuation };
      const reward = discountedValue(plan.goal.rewardGold, Math.max(0, plan.completedTick - input.snapshot.tick), window);
      const opportunity = valuation.opportunity?.status === 'known' ? valuation.opportunity.gold : 0;
      return { methodId: request.method.id, status: 'feasible', force: null, potentialUtility: null, missingPreconditions: [], valuation,
        reason: reason('whole-remaining-goal-plan', [plan.id]), utility: { horizonTicks: window.horizonTicks,
          benefit: [{ code: 'goal-effect-reward', value: reward }], cost: [{ code: 'remaining-plan-actions', value: plan.costGold },
            ...(valuation.phase === 'net' ? [{ code: 'bundle-opportunity', value: opportunity }] : [])],
          successProbability: plan.successProbability, persistenceBonus: 0, score: plan.successProbability * reward - plan.costGold - opportunity } };
    } };
  return { methods, provider, deferred };
}
function unavailable(request: AllocationMethodQuoteInput, code: string, pending: boolean): MethodAllocationQuote {
  const why = reason(code, [request.method.id]);
  return { methodId: request.method.id, status: 'blocked', utility: null, potentialUtility: null, force: null, reason: why,
    missingPreconditions: [{ id: `${request.method.id}/${code}`, kind: 'force', status: pending ? 'unknown' : 'unmet', reason: why, demand: null, subgoalIds: [] }] };
}
