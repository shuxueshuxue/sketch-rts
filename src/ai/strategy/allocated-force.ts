import { unitMover } from '../../shared/catalog';
import { walkableGoal } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { strengthOf } from '../policy/v6/strength';
import { creepForce, forceFor, type Camp } from '../policy/v7/creep';
import { isOpponentOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import { arrivalWeightedForce } from './arrival-force';
import type { DecisionFacts } from './decision';
import { landIdAt } from './regions';
import { strategicTargetCamp } from './target-camp';
import type { Situation, Target } from './types';
import { unitArrival } from './unit-arrivals';

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
