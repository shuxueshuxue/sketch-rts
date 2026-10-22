import type { DecisionFacts } from './decision';
import { goalFact } from './goal-facts';
import type { GoalFact, GoalPlanningContext, GoalRequest } from './goal-planner-types';
import { siteCollapseAfter } from './naval-objectives';
import type { Objective, Target } from './types';
import { goalGarrisonThroughTick } from './goal-guard-window';

type ObservedObjective = DecisionFacts<Objective>;
const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Convert existing observer objectives, including blocked ones. This module
 * neither generates targets nor decomposes an objective into actions. Positive
 * benefit terms retain the observer's valuation epoch; negative benefits,
 * committed costs, success probability and persistence never enter reward. */
export function collectGoalRequests(objectives: readonly ObservedObjective[], context: GoalPlanningContext): readonly GoalRequest[] {
  return objectives.filter(objective => objective.owner === context.owner
    && !['complete', 'failed', 'abandoned'].includes(objective.status))
    .sort(order).map(objective => goalRequestFromObjective(objective, context));
}

export function goalRequestFromObjective(objective: ObservedObjective, context: GoalPlanningContext): GoalRequest {
  if (objective.owner !== context.owner) throw Error('Goal objective owner mismatch');
  const { situation, snapshot, tick } = context;
  const horizon = tick + objective.utility.horizonTicks;
  const targets = new Map(situation.assets.map(asset => [asset.id, asset.target]));
  const targetOf = (id: string): Target => {
    const asset = targets.get(id);
    if (asset) return asset;
    const body = snapshot.units.find(unit => unit.id === id) ?? snapshot.buildings.find(building => building.id === id);
    // A retained objective can outlive the entity. Preserve its recorded target
    // and identity; absence is not a fabricated death or a new nearest target.
    return { ...objective.target, entityId: id, point: body ? { x: body.x, y: body.y } : objective.target.point };
  };
  const effects: GoalFact[] = [];
  const deadlines: number[] = [];
  for (const effect of objective.effects) {
    if (effect.kind === 'site-safe') {
      effects.push(goalFact({ kind: 'site-safe', site: targetOf(effect.siteId), throughTick: effect.throughTick }));
      deadlines.push(effect.throughTick);
      if (objective.kind === 'DefendSite') {
        const threat = situation.lands.flatMap(land => land.threats).find(threat => threat.siteId === effect.siteId);
        const site = situation.assets.find(asset => asset.id === effect.siteId);
        const declaredArrivals = threat?.attackers.filter(attacker => attacker.intent?.kind === 'actual-intrusion'
          && attacker.intent.basis !== 'hostile-presence').flatMap(attacker => 'ticks' in attacker.arrival ? [attacker.arrival.ticks] : []) ?? [];
        if (declaredArrivals.length) deadlines.push(tick + Math.min(...declaredArrivals));
        else if (threat && site?.hp !== null && site?.hp !== undefined)
          deadlines.push(tick + Math.min(threat.horizonTicks, siteCollapseAfter(snapshot, threat, site.hp)));
      }
    } else if (effect.kind === 'mining-established') {
      const at = targetOf(effect.mineId);
      effects.push(goalFact({ kind: 'hall-complete', mineId: effect.mineId, at }));
      if (effect.garrisonHandoff) effects.push(goalFact({ kind: 'garrison-ready', mineId: effect.mineId, at,
        throughTick: goalGarrisonThroughTick(objective, effect) }));
    } else if (effect.kind === 'force-present') {
      effects.push(goalFact({ kind: 'force-at', at: { ...objective.target, landId: effect.landId },
        metric: 'field-strength', minimum: effect.minimumStrength, byTick: effect.throughTick }));
      deadlines.push(effect.throughTick);
    } else if (effect.kind === 'entity-destroyed')
      effects.push(goalFact({ kind: 'enemy-site-destroyed', site: targetOf(effect.entityId) }));
    else if (effect.kind === 'route-controlled') {
      effects.push(goalFact({ kind: 'route-controlled', at: effect.target, throughTick: horizon }));
      deadlines.push(horizon);
    } else if (effect.kind === 'harassment-ended') {
      effects.push(goalFact({ kind: 'harassment-ended', site: targetOf(effect.siteId), throughTick: horizon, unitIds: [effect.unitId] }));
      deadlines.push(horizon);
    } else if (effect.kind === 'assets-evacuated') {
      effects.push(goalFact({ kind: 'assets-safe', unitIds: effect.unitIds, at: effect.destination, throughTick: horizon }));
      deadlines.push(horizon);
    } else {
      const exhaustive: never = effect;
      throw Error(`Unsupported objective effect ${String(exhaustive)}`);
    }
  }
  const terms = objective.utility.benefit.filter(term => term.value > 0);
  if (objective.utility.benefit.some(term => !Number.isFinite(term.value))) throw Error('Invalid objective benefit');
  const rewardGold = terms.reduce((sum, term) => sum + term.value, 0);
  if (!Number.isFinite(rewardGold)) throw Error('Invalid objective reward');
  return { id: objective.id, owner: objective.owner,
    effects: [...new Map(effects.map(fact => [fact.id, fact])).values()], rewardGold,
    deadlineTick: deadlines.length ? Math.min(...deadlines) : null,
    reasons: [{ code: 'goal-from-observed-objective', factIds: [objective.id],
      values: { observedTick: tick, blocked: objective.status === 'blocked', benefitTerms: terms.length,
        rewardGold, sourceBenefitsKeepExistingDiscount: true } },
      ...terms.map(term => ({ code: 'goal-objective-benefit', factIds: [objective.id, term.code], values: { gold: term.value } }))] };
}
