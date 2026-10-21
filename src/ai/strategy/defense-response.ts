import { structureRating, TOWER_STRENGTH } from '../policy/v6/strength';
import { creepForce } from '../policy/v7/creep';
import type { GameSnapshot } from '../../shared/types';
import type { DecisionFacts } from './decision';
import { targetCoveringTowers } from './allocated-force';
import type { DefenseResponse } from './defense-risk';
import type { Situation, Target } from './types';
import { unitArrival } from './unit-arrivals';
import { distance } from '../policy/spatial';

/** Physical occupants only. A possible future response is not already
 * protecting an evacuee. Recompute native tower coverage once instead of
 * adding it to SiteThreat.friendlyOnStationStrength, which already includes
 * a coarse tower term. Field and camp currencies remain separate. */
export function currentInPlaceDefense(input: Readonly<{ snapshot: GameSnapshot;
  situation: DecisionFacts<Situation>; target: Target; excludedUnitIds?: readonly string[] }>) {
  const excluded = new Set(input.excludedUnitIds ?? []);
  const units = input.situation.units.filter(unit => unit.owner === input.situation.owner && unit.hp > 0
    && unit.location.kind === 'land' && unit.location.landId === input.target.landId
    && !unit.roles.some(role => ['worker', 'transport', 'warship'].includes(role))
    && !excluded.has(unit.id) && (unit.expiresTick === null || unit.expiresTick > input.snapshot.tick)
    && distance(unit.location.point, input.target.point) <= 650);
  const towers = targetCoveringTowers(input.snapshot, input.situation.owner, input.target, 'own');
  const mobileForce = units.reduce((sum, unit) => sum + unit.strength, 0);
  const staticForce = towers.reduce((sum, tower) => sum + TOWER_STRENGTH * Math.max(0, tower.hp / Math.max(1, tower.maxHp)), 0);
  return { unitIds: units.map(unit => unit.id).sort(), towerIds: towers.map(tower => tower.id).sort(),
    mobileForce, staticForce, totalForce: mobileForce + staticForce };
}

/** Counterfactual response, from an explicit eligible pool with the priced
 * cohort removed. It is a forecast, never permission to recruit or command.
 * Tower reach is the same native strike-surface query as the battle model. */
export function assessDefenseResponse(input: Readonly<{
  snapshot: GameSnapshot; situation: DecisionFacts<Situation>; target: Target; arrivalTargetId: string;
  eligibleUnitIds: readonly string[]; excludedUnitIds: readonly string[];
  actualMobileOpponentForce: number; windowTicks: number;
  metric?: 'field-strength' | 'camp-force'; plannedAssetRadius?: number;
}>) {
  const { snapshot, situation, target, windowTicks } = input;
  if (!Number.isFinite(input.actualMobileOpponentForce) || input.actualMobileOpponentForce < 0
    || !Number.isFinite(windowTicks) || windowTicks <= 0) throw new Error('Invalid counterfactual defense window/force');
  const ownTowers = targetCoveringTowers(snapshot, situation.owner, target, 'own', input.plannedAssetRadius);
  const hostileTowers = targetCoveringTowers(snapshot, situation.owner, target, 'opponent', input.plannedAssetRadius);
  const towerForce = (towers: typeof ownTowers) => towers.reduce((sum, tower) => sum + (input.metric === 'camp-force'
    ? structureRating(tower) : TOWER_STRENGTH * Math.max(0, tower.hp / Math.max(1, tower.maxHp))), 0);
  const staticForce = towerForce(ownTowers), hostileStaticForce = towerForce(hostileTowers);
  const requiredForce = input.actualMobileOpponentForce + hostileStaticForce;
  const excluded = new Set(input.excludedUnitIds), eligible = new Set(input.eligibleUnitIds);
  const arrivals: { unitId: string; ticks: number; force: number }[] = [], unknownUnitIds: string[] = [];
  const actors = new Map(snapshot.units.map(unit => [unit.id, unit]));
  for (const unit of situation.units) {
    if (unit.owner !== situation.owner || unit.hp <= 0 || unit.strength <= 0 || !eligible.has(unit.id) || excluded.has(unit.id)
      || unit.roles.includes('worker') || unit.roles.includes('transport') || unit.roles.includes('warship')) continue;
    const arrival = unitArrival(unit, input.arrivalTargetId);
    if (arrival?.status === 'unreachable' || arrival && 'lowerBoundTicks' in arrival
      && typeof arrival.lowerBoundTicks === 'number' && arrival.lowerBoundTicks > windowTicks) continue;
    if (!arrival || arrival.status === 'unknown' || arrival.status === 'conditional') { unknownUnitIds.push(unit.id); continue; }
    if (!('ticks' in arrival) || arrival.ticks > windowTicks || unit.expiresTick !== null && unit.expiresTick <= snapshot.tick + arrival.ticks) continue;
    const actor = actors.get(unit.id);
    if (input.metric === 'camp-force' && !actor) { unknownUnitIds.push(unit.id); continue; }
    arrivals.push({ unitId: unit.id, ticks: arrival.ticks, force: input.metric === 'camp-force' ? creepForce([actor!]) : unit.strength });
  }
  arrivals.sort((a, b) => a.ticks - b.ticks || (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
  let force = staticForce, response: DefenseResponse = { status: 'none' };
  const responseUnitIds: string[] = [];
  if (force >= requiredForce) response = { status: 'known', ticks: 0 };
  else for (const arrival of arrivals) {
    force += arrival.force; responseUnitIds.push(arrival.unitId);
    if (force >= requiredForce) { response = { status: 'known', ticks: arrival.ticks }; break; }
  }
  // A missing route might make the response earlier; do not silently turn it
  // into zero support or a known no-response fact.
  if (unknownUnitIds.length && (response.status !== 'known' || response.ticks > 0)) response = { status: 'unknown' };
  return { response, responseUnitIds, unknownUnitIds: unknownUnitIds.sort(), responseForce: force, requiredForce,
    staticForce, hostileStaticForce, ownTowerIds: ownTowers.map(tower => tower.id).sort(),
    hostileTowerIds: hostileTowers.map(tower => tower.id).sort() };
}
