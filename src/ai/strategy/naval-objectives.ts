import { snapshotUnitIndex } from './world-index';
import { frameMemo } from './frame-reuse';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { walkableGoal } from '../../shared/terrain';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { bodyMass } from '../../shared/physical-body';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Unit } from '../../shared/types';
import { distance } from '../policy/spatial';
import { isOpponentOwner } from '../policy/ownership';
import { isBacklineKind } from '../policy/v6/backline';
import { creepForce, EXPANSION_GUARD_RANGE, forceFor } from '../policy/v7/creep';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { neutralCampPointContacts } from '../situation/neutral-camp-contact';
import { objectiveId } from './commitments';
import { landIdAt } from './regions';
import { discountGold, forceSuccessProbability, forceTimeGold, STRATEGY_PARAMETERS, strategyUtility } from './utility';
import type { Arrival, Asset, Effect, Method, Objective, ObjectiveKind, PlanningContext, Precondition, Reason,
  ResourceDemand, Situation, SituationUnit, SiteThreat, Subgoal, Target, Utility } from './types';
import type { PreviousObjective } from './observation-memory';
import { deferredEvidence, lazyValue, projectedCopy, projectedProperty, projectedValueReader } from './explanations';

const STATION_RANGE = 650;
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const sumStrength = (units: readonly SituationUnit[]) => units.reduce((sum, unit) => sum + unit.strength, 0);
const route = (unit: SituationUnit, targetId: string) => unit.arrivals.find(entry => entry.targetId === targetId)?.arrival;
const duration = (arrival: Arrival | undefined) => arrival && 'ticks' in arrival ? arrival.ticks : undefined;
const reason = (tick: number, code: string, detail: string | (() => string), source = 'strategy.naval-objectives'): Reason => {
  const text = lazyValue(typeof detail === 'function' ? detail : () => detail);
  return deferredEvidence(projectedProperty({ code }, 'detail', text), () => [{ source, tick, certainty: 'inferred', detail: text() }]);
};
const fieldDemand = (target: Target, strength: number, permanent = false): ResourceDemand => ({ kind: 'force', metric: 'field-strength',
  strength, roles: ['frontline', 'ranged'], at: target, neededByTick: null, permanent });
const campDomain = Symbol('strategy-frame-camps');
function collapseAfter(context: PlanningContext, threat: SiteThreat, hp: number): number {
  const events = threat.attackers.flatMap(attacker => {
    const unit = context.snapshot.units.find(unit => unit.id === attacker.unitId);
    return unit && 'ticks' in attacker.arrival ? [{ tick: attacker.arrival.ticks,
      dps: combatCapability(context.snapshot, unit).dps / SIM_TICKS_PER_SECOND }] : [];
  }).sort((a, b) => a.tick - b.tick);
  let previous = 0, damagePerTick = 0, remaining = hp;
  for (const event of events) {
    const loss = (event.tick - previous) * damagePerTick;
    if (damagePerTick > 0 && remaining <= loss) return previous + remaining / damagePerTick;
    remaining -= loss; previous = event.tick; damagePerTick += event.dps;
  }
  return damagePerTick > 0 ? previous + remaining / damagePerTick : threat.horizonTicks;
}
function campFacts(context: PlanningContext) {
  return frameMemo(campDomain, context.snapshot, () => neutralCampExposure(context.snapshot));
}
function campAt(context: PlanningContext, target: Target) {
  return campFacts(context).camps.find(exposure => distance(exposure.camp.center, target.point) <= EXPANSION_GUARD_RANGE)?.camp;
}
function stationed(situation: Situation, target: Target) {
  return situation.units.filter(unit => unit.owner === situation.owner && !unit.roles.includes('worker')
    && unit.location.kind === 'land' && unit.location.landId === target.landId && distance(unit.location.point, target.point) <= STATION_RANGE);
}
function candidates(situation: Situation, targetId: string, present: readonly SituationUnit[], permanent = false) {
  const ids = new Set(present.map(unit => unit.id));
  return situation.units.filter(unit => unit.owner === situation.owner && !ids.has(unit.id) && unit.strength > 0
    && !unit.roles.some(role => role === 'worker' || role === 'transport' || role === 'warship')
    && unit.hp >= unit.maxHp * .35 && (!permanent || unit.expiresTick === null)
    && !unit.commitments.some(task => task.source.startsWith('mobileCare.') || task.source.startsWith('frontRecovery.')
      || task.source === 'retreat.inferred-order' || task.source === 'unitClaims.workerSafety')
    && duration(route(unit, targetId)) !== undefined
    && (unit.expiresTick === null || unit.expiresTick > situation.tick + duration(route(unit, targetId))! + 30 * SIM_TICKS_PER_SECOND))
    .sort((a, b) => duration(route(a, targetId))! - duration(route(b, targetId))! || byId(a, b));
}
function hallAt(context: PlanningContext, target: Target) {
  return context.snapshot.buildings.find(hall => hall.owner === context.owner && hall.kind === 'townHall' && hall.hp > 0
    && landIdAt(context.snapshot.map, hall) === target.landId && distance(hall, target.point) <= GOLD_MINE_RULES.baseRange);
}
const forceDomain = Symbol('strategy-frame-conquest-forces');
function conquestForce(situation: Situation, context: PlanningContext, target: Target) {
  const values = frameMemo(forceDomain, situation, () => new Map<string, ReturnType<typeof assessConquestForce>>());
  const key = `${target.entityId}:${target.point.x}:${target.point.y}`;
  if (!values.has(key)) values.set(key, assessConquestForce(situation, context, target));
  return values.get(key)!;
}
function assessConquestForce(situation: Situation, context: PlanningContext, target: Target) {
  const raw = snapshotUnitIndex(context.snapshot).all;
  const combatants = (units: readonly SituationUnit[]) => units.flatMap(unit => {
    const actor = raw!.get(unit.id);
    return actor && unit.expiresTick === null && !isBacklineKind(actor) && actor.attackDamage > 0
      && actor.hp >= actor.maxHp * .35 ? [actor] : [];
  });
  const present = stationed(situation, target).filter(unit => combatants([unit]).length > 0);
  const camp = campAt(context, target), required = camp ? forceFor(camp) : 1;
  const presentForce = camp ? creepForce(combatants(present), camp) : sumStrength(present);
  const groups = new Map<string, SituationUnit[]>();
  for (const unit of candidates(situation, target.entityId!, present, true).filter(unit => combatants([unit]).length)) {
    const key = unit.location.kind === 'land' ? unit.location.landId : unit.location.kind === 'aboard' ? `aboard:${unit.location.shipId}` : 'unknown';
    const group = groups.get(key) ?? [];
    if (!groups.has(key)) groups.set(key, group);
    group.push(unit);
  }
  const batches = [...groups.values()].map(group => {
    const selected: SituationUnit[] = [];
    for (const unit of group) {
      if ((camp ? creepForce(combatants([...present, ...selected]), camp) : sumStrength([...present, ...selected])) >= required) break;
      selected.push(unit);
    }
    const force = camp ? creepForce(combatants([...present, ...selected]), camp) : sumStrength([...present, ...selected]);
    const eta = selected.length ? Math.max(...selected.map(unit => duration(route(unit, target.entityId!))!)) : 0;
    return { selected, force, eta };
  }).sort((a, b) => Number(b.force >= required) - Number(a.force >= required) || a.eta - b.eta
    || (a.selected[0]?.id ?? '').localeCompare(b.selected[0]?.id ?? ''));
  const best = batches[0] ?? { selected: [], force: presentForce, eta: 0 };
  const presentIds = new Set(present.map(unit => unit.id));
  const unknownForce = best.force < required && situation.units.some(unit => unit.owner === context.owner
    && !presentIds.has(unit.id) && unit.strength > 0 && !unit.roles.some(role => ['worker', 'transport', 'warship'].includes(role))
    && combatants([unit]).length > 0 && !unit.commitments.some(task => task.source.startsWith('mobileCare.')
      || task.source.startsWith('frontRecovery.') || task.source === 'retreat.inferred-order' || task.source === 'unitClaims.workerSafety')
    && (() => { const arrival = route(unit, target.entityId!); return !arrival || arrival.status === 'unknown'
      && arrival.reason.code !== 'beyond-evaluation-window'; })());
  return { present, presentForce, camp, required, unknownForce, ...best };
}
function atRiskValue(situation: Situation, site: Asset) {
  return situation.assets.filter(asset => (asset.owner === situation.owner || site.kind === 'hall' && asset.kind === 'mine')
    && asset.target.landId === site.target.landId && distance(asset.target.point, site.target.point) <= STATION_RANGE)
    .reduce((sum, asset) => sum + (asset.kind === 'mine' ? asset.discountedValueGold : asset.replacementGold), 0);
}
function createObjective(situation: Situation, previous: readonly PreviousObjective[], kind: ObjectiveKind, target: Target,
  effects: readonly Effect[], utility: Utility, reasons: readonly Reason[], status: Objective['status'] = 'candidate', sinceTick?: number): Objective {
  const id = objectiveId(kind, situation.owner, kind === 'ReinforceFront' ? target.landId! : target.entityId ?? target.landId!), old = previous.find(objective => objective.id === id);
  const since = sinceTick ?? old?.sinceTick ?? situation.tick;
  const persistenceBonus = status === 'active' ? Math.min(STRATEGY_PARAMETERS.maximumPersistenceGold,
    Math.max(0, utility.score) * STRATEGY_PARAMETERS.persistenceBenefitShare) : 0;
  const repriced = strategyUtility({ benefit: utility.benefit, cost: utility.cost, horizonTicks: utility.horizonTicks,
    successProbability: utility.successProbability, persistenceBonus, evidence: projectedValueReader(utility, 'evidence') });
  return { id, kind, owner: situation.owner, target: { ...target, point: { ...target.point } }, effects,
    utility: projectedCopy(repriced, { score: status === 'blocked' ? null : repriced.score }),
    ...(status === 'blocked' ? { conditionalQuote: { potentialUtility: null,
      assumptions: [reason(situation.tick, 'conditional-valuation-unknown', 'The force, route or response after missing prerequisites is not priced; current troops do not establish a conditional success quote')],
      includedPrerequisiteUtilityCodes: [] } } : {}),
    status, sinceTick: since, rank: null,
    reasons, methodIds: [], stability: { minimumStayUntilTick: old?.stability.minimumStayUntilTick
      ?? (status === 'active' ? since + STRATEGY_PARAMETERS.minimumStayTicks : situation.tick),
    challengerId: old?.stability.challengerId ?? null, challengerThinks: old?.stability.challengerThinks ?? 0 } };
}

/** Candidate generation only. Positive scores are proposals, not commands or
 * ownership; an existing voyage is not proof its original objective is useful. */
export function generateNavalObjectives(situation: Situation, context: PlanningContext, previous: readonly PreviousObjective[]): readonly Objective[] {
  const objectives: Objective[] = [], tick = situation.tick;
  const threats = situation.lands.flatMap(land => land.threats);
  const deficits = new Map<string, { target: Target; strength: number; minimumStrength: number; utility: Utility; parentId: string; reasons: Reason[] }>();
  const held = new Set(situation.units.flatMap(unit => unit.commitments.filter(task => task.source.startsWith('unitClaims.')).map(task => task.objectiveId)));
  for (const threat of threats.filter(threat => threat.attackers.length > 0 || held.has(objectiveId('DefendSite', context.owner, threat.siteId)))) {
    const site = situation.assets.find(asset => asset.id === threat.siteId)!;
    const enemy = threat.arrivedStrength + threat.incomingStrength, present = stationed(situation, site.target);
    const incoming = candidates(situation, site.id, present).filter(unit => duration(route(unit, site.id))! <= threat.horizonTicks);
    const collapseTicks = collapseAfter(context, threat, site.hp ?? 0);
    const timely = incoming.filter(unit => duration(route(unit, site.id))! <= collapseTicks);
    const available = threat.friendlyOnStationStrength + sumStrength(timely);
    const unknownThreat = threat.lossProbability === null;
    const value = atRiskValue(situation, site) * (threat.lossProbability ?? 0);
    const utility = strategyUtility({ benefit: [{ code: 'asset-loss-prevented', value, explanation: 'Replacement value and mine income at risk, weighted by the current local loss forecast' }],
      cost: [{ code: 'force-time', value: unknownThreat ? 0 : forceTimeGold(Math.min(enemy, available), threat.horizonTicks), explanation: 'Expected force occupation, paid even if the defense fails' }],
      successProbability: unknownThreat ? 0 : forceSuccessProbability(available, enemy), evidence: projectedValueReader(threat, 'evidence') });
    const reasons = [reason(tick, 'site-under-threat', `${site.id}: on station ${threat.friendlyOnStationStrength}; enemy ${enemy}; estimated collapse ${Math.ceil(collapseTicks)} ticks`),
      reason(tick, timely.length ? 'timely-response-candidates' : 'no-timely-response', timely.length ? timely.map(unit => unit.id).join(', ') : 'No forecast force arrives before the current-HP/DPS deadline; this is not a promise the site can be saved')];
    if (unknownThreat) reasons.push(reason(tick, 'threat-geometry-pending', 'Coarse attacker presence is recorded; a pending arrival field must not become a safety claim or a successful defense quote'));
    objectives.push(createObjective(situation, previous, 'DefendSite', site.target,
      [{ kind: 'site-safe', siteId: site.id, throughTick: tick + threat.horizonTicks }], utility, reasons,
      unknownThreat || enemy > 0 && available <= 0 ? 'blocked'
        : context.memory.miningDefense?.hallId === site.id || held.has(objectiveId('DefendSite', context.owner, site.id)) ? 'active' : 'candidate'));
    const deficit = Math.max(0, enemy - threat.friendlyOnStationStrength);
    if (deficit > (deficits.get(site.target.landId!)?.strength ?? 0)) deficits.set(site.target.landId!, { target: site.target,
      strength: deficit, minimumStrength: enemy, utility, parentId: objectiveId('DefendSite', situation.owner, site.id), reasons });
    const workers = situation.units.filter(unit => unit.owner === situation.owner && unit.roles.includes('worker')
      && unit.location.kind === 'land' && unit.location.landId === site.target.landId && distance(unit.location.point, site.target.point) <= STATION_RANGE);
    if (workers.length && enemy > threat.friendlyOnStationStrength) {
      const shelter = situation.assets.filter(asset => asset.owner === situation.owner && asset.kind === 'hall' && asset.complete && asset.id !== site.id
        && !threats.some(other => other.siteId === asset.id && other.arrivedStrength + other.incomingStrength > other.friendlyOnStationStrength))
        .sort((a, b) => distance(a.target.point, site.target.point) - distance(b.target.point, site.target.point) || byId(a, b))[0];
      const arrivals = shelter ? workers.map(worker => route(worker, shelter.id)) : [];
      const reachable = arrivals.length > 0 && arrivals.every(arrival => arrival?.status === 'reachable' && arrival.ticks < collapseTicks);
      objectives.push(createObjective(situation, previous, 'Evacuate', site.target,
        shelter ? [{ kind: 'assets-evacuated', unitIds: workers.map(worker => worker.id), destination: shelter.target }] : [],
        strategyUtility({ benefit: [{ code: 'workers-saved', value: workers.length * UNIT_DEFS.worker.cost, explanation: 'Paid workers at the threatened site' }],
          cost: [], successProbability: reachable ? 1 : 0, evidence: projectedValueReader(threat, 'evidence') }),
        [reason(tick, reachable ? 'evacuation-route-forecast' : 'evacuation-prerequisites-unmet', shelter ? `Shelter ${shelter.id}; boats and ETA must be feasible before abandonment` : 'No shelter site is known')], reachable ? 'candidate' : 'blocked'));
    }
  }
  const mines = new Map(situation.opportunities.filter(opportunity => opportunity.kind === 'neutral-mine')
    .map(opportunity => [opportunity.target.entityId!, opportunity.target]));
  for (const task of Object.values(context.memory.naval?.conquests ?? {})) {
    const mine = situation.assets.find(asset => asset.id === task.mineId && asset.remainingGold > 0);
    if (mine) mines.set(mine.id, mine.target);
  }
  const ownLands = new Set(situation.assets.filter(asset => asset.owner === situation.owner && asset.kind === 'hall').map(asset => asset.target.landId));
  for (const [mineId, target] of mines) {
    const task = context.memory.naval?.conquests?.[mineId];
    if (!target.landId || ownLands.has(target.landId) && !task) continue;
    const mine = situation.assets.find(asset => asset.id === mineId)!, hall = hallAt(context, target);
    const force = conquestForce(situation, context, target);
    const complete = Boolean(hall?.complete && (force.presentForce >= 1 || situation.assets.some(asset => asset.kind === 'tower'
      && asset.owner === situation.owner && asset.complete && asset.target.landId === target.landId && distance(asset.target.point, target.point) < STATION_RANGE)));
    const selectedStrength = sumStrength(force.selected);
    const crossing = force.selected.flatMap(unit => { const arrival = route(unit, mineId); return arrival && 'crossings' in arrival ? arrival.crossings : []; });
    const transportCost = crossing.some(crossing => crossing.requiresNewShip) ? UNIT_DEFS.transport.cost : 0;
    const utility = complete ? strategyUtility({ benefit: [], cost: [], successProbability: 1, evidence: [] }) : strategyUtility({
      benefit: [{ code: 'island-income', value: discountGold(mine.discountedValueGold, force.eta), explanation: 'Mine income potential over the common horizon, discounted by the force arrival forecast' },
        { code: 'new-site-asset', value: hall ? 0 : BUILDING_DEFS.townHall.cost, explanation: 'Completed hall asset after conquest' },
        { code: 'hall-after-clearing', value: hall ? 0 : -BUILDING_DEFS.townHall.cost, explanation: 'Hall capital is paid only after successful clearing' }],
      cost: [{ code: 'force-time', value: forceTimeGold(selectedStrength, Math.min(situation.horizonTicks, force.eta + 30 * SIM_TICKS_PER_SECOND)), explanation: 'Force time for assembling, sailing and clearing' },
        { code: 'new-transport', value: transportCost, explanation: 'Hull capital is paid even if the later landing fails; no reservation yet' }],
      successProbability: forceSuccessProbability(force.force, force.required), evidence: [] });
    objectives.push(createObjective(situation, previous, 'ConquerIsland', target,
      [{ kind: 'mining-established', mineId, completeHall: true, garrisonHandoff: true }], utility,
      [reason(tick, complete ? 'physical-colony-established' : force.unknownForce ? 'clearing-arrivals-unknown' : force.force >= force.required ? 'clearing-plan-candidates' : 'clearing-force-deficit',
        `${mineId}: present camp force ${force.presentForce}, proposed batch ${force.selected.map(unit => unit.id).join(', ') || 'none'}, combined ${force.force}, required ${force.required}`)],
      complete ? 'complete' : task?.abandonedTick !== undefined ? 'abandoned'
        : force.unknownForce || force.force < force.required ? 'blocked' : task ? 'active' : 'candidate', task?.sinceTick));
    const deficit = Math.max(0, force.required - force.presentForce);
    // Camp force is not field strength. Price the specific proposed batch's
    // marginal camp contribution in the common field-strength currency.
    const fieldDeficit = force.force > force.presentForce ? deficit * sumStrength(force.selected) / (force.force - force.presentForce) : 0;
    if (!complete && task?.abandonedTick === undefined && task && fieldDeficit > (deficits.get(target.landId)?.strength ?? 0))
      deficits.set(target.landId, { target, strength: fieldDeficit, minimumStrength: sumStrength(stationed(situation, target)) + fieldDeficit,
        utility, parentId: objectiveId('ConquerIsland', situation.owner, mineId),
        reasons: [reason(tick, 'named-clearing-deficit', `${mineId}: ${deficit} camp-force missing; not a six-idle-unit dispatch threshold`)] });
  }
  for (const [landId, deficit] of deficits) {
    const target: Target = { ...deficit.target, point: { ...deficit.target.point }, landId: deficit.target.landId! };
    const support = createObjective(situation, previous, 'ReinforceFront', target,
      [{ kind: 'force-present', landId: target.landId!, minimumStrength: deficit.minimumStrength, throughTick: tick + situation.horizonTicks }],
      deficit.utility, [...deficit.reasons, reason(tick, 'supports-parent-effect', deficit.parentId)],
      objectives.find(objective => objective.id === deficit.parentId)?.status === 'blocked' ? 'blocked' : 'candidate');
    objectives.push({ ...support, supportsObjectiveIds: [deficit.parentId] });
  }
  return objectives.sort(byId);
}

/** HTN proposal decomposition. All budget entries and assignments remain outside
 * policy memory; incomplete requirements stay visible instead of silently idling. */
export function decomposeNavalObjective(situation: Situation, objective: Objective, context: PlanningContext): readonly Method[] {
  if (objective.status === 'complete' || objective.status === 'abandoned') return [];
  const id = `${objective.id}/method:${objective.kind === 'ConquerIsland' ? 'staged-beachhead' : objective.kind === 'Evacuate' ? 'evacuation' : 'cross-sea-reinforcement'}`;
  const preconditions: Precondition[] = [], subgoals: Subgoal[] = [], demands: ResourceDemand[] = [];
  const add = (kind: Subgoal['kind'], target: Target, resources: readonly ResourceDemand[], dependsOn: readonly string[] = [], detail: string = kind) => {
    const stepId = `${id}/${kind}:${subgoals.length}`;
    subgoals.push({ id: stepId, parentMethodId: id, kind, target, demands: resources, dependsOn,
      estimatedTicks: null, status: 'proposed', reasons: [reason(situation.tick, kind, detail)] });
    return stepId;
  };
  const require = (kind: Precondition['kind'], met: boolean, demand: ResourceDemand | null, children: readonly string[], detail: string) => {
    preconditions.push({ id: `${id}/requires:${preconditions.length}`, kind, status: met ? 'met' : 'unmet',
      reason: reason(situation.tick, kind, detail), demand, subgoalIds: children });
  };
  if (objective.kind === 'ConquerIsland') {
    const force = conquestForce(situation, context, objective.target), target = objective.target;
    const demand: ResourceDemand = { kind: 'force', metric: force.camp ? 'camp-force' : 'field-strength', strength: force.required,
      roles: ['frontline', 'ranged'], at: target, neededByTick: null, permanent: true };
    demands.push(demand);
    const borrow = force.selected.length ? add('borrow-force', target, [demand], [], `Candidate batch: ${force.selected.map(unit => unit.id).join(', ')}; existing commitments need allocator handoff`) : null;
    const training = force.force < force.required && !force.unknownForce ? add('train-force', target, [demand], [], `Missing ${force.required - force.force} clearing force; production, supply and budget remain prerequisites`) : null;
    require('force', force.presentForce >= force.required, demand, [borrow, training].filter((id): id is string => id !== null), `On-station ${force.presentForce}; required ${force.required}`);
    const crossings = force.selected.flatMap(unit => { const arrival = route(unit, target.entityId!); return arrival && 'crossings' in arrival ? arrival.crossings : []; });
    const crossing = crossings[0];
    let transport: string | null = null;
    if (crossing) {
      const needed: ResourceDemand = { kind: 'transport', seaId: crossing.seaId,
        payloadMass: force.selected.reduce((sum, unit) => sum + bodyMass(context.snapshot.units.find(actor => actor.id === unit.id)!), 0),
        departure: crossing.departure, landing: crossing.landing };
      demands.push(needed);
      if (crossing.requiresNewShip) {
        const yard = situation.seas.find(sea => sea.id === crossing.seaId)?.shipyardIds.length;
        const build = yard ? null : add('build-shipyard', { point: crossing.departure, seaId: crossing.seaId },
          [{ kind: 'gold', amount: BUILDING_DEFS.shipyard.cost }, { kind: 'workers', count: 1, at: { point: crossing.departure } }]);
        transport = add('train-transport', { point: crossing.departure, seaId: crossing.seaId },
          [needed, { kind: 'gold', amount: UNIT_DEFS.transport.cost }, { kind: 'supply', amount: UNIT_DEFS.transport.supplyUsed }], build ? [build] : []);
      } else transport = add('obtain-transport', { point: crossing.departure, seaId: crossing.seaId }, [needed], [],
        `Request ${crossing.shipId}; a live stream needs explicit release before reuse`);
      require('transport', false, needed, [transport], `Wait ${crossing.waitTicks}, board ${crossing.boardingTicks}, sail ${crossing.sailingTicks}, unload ${crossing.unloadingTicks} ticks`);
      const ground = crossing.landingGround ?? walkableGoal(context.snapshot.map, crossing.landing.x, crossing.landing.y);
      const shore = { ...target, point: { ...ground } };
      const contacts = force.selected.flatMap(unit => {
        const actor = context.snapshot.units.find(actor => actor.id === unit.id);
        return actor ? neutralCampPointContacts(context.snapshot, actor, ground, { facts: campFacts(context), horizonTicks: situation.horizonTicks }) : [];
      });
      const exposed = new Set(contacts.map(contact => contact.memberId));
      const opposition = situation.units.filter(unit => unit.owner === 'neutral' ? exposed.has(unit.id) : isOpponentOwner(context.snapshot, context.owner, unit.owner,
        context.snapshot.teams ? { teams: context.snapshot.teams } : {}))
        .filter(unit => unit.owner === 'neutral' || unit.location.kind === 'land' && unit.location.landId === target.landId && distance(unit.location.point, ground) <= 400);
      const beachReady = sumStrength([...force.present, ...force.selected]) >= sumStrength(opposition) * 1.4;
      const clearBeach = beachReady ? null : add('clear-beachhead', shore,
        [fieldDemand(shore, sumStrength(opposition) * 1.4, true)], [], 'Clear the actual unload shore, not the inland mine point');
      require('shore-safe', beachReady, null, clearBeach ? [clearBeach] : [],
        `Actual landing ground; shared neutral contacts ${contacts.map(contact => `${contact.memberId}:${contact.reason}`).join(',') || 'none'}; enemy movement remains uncertain`);
    }
    const selectedRoutes = force.selected.map(unit => route(unit, target.entityId!));
    if (force.unknownForce) preconditions.push({ id: `${id}/requires:unquoted-force-arrivals`, kind: 'route', status: 'unknown',
      reason: reason(situation.tick, 'clearing-arrivals-unknown', 'Some potential permanent fighters have deferred or unquoted routes; do not turn uncomputed arrival into a confirmed training deficit'),
      demand: null, subgoalIds: [] });
    require('route', force.presentForce >= force.required || selectedRoutes.length > 0 && selectedRoutes.every(arrival => arrival && 'ticks' in arrival),
      null, [], 'Each proposed existing soldier needs an evaluated route; untrained reinforcements have no invented ETA');
    const occupied = force.selected.filter(unit => unit.commitments.length);
    require('handoff', occupied.length === 0, null, borrow ? [borrow] : [],
      occupied.length ? occupied.map(unit => `${unit.id}: ${unit.commitments.map(task => task.taskId).join(',')}`).join('; ') : 'No retained task needs to release the proposed batch');
    const deliver = force.presentForce < force.required ? add('deliver-force', target, [demand], [borrow, training, transport].filter((id): id is string => id !== null)) : null;
    const clear = force.camp ? add('clear-camp', target, [demand], deliver ? [deliver] : []) : deliver;
    const hall = hallAt(context, target);
    if (!hall) {
      const workers = situation.units.filter(unit => unit.owner === context.owner && unit.roles.includes('worker') && unit.location.kind === 'land'
        && unit.location.landId === target.landId);
      const engineer = workers.length ? null : add('deliver-workers', target, [{ kind: 'workers', count: 1, at: target }], clear ? [clear] : []);
      require('workers', workers.length > 0, { kind: 'workers', count: 1, at: target }, engineer ? [engineer] : [],
        'An engineer must actually reach the cleared island; a soldier landing does not establish a mine');
      const capital: ResourceDemand = { kind: 'gold', amount: BUILDING_DEFS.townHall.cost };
      const firstBoatGold = crossing?.requiresNewShip ? UNIT_DEFS.transport.cost : 0;
      const capitalReady = situation.economy.cashGold - firstBoatGold >= BUILDING_DEFS.townHall.cost;
      const wait = capitalReady ? null : add('wait-income', target, [capital], [], 'Hall capital is a later stage; buying the boat does not simultaneously reserve the same cash for the hall');
      require('budget', capitalReady, capital, wait ? [wait] : [], `Cash ${situation.economy.cashGold}, first hull ${firstBoatGold}, later hall ${BUILDING_DEFS.townHall.cost}; predicted income is not reserved cash`);
      const build = add('build-hall', target, [capital, { kind: 'workers', count: 1, at: target }],
        [clear, engineer, wait].filter((id): id is string => id !== null));
      add('establish-garrison', target, [fieldDemand(target, 1, true)], [build]);
    } else add('establish-garrison', target, [fieldDemand(target, 1, true)], clear ? [clear] : []);
  } else if (objective.kind === 'Evacuate') {
    const effect = objective.effects.find(effect => effect.kind === 'assets-evacuated');
    require('route', objective.status !== 'blocked', null, [], 'A real shelter and a timely reachable route are required; no phantom rescue boat');
    if (effect?.kind === 'assets-evacuated') add('evacuate', effect.destination, [{ kind: 'workers', count: effect.unitIds.length, at: effect.destination }]);
  } else {
    const threat = situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === objective.target.entityId);
    const effect = objective.effects.find(effect => effect.kind === 'force-present');
    const required = effect?.kind === 'force-present' ? Math.max(0, effect.minimumStrength - sumStrength(stationed(situation, objective.target))) : threat ? Math.max(0,
      threat.arrivedStrength + threat.incomingStrength - threat.friendlyOnStationStrength) : 0;
    const demand = fieldDemand(objective.target, required);
    demands.push(demand);
    const deadline = threat && objective.kind === 'DefendSite' ? Math.min(threat.horizonTicks,
      collapseAfter(context, threat, situation.assets.find(asset => asset.id === threat.siteId)?.hp ?? 0)) : situation.horizonTicks;
    const available = candidates(situation, objective.target.entityId!, stationed(situation, objective.target))
      .filter(unit => duration(route(unit, objective.target.entityId!))! <= deadline);
    const groups: { kind: Method['kind']; units: SituationUnit[] }[] = [
      { kind: 'local-squad', units: available.filter(unit => unit.location.kind === 'land' && unit.location.landId === objective.target.landId && !unit.commitments.length) },
      { kind: 'main-army-recall', units: available.filter(unit => unit.location.kind === 'land' && unit.location.landId === objective.target.landId && unit.commitments.length) },
      { kind: 'cross-sea-reinforcement', units: available.filter(unit => unit.location.kind === 'aboard' || unit.location.kind === 'land' && unit.location.landId !== objective.target.landId) },
    ];
    return groups.map(group => {
      const methodId = `${objective.id}/method:${group.kind}`, power = sumStrength(group.units);
      const eligible = group.units.map(unit => `${unit.id}${unit.commitments.length ? ` releases ${unit.commitments.map(task => task.taskId).join(',')}` : ''}`).join('; ');
      const fetch: Subgoal = { id: `${methodId}/borrow-force`, parentMethodId: methodId, kind: 'borrow-force', target: objective.target,
        demands: [demand], dependsOn: [], estimatedTicks: null, status: power >= required ? 'proposed' : 'blocked',
        reasons: [reason(situation.tick, 'response-candidates', eligible || 'No evaluated response force in this alternative')] };
      const deliver: Subgoal = { ...fetch, id: `${methodId}/deliver-force`, kind: 'deliver-force', dependsOn: [fetch.id] };
      return { id: methodId, objectiveId: objective.id, kind: group.kind, demands: [demand],
        preconditions: [{ id: `${methodId}/force`, kind: 'force' as const, status: power >= required ? 'met' as const : 'unmet' as const,
          reason: reason(situation.tick, 'response-deficit', `Forecast ${power}; needed ${required}; candidates are alternatives, never jointly allocated twice`), demand, subgoalIds: required > 0 ? [fetch.id] : [] }],
        subgoals: required > 0 ? [fetch, deliver] : [], estimatedTicks: group.units.length ? Math.max(...group.units.map(unit => duration(route(unit, objective.target.entityId!))!)) : null,
        status: power >= required ? 'candidate' as const : 'blocked' as const, reasons: objective.reasons };
    });
  }
  return [{ id, objectiveId: objective.id, kind: objective.kind === 'ConquerIsland' ? 'staged-beachhead'
    : objective.kind === 'Evacuate' ? 'evacuation' : 'cross-sea-reinforcement',
  preconditions, subgoals, demands, estimatedTicks: null, status: preconditions.some(condition => condition.status !== 'met') ? 'blocked' : 'candidate', reasons: objective.reasons }];
}
