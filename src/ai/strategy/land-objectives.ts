import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { bodyMass } from '../../shared/physical-body';
import { constructionWorkers } from '../../shared/construction';
import { withinExpansionGarrisonCoverage } from '../bootstrap_1/expansion-garrison-rules';
import type { Unit } from '../../shared/types';
import { strategyIsOpponent } from './ownership';
import { canLandIntercept, landInterceptionShotDamage } from './land-interception';
import { assessLandCombatAttrition, landCombatResponseCoverage, landCombatWorkTicks } from './land-combat-assessment';
import { creepForce, forceFor, neutralCamps, EXPANSION_GUARD_RANGE, type Camp } from '../policy/v7/creep';
import { combatRating, structureRating } from '../policy/v6/strength';
import type {
  Arrival, Asset, Evidence, IdleForce, Method, Objective, ObjectiveKind, Opportunity, PlanningContext,
  Precondition, Reason, ResourceDemand, Situation, SituationUnit, Subgoal, Target, Utility, UtilityTerm,
} from './types';
import { discountGold, forceSuccessProbability, forceTimeGold, STRATEGY_PARAMETERS as PARAMETERS, strategyUtility } from './utility';
import type { PreviousObjective } from './observation-memory';
import { projectedCopy } from './explanations';
import { unitArrival as arrivalAt } from './unit-arrivals';
import { landAssessmentEvidence, landReason as reason, projectLandReason, projectLandTerm, reasonFact,
  termFact as term, type LandReasonFact, type LandTermFact, type LandText } from './land-explanations';

type LandKind = Extract<ObjectiveKind, 'ExpandLand' | 'RecoverSite' | 'AttackSite' | 'ContestRoute' | 'CounterHarass'>;
type Candidate = { kind: LandKind; key: string; target: Target; opportunities: Opportunity[] };
type Fighter = { unit: SituationUnit; raw: Unit; eta: number; coverage: number; borrowed: boolean; interrupted: boolean };
type Assessment = {
  candidate: Candidate; id: string; crew: Fighter[]; required: number; power: number; available: number;
  eta: number | null; duration: number; camp: Camp | undefined; occupation: Target | undefined; preconditions: Precondition[];
  benefit: UtilityTerm[]; cost: UtilityTerm[]; evidence: () => readonly Evidence[]; reasons: Reason[];
};
type ConditionFact = Omit<Precondition, 'reason'> & { reason: LandReasonFact };
type AssessmentFacts = Omit<Assessment, 'preconditions' | 'benefit' | 'cost' | 'evidence' | 'reasons'> & {
  preconditions: ConditionFact[]; benefit: LandTermFact[]; cost: LandTermFact[]; reasons: LandReasonFact[];
};
type CachedAssessment = Omit<AssessmentFacts, 'candidate' | 'camp' | 'crew'> & {
  crew: (Omit<Fighter, 'unit' | 'raw'> & { id: string })[];
};
function projectAssessment(facts: AssessmentFacts, situation: Situation): Assessment {
  const projected = new Map<LandReasonFact, Reason>();
  const projectReason = (fact: LandReasonFact) => {
    let value = projected.get(fact);
    if (!value) { value = projectLandReason(fact, situation.tick); projected.set(fact, value); }
    return value;
  };
  return { ...facts,
    preconditions: facts.preconditions.map(condition => ({ ...condition, reason: projectReason(condition.reason),
      demand: condition.demand?.kind === 'force' && condition.demand.neededByTick !== null
        ? { ...condition.demand, neededByTick: situation.tick + (facts.eta ?? 0) } : condition.demand })),
    benefit: facts.benefit.map(projectLandTerm), cost: facts.cost.map(projectLandTerm),
    evidence: landAssessmentEvidence(facts.candidate.opportunities, situation.tick, facts.available, facts.power, facts.required),
    reasons: facts.reasons.map(projectReason) };
}
const methodVariants = (a: Assessment) => a.preconditions.some(item => item.kind === 'force' && item.demand && item.status === 'unmet')
  ? ['borrow', 'train'] as const : ['current'] as const;
const HORIZON = PARAMETERS.utilityHorizonTicks;
// Observation is bounded before any target-specific combat calculations. No route query occurs here.
const CANDIDATES_PER_KIND = 4;
const campCache = new WeakMap<PlanningContext['snapshot'], { tick: number; camps: Camp[] }>();
// A proposal and its methods share one assessment during this immutable observation pass.
// Weak keys keep this cache out of saved policy state and release it with the trace.
const assessments = new WeakMap<Objective, { situation: Situation; context: PlanningContext; model: LandModel; value: Assessment }>();
type RetainedAssessment = { key: string; value: CachedAssessment };
type ObservationCache = { map: PlanningContext['snapshot']['map']; owner: string; tick: number; goals: Map<string, RetainedAssessment> };
// Observational memoization, outside serialized policy memory. Match reset/map/owner changes
// discard it; each entry retains only owned values and cohort IDs, not a world snapshot.
const observations = new WeakMap<PlanningContext['memory'], ObservationCache>();
const sameMap = (a: ObservationCache['map'], b: ObservationCache['map']) => a.id === b.id && a.width === b.width
  && a.height === b.height && a.terrain === b.terrain && a.landmarks === b.landmarks;
const gap = (a: Target['point'], b: Target['point']) => Math.hypot(a.x - b.x, a.y - b.y);
const identity = (kind: ObjectiveKind, owner: string, target: string) => `${kind}:${owner}:${target}`;
const interruption = (unit: SituationUnit) => unit.commitments.some(item => /care|recover|healing|retreat|safety|shell/i.test(item.source));
const battleRole = (unit: SituationUnit) => unit.roles.some(role => ['frontline', 'ranged', 'caster'].includes(role));
const frontRole = (unit: SituationUnit) => !unit.roles.includes('caster') && !unit.roles.includes('healer')
  && unit.roles.some(role => role === 'frontline' || role === 'ranged');
const unquoted = (arrival: Arrival | undefined) => !arrival || arrival.status === 'unknown'
  && arrival.reason.code !== 'beyond-evaluation-window';
function knownArrival(arrival: Arrival | undefined): arrival is Extract<Arrival, { ticks: number }> {
  if (!arrival || !('ticks' in arrival)) return false;
  if (!Number.isFinite(arrival.ticks) || arrival.ticks < 0) throw new Error(`Invalid land objective arrival: ${arrival.ticks}`);
  return true;
}

/** Pure consumer of the shared Situation. This class does not create routes, threat forecasts or claims. */
class LandModel {
  readonly raw: Map<string, Unit>;
  readonly own: SituationUnit[];
  readonly units: Map<string, SituationUnit>;
  readonly assets: Map<string, Asset>;
  readonly retained: ObservationCache;
  constructor(readonly situation: Situation, readonly context: PlanningContext) {
    if (situation.owner !== context.owner || situation.tick !== context.snapshot.tick)
      throw new Error('Land objective Situation and context must describe the same owner/tick');
    this.raw = new Map(context.snapshot.units.map(unit => [unit.id, unit]));
    this.units = new Map(situation.units.map(unit => [unit.id, unit]));
    this.own = situation.units.filter(unit => unit.owner === context.owner && unit.hp > 0);
    this.assets = new Map(situation.assets.map(asset => [asset.id, asset]));
    const previous = observations.get(context.memory);
    // snapshotGame copies the map wrapper, but retains its geometry. Wind and that
    // wrapper's identity are not facts used by a land quotation; the shared ETA is.
    this.retained = previous && sameMap(previous.map, context.snapshot.map) && previous.owner === context.owner && previous.tick <= situation.tick
      ? previous : { map: context.snapshot.map, owner: context.owner, tick: situation.tick, goals: new Map() };
    this.retained.tick = situation.tick;
    observations.set(context.memory, this.retained);
  }
  foe(owner: string) { return strategyIsOpponent(this.context.snapshot, this.context.owner, owner, this.context.teams); }
  mining(kind: LandKind) { return kind === 'ExpandLand' || kind === 'RecoverSite'; }
  income(asset: Asset | undefined) {
    return asset ? Math.max(0, Math.min(asset.remainingGold, asset.incomeGoldPerTick * HORIZON)) : 0;
  }
  mineFor(target: Target) {
    return this.situation.assets.filter(asset => asset.kind === 'mine' && asset.target.landId === target.landId
      && gap(asset.target.point, target.point) <= GOLD_MINE_RULES.baseRange)
      .sort((a, b) => gap(a.target.point, target.point) - gap(b.target.point, target.point) || a.id.localeCompare(b.id))[0];
  }
  candidates(): Candidate[] {
    const result = new Map<string, Candidate>();
    const add = (kind: LandKind, key: string, target: Target, opportunity?: Opportunity) => {
      const id = identity(kind, this.context.owner, key), existing = result.get(id);
      if (existing) { if (opportunity) existing.opportunities.push(opportunity); return; }
      result.set(id, { kind, key, target: { ...target, point: { ...target.point } }, opportunities: opportunity ? [opportunity] : [] });
    };
    const lost = new Set(this.situation.opportunities.filter(item => item.kind === 'lost-site').map(item => item.target.entityId));
    for (const opportunity of this.situation.opportunities) {
      const { target } = opportunity, id = target.entityId;
      if (!id) continue;
      if (opportunity.kind === 'lost-site') add('RecoverSite', id, target, opportunity);
      if (opportunity.kind === 'neutral-mine' && !lost.has(id)) {
        // An active overseas parent owns its mining effect even after a caster or worker has landed.
        const conquest = this.context.memory.naval?.conquests?.[id];
        const localWorkforce = this.own.some(unit => unit.roles.includes('worker') && unit.location.kind === 'land'
          && unit.location.landId === target.landId);
        if ((!conquest || conquest.stage === 'complete') && localWorkforce) add('ExpandLand', id, target, opportunity);
      }
      if (opportunity.kind === 'route') add('ContestRoute', id, target, opportunity);
      if (['weak-site', 'construction', 'army-away'].includes(opportunity.kind)) {
        const hall = this.assets.get(id);
        if (hall?.kind === 'hall' && this.foe(hall.owner)) add('AttackSite', id, hall.target, opportunity);
      }
    }
    for (const hall of this.situation.assets.filter(asset => asset.kind === 'hall' && this.foe(asset.owner)))
      add('AttackSite', hall.id, hall.target);
    const active = this.context.memory.landExpansion;
    if (active && active.stage !== 'complete' && !lost.has(active.mineId)) {
      const mine = this.assets.get(active.mineId);
      if (mine && !result.has(identity('ExpandLand', this.context.owner, mine.id)))
        add('ExpandLand', mine.id, mine.target, this.situation.opportunities.find(opportunity =>
          opportunity.kind === 'neutral-mine' && opportunity.target.entityId === mine.id));
    }
    const siteThreats = this.situation.lands.flatMap(land => land.threats);
    const workerIds = new Set(this.own.filter(unit => unit.roles.includes('worker')).map(unit => unit.id));
    for (const threat of siteThreats) {
      const site = this.assets.get(threat.siteId);
      if (site?.owner !== this.context.owner) continue;
      for (const attacker of threat.attackers) {
        const unit = this.units.get(attacker.unitId), raw = this.raw.get(attacker.unitId);
        const harassing = raw?.kind === 'horseArcher' || raw?.order.type === 'attack' && workerIds.has(raw.order.targetId);
        if (unit && harassing && this.foe(unit.owner) && unit.location.kind === 'land')
          add('CounterHarass', unit.id, { entityId: unit.id, landId: unit.location.landId, point: { ...unit.location.point } });
      }
    }
    const activeId = this.context.memory.landAttack?.targetId;
    const coarse = (candidate: Candidate) => {
      const key = candidate.kind === 'ContestRoute' ? candidate.opportunities[0]?.id ?? candidate.key : candidate.key;
      const etas = this.own.filter(unit => battleRole(unit) && !interruption(unit)).map(unit => arrivalAt(unit, key)).filter(knownArrival);
      const eta = etas.length ? Math.min(...etas.map(arrival => arrival.ticks)) : HORIZON;
      return Math.max(this.assets.get(candidate.key)?.replacementGold ?? 0,
        this.income(this.mineFor(candidate.target)), ...candidate.opportunities.map(op => op.valueGold), 0) / (1 + eta / HORIZON);
    };
    const coarseValues = new Map([...result.values()].map(candidate => [candidate, coarse(candidate)]));
    return [...result.values()].sort((a, b) => Number(b.key === activeId || b.key === active?.mineId)
      - Number(a.key === activeId || a.key === active?.mineId) || coarseValues.get(b)! - coarseValues.get(a)! || a.key.localeCompare(b.key))
      .filter((candidate, index, all) => all.slice(0, index).filter(other => other.kind === candidate.kind).length < CANDIDATES_PER_KIND);
  }
  camp(target: Target): Camp | undefined {
    let cached = campCache.get(this.context.snapshot);
    if (!cached || cached.tick !== this.situation.tick) {
      cached = { tick: this.situation.tick, camps: neutralCamps(this.context.snapshot) };
      campCache.set(this.context.snapshot, cached);
    }
    return cached.camps.find(camp => gap(camp.center, target.point) <= EXPANSION_GUARD_RANGE);
  }
  /** Exact input projection of this quotation, without observation timestamps or
   * unrelated positions/orders. ETA/HP/claims/deadlines are never rounded. */
  factKey(candidate: Candidate, pool: Fighter[], potential: Fighter[], enemyPool: SituationUnit[],
    camp: Camp | undefined, towers: PlanningContext['snapshot']['buildings'], previous: readonly PreviousObjective[], unknownRoutes: number) {
    const s = this.situation, targetKey = candidate.kind === 'ContestRoute' ? candidate.opportunities[0]?.id ?? candidate.key : candidate.key;
    const arrival = (a: Arrival | undefined) => !a ? null : 'ticks' in a
      ? [a.status, a.ticks, a.landTicks, a.crossings, a.status === 'conditional' ? a.unmet.map(reason => reason.code) : []]
      : [a.status, a.reason.code];
    const stats = (unit: Unit | undefined) => unit ? [unit.id, unit.kind, unit.hp, unit.maxHp, unit.attackDamage, unit.attackCooldown,
      unit.attackRange, unit.speed, unit.level, unit.radius, unit.bodyRadius, unit.gearMass] : null;
    const threats = s.lands.flatMap(land => land.threats);
    const sites = threats.flatMap(threat => { const site = this.assets.get(threat.siteId); return site?.owner === s.owner ? [site] : []; });
    const relevantAssets = new Set([candidate.key, this.mineFor(candidate.target)?.id, ...sites.map(site => site.id)]);
    if (candidate.kind === 'CounterHarass') for (const site of sites) for (const asset of s.assets)
      if (asset.owner === s.owner && asset.target.landId === site.target.landId && gap(asset.target.point, site.target.point) <= 650)
        relevantAssets.add(asset.id);
    const ownHall = this.mining(candidate.kind) ? this.context.snapshot.buildings.find(building => building.owner === s.owner
      && building.kind === 'townHall' && gap(building, candidate.target.point) <= GOLD_MINE_RULES.baseRange) : undefined;
    const occupiedHall = this.mining(candidate.kind) ? this.context.snapshot.buildings.find(building => building.kind === 'townHall'
      && this.foe(building.owner) && gap(building, candidate.target.point) <= GOLD_MINE_RULES.baseRange) : undefined;
    const buildings = new Map([...towers, ...this.context.snapshot.buildings.filter(building => building.id === candidate.key
      || building.id === ownHall?.id || building.id === occupiedHall?.id || ownHall && building.owner === s.owner && building.attackDamage > 0
      && gap(building, ownHall) <= building.attackRange + ownHall.radius)].map(building => [building.id, building]));
    const borrowedIds = new Set(pool.filter(fighter => fighter.borrowed).flatMap(fighter => fighter.unit.commitments
      .map(claim => claim.objectiveId).filter(id => id !== identity(candidate.kind, s.owner, candidate.key))));
    const reserved = s.economy.ledger.filter(entry => entry.objectiveId !== identity(candidate.kind, s.owner, candidate.key)
      && entry.state === 'reserved' && entry.authority !== 'proposed').reduce((sum, entry) => sum + entry.gold, 0);
    // Opportunity identity, kind, geometry and price are decision facts. Evidence
    // is projected from the current Situation below; wording must neither force
    // a recomputation nor materialize a lazy explanation while building this key.
    return JSON.stringify({ candidate: [candidate.kind, candidate.key, candidate.target,
      candidate.opportunities.map(op => [op.id, op.kind, op.target, op.valueGold])],
      pool: pool.map(fighter => [stats(fighter.raw), fighter.unit.strength, fighter.unit.roles,
        fighter.unit.expiresTick === null ? null : fighter.unit.expiresTick - s.tick,
        fighter.unit.location.kind, 'landId' in fighter.unit.location ? fighter.unit.location.landId : null,
        [candidate.target, ...sites.map(site => site.target)].map(site => gap(fighter.unit.location.point, site.point) <= 650),
        fighter.unit.commitments.map(claim => [claim.source, claim.taskId, claim.objectiveId]), arrival(arrivalAt(fighter.unit, targetKey))]),
      interruptions: potential.filter(fighter => fighter.interrupted).map(fighter => fighter.unit.id), unknownRoutes,
      unquotedOwn: this.own.filter(unit => battleRole(unit) && unquoted(arrivalAt(unit, targetKey))).map(unit =>
        [unit.id, stats(this.raw.get(unit.id)), unit.strength, unit.roles,
          unit.expiresTick === null ? null : unit.expiresTick - s.tick,
          unit.commitments.map(claim => [claim.source, claim.taskId, claim.objectiveId])]),
      enemy: enemyPool.flatMap(unit => { const a = arrivalAt(unit, targetKey); return knownArrival(a) && a.status === 'reachable' && a.ticks <= HORIZON
        ? [[unit.id, unit.strength, unit.expiresTick === null ? null : unit.expiresTick - s.tick, arrival(a), stats(this.raw.get(unit.id)!)]]
        : !a || a.status === 'unknown' ? [[unit.id, arrival(a)]] : []; }),
      camp: camp && [camp.center, camp.strength, camp.creeps.map(unit => [stats(unit), unit.expiresTick === undefined ? null : unit.expiresTick - s.tick])],
      buildings: [...buildings.values()].map(building => [building.id, building.kind, building.owner, building.x, building.y,
        building.hp, building.complete, building.radius, building.attackRange, building.attackDamage, building.attackCooldown,
        building.buildProgress, building.buildTime, building.complete ? 0 : constructionWorkers(this.context.snapshot, building).length]),
      assets: s.assets.filter(asset => relevantAssets.has(asset.id)).map(asset => [asset.id, asset.owner, asset.kind, asset.target,
        asset.complete, asset.replacementGold, asset.discountedValueGold, this.income(asset), asset.remainingGold === 0]),
      threats: threats.map(threat => [threat.siteId, threat.arrivedStrength, threat.incomingStrength, threat.friendlyOnStationStrength,
        threat.lossProbability, threat.attackers.map(attacker => [attacker.unitId, attacker.strength, arrival(attacker.arrival)])]),
      guards: ownHall && this.own.filter(unit => unit.expiresTick === null && frontRole(unit) && !interruption(unit)
        && unit.location.kind === 'land' && unit.location.landId === candidate.target.landId
        && withinExpansionGarrisonCoverage(unit.location.point, candidate.target.point)).map(unit => [unit.id, unit.strength, unit.commitments.map(claim => claim.objectiveId)]),
      workers: this.mining(candidate.kind) && this.own.filter(unit => unit.roles.includes('worker') && !interruption(unit))
        .map(unit => { const a = arrivalAt(unit, candidate.key); return [unit.id, unquoted(a), knownArrival(a)
          && a.status === 'reachable' && a.ticks < HORIZON]; }),
      funded: !this.mining(candidate.kind) || !!ownHall || s.economy.cashGold - reserved >= BUILDING_DEFS.townHall.cost,
      displaced: [...borrowedIds].filter((id): id is string => id !== null).sort().map(id => [id,
        previous.find(objective => objective.id === id)?.utility.score ?? null,
        s.units.filter(unit => unit.commitments.some(claim => claim.objectiveId === id)).reduce((sum, unit) => sum + unit.strength, 0)]),
      counter: candidate.kind === 'CounterHarass' ? [this.raw.get(candidate.key), pool.map(fighter => fighter.raw),
        this.context.snapshot.items, this.context.snapshot.variants, this.context.snapshot.players[s.owner]!.race] : null });
  }
  assess(candidate: Candidate, previous: readonly PreviousObjective[]): Assessment {
    const s = this.situation, id = identity(candidate.kind, s.owner, candidate.key), mining = this.mining(candidate.kind);
    const camp = mining ? this.camp(candidate.target) : undefined;
    const arrivalKey = candidate.kind === 'ContestRoute' ? candidate.opportunities[0]?.id ?? candidate.key : candidate.key;
    const potential: Fighter[] = [];
    let unknownRoutes = 0;
    for (const unit of this.own.filter(battleRole)) {
      const raw = this.raw.get(unit.id), arrival = arrivalAt(unit, arrivalKey);
      if (!raw || !knownArrival(arrival)) { unknownRoutes += Number(unquoted(arrival)); continue; }
      if (arrival.ticks >= HORIZON) continue;
      // A conditional crossing is a prerequisite, not troops already at the target.
      const borrowed = arrival.status === 'conditional' || unit.commitments.some(item => item.objectiveId !== id);
      potential.push({ unit, raw, eta: arrival.ticks, coverage: 1, borrowed, interrupted: interruption(unit) });
    }
    const harasser = candidate.kind === 'CounterHarass' ? this.raw.get(candidate.key) : undefined;
    const targets = camp?.creeps ?? (harasser ? [harasser] : this.context.snapshot.buildings.filter(building => building.id === candidate.key));
    let pool = potential.filter(fighter => !fighter.interrupted
      && (!mining || frontRole(fighter.unit)));
    const canIntercept = (fighter: Pick<Fighter, 'raw'>) => !harasser || canLandIntercept(fighter.raw, harasser);
    pool.sort((a, b) => Number(canIntercept(b)) - Number(canIntercept(a))
      || Number(a.borrowed) - Number(b.borrowed) || a.eta - b.eta || a.unit.id.localeCompare(b.unit.id));
    const measure = (fighters: Fighter[]) => {
      if (!camp) return fighters.reduce((sum, fighter) => sum + fighter.unit.strength * fighter.coverage, 0);
      // Preserve the existing camp/range rating, then apply a combat-rating-weighted
      // lifetime share once. Scaling both HP and damage would penalize expiry twice.
      const full = fighters.reduce((sum, fighter) => sum + combatRating(fighter.raw), 0);
      const lasting = fighters.reduce((sum, fighter) => sum + combatRating(fighter.raw) * fighter.coverage, 0);
      return full > 0 ? creepForce(fighters.map(fighter => fighter.raw), camp) * lasting / full : 0;
    };
    const shotDamage = new Map<string, number>();
    const volley = (fighters: Fighter[]) => harasser ? fighters.filter(canIntercept).reduce((sum, fighter) => {
      if (!shotDamage.has(fighter.unit.id)) shotDamage.set(fighter.unit.id, landInterceptionShotDamage(this.context.snapshot, fighter.raw, harasser));
      return sum + shotDamage.get(fighter.unit.id)!;
    }, 0) : 0;
    // Combat work is a stated estimate. ETA and response reachability remain shared Situation facts.
    const workTicks = (fighters: Fighter[]) => landCombatWorkTicks(targets, fighters.map(fighter => fighter.raw),
      candidate.kind === 'ContestRoute' ? HORIZON : undefined);
    const enemyPool = this.situation.units.filter(unit => this.foe(unit.owner) && unit.hp > 0 && battleRole(unit));
    const responding = (window: number) => enemyPool.filter(unit => {
      const arrival = arrivalAt(unit, arrivalKey);
      return knownArrival(arrival) && arrival.status === 'reachable' && arrival.ticks <= window
        && (unit.expiresTick === null || unit.expiresTick > s.tick + arrival.ticks);
    }).map(unit => {
      const arrival = arrivalAt(unit, arrivalKey) as Extract<Arrival, { ticks: number }>;
      const coverage = landCombatResponseCoverage(s.tick, window, arrival.ticks, unit.expiresTick);
      return coverage === 1 ? unit : { ...unit, strength: unit.strength * coverage };
    });
    const towers = this.context.snapshot.buildings.filter(building => this.foe(building.owner)
      && building.complete && building.attackDamage > 0 && gap(building, candidate.target.point) <= building.attackRange + building.radius);
    const towerPower = towers.reduce((sum, building) => sum + structureRating(building), 0);
    // A permanent-force lower bound cannot overstate a prefix's camp capacity.
    // Stop before inspecting later soldiers once this prefix covers even every
    // possible responder in the whole window. Summons cannot shorten this bound.
    if (!harasser) {
      const upper = camp ? forceFor(camp) : enemyPool.reduce((sum, unit) => {
        const a = arrivalAt(unit, arrivalKey);
        return sum + (knownArrival(a) && a.status === 'reachable' && a.ticks <= HORIZON ? unit.strength : 0);
      }, towerPower);
      let power = 0, front = false, end = 0;
      for (const fighter of pool) {
        end++; front ||= frontRole(fighter.unit) && fighter.unit.expiresTick === null;
        if (fighter.unit.expiresTick === null) power += camp ? combatRating(fighter.raw) : fighter.unit.strength;
        if (front && power >= upper) break;
      }
      pool = pool.slice(0, end);
    }
    const key = this.factKey(candidate, pool, potential, enemyPool, camp, towers, previous, unknownRoutes);
    const retained = this.retained.goals.get(id);
    // Cache residency must not become observable history: a cold fork quotes the
    // same present facts and evidence ticks as a warm observer. Original external
    // evidence comes from this Situation, never from the cached opportunity.
    if (retained?.key === key) return projectAssessment({ ...retained.value, candidate, camp,
      crew: retained.value.crew.map(({ id, ...fighter }) => ({ ...fighter, unit: this.units.get(id)!, raw: this.raw.get(id)! })) }, s);
    const earliest = pool[0]?.eta ?? HORIZON;
    let required = camp ? forceFor(camp) : responding(Math.min(HORIZON, earliest + workTicks(pool)))
      .reduce((sum, unit) => sum + unit.strength, 0) + towerPower;
    // Price a sufficient proposed cohort, not every free soldier on the map. A second bounded pass
    // accounts for the smaller cohort taking longer and allowing additional reinforcements to arrive.
    let crew: Fighter[] = [], duration = workTicks(pool), eta: number | null = null;
    for (let pass = 0; pass < 2; pass++) {
      crew = [];
      let fieldPower = 0;
      for (const fighter of pool) {
        fighter.coverage = fighter.unit.expiresTick === null ? 1
          : Math.max(0, Math.min(1, (fighter.unit.expiresTick - s.tick - fighter.eta) / duration));
        if (fighter.coverage <= 0) continue;
        crew.push(fighter);
        fieldPower += fighter.unit.strength * fighter.coverage;
        if (crew.some(item => frontRole(item.unit)) && (camp ? measure(crew) : fieldPower) >= required && (!harasser || volley(crew) * 2 >= harasser.hp)) break;
      }
      eta = crew.length ? Math.max(...crew.map(fighter => fighter.eta)) : null;
      duration = workTicks(crew);
      if (!camp) required = Math.max(required, responding(Math.min(HORIZON, (eta ?? HORIZON) + duration))
        .reduce((sum, unit) => sum + unit.strength, 0) + towerPower);
    }
    for (const fighter of crew) fighter.coverage = fighter.unit.expiresTick === null ? 1
      : Math.max(0, Math.min(1, (fighter.unit.expiresTick - s.tick - fighter.eta) / duration));
    crew = crew.filter(fighter => fighter.coverage > 0);
    let currentPower = measure(crew);
    for (const fighter of pool) {
      if (currentPower >= required && crew.some(item => frontRole(item.unit)) && (!harasser || volley(crew) * 2 >= harasser.hp)) break;
      if (crew.includes(fighter)) continue;
      fighter.coverage = fighter.unit.expiresTick === null ? 1
        : Math.max(0, Math.min(1, (fighter.unit.expiresTick - s.tick - fighter.eta) / duration));
      if (fighter.coverage > 0) {
        crew.push(fighter);
        currentPower = camp ? measure(crew) : currentPower + fighter.unit.strength * fighter.coverage;
      }
    }
    eta = crew.length ? Math.max(...crew.map(fighter => fighter.eta)) : null;
    duration = workTicks(crew);
    const responseWindow = Math.min(HORIZON, (eta ?? HORIZON) + duration), responders = responding(responseWindow);
    const power = measure(crew), available = measure(crew.filter(fighter => !fighter.borrowed));
    const preconditions: ConditionFact[] = [], reasons: LandReasonFact[] = [];
    const condition = (kind: Precondition['kind'], status: Precondition['status'], code: string, detail: LandText, demand: ResourceDemand | null) => {
      const item = reasonFact(code, detail, status === 'unknown' ? 'unknown' : 'inferred');
      preconditions.push({ id: `${id}/${code}`, kind, status, reason: item, demand, subgoalIds: [] });
      if (status !== 'met') reasons.push(item);
    };
    condition('route', !candidate.target.landId ? 'unknown' : eta === null ? unknownRoutes ? 'unknown' : 'unmet' : 'met',
      !candidate.target.landId ? 'target-ground-unknown' : eta === null ? 'arrival-unavailable' : 'arrival-recorded',
      eta === null ? 'Situation 没有一支可按时到达的队伍；没有把缺少 ETA 当成零' : ['统一到达记录；目标响应窗口 ', responseWindow, ' tick'], null);
    const permanentFront = crew.some(fighter => frontRole(fighter.unit) && fighter.unit.expiresTick === null && !fighter.borrowed);
    const forceEnough = crew.some(fighter => frontRole(fighter.unit)) && available >= required && available > 0
      && (!mining || permanentFront);
    const unquotedFighters = this.own.filter(unit => battleRole(unit) && !interruption(unit) && unit.strength > 0
      && unquoted(arrivalAt(unit, arrivalKey)) && (!mining || frontRole(unit)));
    const unknownForce = !forceEnough && unquotedFighters.some(unit => mining && !permanentFront
      ? unit.expiresTick === null : crew.some(fighter => frontRole(fighter.unit)) || frontRole(unit));
    condition('force', forceEnough ? 'met' : unknownForce ? 'unknown' : 'unmet', unknownForce ? 'own-force-arrivals-unknown' : 'sustained-force',
      ['可兑现 ', { fixed: available }, '；含待借调 ', { fixed: power }, '；需要 ', { fixed: required }, '。到期召唤物按到达后寿命折算',
        mining && !permanentFront ? '；已报价队伍缺少能完成清营后护送/留守的常驻前排' : '',
        unknownForce ? '；仍有可能补足的兵未完成 ETA，不能据此确认训练缺口' : ''],
      unknownForce ? null : { kind: 'force', metric: camp ? 'camp-force' : 'field-strength', strength: Math.max(1, required),
        roles: mining ? ['frontline', 'ranged', 'caster'] : ['frontline', 'ranged'], at: candidate.target,
        neededByTick: eta === null ? null : s.tick + eta, permanent: mining });
    const unknownResponse = enemyPool.some(unit => {
      const arrival = arrivalAt(unit, arrivalKey);
      // This explicit lower bound is stronger than an unknown route: the shared evaluator
      // proves that even straight maximum-speed travel exceeds the whole response window.
      return unquoted(arrival);
    });
    if (unknownResponse) condition('force', 'unknown', 'enemy-response-unknown',
      '部分敌军没有到目标的 ETA，不能把未知援军当成零；成功率只给保守下界', null);
    const crossings = new Map<string, { crossing: Extract<Arrival, { ticks: number }>['crossings'][number]; units: Unit[] }>();
    for (const fighter of crew) {
      const arrival = arrivalAt(fighter.unit, arrivalKey);
      if (arrival?.status !== 'conditional') continue;
      for (const crossing of arrival.crossings) {
        const key = `${crossing.seaId}:${crossing.departure.x}:${crossing.departure.y}:${crossing.landing.x}:${crossing.landing.y}`;
        const group = crossings.get(key) ?? { crossing, units: [] };
        if (!group.units.includes(fighter.raw)) group.units.push(fighter.raw);
        crossings.set(key, group);
      }
    }
    for (const [key, { crossing, units }] of crossings) condition('transport', 'unmet', `crossing:${key}`,
      crossing.requiresNewShip ? '跨海方案还依赖新船，不能当已有可用运力' : '条件可达还需要装船、航行与卸载',
      { kind: 'transport', seaId: crossing.seaId, payloadMass: units.reduce((sum, unit) => sum + bodyMass(unit), 0),
        departure: { ...crossing.departure }, landing: { ...crossing.landing } });
    const borrowed = crew.filter(fighter => fighter.borrowed);
    if (borrowed.length) reasons.push(reasonFact('borrow-requires-handoff', ['不能当空闲兵使用：', { ids: borrowed.map(fighter => fighter.unit.id) }]));
    if (potential.some(fighter => fighter.interrupted)) reasons.push(reasonFact('life-saving-unavailable',
      ['治疗/撤退/救命中的兵不兑现为到岗力量：', { ids: potential.filter(fighter => fighter.interrupted).map(fighter => fighter.unit.id) }]));
    const occupied = mining ? this.context.snapshot.buildings.find(building => building.kind === 'townHall'
      && this.foe(building.owner) && gap(building, candidate.target.point) <= GOLD_MINE_RULES.baseRange) : undefined;
    const occupation = occupied ? { ...candidate.target, entityId: occupied.id, point: { x: occupied.x, y: occupied.y } } : undefined;
    if (mining) {
      if (occupation) condition('force', 'unmet', 'clear-enemy-occupation', ['需要先摧毁占矿据点 ', occupation.entityId!, '，不能直接在敌厅旁施工'], null);
      const workers = this.own.filter(unit => unit.roles.includes('worker')).filter(unit => {
        const arrival = arrivalAt(unit, candidate.key);
        return knownArrival(arrival) && arrival.status === 'reachable' && arrival.ticks < HORIZON && !interruption(unit);
      });
      const unknownWorkers = this.own.some(unit => unit.roles.includes('worker') && !interruption(unit) && unquoted(arrivalAt(unit, candidate.key)));
      condition('workers', workers.length ? 'met' : unknownWorkers ? 'unknown' : 'unmet', 'engineer-arrival',
        workers.length ? '已有可达工程兵' : unknownWorkers ? '已有工程兵，但其路线尚未报价；不能据此断言需要另送工人' : '需要可实际到达的工程兵',
        { kind: 'workers', count: 1, at: candidate.target });
      const hall = this.context.snapshot.buildings.find(building => building.owner === s.owner && building.kind === 'townHall'
        && gap(building, candidate.target.point) <= GOLD_MINE_RULES.baseRange);
      const reservedElsewhere = s.economy.ledger.filter(item => item.objectiveId !== id && item.state === 'reserved'
        && item.authority !== 'proposed').reduce((sum, item) => sum + item.gold, 0);
      condition('budget', hall || s.economy.cashGold - reservedElsewhere >= BUILDING_DEFS.townHall.cost ? 'met' : 'unmet', 'hall-capital',
        hall ? '矿厅已经支付，不重复扣费' : '清营之后需要矿厅本金', { kind: 'gold', amount: hall ? 0 : BUILDING_DEFS.townHall.cost });
      const guards = this.own.filter(unit => unit.expiresTick === null && frontRole(unit) && unit.location.kind === 'land'
        && unit.location.landId === candidate.target.landId && withinExpansionGarrisonCoverage(unit.location.point, candidate.target.point) && !interruption(unit)
        && unit.commitments.some(claim => claim.objectiveId === identity('DefendSite', s.owner, hall?.id ?? '')));
      const guardPower = guards.reduce((sum, unit) => sum + unit.strength, 0);
      const staticPower = hall ? this.context.snapshot.buildings.filter(building => building.owner === s.owner && building.complete
        && building.attackDamage > 0 && gap(building, hall) <= building.attackRange + hall.radius
        && gap(building, candidate.target.point) <= building.attackRange).reduce((sum, building) => sum + structureRating(building), 0) : 0;
      const defense = hall && s.lands.flatMap(land => land.threats).find(threat => threat.siteId === hall.id);
      const raid = defense ? [...defense.attackers].filter(attacker => knownArrival(attacker.arrival))
        .sort((a, b) => (a.arrival as Extract<Arrival, {ticks: number}>).ticks - (b.arrival as Extract<Arrival, {ticks: number}>).ticks
          || a.unitId.localeCompare(b.unitId)).slice(0, 2).reduce((sum, attacker) => sum + attacker.strength, 0) : 0;
      condition('handoff', hall?.complete && guardPower + staticPower > 0 && guardPower + staticPower >= raid ? 'met' : 'unmet', 'actual-garrison-handoff',
        '完成效果需要实际矿厅与当地防守交接；分配名单或已登陆施法者不等于就绪',
        { kind: 'force', metric: 'field-strength', strength: 1, roles: ['frontline', 'ranged'], at: candidate.target,
          neededByTick: null, permanent: true });
    }
    const value = this.assets.get(candidate.key), mine = mining ? value : this.mineFor(candidate.target);
    const income = this.income(mine), completed = (eta ?? HORIZON) + duration
      + (mining ? BUILDING_DEFS.townHall.buildTime : 0);
    const benefit: LandTermFact[] = [], cost: LandTermFact[] = [];
    if (mining) {
      const opportunityValue = Math.max(0, ...candidate.opportunities.map(opportunity => opportunity.valueGold));
      const incomeKnown = income > 0 || mine?.remainingGold === 0 || candidate.opportunities.some(opportunity =>
        opportunity.kind === 'neutral-mine' || opportunity.kind === 'lost-site');
      if (incomeKnown) benefit.push(term('mining-income', discountGold(Math.max(income, opportunityValue), completed),
        '新增矿的评价窗收入；同矿 RecoverSite/ExpandLand 共用 mining-established 效果'));
      // No numerical benefit term is safer than a fabricated zero. This economic
      // prerequisite has no cash demand, so it cannot create a wait-income action.
      else condition('budget', 'unknown', 'mining-income-unknown',
        '矿口缺少潜在收入机会与实际开采收入，未来收益未知；不能把遗漏的估值当成零', null);
      const hall = this.context.snapshot.buildings.find(building => building.owner === s.owner && building.kind === 'townHall'
        && gap(building, candidate.target.point) <= GOLD_MINE_RULES.baseRange);
      if (!hall) benefit.push(term('hall-after-clear', -BUILDING_DEFS.townHall.cost, '成功清营后才支付矿厅；既有落基不重复付费'));
      if (preconditions.some(item => item.kind === 'workers' && item.status === 'unmet'))
        cost.push(term('missing-worker', UNIT_DEFS.worker.cost, '至少需要一名工程兵，训练/借调仍是未满足前置'));
    } else if (candidate.kind === 'AttackSite') {
      benefit.push(term('destroy-site', discountGold(value?.replacementGold ?? 0, completed), '摧毁目标当前资产的估值；不把下过 attack 当成效果'));
      benefit.push(term('denied-income', discountGold(income, completed), '目标真的失去之后评价窗内断矿收入'));
      const responding = responders.reduce((sum, unit) => sum + unit.strength, 0);
      benefit.push(term('pressure', discountGold(Math.min((value?.replacementGold ?? 0) + income,
        forceTimeGold(responding, Math.min(HORIZON, (eta ?? 0) + duration))), eta ?? HORIZON), '迫使可响应敌军回防的占用价值；有上限的推断，不等于已发生回防'));
      const hall = this.context.snapshot.buildings.find(building => building.id === candidate.key);
      const builders = hall ? constructionWorkers(this.context.snapshot, hall).length : 0;
      const remaining = hall && !hall.complete && builders ? (hall.buildTime - hall.buildProgress) / builders : null;
      const responseTimes = enemyPool.map(unit => arrivalAt(unit, arrivalKey)).filter(knownArrival).map(arrival => arrival.ticks);
      const timing = candidate.opportunities.filter(opportunity => opportunity.kind === 'construction'
        ? remaining !== null && eta !== null && eta < remaining
        : opportunity.kind === 'army-away' && eta !== null && responseTimes.every(ticks => ticks > eta));
      benefit.push(term('timing-window', discountGold(Math.min(value?.replacementGold ?? 0,
        Math.max(0, ...timing.map(opportunity => opportunity.valueGold))), eta ?? HORIZON), '施工/主力外出的限时窗口，单列并受目标价值上限约束'));
    } else if (candidate.kind === 'ContestRoute') {
      benefit.push(term('route-pressure', discountGold(Math.max(0, ...candidate.opportunities.map(opportunity => opportunity.valueGold)), eta ?? HORIZON),
        'Situation 提供的真实前压点与压制估值；没有拿敌厅中心替代路口'));
    } else {
      const affected = this.situation.lands.flatMap(land => land.threats).filter(threat => threat.attackers.some(attacker => attacker.unitId === candidate.key));
      const protectedAssets = new Map<string, number>();
      for (const threat of affected) {
        const site = this.assets.get(threat.siteId);
        if (!site) continue;
        for (const asset of s.assets.filter(asset => asset.owner === s.owner && asset.target.landId === site.target.landId
          && gap(asset.target.point, site.target.point) <= 650 && ['hall', 'mine', 'worker'].includes(asset.kind))) {
          const atRisk = (asset.kind === 'mine' ? this.income(asset) : asset.discountedValueGold) * (threat.lossProbability ?? 0);
          protectedAssets.set(asset.id, Math.max(protectedAssets.get(asset.id) ?? 0, atRisk));
        }
      }
      const saved = [...protectedAssets.values()].reduce((sum, value) => sum + value, 0);
      benefit.push(term('saved-mining', discountGold(saved, eta ?? HORIZON), '驱离也能保护工人与收入；与 DefendSite 共享 site-safe 效果，不重复兑现'));
      const rider = this.raw.get(candidate.key);
      const counters = crew.filter(fighter => rider && (fighter.raw.attackRange > rider.attackRange
        || fighter.raw.speed >= rider.speed && fighter.raw.attackDamage > 0));
      const counter = this.context.snapshot.players[s.owner]!.race === 'grove' ? 'horseArcher' : 'sparkArcher';
      const enough = counters.length > 0 && !!rider && volley(crew) * 2 >= rider.hp;
      const unknownCounter = unquotedFighters.some(unit => { const raw = this.raw.get(unit.id);
        return raw && raw.attackDamage > 0 && canIntercept({ raw }); });
      condition('production', enough ? 'met' : unknownCounter ? 'unknown' : 'unmet', 'interception-capability',
        '需要能赶上或射程压制且两轮齐射足够的反制队伍；未报价的可能反制兵不能当成不存在',
        !enough && unknownCounter ? null : { kind: 'production', buildingId: null, unitKind: counter,
          count: enough ? 0 : Math.max(1, Math.ceil(((rider?.hp ?? 1) - volley(crew) * 2) / (UNIT_DEFS[counter].attackDamage * 2))) });
    }
    cost.push(term('force-time', forceTimeGold(crew.reduce((sum, fighter) => sum + fighter.unit.strength * fighter.coverage, 0),
      Math.min(HORIZON, (eta ?? 0) + duration)), '兵力在途与执行占用，成功失败都产生'));
    const firing = new Map([...responders.map(unit => this.raw.get(unit.id)).filter((unit): unit is Unit => !!unit),
      ...towers, ...targets.filter(target => target.attackDamage > 0)].map(source => [source.id, source]));
    const attrition = assessLandCombatAttrition({ tick: s.tick, arrivalTicks: eta ?? 0, workTicks: duration,
      fighters: crew.map(fighter => fighter.raw), fieldStrength: power, requiredFieldStrength: required,
      firing: [...firing.values()].map(source => {
      const unit = this.units.get(source.id), arrival = unit && arrivalAt(unit, arrivalKey);
      return { body: source, arrivalTicks: knownArrival(arrival) ? arrival.ticks : null, expiresTick: unit?.expiresTick ?? null };
    }) });
    cost.push(term('expected-attrition', attrition.expectedLossGold,
      '交战窗口火力暴露与战力比给出的风险估计，非实际死亡归因'));
    const displaced = new Set(borrowed.flatMap(fighter => fighter.unit.commitments.map(item => item.objectiveId)
      .filter((oldId): oldId is string => oldId !== null && oldId !== id)));
    if (borrowed.some(fighter => fighter.unit.commitments.some(claim => claim.objectiveId === null)))
      reasons.push(reasonFact('borrow-opportunity-cost-unknown', '部分旧执行任务尚无目标身份，不能把其机会成本当成零'));
    for (const oldId of [...displaced].sort()) {
      const old = previous.find(objective => objective.id === oldId);
      if (old?.utility.score === null || old?.utility.score === undefined) {
        reasons.push(reasonFact('borrow-opportunity-cost-unknown', [oldId, ' 没有已确认的可行报价；不能用条件潜在值或零代替借兵机会成本']));
        continue;
      }
      const committed = s.units.filter(unit => unit.commitments.some(item => item.objectiveId === oldId));
      const total = committed.reduce((sum, unit) => sum + unit.strength, 0);
      const taken = borrowed.filter(fighter => fighter.unit.commitments.some(item => item.objectiveId === oldId))
        .reduce((sum, fighter) => sum + fighter.unit.strength, 0);
      cost.push(term(`handoff:${oldId}`, Math.max(0, old.utility.score) * Math.min(1, taken / Math.max(1e-6, total)),
        '按被借战力占原承诺的份额估算机会损失；非实际授权'));
    }
    // Only the incremental exposure from withdrawing this cohort is charged. SiteThreat is
    // supplied by the common evaluator. The maximum prices one potential counterraid rather
    // than adding every site's alternative outcome as if all of them occurred together.
    let exposure = 0;
    for (const threat of s.lands.flatMap(land => land.threats)) {
      const site = this.assets.get(threat.siteId);
      if (!site || site.owner !== s.owner || gap(site.target.point, candidate.target.point) <= 650) continue;
      const departing = crew.filter(fighter => fighter.unit.location.kind === 'land'
        && fighter.unit.location.landId === site.target.landId
        && gap(fighter.unit.location.point, site.target.point) <= 650).reduce((sum, fighter) => sum + fighter.unit.strength, 0);
      const attack = threat.arrivedStrength + threat.incomingStrength;
      const increase = forceSuccessProbability(attack, Math.max(0, threat.friendlyOnStationStrength - departing))
        - forceSuccessProbability(attack, threat.friendlyOnStationStrength);
      exposure = Math.max(exposure, Math.max(0, increase) * site.discountedValueGold);
    }
    cost.push(term('departure-exposure', exposure, '撤走这份兵力新增的据点风险；相互替代的回援/反袭不重复相加'));
    reasons.push(reasonFact('observation-only-cohort', ['这里只报价候选队伍：', { ids: crew.map(fighter => fighter.unit.id) }, '；没有创建分配或修改 claim']));
    const facts = { candidate, id, crew, required, power, available, eta, duration, camp, occupation, preconditions, benefit, cost, reasons };
    const { candidate: _candidate, camp: _camp, crew: _crew, ...retainedFacts } = facts;
    // Retain only owned facts and cohort IDs. Current-call projection readers,
    // Situation rows and raw world entities must never cross the think boundary.
    this.retained.goals.set(id, { key, value: { ...retainedFacts,
      crew: crew.map(({ unit, eta, coverage, borrowed, interrupted }) => ({ id: unit.id, eta, coverage, borrowed, interrupted })) } });
    return projectAssessment(facts, s);
  }

  conditionalQuote(a: Assessment, utility: Utility): NonNullable<Objective['conditionalQuote']> {
    const s = this.situation, missing = a.preconditions.filter(condition => condition.status !== 'met');
    const assumptions = missing.map(condition => condition.reason);
    const newForce = a.power < a.required || !a.crew.some(fighter => frontRole(fighter.unit))
      || this.mining(a.candidate.kind) && !a.crew.some(fighter => frontRole(fighter.unit) && fighter.unit.expiresTick === null)
      || missing.some(condition => condition.kind === 'production');
    if (newForce) assumptions.push(reason(s, 'conditional-force-unquoted',
      '需要新增且尚未定义的兵力/反制兵，缺少其行军和交战估算；不把最低需求虚构为已到岗部队'));
    const unknownHandoff = a.reasons.filter(item => item.code === 'borrow-opportunity-cost-unknown');
    assumptions.push(...unknownHandoff);
    const known = a.eta !== null && !newForce && !unknownHandoff.length && !missing.some(condition => condition.status === 'unknown');
    if (known) assumptions.push(reason(s, 'conditional-on-prerequisites',
      '仅对准入前置已满足后的已命名队伍报价；工程兵/资金就绪、借调与运输已获准，不表示当前已承诺或已到岗'));
    const includedPrerequisiteUtilityCodes = [...a.benefit, ...a.cost]
      .filter(item => ['hall-after-clear', 'missing-worker'].includes(item.code)).map(item => item.code);
    return { potentialUtility: known ? utility : null, assumptions, includedPrerequisiteUtilityCodes };
  }
}

/** Proposals only. Neither this function nor decompose writes memory or issues commands. */
export function generateLandObjectives(situation: Situation, context: PlanningContext, previousObjectives: readonly PreviousObjective[] = []): readonly Objective[] {
  const model = new LandModel(situation, context);
  const candidates = model.candidates(), retainedIds = new Set(candidates.map(candidate => identity(candidate.kind, situation.owner, candidate.key)));
  for (const id of model.retained.goals.keys()) if (!retainedIds.has(id)) model.retained.goals.delete(id);
  return candidates.map(candidate => {
    const a = model.assess(candidate, previousObjectives), old = previousObjectives.find(objective => objective.id === a.id);
    const live = candidate.kind === 'AttackSite' ? context.memory.landAttack?.targetId === candidate.key
      : candidate.kind === 'ContestRoute' ? context.memory.territory?.objective?.targetId === candidate.key
      : candidate.kind === 'CounterHarass' ? context.memory.harassDefense?.targetId === candidate.key
      : context.memory.landExpansion?.mineId === candidate.key;
    const committedSince = !live ? null : candidate.kind === 'AttackSite' ? context.memory.landAttack!.sinceTick
      : candidate.kind === 'ContestRoute' ? context.memory.territory!.objective!.sinceTick
      : model.mining(candidate.kind) ? context.memory.landExpansion!.sinceTick : null;
    const sinceTick = committedSince ?? old?.sinceTick ?? situation.tick;
    const blocked = a.preconditions.some(condition => condition.status !== 'met' && condition.kind !== 'handoff');
    // This is the cohort's combat forecast, conditional on resource preconditions.
    // An engineer/budget prerequisite still blocks the objective; it does not turn
    // a known combat comparison into a fictitious zero-force opponent.
    const incompleteForce = a.preconditions.some(condition => condition.status === 'unknown'
      && ['force', 'route', 'production', 'transport'].includes(condition.kind));
    const persistenceBonus = live && a.power > 0 && a.eta !== null && !incompleteForce ? Math.min(PARAMETERS.maximumPersistenceGold,
      a.benefit.reduce((sum, item) => sum + Math.max(0, item.value), 0) * PARAMETERS.persistenceBenefitShare) : 0;
    const effects: Objective['effects'] = model.mining(candidate.kind)
      ? [{ kind: 'mining-established', mineId: candidate.key, completeHall: true, garrisonHandoff: true }]
      : candidate.kind === 'AttackSite' ? [{ kind: 'entity-destroyed', entityId: candidate.key }]
      : candidate.kind === 'ContestRoute' ? [{ kind: 'route-controlled', target: candidate.target }]
      : situation.lands.flatMap(land => land.threats).filter(threat => threat.attackers.some(attacker => attacker.unitId === candidate.key))
        .flatMap(threat => [{ kind: 'site-safe' as const, siteId: threat.siteId, throughTick: situation.tick + HORIZON },
          { kind: 'harassment-ended' as const, unitId: candidate.key, siteId: threat.siteId }]);
    const utility = strategyUtility({ benefit: a.benefit, cost: a.cost,
      successProbability: incompleteForce ? 0 : forceSuccessProbability(a.power, a.required), persistenceBonus, evidence: a.evidence });
    const objective: Objective = { id: a.id, kind: candidate.kind, owner: situation.owner, target: candidate.target, effects,
      utility: blocked ? projectedCopy(utility, { score: null }) : utility,
      ...(blocked ? { conditionalQuote: model.conditionalQuote(a, utility) } : {}),
      status: blocked ? 'blocked' : live ? 'active' : 'candidate',
      sinceTick, rank: null, reasons: a.reasons,
      methodIds: methodVariants(a).map(variant => `${a.id}/method:${variant}`),
      stability: live && old?.sinceTick === sinceTick ? { ...old.stability }
        : { minimumStayUntilTick: live ? sinceTick + PARAMETERS.minimumStayTicks : situation.tick,
        challengerId: null, challengerThinks: 0 } };
    assessments.set(objective, { situation, context, model, value: a });
    return objective;
  });
}

export function decomposeLandObjective(situation: Situation, objective: Objective, context: PlanningContext): readonly Method[] {
  if (!['ExpandLand', 'RecoverSite', 'AttackSite', 'ContestRoute', 'CounterHarass'].includes(objective.kind)) return [];
  const cached = assessments.get(objective);
  const reusable = cached?.situation === situation && cached.context === context ? cached : undefined;
  const model = reusable?.model ?? new LandModel(situation, context);
  const candidate = reusable?.value.candidate ?? model.candidates().find(candidate => identity(candidate.kind, situation.owner, candidate.key) === objective.id);
  if (!candidate) return [];
  const a = reusable?.value ?? model.assess(candidate, []);
  return methodVariants(a).map(variant => {
  const id = `${objective.id}/method:${variant}`, subgoals: Subgoal[] = [];
  const add = (kind: Subgoal['kind'], demands: ResourceDemand[], dependsOn: string[], reasons: Reason[], target = candidate.target) => {
    const childId = `${id}/${kind}:${reasons[0]?.code ?? 'effect'}`;
    subgoals.push({ id: childId, parentMethodId: id, kind, target, demands, dependsOn,
      estimatedTicks: null, status: 'proposed', reasons });
    return childId;
  };
  const preconditions = a.preconditions.map(condition => {
    const subgoalIds: string[] = [];
    if (condition.status === 'unmet') {
      const demands = condition.demand ? [condition.demand] : [];
      if (condition.reason.code === 'clear-enemy-occupation') subgoalIds.push(add('clear-beachhead', [], [], [condition.reason], a.occupation));
      else if (condition.kind === 'force' && condition.demand) {
        const deficit = condition.demand.kind === 'force' ? [{ ...condition.demand,
          strength: Math.max(model.mining(candidate.kind) ? 1 : 0, condition.demand.strength - a.available) }] : demands;
        subgoalIds.push(add(variant === 'train' ? 'train-force' : 'borrow-force', deficit, [], [condition.reason]));
      } else if (condition.kind === 'workers') subgoalIds.push(add('deliver-workers', demands, [], [condition.reason]));
      else if (condition.kind === 'budget') subgoalIds.push(add('wait-income', demands, [], [condition.reason]));
      else if (condition.kind === 'production') subgoalIds.push(add('train-force', demands, [], [condition.reason]));
      else if (condition.kind === 'transport') subgoalIds.push(add('obtain-transport', demands, [], [condition.reason]));
    }
    return { ...condition, subgoalIds };
  });
  if (model.mining(candidate.kind)) {
    const setup = subgoals.filter(child => ['borrow-force', 'train-force', 'obtain-transport'].includes(child.kind)).map(child => child.id);
    const occupation = subgoals.filter(child => child.kind === 'clear-beachhead').map(child => child.id);
    const clear = a.camp ? add('clear-camp', [], [...setup, ...occupation], []) : null;
    const workers = subgoals.filter(child => ['deliver-workers', 'wait-income'].includes(child.kind)).map(child => child.id);
    const hall = add('build-hall', [{ kind: 'gold', amount: a.benefit.some(item => item.code === 'hall-after-clear') ? BUILDING_DEFS.townHall.cost : 0 }],
      [...workers, ...occupation, ...(clear ? [clear] : [])], []);
    const handoff = preconditions.find(condition => condition.kind === 'handoff');
    if (handoff?.status !== 'met') {
      const child = add('establish-garrison', handoff?.demand ? [handoff.demand] : [], [hall], handoff ? [handoff.reason] : []);
      if (handoff) preconditions[preconditions.indexOf(handoff)] = { ...handoff, subgoalIds: [child] };
    }
  }
  const kind: Method['kind'] = candidate.kind === 'ExpandLand' ? 'land-expansion' : candidate.kind === 'RecoverSite' ? 'recovery'
    : candidate.kind === 'AttackSite' ? 'land-attack' : candidate.kind === 'ContestRoute' ? 'route-pressure' : 'counter-harassment';
  return { id, objectiveId: objective.id, kind, preconditions, subgoals,
    demands: preconditions.flatMap(condition => condition.demand ? [condition.demand] : []),
    estimatedTicks: a.eta === null ? null : a.eta + a.duration, status: objective.status === 'blocked' ? 'blocked' : 'candidate', reasons: a.reasons };
  });
}

/** The idle alternative has negative utility; do not charge its cost to every sortie as well. */
export function landIdleForces(situation: Situation, objectives: readonly Objective[]): readonly IdleForce[] {
  const groups = new Map<string | null, { units: SituationUnit[]; objective: Objective | undefined }>();
  for (const unit of situation.units.filter(unit => unit.owner === situation.owner && battleRole(unit) && unit.hp > 0
    && unit.location.kind === 'land' && unit.commitments.length === 0)) {
    const alternative = objectives.filter(objective => objective.utility.score !== null && objective.utility.score > 0
      && ['active', 'candidate'].includes(objective.status))
      .filter(objective => {
        const key = objective.kind === 'ContestRoute' ? situation.opportunities.find(opportunity => opportunity.kind === 'route'
          && opportunity.target.entityId === objective.target.entityId)?.id : objective.target.entityId;
        const arrival = key ? arrivalAt(unit, key) : undefined;
        return knownArrival(arrival) && arrival.status === 'reachable' && arrival.ticks < HORIZON
          && (unit.expiresTick === null || unit.expiresTick > situation.tick + arrival.ticks);
      }).sort((a, b) => b.utility.score! - a.utility.score! || a.id.localeCompare(b.id))[0];
    const key = alternative?.id ?? null, group = groups.get(key) ?? { units: [], objective: alternative };
    group.units.push(unit); groups.set(key, group);
  }
  return [...groups.values()].map(({ units, objective }) => ({ unitIds: units.map(unit => unit.id).sort(),
    opportunityCostGold: objective ? Math.max(0, objective.utility.score!) : 0,
    alternativeObjectiveId: objective?.id ?? null,
    reason: reason(situation, objective ? 'positive-alternative-forgone' : 'no-known-positive-alternative',
      objective ? ['闲置放弃可行目标 ', objective.id, '；这是闲置备选的负效用，不是给该目标重复加分'] : '没有可核实的正效用备选；不凭缺失 ETA 虚造机会成本', objective ? 'inferred' : 'unknown') }));
}

/** Plug this family into the shared plan collector; it owns no evaluator or allocator. */
export const LAND_OBJECTIVE_FAMILY = {
  id: 'land', generate: generateLandObjectives, decompose: decomposeLandObjective, idleForces: landIdleForces,
} as const;
