import type { SiteThreat } from './types';
import type { DecisionFacts } from './decision';
import { forceSuccessProbability } from './utility';

export type DefenseResponse = Readonly<{ status: 'known'; ticks: number } | { status: 'none' } | { status: 'unknown' }>;

/** A race estimate, not an assertion of an enemy's future intention. A slower
 * friendly response leaves more time for a profitable redirect. Equal ETAs
 * give one half; an observed on-station response gives zero; missing ETA stays
 * unknown. No map, unit price or safety margin enters this probability. */
export function redirectProbability(enemyTicks: number, response: DefenseResponse): number | null {
  if (!Number.isFinite(enemyTicks) || enemyTicks < 0) throw new Error('Invalid enemy redirect ETA');
  if (response.status === 'unknown') return null;
  if (response.status === 'none') return 1;
  if (!Number.isFinite(response.ticks) || response.ticks < 0) throw new Error('Invalid friendly response ETA');
  if (enemyTicks === 0 && response.ticks === 0) return .5;
  const scale = Math.max(enemyTicks, response.ticks);
  return (response.ticks / scale) / (enemyTicks / scale + response.ticks / scale);
}

/** Mutually exclusive redirect scenarios preserve the actual opponent cohort;
 * they do not replace an uncertain arrival by an averaged, fictitious army. */
export function defenseThreatScenarios(threat: DecisionFacts<SiteThreat>, response: DefenseResponse) {
  const actualIds: string[] = [], oppositionIds: string[] = [];
  const groups = new Map<string, { unitIds: string[]; force: number; earliestTicks: number; unknown: boolean }>();
  let actualForce = 0;
  const unknownIds: string[] = [];
  for (const attacker of threat.attackers) {
    if (oppositionIds.includes(attacker.unitId)) throw new Error('Enemy counted twice in site threat');
    oppositionIds.push(attacker.unitId);
    if (!Number.isFinite(attacker.strength) || attacker.strength < 0) throw new Error('Invalid site opponent force');
    if (!attacker.intent || !('ticks' in attacker.arrival)) { unknownIds.push(attacker.unitId); continue; }
    if (attacker.intent.kind === 'actual-intrusion') {
      if (attacker.intent.actualSiteId !== threat.siteId) throw new Error('Actual intrusion belongs to another site');
      actualIds.push(attacker.unitId); actualForce += attacker.strength; continue;
    }
    const key = attacker.intent.redirectGroupId;
    const group = groups.get(key) ?? { unitIds: [], force: 0, earliestTicks: attacker.arrival.ticks, unknown: false };
    group.unitIds.push(attacker.unitId); group.force += attacker.strength;
    group.earliestTicks = Math.min(group.earliestTicks, attacker.arrival.ticks);
    groups.set(key, group);
  }
  const redirects = [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([id, group]) => ({
    id, unitIds: group.unitIds.sort(), force: group.force, etaTicks: group.earliestTicks,
    probability: redirectProbability(group.earliestTicks, response),
  }));
  const missing = redirects.filter(group => group.probability === null).flatMap(group => group.unitIds);
  if (unknownIds.length || missing.length || redirects.length > 6) return {
    status: 'unknown' as const, actualIds: actualIds.sort(), actualForce, oppositionIds: oppositionIds.sort(), redirects,
    unknownIds: [...new Set([...unknownIds, ...missing])].sort(), scenarios: [],
    reasonCode: redirects.length > 6 ? 'defense-scenario-budget-exceeded' : 'defense-response-or-intent-unknown',
  };
  let scenarios = [{ probability: 1, force: actualForce, unitIds: actualIds.sort() }];
  for (const group of redirects) {
    const p = group.probability!;
    scenarios = scenarios.flatMap(scenario => [
      { ...scenario, probability: scenario.probability * (1 - p) },
      { probability: scenario.probability * p, force: scenario.force + group.force,
        unitIds: [...scenario.unitIds, ...group.unitIds].sort() },
    ]).filter(scenario => scenario.probability > 0);
  }
  return { status: 'known' as const, actualIds: actualIds.sort(), actualForce, oppositionIds: oppositionIds.sort(),
    redirects, unknownIds: [], scenarios, reasonCode: 'native-intrusions-and-redirect-races' };
}

/** Expected protection is evaluated per real army scenario. Averaging opponent
 * force before the nonlinear fight probability would produce a different
 * answer. Static protection is the no-cohort counterfactual, not a cash cost. */
export function defenseProtectionValue(input: Readonly<{
  threat: ReturnType<typeof defenseThreatScenarios>;
  assetValueGold: number;
  cohortForce: number;
  staticForce: number;
}>) {
  const { threat, assetValueGold, cohortForce, staticForce } = input;
  for (const value of [assetValueGold, cohortForce, staticForce])
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid defense protection input');
  if (threat.status === 'unknown') return null;
  let attackProbability = 0, protectedShare = 0, staticShare = 0;
  for (const scenario of threat.scenarios) {
    if (!(scenario.force > 0)) continue;
    attackProbability += scenario.probability;
    protectedShare += scenario.probability * forceSuccessProbability(cohortForce + staticForce, scenario.force);
    staticShare += scenario.probability * forceSuccessProbability(staticForce, scenario.force);
  }
  return { attackProbability, successProbability: attackProbability > 0 ? protectedShare / attackProbability : 0,
    benefitGold: assetValueGold * attackProbability, staticBaselineGold: assetValueGold * staticShare,
    protectedGold: assetValueGold * protectedShare,
    grossGold: assetValueGold * (protectedShare - staticShare) };
}

/** Counterfactual asset survival while staying at its current site. Peaceful
 * branches preserve the asset with probability one; real/potential armies are
 * the same mutually exclusive SiteThreat scenarios used for protection. This
 * is not a second combat model and does not assert an unknown site is safe. */
export function defenseInPlaceSurvival(input: Readonly<{
  threat: ReturnType<typeof defenseThreatScenarios> | null;
  defendingForce: number;
}>) {
  if (!Number.isFinite(input.defendingForce) || input.defendingForce < 0) throw new Error('Invalid in-place defense force');
  if (!input.threat || input.threat.status === 'unknown') return { status: 'unknown' as const, survivalProbability: null,
    reasonCode: input.threat?.reasonCode ?? 'in-place-site-threat-unobserved', unknownIds: input.threat?.unknownIds ?? [] };
  const protectedValue = defenseProtectionValue({ threat: input.threat, assetValueGold: 1,
    cohortForce: 0, staticForce: input.defendingForce })!;
  return { status: 'known' as const, survivalProbability: 1 - protectedValue.attackProbability + protectedValue.staticBaselineGold,
    reasonCode: 'same-site-threat-in-place-survival', unknownIds: [] };
}
