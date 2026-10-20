import { unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { strikeGap } from '../../shared/combat-geometry';
import { sameGround, walkableGoal } from '../../shared/terrain';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { strengthOf, structureRating } from '../policy/v6/strength';
import { creepForce, forceFor, type Camp } from '../policy/v7/creep';
import { isOpponentOwner } from '../policy/ownership';
import { averagePoint, distance } from '../policy/spatial';
import { arrivalWeightedForce } from './arrival-force';
import { casualtySurvivors, focusedCasualties } from './focused-casualties';
import type { DecisionFacts } from './decision';
import { landIdAt } from './regions';
import { strategicTargetCamp } from './target-camp';
import type { Situation, Target } from './types';
import { unitArrival } from './unit-arrivals';
import { assetSurvivalProbability, forceSuccessProbability } from './utility';
import { defenseThreatScenarios, type DefenseResponse } from './defense-risk';
import { createThreatIntentQuery } from './threat-intent';

export type AllocatedForceTarget =
  | Readonly<{ metric: 'field-strength'; requiredForce: number }>
  | Readonly<{ metric: 'camp-force'; camp: Readonly<Camp>; requiredForce?: number }>;

/** Evaluate exactly the supplied cohort. Location, arrival discounts and leases
 * belong to the caller; a passenger is not silently counted as on station here.
 * Camp free volleys depend on the whole group's kill time, so neither marginal
 * force nor an ETA-discounted cohort can be assembled from singleton ratings. */
export function assessAllocatedForce(owner: PlayerId, units: readonly Unit[], target: AllocatedForceTarget) {
  const members = [...new Map(units.filter(unit => unit.owner === owner && unit.hp > 0)
    .map(unit => [unit.id, unit])).values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const force = target.metric === 'camp-force' ? creepForce(members, target.camp.creeps.length ? target.camp : undefined) : strengthOf(members);
  const requiredForce = target.requiredForce ?? (target.metric === 'camp-force' ? forceFor(target.camp) : 0);
  return { metric: target.metric, unitIds: members.map(unit => unit.id), force, requiredForce,
    deficit: Math.max(0, requiredForce - force), sufficient: force >= requiredForce };
}

export type TargetReinforcementInput = Readonly<{ snapshot: GameSnapshot; situation: DecisionFacts<Situation>;
  target: Target; battleStartTicks: number; windowTicks: number }>;

/** One geographic/observed-unload boundary for camp and field targets. Reuse
 * existing numerical arrival rows: never invent an enemy transport intention or
 * treat an old evaluation horizon as proof that a longer plan is safe. */
export function targetEnemyReinforcements(input: TargetReinforcementInput) {
  const { snapshot, situation, target, battleStartTicks, windowTicks } = input;
  if (!Number.isFinite(battleStartTicks) || battleStartTicks < 0 || !Number.isFinite(windowTicks) || windowTicks <= 0)
    throw new Error('Invalid camp engagement forecast window');
  const targetLand = target.landId ?? landIdAt(snapshot.map, target.point);
  if (!targetLand) throw new Error('Camp engagement target has no known land component');
  const byId = new Map(snapshot.units.map(unit => [unit.id, unit])), facts = new Map(situation.units.map(unit => [unit.id, unit]));
  const onStation: Unit[] = [], arriving: { unit: Unit; etaTicks: number }[] = [], unknownEnemyIds: string[] = [];
  const availability: { unitId: string; fromTicks: number; throughTicks: number; share: number }[] = [];
  const candidates: Unit[] = [];
  for (const unit of snapshot.units) {
    if (unit.owner === 'neutral' || unit.hp <= 0 || unit.kind === 'worker' || unitMover(unit.kind) !== 'land' || unit.attackDamage <= 0
      || !isOpponentOwner(snapshot, situation.owner, unit.owner, {})) continue;
    const carrier = unit.deck?.shipId ?? unit.cabin?.shipId, boat = carrier ? byId.get(carrier) : undefined;
    const aboardHeadingHere = boat?.order.type === 'unload' && landIdAt(snapshot.map,
      walkableGoal(snapshot.map, boat.order.x, boat.order.y)) === targetLand;
    if (carrier ? !aboardHeadingHere : landIdAt(snapshot.map, unit) !== targetLand) continue;
    if (unit.expiresTick !== undefined && unit.expiresTick <= snapshot.tick + battleStartTicks) continue;
    candidates.push(unit);
    const fact = facts.get(unit.id), arrival = fact && unitArrival(fact, target.entityId ?? '');
    // A computation cut off at an earlier horizon is not a proof that the
    // unit cannot arrive inside this method's longer engagement window.
    if (arrival?.status === 'unreachable' && arrival.reason.code !== 'beyond-evaluation-window') continue;
    if (!arrival || !('ticks' in arrival) || arrival.crossings.some(crossing => crossing.requiresNewShip)) {
      unknownEnemyIds.push(unit.id); continue;
    }
    if (!Number.isFinite(arrival.ticks) || arrival.ticks < 0) throw new Error(`Invalid enemy arrival: ${unit.id}`);
    if (arrival.ticks > battleStartTicks + windowTicks) continue;
    const fromTicks = Math.max(battleStartTicks, arrival.ticks);
    const throughTicks = Math.min(battleStartTicks + windowTicks, (unit.expiresTick ?? Infinity) - snapshot.tick);
    if (throughTicks <= fromTicks) continue;
    availability.push({ unitId: unit.id, fromTicks, throughTicks,
      share: (throughTicks - fromTicks) / (battleStartTicks + windowTicks - fromTicks || windowTicks) });
    if (arrival.ticks <= battleStartTicks) onStation.push(unit);
    else arriving.push({ unit, etaTicks: arrival.ticks - battleStartTicks });
  }
  const byUnitId = (a: Unit, b: Unit) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return { candidateEnemies: candidates.sort(byUnitId), onStation: onStation.sort(byUnitId),
    arriving: arriving.sort((a, b) => a.etaTicks - b.etaTicks || byUnitId(a.unit, b.unit)),
    availability: availability.sort((a, b) => a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0),
    unknownEnemyIds: unknownEnemyIds.sort() };
}

/** The guard and arriving player troops share the combat-rating currency.
 * This target group is for force assessment only, never exposure or navigation:
 * its incoming members are not a fictitious, enlarged neutral camp. */
export function assessAllocatedCampEngagement(input: TargetReinforcementInput & Readonly<{ unitIds: readonly string[] }>) {
  const { snapshot, situation, target, windowTicks } = input;
  const original = strategicTargetCamp(snapshot, target), guards = [...(original?.creeps ?? [])].filter(unit => unit.hp > 0);
  const reinforcement = targetEnemyReinforcements(input), { arriving, unknownEnemyIds } = reinforcement;
  const selected = new Set(input.unitIds), ours = snapshot.units.filter(unit => selected.has(unit.id) && unit.owner === situation.owner && unit.hp > 0);
  const onStation = [...guards, ...reinforcement.onStation];
  const knownMembers = [...onStation, ...arriving.map(entry => entry.unit)].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const shares = new Map(reinforcement.availability.map(entry => [entry.unitId, entry.share]));
  // Preserve the camp's existing actual rating. Player reinforcements use the
  // camp combat metric, not SituationUnit.strength (the field/price currency).
  const weighted = arrivalWeightedForce(onStation, arriving, windowTicks,
    group => (original?.strength ?? 0) + group.filter(unit => unit.owner !== 'neutral')
      .reduce((sum, unit) => sum + creepForce([unit]) * (shares.get(unit.id) ?? 1), 0));
  const center = original?.center ?? target.point;
  // A temporary summon contributes only the HP/damage available during this
  // fight. These assessment copies are never simulation entities or route facts.
  const projectedMembers = knownMembers.map(unit => {
    const share = shares.get(unit.id) ?? 1;
    return share < 1 ? { ...unit, hp: unit.hp * share, attackDamage: unit.attackDamage * share } : unit;
  });
  const opposition: Readonly<Camp> = { center, creeps: projectedMembers, strength: weighted.effectiveForce,
    reach: Math.max(0, ...knownMembers.map(unit => distance(unit, center))) };
  const knownOurForce = assessAllocatedForce(situation.owner, ours, { metric: 'camp-force', camp: opposition }).force;
  const margin = original ? forceFor(original) - original.strength : 0;
  return { status: unknownEnemyIds.length ? 'unknown' as const : 'known' as const,
    memberIds: knownMembers.map(unit => unit.id), candidateEnemyIds: reinforcement.candidateEnemies.map(unit => unit.id),
    onStationEnemyIds: onStation.map(unit => unit.id).sort(), enRouteEnemyIds: arriving.map(entry => entry.unit.id).sort(),
    unknownEnemyIds: unknownEnemyIds.sort(),
    enemyAvailability: reinforcement.availability,
    knownOpponentForce: weighted.effectiveForce, actualOpponentForce: unknownEnemyIds.length ? null : weighted.effectiveForce,
    knownOurForce, ourForce: unknownEnemyIds.length ? null : knownOurForce,
    requiredForce: unknownEnemyIds.length ? null : weighted.effectiveForce + margin, margin, opposition };
}

/** Use the actual target's strike surface when it exists. Structures remain
 * structures, never members of a navigational neutral camp. */
export function targetCoveringTowers(snapshot: GameSnapshot, owner: PlayerId, target: Target, side: 'own' | 'opponent', plannedAssetRadius = 0) {
  if (!Number.isFinite(plannedAssetRadius) || plannedAssetRadius < 0) throw new Error('Invalid planned asset radius');
  const actualTarget = snapshot.buildings.find(building => building.id === target.entityId)
    ?? (plannedAssetRadius ? { ...target.point, radius: plannedAssetRadius } : target.point);
  return snapshot.buildings.filter(tower => tower.complete && tower.hp > 0 && tower.attackDamage > 0
    && (side === 'own' ? tower.owner === owner : isOpponentOwner(snapshot, owner, tower.owner, {}))
    && strikeGap(tower, actualTarget) <= tower.attackRange);
}

function campBattleForces(owner: PlayerId, ours: readonly Unit[], opposition: Readonly<Camp>, margin: number,
  towers: ReturnType<typeof targetCoveringTowers>) {
  const actualOpponentForce = opposition.strength + towers.reduce((sum, tower) => sum + structureRating(tower), 0);
  const ourForce = towers.length ? creepForce(ours) : assessAllocatedForce(owner, ours, { metric: 'camp-force', camp: opposition }).force;
  return { actualOpponentForce, ourForce, requiredForce: actualOpponentForce + margin };
}

/** The executor's physical counterpart of the forecast. Only actual granted,
 * landed members count; no ETA, unarrived reinforcement or remembered hold is
 * cashed out. Players outside the post's leash remain a parent-plan concern. */
export function assessPresentCampEngagement(input: Readonly<{ snapshot: GameSnapshot; owner: PlayerId;
  target: Target; unitIds: readonly string[]; campMemberIds: readonly string[]; radius?: number }>) {
  const { snapshot, owner, target } = input, ids = new Set(input.unitIds), members = new Set(input.campMemberIds);
  const guards = snapshot.units.filter(unit => unit.owner === 'neutral' && unit.hp > 0 && members.has(unit.id));
  const center = guards.length ? averagePoint(guards.map(unit => ({ x: unit.homeX ?? unit.x, y: unit.homeY ?? unit.y }))) : target.point;
  const camp: Camp = { center, creeps: guards, strength: strengthOf(guards), reach: Math.max(0,
    ...guards.map(unit => distance(center, { x: unit.homeX ?? unit.x, y: unit.homeY ?? unit.y }))) };
  const ours = snapshot.units.filter(unit => ids.has(unit.id) && unit.owner === owner && unit.hp > 0 && unit.kind !== 'worker'
    && unit.attackDamage > 0 && unitMover(unit.kind) === 'land' && !unit.deck && !unit.cabin && sameGround(snapshot.map, unit, center));
  const hostile = snapshot.units.filter(unit => unit.hp > 0 && !unit.deck && !unit.cabin && unit.kind !== 'worker'
    && unit.attackDamage > 0 && unitMover(unit.kind) === 'land' && isOpponentOwner(snapshot, owner, unit.owner, {})
    && sameGround(snapshot.map, unit, center) && distance(unit, center) <= (input.radius ?? 650));
  const towers = targetCoveringTowers(snapshot, owner, { ...target, point: center }, 'opponent');
  const opposition: Camp = { center, creeps: [...guards, ...hostile], strength: camp.strength + creepForce(hostile), reach: 0 };
  const force = campBattleForces(owner, ours, opposition, guards.length ? forceFor(camp) - camp.strength : 0, towers);
  return { camp, ours, hostile, towers, ...force, sufficient: ours.length > 0 && force.ourForce >= force.requiredForce };
}

/** A bounded, monotone forecast of the first battle, not the economic holding
 * window. New arrivals may prolong a fight, but a unit cannot join before the
 * preceding forecast reaches its ETA. Lifetimes use the same engagement facts.
 * An iteration limit is unknown, not an accepted last approximation. */
export function assessAllocatedCampBattle(input: Omit<TargetReinforcementInput, 'windowTicks'> & Readonly<{
  unitIds: readonly string[]; maxIterations?: number }>) {
  const { snapshot, situation, target, battleStartTicks } = input;
  const maxIterations = input.maxIterations ?? 8;
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 32) throw new Error('Invalid camp battle iteration bound');
  const selected = new Set(input.unitIds), ours = snapshot.units.filter(unit => selected.has(unit.id)
    && unit.owner === situation.owner && unit.hp > 0 && unit.attackDamage > 0);
  const dps = ours.reduce((sum, unit) => sum + combatCapability(snapshot, unit).dps, 0);
  const camp = strategicTargetCamp(snapshot, target), towers = targetCoveringTowers(snapshot, situation.owner, target, 'opponent');
  let durationTicks = Math.max(1, dps > 0 ? Math.ceil((camp?.creeps.reduce((sum, unit) => sum + unit.hp, 0) ?? 0)
    / dps * SIM_TICKS_PER_SECOND) : 1);
  let engagement = assessAllocatedCampEngagement({ ...input, windowTicks: durationTicks });
  let converged = false, iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    engagement = assessAllocatedCampEngagement({ ...input, windowTicks: durationTicks });
    const next = dps > 0 ? Math.max(1, Math.ceil(engagement.opposition.creeps.reduce((sum, unit) => sum + unit.hp, 0)
      / dps * SIM_TICKS_PER_SECOND)) : durationTicks;
    if (next <= durationTicks) { converged = true; iterations++; break; }
    durationTicks = next;
  }
  if (!converged) engagement = assessAllocatedCampEngagement({ ...input, windowTicks: durationTicks });
  const rated = campBattleForces(situation.owner, ours, engagement.opposition, engagement.margin, towers);
  const opponentForce = engagement.actualOpponentForce === null ? null : rated.actualOpponentForce;
  const ourForce = engagement.ourForce === null ? null : rated.ourForce;
  const expires = ours.filter(unit => unit.expiresTick !== undefined && unit.expiresTick <= snapshot.tick + battleStartTicks + durationTicks);
  const status = converged && dps > 0 && engagement.status === 'known' && !expires.length ? 'known' as const : 'unknown' as const;
  const probability = status === 'known' ? forceSuccessProbability(ourForce!, opponentForce!) : null;
  const availability = new Map(engagement.enemyAvailability.map(entry => [entry.unitId, entry]));
  const frontRange = ours.length ? Math.min(...ours.map(unit => unit.attackRange)) : 0;
  // Exposure estimates damage only. One shared focus-fire model turns it into
  // exact deaths and wounded survivors; departure margins never enter loss cost.
  const damage = engagement.opposition.creeps.reduce((sum, opponent) => {
    const life = availability.get(opponent.id);
    const seconds = ((life?.throughTicks ?? battleStartTicks + durationTicks) - (life?.fromTicks ?? battleStartTicks)) / SIM_TICKS_PER_SECOND;
    const approach = Math.max(0, frontRange - opponent.attackRange) / Math.max(1, opponent.speed);
    const original = snapshot.units.find(unit => unit.id === opponent.id)!;
    return sum + combatCapability(snapshot, original).dps * Math.max(0, seconds - approach);
  }, towers.reduce((sum, tower) => sum + tower.attackDamage / Math.max(1, tower.attackCooldown) * durationTicks, 0));
  const casualties = focusedCasualties(ours, damage);
  const hp = ours.reduce((sum, unit) => sum + unit.hp, 0), lossShare = casualties.expectedHpLost / Math.max(1, hp);
  const permanent = casualtySurvivors(ours, casualties).filter(unit => unit.expiresTick === undefined);
  return { status, reasonCode: !converged ? 'camp-battle-iteration-limit' : !dps ? 'allocated-battle-dps-unavailable'
    : expires.length ? 'allocated-cohort-expires-during-battle' : engagement.status === 'unknown' ? 'battle-enemy-arrival-unknown' : 'camp-battle-converged',
    converged, iterations, battleStartTicks, durationTicks, battleUntilTicks: battleStartTicks + durationTicks, dps,
    engagement, coveringTowerIds: towers.map(tower => tower.id).sort(), actualOpponentForce: opponentForce,
    knownOurForce: ourForce, ourForce: status === 'known' ? ourForce : null,
    requiredForce: opponentForce === null ? null : opponentForce + engagement.margin, successProbability: probability,
    expiringOwnIds: expires.map(unit => unit.id).sort(),
    attrition: { ...casualties, lossShare,
      permanentUnitIds: permanent.map(unit => unit.id).sort(),
      survivingCampForce: creepForce(permanent), survivingFieldForce: strengthOf(permanent) } };
}

/** Conditional on winning the first fight: those opponents have been resolved.
 * Later actual player arrivals and local structure fire price the new asset.
 * The income comparison window is separate from this asset's own completion ETA. */
export function assessPostBattleSiteRisk(input: TargetReinforcementInput & Readonly<{
  excludedEnemyIds: readonly string[]; survivingPermanentCampForce: number; plannedAssetRadius: number;
  /** Other adequate support, excluding this priced cohort, in the same camp
   * metric. An omitted response never proves a potential attack certain. */
  response?: DefenseResponse }>) {
  if (!Number.isFinite(input.survivingPermanentCampForce) || input.survivingPermanentCampForce < 0)
    throw new Error('Invalid surviving permanent camp force');
  const excluded = new Set(input.excludedEnemyIds), reinforcement = targetEnemyReinforcements(input);
  const onStation = reinforcement.onStation.filter(unit => !excluded.has(unit.id));
  const arriving = reinforcement.arriving.filter(entry => !excluded.has(entry.unit.id));
  const unknownEnemyIds = reinforcement.unknownEnemyIds.filter(id => !excluded.has(id));
  const availability = reinforcement.availability.filter(entry => !excluded.has(entry.unitId));
  const shares = new Map(availability.map(entry => [entry.unitId, entry.share]));
  const weighted = arrivalWeightedForce(onStation, arriving, input.windowTicks,
    group => group.reduce((sum, unit) => sum + creepForce([unit]) * (shares.get(unit.id) ?? 1), 0));
  const ownTowers = targetCoveringTowers(input.snapshot, input.situation.owner, input.target, 'own', input.plannedAssetRadius);
  const hostileTowers = targetCoveringTowers(input.snapshot, input.situation.owner, input.target, 'opponent', input.plannedAssetRadius);
  const ownForce = input.survivingPermanentCampForce + ownTowers.reduce((sum, tower) => sum + structureRating(tower), 0);
  const opponentForce = weighted.effectiveForce + hostileTowers.reduce((sum, tower) => sum + structureRating(tower), 0);
  const siteId = input.target.entityId ?? `prospective:${input.target.point.x}:${input.target.point.y}`;
  const sites = input.situation.assets.filter(asset => asset.owner === input.situation.owner && ['hall', 'mine'].includes(asset.kind));
  const intent = createThreatIntentQuery(input.snapshot, input.situation.owner,
    [...sites.filter(site => site.id !== siteId), { id: siteId, target: input.target }]);
  const incoming = new Map(arriving.map(entry => [entry.unit.id, entry.etaTicks]));
  const facts = new Map(input.situation.units.map(unit => [unit.id, unit]));
  const scenarios = defenseThreatScenarios({ siteId, horizonTicks: input.windowTicks,
    attackers: [...onStation, ...arriving.map(entry => entry.unit)].map(unit => ({ unitId: unit.id,
      // A potential redirect is a race from the observed pose, not proof it
      // started moving while the first fight and hall construction took place.
      arrival: unitArrival(facts.get(unit.id)!, input.target.entityId ?? '')!, intent: intent(unit, siteId),
      strength: creepForce([unit]) * (shares.get(unit.id) ?? 1) / (1 + (incoming.get(unit.id) ?? 0) / input.windowTicks) })),
    arrivedStrength: 0, incomingStrength: 0, friendlyOnStationStrength: 0, firstArrivalTicks: null, lossProbability: null },
  input.response ?? { status: 'unknown' });
  const status = unknownEnemyIds.length || scenarios.status === 'unknown' ? 'unknown' as const : 'known' as const;
  const hostileStatic = hostileTowers.reduce((sum, tower) => sum + structureRating(tower), 0);
  const survivalProbability = status === 'known' ? scenarios.scenarios.reduce((sum, scenario) => sum
    + scenario.probability * assetSurvivalProbability({ status: 'known', ourForce: ownForce,
      opponentForce: scenario.force + hostileStatic })!, 0) : null;
  return { status, survivalProbability, ownForce, opponentForce, unknownEnemyIds,
    scenarios, actualOpponentForce: scenarios.actualForce + hostileStatic,
    memberIds: [...onStation, ...arriving.map(entry => entry.unit)].map(unit => unit.id).sort(), availability,
    ownTowerIds: ownTowers.map(tower => tower.id).sort(), hostileTowerIds: hostileTowers.map(tower => tower.id).sort(),
    battleStartTicks: input.battleStartTicks, throughTicks: input.battleStartTicks + input.windowTicks };
}
