import type { GameSnapshot } from '../../shared/types';
import { distance } from '../policy/spatial';
import type { DecisionFacts } from './decision';
import { assessDefenseResponse, currentInPlaceDefense } from './defense-response';
import { defenseInPlaceSurvival, defenseThreatScenarios } from './defense-risk';
import type { Situation, Target } from './types';

/** Staying is a per-person counterfactual at this think's physical location.
 * Consume existing site coverage and shared risk primitives only; never create
 * new navigation facts or reuse a far-away source site's danger for everybody. */
export function evacuationInPlace(input: Readonly<{ snapshot: GameSnapshot; situation: DecisionFacts<Situation>;
  unitIds: readonly string[]; destination: Target; arrivedUnitIds: readonly string[];
  responseEligibleUnitIds: readonly string[]; excludedUnitIds: readonly string[] }>) {
  const { snapshot, situation } = input;
  const threats = new Map(situation.lands.flatMap(land => land.threats).map(threat => [threat.siteId, threat]));
  const assets = new Map(situation.assets.filter(asset => asset.owner === situation.owner).map(asset => [asset.id, asset]));
  const facts = new Map(situation.units.map(unit => [unit.id, unit]));
  const arrived = new Set(input.arrivedUnitIds), cache = new Map<string, ReturnType<typeof defenseInPlaceSurvival>>();
  const byUnit = new Map<string, ReturnType<typeof defenseInPlaceSurvival>>(), targets = new Map<string, Target | null>();
  for (const id of input.unitIds) {
    const unit = facts.get(id);
    let target: Target | undefined;
    if (unit?.location.kind === 'land') {
      const location = unit.location;
      if (arrived.has(id)) target = input.destination;
      else if (threats.has(id)) target = assets.get(id)?.target;
      else target = [...assets.values()].filter(asset => asset.kind === 'hall' && asset.target.landId === location.landId
        && distance(asset.target.point, location.point) <= 650)
        .sort((a, b) => distance(a.target.point, location.point) - distance(b.target.point, location.point)
          || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]?.target;
    }
    targets.set(id, target ?? null);
    if (!target?.entityId) { byUnit.set(id, defenseInPlaceSurvival({ threat: null, defendingForce: 0 })); continue; }
    const key = `${target.entityId}:${target.point.x}:${target.point.y}`;
    let survival = cache.get(key);
    if (!survival) {
      const threat = threats.get(target.entityId);
      if (!threat) survival = defenseInPlaceSurvival({ threat: null, defendingForce: 0 });
      else {
        const defense = currentInPlaceDefense({ snapshot, situation, target, excludedUnitIds: input.excludedUnitIds });
        const response = assessDefenseResponse({ snapshot, situation, target, arrivalTargetId: target.entityId,
          eligibleUnitIds: input.responseEligibleUnitIds, excludedUnitIds: input.excludedUnitIds,
          actualMobileOpponentForce: threat.attackers.reduce((sum, attacker) => sum + attacker.strength, 0), windowTicks: threat.horizonTicks });
        const scenarios = defenseThreatScenarios(threat, response.response);
        const totalThreat = scenarios.status === 'unknown' ? scenarios : { ...scenarios,
          scenarios: scenarios.scenarios.map(scenario => ({ ...scenario, force: scenario.force + response.hostileStaticForce })) };
        survival = defenseInPlaceSurvival({ threat: totalThreat, defendingForce: defense.totalForce });
      }
      cache.set(key, survival);
    }
    byUnit.set(id, survival);
  }
  return { byUnit, targets };
}
