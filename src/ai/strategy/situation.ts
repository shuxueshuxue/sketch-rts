import { readCacheMap, retainCacheMap } from './bounded-cache';
import { arrivalColumns, EMPTY_UNIT_ARRIVALS, unitArrivalFacts, withUnitArrivals, type UnitArrivalFacts } from './unit-arrivals';
import { snapshotUnitIndex } from './world-index';
import { BUILDING_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { miningCapacity } from './mining-capacity';
import { createThreatIntentQuery } from './threat-intent';
import { GOLD_MINE_RULES, miningIncomeRate } from '../../shared/mining';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { walkableGoal } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { incomingLandArmy } from '../policy/land-arrivals';
import { postRecoveryAssignments } from '../bootstrap_1/front-recovery';
import { mobileCare } from '../bootstrap_1/mobile-care';
import { strategyIsOpponent } from './ownership';
import { distance } from '../policy/spatial';
import { effectiveCombatRating, TOWER_STRENGTH, unitStrength } from '../policy/v6/strength';
import { createArrivalQuery, crossingCandidateId, EXACT_CROSSING_CANDIDATES } from './arrivals';
import { createPlanningDistanceQuery } from './distance-fields';
import { createUnitCommitmentQuery, unitRoles } from './commitments';
import { landIdAt, regionIndex, seaIdAt, unitLocation, type RegionIndex } from './regions';
import { forceSuccessProbability, STRATEGY_PARAMETERS } from './utility';
import type { Arrival, Asset, Evidence, Opportunity, Reason, Situation, SituationObservation, SiteThreat, Target, SituationUnit } from './types';
import type { SituationHistory, StrategyObservationMemory } from './observation-memory';
import { capturesExplanations, deferredEvidence, deferredRecord, explanationRecipe } from './explanations';

const decisionUnitFacts = new WeakMap<AiPolicyMemory, Map<string, SituationUnit>>();
const idleUnitFacts = new WeakMap<object, Map<string, SituationUnit>>();
/** Reuse only immutable, tick-independent numerical rows. No raw world object,
 * ownership reader or current-call explanation is retained by this cache. */
function stableUnitFacts(snapshot: GameSnapshot, unit: Unit, location: SituationUnit['location'], strength: number,
  roles: SituationUnit['roles'], commitments: SituationUnit['commitments'], arrivals: UnitArrivalFacts, prior?: SituationUnit): SituationUnit {
  const cacheable = location.kind !== 'unknown' && !commitments.length && !arrivals.count;
  const key = snapshot.map.terrain ?? snapshot.map;
  let values = cacheable ? idleUnitFacts.get(key) : undefined;
  if (cacheable && !values) idleUnitFacts.set(key, values = new Map());
  const old = prior ?? (values ? readCacheMap(values, unit.id) : undefined), expiresTick = unit.expiresTick ?? null;
  if (old && old.owner === unit.owner && old.kind === unit.kind && old.location === location && old.hp === unit.hp
    && old.maxHp === unit.maxHp && old.strength === strength && old.roles === roles && old.expiresTick === expiresTick && old.commitments === commitments && unitArrivalFacts(old) === arrivals) return old;
  const row: SituationUnit = withUnitArrivals({ id: unit.id, owner: unit.owner, kind: unit.kind, location, hp: unit.hp, maxHp: unit.maxHp,
    strength, roles, expiresTick, commitments }, arrivals);
  if (values) {
    retainCacheMap(values, unit.id, row, 2048);
  }
  return row;
}

const STATION_RANGE = 650;
const MAX_OPTIONAL_TARGETS = 16;
const MAX_HARASS_TARGETS = 8;
const RUNTIME_OPTIONAL_TARGETS = 4;
const RUNTIME_HARASS_TARGETS = 2;
const compareCandidateDistance = (a: { unit: Unit; distance: number }, b: { unit: Unit; distance: number }) =>
  a.distance - b.distance || compareId(a.unit.id, b.unit.id);
const compareId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const point = (entity: { x: number; y: number }) => ({ x: entity.x, y: entity.y });
const factEvidence = (source: string, detail: string, tick: number): Evidence => ({ source, detail, tick, certainty: 'inferred' });
const descriptions = {
  mine: ({ id, amount, tick }: { id: string; amount: number; tick: number }) =>
    [factEvidence('snapshot.resources', `${id} has ${amount} gold and no hall at its mine mouth`, tick)],
  site: ({ id, complete, guards, tick }: { id: string; complete: boolean; guards: number; tick: number }) =>
    [factEvidence('snapshot.buildings', `${id}: complete=${complete}; ${guards} local land guards; arriving reinforcements are separate`, tick)],
  away: ({ id, tick }: { id: string; tick: number }) =>
    [factEvidence('snapshot.units', `No land defender within ${STATION_RANGE} of ${id}; not proof that the site is safe`, tick)],
  route: (tick: number) => [factEvidence('memory.territory.objective', 'Actual retained pressure point; its ETA is keyed by this opportunity id', tick)],
  threat: (tick: number) => [factEvidence('strategy.situation', 'All sites share physical routes; declared intrusion ETAs extend to ten minutes and speculative arrivals to the evaluation horizon', tick)],
};

// Diagnostic only. Neither publication, utility nor control may read this
// process counter; it is deliberately absent from memory and strategy traces.
let constructionCount = 0;
export function situationConstructionCount(): number { return constructionCount; }

export type SituationPhysicalQueries = Readonly<{
  regions: RegionIndex;
  distances: ReturnType<typeof createPlanningDistanceQuery>;
  arrivals: ReturnType<typeof createArrivalQuery>;
  /** Published projection only; undefined is pending, never a native fallback. */
  projectGround?: (point: { x: number; y: number }, mover: 'land' | 'sea') => { x: number; y: number } | undefined;
}>;

/** Read-only world assessment. All routing shares the caller's owner-think scope.
 * The previous value is observational history, never a serialized policy task. */
export function evaluateSituation(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory, previous?: SituationHistory,
  teams = snapshot.teams, fieldBuildBudget = Infinity, observation?: SituationObservation, preparation?: StrategyObservationMemory,
  physical?: SituationPhysicalQueries): Situation {
  constructionCount++;
  const tick = snapshot.tick, horizonTicks = STRATEGY_PARAMETERS.utilityHorizonTicks;
  const regions = physical?.regions ?? regionIndex(snapshot.map, Infinity, tick), options = { memory, ...(teams ? { teams } : {}) };
  const distances = physical?.distances ?? createPlanningDistanceQuery(snapshot, fieldBuildBudget, 'land', preparation);
  const query = physical?.arrivals ?? createArrivalQuery(snapshot, owner, memory, distances, fieldBuildBudget, regions, preparation, false);
  const projected = new Map<string, { x: number; y: number } | undefined>();
  const ground = (point: { x: number; y: number }, mover: 'land' | 'sea' = 'land') => {
    const key = `${mover}:${point.x}:${point.y}`;
    if (!projected.has(key)) projected.set(key, physical?.projectGround ? physical.projectGround(point, mover) : walkableGoal(snapshot.map, point.x, point.y, mover));
    return projected.get(key);
  };
  const projectedLand = (point: { x: number; y: number }) => { const value = ground(point); return value && landIdAt(snapshot.map, value); };
  const { liveUnits: live, live: byId } = snapshotUnitIndex(snapshot);
  const locations = new Map<string, SituationUnit['location']>();
  for (const unit of live) locations.set(unit.id, unitLocation(snapshot.map, unit, byId, tick));
  const unitLand = (unit: Unit) => { const location = locations.get(unit.id)!; return location.kind === 'land' ? location.landId : undefined; };
  const own = live.filter(unit => unit.owner === owner);
  const recovering = new Map((observation ? [] : postRecoveryAssignments(snapshot, owner, options))
    .map(({ patient, post, walk }) => [patient.id, { postId: post.id, walk }]));
  // The existing mobile-care selector prunes ferry state through navalUnitIds.
  // Evaluate that exact selector on an isolated memory, never the live policy.
  const mobilePatients = !observation && own.some(unit => unit.kind !== 'worker' && unit.hp < unit.maxHp)
    ? mobileCare.claimsUnits!(snapshot, owner, { ...options, memory: structuredClone(memory) }) : new Set<string>();
  const acceptedHealing = new Map(observation?.healing.map(entry => [entry.unitId, entry.executor]));
  const enemies = new Set([...new Set(live.map(unit => unit.owner).concat(snapshot.buildings.map(building => building.owner)))]
    .filter(other => strategyIsOpponent(snapshot, owner, other, teams)));
  const foe = (other: string) => enemies.has(other);
  const weapons = new Map<Unit, ReturnType<typeof combatCapability>>();
  const weapon = (unit: Unit) => { let value = weapons.get(unit); if (!value) {
    value = combatCapability(snapshot, unit); weapons.set(unit, value);
  } return value; };
  const strengths = new Map<Unit, number>();
  const strength = (unit: Unit) => { let value = strengths.get(unit); if (value === undefined) {
    value = unitMover(unit.kind) === 'sea' ? effectiveCombatRating(snapshot, unit) : unitStrength(unit); strengths.set(unit, value);
  } return value; };
  const evidence = (source: string, detail: string, at = tick): Evidence => ({ source, detail, tick: at, certainty: 'inferred' });
  const targetCache = new Map<string, Target>();
  const target = (entity: { id: string; x: number; y: number; kind?: string }): Target => {
    const known = targetCache.get(entity.id); if (known) return known;
    const landId = landIdAt(snapshot.map, entity);
    const seaPoint = entity.kind === 'shipyard' ? ground(entity, 'sea') : entity;
    const seaId = seaPoint && seaIdAt(snapshot.map, seaPoint);
    const result = { entityId: entity.id, point: point(entity), ...(landId ? { landId } : {}), ...(seaId ? { seaId } : {}) };
    targetCache.set(entity.id, result); return result;
  };
  const halls = snapshot.buildings.filter(building => building.hp > 0 && building.kind === 'townHall');
  const assets: Asset[] = snapshot.buildings.filter(building => building.hp > 0).map(building => ({
    id: building.id, owner: building.owner, kind: building.kind === 'townHall' ? 'hall'
      : building.kind === 'defenseTower' ? 'tower' : building.kind === 'shipyard' ? 'shipyard' : 'production',
    target: target(building), hp: building.hp, complete: building.complete,
    replacementGold: BUILDING_DEFS[building.kind].cost, remainingGold: 0, incomeGoldPerTick: 0,
    discountedValueGold: BUILDING_DEFS[building.kind].cost * (building.complete ? 1 : Math.min(1, building.buildProgress / Math.max(1, building.buildTime))),
  }));
  for (const worker of live.filter(unit => unit.kind === 'worker')) assets.push({ id: worker.id, owner: worker.owner,
    kind: 'worker', target: worker.deck || worker.cabin
      ? (() => { const location = locations.get(worker.id)!;
        return { entityId: worker.id, point: location.point, ...(location.kind === 'aboard' ? { seaId: location.seaId } : {}) }; })()
      : target(worker), hp: worker.hp, complete: true, replacementGold: UNIT_DEFS.worker.cost,
    remainingGold: 0, incomeGoldPerTick: 0, discountedValueGold: UNIT_DEFS.worker.cost });
  for (const mine of snapshot.resources) {
    const hall = halls.find(hall => hall.complete && landIdAt(snapshot.map, hall) === landIdAt(snapshot.map, mine)
      && distance(hall, mine) <= GOLD_MINE_RULES.baseRange);
    const workers = hall ? live.filter(unit => unit.owner === hall.owner && unit.kind === 'worker' && !unit.deck && !unit.cabin
      && unit.order.type === 'mine' && unit.order.resourceId === mine.id && unitLand(unit) === landIdAt(snapshot.map, mine)
      && (unit.mineSlot === mine.id || unit.order.phase === 'gather' || unit.order.phase === 'return')) : [];
    // Forecast current staffed income; an unowned mine has potential value but
    // does not contribute fictitious cash to the owner's budget.
    const capacity = GOLD_MINE_RULES.goldPerTrip / GOLD_MINE_RULES.entrySeconds / SIM_TICKS_PER_SECOND;
    const income = hall && mine.amount > 0 ? capacity * Math.min(1, workers.length / GOLD_MINE_RULES.workstations)
      * miningIncomeRate(snapshot.players[hall.owner]?.supplyUsed ?? 0) : 0;
    assets.push({ id: mine.id, owner: hall?.owner ?? 'neutral', kind: 'mine', target: target(mine), hp: null, complete: Boolean(hall),
      replacementGold: 0, remainingGold: mine.amount, incomeGoldPerTick: income, miningCapacity: miningCapacity(workers.map(worker => worker.id)),
      discountedValueGold: Math.min(mine.amount, (hall ? income : capacity) * horizonTicks) });
  }
  const opportunities: Opportunity[] = [];
  for (const mine of assets.filter(asset => asset.kind === 'mine' && asset.owner === 'neutral' && asset.remainingGold > 0)) {
    // An unfinished hall has already committed its site; it is not a fresh,
    // unclaimed neutral resource for another colony to buy a second time.
    if (halls.some(hall => distance(hall, mine.target.point) <= GOLD_MINE_RULES.baseRange)) continue;
    opportunities.push(deferredEvidence({ id: `mine:${mine.id}`, kind: 'neutral-mine' as const, target: mine.target, valueGold: mine.discountedValueGold },
      explanationRecipe(descriptions.mine, { id: mine.id, amount: mine.remainingGold, tick })));
  }
  for (const hall of halls.filter(hall => foe(hall.owner))) {
    const guards = live.filter(unit => unit.owner !== 'neutral' && !strategyIsOpponent(snapshot, hall.owner, unit.owner, teams)
      && !unit.deck && !unit.cabin && unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && distance(unit, hall) <= STATION_RANGE);
    const kind = !hall.complete ? 'construction' : 'weak-site';
    const hallId = hall.id, complete = hall.complete, guardCount = guards.length;
    opportunities.push(deferredEvidence({ id: `${kind}:${hallId}`, kind, target: target(hall), valueGold: BUILDING_DEFS.townHall.cost },
      explanationRecipe(descriptions.site, { id: hallId, complete, guards: guardCount, tick })));
    if (!guards.length) opportunities.push(deferredEvidence({ id: `army-away:${hallId}`, kind: 'army-away' as const, target: target(hall),
      valueGold: BUILDING_DEFS.townHall.cost }, explanationRecipe(descriptions.away, { id: hallId, tick })));
  }
  const post = memory.territory?.objective;
  if (post && snapshot.buildings.some(building => building.id === post.targetId && building.hp > 0)) {
    const landId = landIdAt(snapshot.map, post.point);
    opportunities.push(deferredEvidence({ id: `route:${post.targetId}`, kind: 'route' as const, target: { entityId: post.targetId,
      point: point(post.point), ...(landId ? { landId } : {}) },
    valueGold: 0 }, explanationRecipe(descriptions.route, tick)));
  }
  if (previous?.owner === owner && previous.tick < tick) {
    const lost = previous.assets.filter(asset => asset.owner === owner && asset.kind === 'hall' && !assets.some(now => now.id === asset.id));
    for (const hall of lost) {
      const mine = previous.assets.find(asset => asset.kind === 'mine' && asset.owner === owner
        && asset.target.landId === hall.target.landId && distance(asset.target.point, hall.target.point) <= GOLD_MINE_RULES.baseRange);
      const current = mine && assets.find(asset => asset.id === mine.id && asset.remainingGold > 0 && asset.owner !== owner);
      if (current) opportunities.push({ id: `lost-site:${current.id}`, kind: 'lost-site', target: current.target,
        valueGold: current.discountedValueGold, evidence: [evidence('previous.situation.assets', `${hall.id} existed at tick ${previous.tick}`, previous.tick),
          evidence('snapshot.buildings', `${hall.id} is absent at tick ${tick}; associated mine ${current.id}`)] });
    }
    for (const old of previous.opportunities.filter(opportunity => opportunity.kind === 'lost-site')) {
      if (!opportunities.some(opportunity => opportunity.id === old.id)
        && assets.some(asset => asset.id === old.target.entityId && asset.remainingGold > 0 && asset.owner !== owner)) opportunities.push({ ...old,
          target: { ...old.target, point: point(old.target.point) }, evidence: old.evidence.map(item => ({ ...item })) });
    }
  }

  const ownHalls = halls.filter(hall => hall.owner === owner);
  const sites = assets.filter(asset => asset.owner === owner && asset.target.landId && (asset.kind === 'hall'
    || !ownHalls.some(hall => landIdAt(snapshot.map, hall) === asset.target.landId && distance(hall, asset.target.point) <= STATION_RANGE)));
  const retainedIds = new Set([memory.landAttack?.targetId, memory.landExpansion?.mineId,
    ...Object.values(memory.naval?.conquests ?? {}).filter(task => task.abandonedTick === undefined).map(task => task.mineId)]);
  const optional = opportunities.filter(opportunity => opportunity.kind !== 'army-away')
    .sort((a, b) => Number(retainedIds.has(b.target.entityId)) - Number(retainedIds.has(a.target.entityId))
      || b.valueGold - a.valueGold || compareId(a.id, b.id));
  const bounded = Number.isFinite(fieldBuildBudget);
  const optionalLimit = bounded ? RUNTIME_OPTIONAL_TARGETS : MAX_OPTIONAL_TARGETS;
  const harassLimit = bounded ? RUNTIME_HARASS_TARGETS : MAX_HARASS_TARGETS;
  const threatIntent = createThreatIntentQuery(snapshot, owner, sites, teams);
  const hasDeclaredIntent = (unit: Unit, siteId: string) => {
    const intent = threatIntent(unit, siteId);
    return intent.kind === 'actual-intrusion' && intent.basis !== 'hostile-presence';
  };
  const threatWindow = (unit: Unit, siteId: string) => hasDeclaredIntent(unit, siteId)
    ? STRATEGY_PARAMETERS.knownThreatHorizonTicks : horizonTicks;
  const landActors = live.filter(unit => !unit.deck && !unit.cabin && unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && unit.attackDamage > 0);
  const urgentSites = new Set(sites.filter(site => landActors.some(unit => foe(unit.owner)
    && unitLand(unit) === site.target.landId
    && distance(unit, site.target.point) <= unit.speed * threatWindow(unit, site.id) / SIM_TICKS_PER_SECOND + 240) || live.some(unit => foe(unit.owner) && (unitMover(unit.kind) === 'sea' && weapon(unit).armed
      && distance(unit, site.target.point) <= weapon(unit).range || (unit.deck || unit.cabin)
      && (() => { const ship = byId.get(unit.deck?.shipId ?? unit.cabin!.shipId);
        return ship?.order.type === 'unload' && projectedLand(ship.order) === site.target.landId; })()))).map(site => site.id));
  const targets = new Map<string, Target>(sites.filter(site => !bounded || urgentSites.has(site.id)
    || site.kind === 'hall' && urgentSites.size > 0).map(site => [site.id, site.target]));
  for (const entity of [...snapshot.resources, ...snapshot.buildings]) if (retainedIds.has(entity.id)) targets.set(entity.id, target(entity));
  // Round-robin opportunity families before spending the detailed ETA budget:
  // neutral mines must not crowd every enemy site out of the shortlist.
  const diversified = [...optional.filter(opportunity => retainedIds.has(opportunity.target.entityId))];
  const kinds = ['route', 'lost-site', 'construction', 'weak-site', 'neutral-mine'] as const;
  while (diversified.length < optional.length) {
    let added = false;
    for (const kind of kinds) {
      const entry = optional.filter(opportunity => opportunity.kind === kind && !diversified.includes(opportunity))[0];
      if (entry) { diversified.push(entry); added = true; }
    }
    if (!added) break;
  }
  for (const opportunity of diversified.slice(0, optionalLimit)) targets.set(opportunity.kind === 'route' ? opportunity.id : opportunity.target.entityId!, opportunity.target);
  const workerIds = new Set(own.filter(unit => unit.kind === 'worker').map(unit => unit.id));
  const harassers = live.filter(unit => foe(unit.owner) && !unit.deck && !unit.cabin && unit.attackDamage > 0
    && (unit.id === memory.harassDefense?.targetId
      || unit.kind === 'horseArcher' && sites.some(site => site.target.landId === unitLand(unit) && distance(unit, site.target.point) <= 750)
      || unit.order.type === 'attack' && workerIds.has(unit.order.targetId)))
    .sort((a, b) => Number(b.id === memory.harassDefense?.targetId) - Number(a.id === memory.harassDefense?.targetId)
      || Number(b.kind === 'horseArcher') - Number(a.kind === 'horseArcher') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const harasser of harassers.slice(0, harassLimit)) targets.set(harasser.id, target(harasser));
  // Keep detailed route work proportional to the goals and force that can be
  // used now. All actors and all region totals remain in the coarse Situation;
  // an omitted route is unknown, never a zero-ETA or unavailable-force claim.
  const candidatesByTarget = new Map<string, Set<string>>();
  const combatPool = own.filter(unit => unitMover(unit.kind) === 'land' && unit.kind !== 'worker' && unit.hp >= unit.maxHp * .35);
  if (bounded) for (const [id, destination] of targets) {
    const pool = combatPool.map(unit => ({ unit, distance: distance(unit, destination.point) })).sort(compareCandidateDistance);
    const required = Math.max(6, landActors.filter(unit => foe(unit.owner)
      && unitLand(unit) === destination.landId && distance(unit, destination.point) <= STATION_RANGE)
      .reduce((sum, unit) => sum + strength(unit), 0) * 1.5);
    const selected = new Set<string>(), forceByOrigin = new Map<string, { count: number; strength: number }>();
    for (const { unit } of pool) {
      const origin = unit.deck?.shipId ?? unit.cabin?.shipId ?? unitLand(unit) ?? 'unknown';
      const group = forceByOrigin.get(origin) ?? { count: 0, strength: 0 };
      if (group.count >= 24 || group.strength >= required) continue;
      selected.add(unit.id); group.count++; group.strength += strength(unit); forceByOrigin.set(origin, group);
    }
    for (const unit of own) if (unit.kind === 'worker' && urgentSites.size > 0) selected.add(unit.id);
    candidatesByTarget.set(id, selected);
  }
  const targetEntries = [...targets];
  if (bounded) {
    const crossings = new Map<string, { id: string; priority: number; upper: number; lower: number }>();
    for (const [id, destination] of targetEntries) for (const unit of own) {
      if (!candidatesByTarget.get(id)?.has(unit.id) || unitMover(unit.kind) !== 'land') continue;
      const key = crossingCandidateId(snapshot, unit, destination); if (!key) continue;
      const support = unit.deck?.shipId ?? unit.cabin?.shipId;
      const sourcePoint = support ? byId.get(support) ?? unit : unit;
      const lower = distance(sourcePoint, destination.point) * SIM_TICKS_PER_SECOND / Math.max(unit.speed, UNIT_DEFS.transport.speed);
      if (lower > horizonTicks) continue;
      const sourceSea = support ? seaIdAt(snapshot.map, sourcePoint) : undefined;
      const sourceLand = !support && unitLand(unit);
      const destinationSeas = regions.shoresByLand.get(destination.landId!);
      if (!destinationSeas || !(sourceSea ? destinationSeas.has(sourceSea)
        : [...(regions.shoresByLand.get(sourceLand || 'land:0')?.keys() ?? [])].some(sea => destinationSeas.has(sea)))) continue;
      const priority = urgentSites.has(id) ? 2 : retainedIds.has(id) ? 1 : 0;
      const value = opportunities.find(opportunity => opportunity.target.entityId === id)?.valueGold
        ?? assets.find(asset => asset.id === id)?.discountedValueGold ?? 0;
      const candidate = { id: key, priority, lower, upper: value / (1 + lower / horizonTicks) };
      const old = crossings.get(key);
      if (!old || lower < old.lower) crossings.set(key, candidate);
    }
    query.setCrossingShortlist([...crossings.values()].sort((a, b) => b.priority - a.priority || b.upper - a.upper
      || a.lower - b.lower || compareId(a.id, b.id)).slice(0, EXACT_CROSSING_CANDIDATES).map(entry => entry.id));
  }
  const beyondWindow: Arrival = { status: 'unknown', lowerBoundTicks: horizonTicks, reason: { code: 'beyond-evaluation-window',
    detail: `Even a straight maximum-speed journey exceeds ${horizonTicks} ticks`, evidence: [] } };
  deferredRecord(beyondWindow.reason);
  const columns = arrivalColumns(targetEntries.map(([id]) => id));
  function arrivalsFor(unit: Unit, old = EMPTY_UNIT_ARRIVALS): UnitArrivalFacts {
    if (unit.owner !== owner && !foe(unit.owner) || unit.kind === 'worker' && unit.owner !== owner || unitMover(unit.kind) === 'sea') return EMPTY_UNIT_ARRIVALS;
    const sameColumns = old.columns.ids.length === columns.ids.length && old.columns.ids.every((id, index) => columns.ids[index] === id);
    const previous = sameColumns ? old.values : EMPTY_UNIT_ARRIVALS.values;
    let values: (Arrival | undefined)[] | undefined, count = 0;
    for (let index = 0; index < targetEntries.length; index++) {
      const [targetId, destination] = targetEntries[index]!;
      let arrival: Arrival | undefined;
      if (!(bounded && unit.owner === owner && !candidatesByTarget.get(targetId)!.has(unit.id)
        && !(retainedIds.has(targetId) && (memory.landAttack?.general.group?.includes(unit.id)
          || memory.landExpansion?.combat?.creep?.group.includes(unit.id))))) {
        const lowerBound = distance(unit, destination.point) * SIM_TICKS_PER_SECOND / Math.max(unit.speed, UNIT_DEFS.transport.speed);
        arrival = lowerBound > horizonTicks ? beyondWindow : query.arrival(unit, destination, unitLand(unit));
        count++;
      }
      if (!values && previous[index] === arrival) continue;
      values ??= previous.slice(0, index); values[index] = arrival;
    }
    if (!count) return EMPTY_UNIT_ARRIVALS;
    return values || !sameColumns ? { columns: sameColumns ? old.columns : columns, values: values ?? [], count } : old;
  }
  const unitCommitments = createUnitCommitmentQuery(snapshot, owner, memory);
  let priorUnits = capturesExplanations() ? undefined : decisionUnitFacts.get(memory);
  if (!capturesExplanations() && !priorUnits) decisionUnitFacts.set(memory, priorUnits = new Map());
  const units = live.map(unit => {
    const old = priorUnits ? readCacheMap(priorUnits, unit.id) : undefined;
    const row = stableUnitFacts(snapshot, unit, locations.get(unit.id)!, strength(unit), unitRoles(unit),
      unitCommitments(unit, recovering.get(unit.id), mobilePatients.has(unit.id), acceptedHealing.get(unit.id)),
      arrivalsFor(unit, old && unitArrivalFacts(old)), old);
    if (priorUnits && row.location.kind !== 'unknown') {
      retainCacheMap(priorUnits, unit.id, row, 2048);
    }
    return row;
  });
  const threatEvidence = explanationRecipe(descriptions.threat, tick);
  const threats: SiteThreat[] = sites.map(site => {
    const land = site.target.landId;
    const candidates = live.filter(unit => foe(unit.owner) && unitMover(unit.kind) === 'land' && !unit.deck && !unit.cabin
      && unitLand(unit) === land
      && distance(unit, site.target.point) <= unit.speed * threatWindow(unit, site.id) / SIM_TICKS_PER_SECOND + 240);
    const field = candidates.length ? distances.field(site.target.point) : null;
    const incoming = incomingLandArmy(snapshot, owner, options, site.target.point, STRATEGY_PARAMETERS.knownThreatHorizonTicks, candidates,
      unit => { const cost = field?.field.cost(unit), ticks = cost === undefined ? undefined : Math.ceil(cost / unit.speed * SIM_TICKS_PER_SECOND);
        return ticks === undefined || ticks > threatWindow(unit, site.id) ? undefined
          : { ticks, endpoint: site.target.point }; });
    const attackers: SiteThreat['attackers'][number][] = incoming.map(({ unit, ticks }) => ({ unitId: unit.id, strength: strength(unit),
      arrival: deferredRecord({ status: 'reachable' as const, ticks, landTicks: ticks, crossings: [], evidence: [evidence('policy.incomingLandArmy',
        `Shared arrival admission using building-aware weighted goal field; geometry built ${field?.builtTick}`, field?.builtTick)] }) }));
    if (!field) for (const unit of candidates) if (unit.kind !== 'worker' && unit.attackDamage > 0) attackers.push({ unitId: unit.id, strength: strength(unit),
      arrival: { status: 'unknown', reason: deferredRecord({ code: 'threat-geometry-refresh-pending', detail: 'Coarse same-land threat candidate; arrival field is pending, not confirmed inside the response window', evidence: [] }) } });
    for (const passenger of live.filter(unit => foe(unit.owner) && unit.kind !== 'worker' && unit.attackDamage > 0 && (unit.deck || unit.cabin))) {
      const boat = byId.get(passenger.deck?.shipId ?? passenger.cabin!.shipId);
      if (!boat || boat.order.type !== 'unload' || projectedLand(boat.order) !== land) continue;
      const arrival = query.arrival(passenger, site.target);
      if ('ticks' in arrival && arrival.ticks <= STRATEGY_PARAMETERS.knownThreatHorizonTicks || arrival.status === 'unknown')
        attackers.push({ unitId: passenger.id, strength: strength(passenger), arrival });
    }
    for (const ship of live.filter(unit => foe(unit.owner) && unitMover(unit.kind) === 'sea')) {
      const capability = weapon(ship);
      if (capability.armed && distance(ship, site.target.point) <= capability.range) attackers.push({ unitId: ship.id, strength: strength(ship),
        arrival: deferredRecord({ status: 'reachable' as const, ticks: 0, landTicks: 0, crossings: [], evidence: [evidence('shared.combatCapability', 'Present working battery in potential range; firing arcs/line of fire are execution concerns')] }) });
    }
    for (let index = 0; index < attackers.length; index++) {
      const attacker = attackers[index]!, unit = byId.get(attacker.unitId)!;
      attackers[index] = { ...attacker, intent: threatIntent(unit, site.id) };
    }
    const present = attackers.filter(attacker => {
      const unit = byId.get(attacker.unitId)!;
      return !unit.deck && !unit.cabin && distance(unit, site.target.point) <= STATION_RANGE;
    });
    const presentIds = new Set(present.map(attacker => attacker.unitId));
    const defenders = own.filter(unit => !unit.deck && !unit.cabin && unitMover(unit.kind) === 'land'
      && unitLand(unit) === land && distance(unit, site.target.point) <= STATION_RANGE);
    const staticStrength = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'defenseTower'
      && building.complete && building.hp > 0 && distance(building, site.target.point) <= STATION_RANGE).length * TOWER_STRENGTH;
    const friendly = defenders.reduce((sum, unit) => sum + strength(unit), 0) + staticStrength;
    const declared = attackers.filter(attacker => hasDeclaredIntent(byId.get(attacker.unitId)!, site.id));
    const siteHorizon = Math.min(STRATEGY_PARAMETERS.knownThreatHorizonTicks, Math.max(horizonTicks,
      ...declared.map(attacker => 'ticks' in attacker.arrival ? attacker.arrival.ticks : STRATEGY_PARAMETERS.knownThreatHorizonTicks)));
    return deferredEvidence({ siteId: site.id, horizonTicks: siteHorizon, attackers,
      arrivedStrength: present.reduce((sum, attacker) => sum + attacker.strength, 0),
      incomingStrength: attackers.filter(attacker => !presentIds.has(attacker.unitId)).reduce((sum, attacker) => sum + attacker.strength, 0),
      friendlyOnStationStrength: friendly, firstArrivalTicks: present.length ? 0 : attackers.reduce<number | null>((minimum, attacker) =>
        'ticks' in attacker.arrival ? Math.min(minimum ?? attacker.arrival.ticks, attacker.arrival.ticks) : minimum, null),
      lossProbability: attackers.some(attacker => attacker.arrival.status === 'unknown') ? null : attackers.length ? forceSuccessProbability(attackers.reduce((sum, attacker) => sum + attacker.strength, 0), friendly) : 0,
    }, threatEvidence);
  });
  const limitations: Reason[] = [{ code: 'forecast-not-execution', detail: 'ETAs exclude combat, body congestion and future wind changes; success probabilities and staffed income are declared heuristics', evidence: [] },
    { code: 'unified-budget-not-migrated', detail: 'Existing modules have no per-objective reservation ledger; method costs are proposals, not reserved cash', evidence: [] },
    { code: 'route-opportunities-partial', detail: 'Only retained actual pressure points are projected; missing new pressure-point geometry remains unknown', evidence: [] }];
  if (distances.deferred) limitations.push({ code: 'geometry-refresh-pending', detail: `${distances.built} goal fields advanced (${distances.work} queue removals); ${distances.deferred} distinct goal queries deferred by the per-think rebuild budget; unknown threat is not safety`, evidence: [] });
  if (query.deferredSeaQueries) limitations.push({ code: 'sea-field-refresh-pending',
    detail: `${query.deferredSeaQueries} distinct sea goal fields deferred; a missing crossing ETA is unknown`, evidence: [] });
  if (regions.scannedRows < regions.totalRows) limitations.push({ code: 'shore-index-refresh-pending',
    detail: `${regions.scannedRows}/${regions.totalRows} terrain rows indexed; every land/sea component is already present; missing crossing geometry is unknown`,
      evidence: [evidence('strategy.regionIndex', 'Incremental immutable-terrain shore scan', regions.scannedAtTick)] });
  if (bounded) limitations.push({ code: 'detailed-force-shortlist', detail: 'Detailed ETA uses a nearest sufficient-force prefix (at least 6 field strength, up to 24 own combatants per origin) per shortlisted goal; omitted own routes and capabilities are unknown, not unavailable', evidence: [] });
  if (optional.length > optionalLimit) limitations.push({ code: 'candidate-target-limit', detail: `Forecast ${optionalLimit}/${optional.length} optional targets plus every owned site; omitted ETA is unknown`, evidence: [] });
  if (harassers.length > harassLimit) limitations.push({ code: 'harasser-target-limit', detail: `Forecast ${harassLimit}/${harassers.length} current harassment targets in stable order; omitted ETA is unknown`, evidence: [] });
  return { tick, owner, horizonTicks, assets, units, opportunities: opportunities.sort((a, b) => compareId(a.id, b.id)).map(opportunity => deferredRecord(opportunity, opportunity.kind === 'lost-site')),
    lands: [...regions.lands].map(([id, anchor]) => ({ id, anchor: point(anchor), assetIds: assets.filter(asset => asset.target.landId === id).map(asset => asset.id),
      unitIds: units.filter(unit => unit.location.kind === 'land' && unit.location.landId === id).map(unit => unit.id),
      adjacentSeaIds: [...(regions.shoresByLand.get(id)?.keys() ?? [])],
      threats: threats.filter(threat => assets.find(asset => asset.id === threat.siteId)?.target.landId === id) })),
    seas: [...regions.seas].map(([id, anchor]) => ({ id, anchor: point(anchor), transportIds: units.filter(unit => unit.owner === owner
      && unit.location.kind === 'sea' && unit.location.seaId === id && unit.roles.includes('transport')).map(unit => unit.id),
      warshipIds: units.filter(unit => unit.owner === owner && unit.location.kind === 'sea' && unit.location.seaId === id && unit.roles.includes('warship')).map(unit => unit.id),
      shipyardIds: assets.filter(asset => asset.owner === owner && asset.kind === 'shipyard' && asset.target.seaId === id).map(asset => asset.id),
      voyages: Object.entries(memory.naval?.ferries ?? {}).flatMap(([shipId, task]) => {
        const ship = byId.get(shipId);
        return ship && seaIdAt(snapshot.map, ship) === id ? [deferredRecord({ shipId, taskId: `ferry:${shipId}:${task.sinceTick}`,
          target: { entityId: task.targetId, point: point(task.phase === 'return' ? task.from : task.to) }, freeInTicks: query.freeInTicks(ship),
          evidence: evidence('memory.naval.ferries', 'Forecast of the next unload; an active stream still requires explicit release') })] : [];
      }) })),
    economy: { cashGold: snapshot.players[owner]?.gold ?? 0, predictedIncomeGold: assets.filter(asset => asset.owner === owner)
      .reduce((sum, asset) => sum + Math.min(asset.remainingGold, asset.incomeGoldPerTick * horizonTicks), 0), horizonTicks, ledger: [] }, limitations: limitations.map(value => deferredRecord(value)) };
}
