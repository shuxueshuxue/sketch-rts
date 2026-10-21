import { unitMover } from '../../shared/catalog';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { assessAllocatedDefenseBattle, assessAllocatedForce } from './allocated-force';
import { calibratedAlphaGoalCampBattleModel, type GoalCampBattleModel } from './goal-camp-quotation';
import { arrivalWeightedForce } from './arrival-force';
import type { DecisionFacts } from './decision';
import { defenseProtectionValue, type defenseThreatScenarios } from './defense-risk';
import { goalValueKey, resolveGoalCamp } from './goal-facts';
import type { GoalActionCost, GoalCandidates, GoalCohortMember, GoalCombatOption, GoalEntityReference, GoalEstimate,
  GoalFact, GoalFactObservation } from './goal-planner-types';
import { strategyIsOpponent } from './ownership';
import { strategicTargetCamp } from './target-camp';
import type { Situation, Target } from './types';

export type GoalMovementRisk = Readonly<{ expectedLossGold: number; survivalProbability: number }>;
export type GoalNavalCombatInput = Readonly<{
  snapshot: GameSnapshot; situation: DecisionFacts<Situation>; effect: GoalFact;
  cohort: readonly GoalCohortMember[]; from: Target; target: Target; byTick: number;
  /** Published prerequisites, never calls to a private route reader. */
  routes: readonly GoalFactObservation[];
  /** This action's actual march/contact delay. Excludes prerequisite assembly. */
  arrivalTicks: GoalEstimate<number>;
  movementRisk?: GoalEstimate<GoalMovementRisk>;
}>;
export type GoalCampCombatInput = GoalNavalCombatInput & Readonly<{
  campId: string; staging: Target;
  /** Published legality/safety facts for this attack staging point. */
  stagingFacts: readonly GoalFactObservation[];
  battleModel?: GoalCampBattleModel;
}>;
export type GoalDefenseCombatInput = GoalNavalCombatInput & Readonly<{
  /** Exact source-selected guard post; target remains the protected site. */
  post?: Target;
  requiredCombatRating: GoalEstimate<number>;
  defense: GoalEstimate<Readonly<{
    threat: ReturnType<typeof defenseThreatScenarios>;
    opponents: readonly Readonly<{ unit: Unit; share: number }>[];
    hostileTowers: readonly Building[]; staticForce: number; windowTicks: number;
    /** Present members remain available in the failed-arrival branch. */
    onStation: readonly GoalEntityReference[];
  }>>;
}>;
const unique = (items: readonly string[]) => [...new Set(items)].sort();
const reason = (code: string, factIds: readonly string[] = []) => ({ code, factIds: unique(factIds), values: {} });
const known = <T>(value: T, factIds: readonly string[]): GoalEstimate<T> => ({ state: 'met', value, factIds: unique(factIds) });
function pending(code: string, factIds: readonly string[], requestIds: readonly string[] = factIds): Exclude<GoalEstimate<never>, { state: 'met' | 'unmet' }> {
  return { state: 'pending', requestIds: unique(requestIds.length ? requestIds : [`naval-assessment:${code}`]), reason: reason(code, factIds) };
}
const unmet = (code: string, factIds: readonly string[] = []): Extract<GoalCandidates<never>, { state: 'unmet' }> => ({ state: 'unmet', reason: reason(code, factIds) });
function selected(input: GoalNavalCombatInput) {
  const members = new Map<string, GoalCohortMember>();
  for (const member of input.cohort) {
    const key = goalValueKey(member.reference), prior = members.get(key), unit = member.assessment;
    if (prior && goalValueKey(prior.assessment) !== goalValueKey(unit)) return null;
    if (unit.owner !== input.situation.owner || !(unit.hp > 0) || unit.kind === 'worker' || unitMover(unit.kind) !== 'land') return null;
    if (member.reference.kind === 'existing') {
      const current = input.snapshot.units.find(unit => member.reference.kind === 'existing' && unit.id === member.reference.entityId);
      if (!current || current.owner !== unit.owner || current.kind !== unit.kind || current.hp <= 0) return null;
    }
    members.set(key, member);
  }
  return [...members.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, member]) => member);
}
/** Private copies permit native whole-group assessment of explicit outputs.
 * No copy ID is emitted in an option, prerequisite, lease or execution ref. */
function assessment(input: GoalNavalCombatInput, members: readonly GoalCohortMember[], at: Target) {
  const occupied = new Set(input.snapshot.units.map(unit => unit.id));
  const units = members.map(member => {
    let id = member.reference.kind === 'existing' ? member.reference.entityId : `goal-combat-assessment:${goalValueKey(member.reference)}`;
    if (member.reference.kind !== 'existing') { while (occupied.has(id)) id += ':'; occupied.add(id); }
    return { ...member.assessment, id, x: at.point.x, y: at.point.y, deck: undefined, cabin: undefined };
  });
  const ids = new Set(units.map(unit => unit.id));
  return { units, snapshot: { ...input.snapshot, units: [...input.snapshot.units.filter(unit => !ids.has(unit.id)), ...units] } };
}
function initial(input: GoalNavalCombatInput) {
  if (input.snapshot.tick !== input.situation.tick || !Number.isFinite(input.byTick) || input.byTick < input.snapshot.tick) return unmet('combat-epoch-or-deadline-invalid', [input.effect.id]);
  const members = selected(input);
  if (!members) return unmet('combat-cohort-binding-invalid', [input.effect.id]);
  if (!members.length) return unmet('clearing-force-empty', [input.effect.id]);
  const factIds = unique([input.effect.id, ...input.routes.map(row => row.fact.id), ...input.routes.flatMap(row => row.reason.factIds)]);
  const routeMissing = input.routes.find(row => row.fact.predicate.kind !== 'route');
  if (routeMissing) return unmet('combat-route-fact-type-invalid', [routeMissing.fact.id]);
  return { members, factIds };
}
function routeTiming(input: GoalNavalCombatInput): GoalEstimate<number> {
  const blocked = input.routes.find(row => row.state === 'unmet');
  if (blocked) return { state: 'unmet', reason: blocked.reason };
  const unresolved = input.routes.filter(row => row.state === 'pending');
  if (unresolved.length) return pending('combat-route-pending', unresolved.map(row => row.fact.id), unresolved.flatMap(row => row.state === 'pending' ? [row.requestId] : []));
  if (input.arrivalTicks.state !== 'met') return input.arrivalTicks;
  return Number.isFinite(input.arrivalTicks.value) && input.arrivalTicks.value >= 0
    ? input.arrivalTicks : { state: 'unmet', reason: reason('combat-arrival-time-invalid', input.arrivalTicks.factIds) };
}
function risk(input: GoalNavalCombatInput): GoalEstimate<GoalMovementRisk> {
  const risk = input.movementRisk ?? pending('combat-movement-risk-unquoted', input.routes.map(row => row.fact.id));
  if (risk.state !== 'met') return risk;
  return Number.isFinite(risk.value.expectedLossGold) && risk.value.expectedLossGold >= 0
    && Number.isFinite(risk.value.survivalProbability) && risk.value.survivalProbability >= 0 && risk.value.survivalProbability <= 1
    ? risk : { state: 'unmet', reason: reason('combat-movement-risk-invalid', risk.factIds) };
}
function option(input: GoalNavalCombatInput, members: readonly GoalCohortMember[], target: Target, requiredForce: number,
  estimates: Pick<GoalCombatOption, 'duration' | 'cost' | 'successProbability' | 'effectDelayTicks'>, factIds: readonly string[], campId?: string): GoalCandidates<GoalCombatOption> {
  const cohort = members.map(member => member.reference);
  const id = `goal-combat:${goalValueKey([input.effect.id, cohort, input.from, target, campId, input.byTick])}`;
  return { state: 'met', candidates: [{ id, target, from: input.from, cohort, requiredForce, byTick: input.byTick,
    ...(campId ? { campId } : {}), ...estimates, preconditions: input.routes.map(row => row.fact), factIds: unique(factIds) }], factIds: unique(factIds) };
}
function costs(lossGold: number, movement: GoalMovementRisk, factIds: readonly string[]): readonly GoalActionCost[] {
  return [{ code: 'combat-attrition', gold: lossGold, factIds: unique(factIds) },
    { code: 'combat-movement-loss', gold: movement.expectedLossGold, factIds: unique(factIds) }];
}

/** Source selects the camp and a legal staging post. This helper never chooses
 * a post, cohort, route, reinforcement intention or a new fact/query service. */
export function assessGoalCampCombatOption(input: GoalCampCombatInput): GoalCandidates<GoalCombatOption> {
  const init = initial(input); if ('state' in init) return init;
  if (!input.stagingFacts.some(row => row.fact.predicate.kind === 'camp-staging' && row.fact.predicate.campId === input.campId
    && goalValueKey(row.fact.predicate.at) === goalValueKey(input.staging)
    && goalValueKey(row.fact.predicate.cohort) === goalValueKey(init.members.map(member => member.reference))))
    return pending('combat-staging-facts-unquoted', [input.campId]);
  init.factIds.push(...input.stagingFacts.map(row => row.fact.id));
  if (!['camp-cleared', 'gold'].includes(input.effect.predicate.kind)
    || input.effect.predicate.kind === 'camp-cleared' && input.effect.predicate.campId !== input.campId) return unmet('combat-camp-effect-mismatch', [input.effect.id]);
  const camp = resolveGoalCamp(input.snapshot, input.campId);
  if (camp.status !== 'present') return unmet(camp.status === 'cleared' ? 'combat-camp-already-cleared' : 'combat-camp-binding-invalid', [input.campId]);
  if (!input.target.landId || input.staging.landId !== input.target.landId) return unmet('combat-staging-region-mismatch', [input.campId]);
  // The existing model still locates its camp geographically. Refuse a model
  // lookup that resolves a different camp rather than silently changing IDs.
  const nativeCamp = strategicTargetCamp(input.snapshot, input.target);
  if (!nativeCamp || goalValueKey(nativeCamp.creeps.map(unit => unit.id).sort()) !== goalValueKey(camp.exposure.camp.creeps.map(unit => unit.id).sort()))
    return pending('combat-native-camp-binding-pending', [input.campId]);
  const timing = routeTiming(input), movement = risk(input);
  const unresolvedUnload = input.snapshot.units.filter(unit => unit.hp > 0 && strategyIsOpponent(input.snapshot, input.situation.owner, unit.owner)
    && (unit.deck || unit.cabin) && input.snapshot.units.some(ship => ship.id === (unit.deck?.shipId ?? unit.cabin?.shipId) && ship.order.type === 'unload'));
  // targetEnemyReinforcements currently projects native unload goals itself.
  // Do not let this pure planning port invoke that unbudgeted pathfinder.
  const unavailable = unresolvedUnload.length ? pending('combat-enemy-unload-binding-pending', unresolvedUnload.map(unit => unit.id)) : timing.state !== 'met' ? timing : null;
  const requiredForce = assessAllocatedForce(input.situation.owner, [], { metric: 'camp-force', camp: camp.exposure.camp }).requiredForce;
  if (unavailable) {
    const result = option(input, init.members, input.staging, requiredForce,
      { duration: unavailable, cost: unavailable, successProbability: unavailable }, init.factIds, input.campId);
    return result.state === 'met' ? { ...result, candidates: result.candidates.map(item => ({ ...item,
      preconditions: [...item.preconditions, ...input.stagingFacts.map(row => row.fact)] })) } : result;
  }
  if (timing.state !== 'met') return timing;
  const assessed = assessment(input, init.members, input.staging);
  const battle = (input.battleModel ?? calibratedAlphaGoalCampBattleModel)({ snapshot: assessed.snapshot, situation: input.situation, target: input.target,
    unitIds: assessed.units.map(unit => unit.id), battleStartTicks: timing.value });
  const ids = unique([...init.factIds, input.campId, ...(battle.state === 'met' ? battle.factIds : battle.reason.factIds),
    ...timing.factIds, ...(movement.state === 'met' ? movement.factIds : movement.reason.factIds)]);
  const unknownBattle = battle.state !== 'met' ? battle : null;
  const duration = unknownBattle ?? known(timing.value + (battle.state === 'met' ? battle.value.battleTicks : 0), ids);
  let cost: GoalCombatOption['cost'], successProbability: GoalCombatOption['successProbability'];
  if (battle.state !== 'met') { cost = battle; successProbability = battle; }
  else if (movement.state !== 'met') { cost = movement; successProbability = movement; }
  else {
    cost = known(costs(movement.value.survivalProbability * battle.value.expectedLossGold, movement.value, ids), ids);
    successProbability = known(movement.value.survivalProbability * battle.value.successProbability, ids);
  }
  const result = option(input, init.members, input.staging, battle.state === 'met' ? battle.value.requiredForce : requiredForce,
    { duration, cost, successProbability }, ids, input.campId);
  return result.state === 'met' ? { ...result, candidates: result.candidates.map(item => ({ ...item,
    preconditions: [...item.preconditions, ...input.stagingFacts.map(row => row.fact)],
    factIds: unique([...item.factIds, ...input.stagingFacts.map(row => row.fact.id)]) })) } : result;
}

/** Shared threat scenarios retain whole enemy armies. Actual damage/deaths and
 * nonlinear protection P reuse the existing defense model without pricing the
 * protected asset as an action cost or charging bundle opportunity twice. */
export function assessGoalDefenseCombatOption(input: GoalDefenseCombatInput): GoalCandidates<GoalCombatOption> {
  const init = initial(input); if ('state' in init) return init;
  const requested = input.effect.predicate;
  const protectedSite = requested.kind === 'site-safe' ? requested.site : requested.kind === 'garrison-ready' ? requested.at : null;
  const post = input.post ?? input.target;
  if (!protectedSite || goalValueKey(protectedSite) !== goalValueKey(input.target)
    || input.target.landId !== post.landId)
    return unmet('combat-defense-effect-mismatch', [input.effect.id]);
  if (input.requiredCombatRating.state !== 'met') return input.requiredCombatRating;
  if (!Number.isFinite(input.requiredCombatRating.value) || input.requiredCombatRating.value < 0) return unmet('combat-defense-threshold-invalid', input.requiredCombatRating.factIds);
  const timing = routeTiming(input), movement = risk(input);
  const through = requested.kind === 'site-safe' ? requested.throughTick : input.byTick, durationTicks = through - input.snapshot.tick;
  if (!Number.isFinite(durationTicks) || durationTicks < 0) return unmet('combat-defense-window-expired', [input.effect.id]);
  const unavailable = timing.state !== 'met' ? timing : input.defense.state !== 'met' ? input.defense : null;
  if (unavailable) return option(input, init.members, post, input.requiredCombatRating.value,
    { duration: unavailable, cost: unavailable, successProbability: unavailable, effectDelayTicks: timing }, init.factIds);
  if (input.defense.state !== 'met' || timing.state !== 'met') return pending('combat-defense-facts-pending', init.factIds);
  const data = input.defense.value;
  if (data.threat.status === 'unknown') {
    const missing = pending(data.threat.reasonCode, data.threat.unknownIds);
    return option(input, init.members, post, input.requiredCombatRating.value,
      { duration: known(Math.max(timing.value, durationTicks), init.factIds), effectDelayTicks: timing, cost: missing, successProbability: missing }, init.factIds);
  }
  if (new Set(data.opponents.map(entry => entry.unit.id)).size !== data.opponents.length
    || data.opponents.some(entry => !strategyIsOpponent(input.snapshot, input.situation.owner, entry.unit.owner)))
    return unmet('combat-defense-opponent-binding-invalid', init.factIds);
  if (!Number.isFinite(data.windowTicks) || data.windowTicks <= 0 || !Number.isFinite(data.staticForce) || data.staticForce < 0
    || timing.value > durationTicks || data.opponents.some(entry => !Number.isFinite(entry.share) || entry.share < 0 || entry.share > 1)) return unmet('combat-defense-model-input-invalid', init.factIds);
  if (data.threat.scenarios.some(scenario => scenario.probability > 0 && scenario.unitIds.some(id => !data.opponents.some(entry => entry.unit.id === id))))
    return pending('combat-defense-opponent-shape-pending', data.threat.oppositionIds);
  const assessed = assessment(input, init.members, post), station = new Set(data.onStation.map(goalValueKey));
  if ([...station].some(ref => !init.members.some(member => goalValueKey(member.reference) === ref))) return unmet('combat-defense-on-station-binding-invalid', init.factIds);
  const stationed = assessed.units.filter((_, index) => station.has(goalValueKey(init.members[index]!.reference)));
  const incoming = assessed.units.filter((_, index) => !station.has(goalValueKey(init.members[index]!.reference)));
  const weighted = arrivalWeightedForce(stationed, incoming.map(unit => ({ unit, etaTicks: timing.value })), data.windowTicks,
    units => assessAllocatedForce(input.situation.owner, units, { metric: 'field-strength', requiredForce: 0 }).force);
  const protection = defenseProtectionValue({ threat: data.threat, assetValueGold: 1, cohortForce: weighted.effectiveForce, staticForce: data.staticForce })!;
  const here = defenseProtectionValue({ threat: data.threat, assetValueGold: 1, cohortForce: weighted.onStationForce, staticForce: data.staticForce })!;
  const battleCost = (units: readonly Unit[]) => data.threat.scenarios.reduce((sum, scenario) => sum + scenario.probability * assessAllocatedDefenseBattle({
    snapshot: assessed.snapshot, units, opponents: data.opponents.filter(entry => scenario.unitIds.includes(entry.unit.id)),
    towers: data.hostileTowers, windowTicks: data.windowTicks }).casualties.expectedLossGold, 0);
  const ids = unique([...init.factIds, ...input.defense.factIds, ...input.requiredCombatRating.factIds, ...timing.factIds,
    ...(movement.state === 'met' ? movement.factIds : movement.reason.factIds)]);
  return option(input, init.members, post, input.requiredCombatRating.value, {
    duration: known(Math.max(timing.value, durationTicks), ids), effectDelayTicks: timing,
    cost: movement.state !== 'met' ? movement : known(costs(movement.value.survivalProbability * battleCost(assessed.units)
      + (1 - movement.value.survivalProbability) * battleCost(stationed), movement.value, ids), ids),
    successProbability: movement.state !== 'met' ? movement : known(movement.value.survivalProbability * protection.successProbability
      + (1 - movement.value.survivalProbability) * here.successProbability, ids),
  }, ids);
}
