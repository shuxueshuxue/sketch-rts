import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { UNIT_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { unitStrength } from '../policy/v6/strength';
import { generateLandObjectives, decomposeLandObjective, landIdleForces } from './land-objectives';
import type { Arrival, Asset, Opportunity, PlanningContext, Situation, SituationUnit, UnitRole } from './types';

const HORIZON = 2400;
function frozen<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) frozen(child);
  }
  return value;
}
const route = (ticks = 60): Arrival => ({ status: 'reachable', ticks, landTicks: ticks, crossings: [], evidence: [] });
function example() {
  let scene = sketchScene('land-strategy-input-contract').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' }).playerState('us', { gold: 1000 })
    .townHall('us', 400, 400, { id: 'home' }).goldMine('mine', 1600, 600, 10000)
    .townHall('foe', 2800, 600, { id: 'enemy-hall' }).worker('us', 600, 400, { id: 'builder' });
  for (let i = 0; i < 4; i++) scene = scene.unit('us', 'knight', 800 + i * 40, 500, { id: `fighter-${i}` });
  scene = scene.unit('foe', 'footman', 2800, 800, { id: 'responder' });
  const snapshot = snapshotGame(scene.build().createGame()), memory = createAiPolicyMemory();
  snapshot.tick = 1000;
  const context: PlanningContext = { snapshot, owner: 'us', memory };
  const point = (id: string) => [...snapshot.units, ...snapshot.buildings, ...snapshot.resources].find(entity => entity.id === id)!;
  const asset = (id: string, kind: Asset['kind'], owner: string): Asset => ({ id, kind, owner,
    target: { entityId: id, landId: 'land:1', point: { x: point(id).x, y: point(id).y } },
    hp: 'hp' in point(id) ? (point(id) as { hp: number }).hp : null,
    complete: true, replacementGold: kind === 'hall' ? 400 : 0,
    remainingGold: kind === 'mine' ? 10000 : 0, incomeGoldPerTick: kind === 'mine' ? 1 / 3 : 0,
    discountedValueGold: 800 });
  const units: SituationUnit[] = snapshot.units.map(unit => ({ id: unit.id, owner: unit.owner, kind: unit.kind,
    location: { kind: 'land', landId: 'land:1', point: { x: unit.x, y: unit.y } }, hp: unit.hp, maxHp: unit.maxHp,
    strength: unitStrength(unit), roles: [unit.kind === 'worker' ? 'worker' : 'frontline'] as UnitRole[],
    expiresTick: null, commitments: [], arrivals: ['mine', 'enemy-hall', 'home', 'road'].map(targetId => ({ targetId, arrival: route() })) }));
  const assets = [asset('mine', 'mine', 'neutral'), asset('home', 'hall', 'us'), asset('enemy-hall', 'hall', 'foe')];
  const opportunities: Opportunity[] = [
    { id: 'neutral:mine', kind: 'neutral-mine', target: assets[0]!.target, valueGold: 800, evidence: [] },
    { id: 'road', kind: 'route', target: { ...assets[2]!.target, point: { x: 1900, y: 600 } }, valueGold: 300, evidence: [] },
  ];
  const situation: Situation = { tick: snapshot.tick, owner: 'us', horizonTicks: HORIZON, units, assets,
    lands: [{ id: 'land:1', anchor: { x: 400, y: 400 }, assetIds: assets.map(asset => asset.id),
      unitIds: units.map(unit => unit.id), adjacentSeaIds: [], threats: [] }], seas: [], opportunities,
    economy: { cashGold: 1000, predictedIncomeGold: 800, horizonTicks: HORIZON, ledger: [] }, limitations: [] };
  return { context, situation, units, assets, opportunities };
}
function changedUnit(situation: Situation, id: string, change: Partial<SituationUnit>): Situation {
  return { ...situation, units: situation.units.map(unit => unit.id === id ? { ...unit, ...change } : unit) };
}
const goals = (situation: Situation, context: PlanningContext) => generateLandObjectives(situation, context, []);

describe('land objective proposals over one shared Situation', () => {
  it('keeps stable effect IDs, independent of rank, time and input enumeration', () => {
    const { context, situation } = example();
    const first = goals(situation, context);
    expect(first.map(goal => goal.id)).toContain('AttackSite:us:enemy-hall');
    expect(first.map(goal => goal.id)).toContain('ExpandLand:us:mine');
    const later = { ...situation, tick: situation.tick + 15, units: [...situation.units].reverse(),
      assets: [...situation.assets].reverse(), opportunities: [...situation.opportunities].reverse() };
    const next = generateLandObjectives(later, { ...context, snapshot: { ...context.snapshot, tick: later.tick } }, first);
    expect(next.map(goal => goal.id).sort()).toEqual(first.map(goal => goal.id).sort());
    expect(next.every(goal => goal.rank === 0 && goal.sinceTick === situation.tick)).toBe(true);
  });

  it('does not change frozen policy state, Situation, orders or previous plans', () => {
    const { context, situation } = example();
    const before = JSON.stringify({ context, situation });
    const result = generateLandObjectives(frozen(situation), frozen(context), frozen([]));
    for (const goal of result) decomposeLandObjective(situation, goal, context);
    landIdleForces(situation, result);
    expect(JSON.stringify({ context, situation })).toBe(before);
    expect(generateLandObjectives(situation, context, [])).toEqual(result);
  });

  it('retains missing ETA as a blocked, unknown route instead of treating it as arrival zero', () => {
    const { context, situation } = example();
    const absent = { ...situation, units: situation.units.map(unit => ({ ...unit, arrivals: [] })) };
    const attack = goals(absent, context).find(goal => goal.kind === 'AttackSite')!;
    expect(attack.status).toBe('blocked');
    expect(attack.utility.successProbability).toBe(0);
    expect(decomposeLandObjective(absent, attack, context)[0]!.estimatedTicks).toBeNull();
    expect(landIdleForces(absent, [attack]).every(item => item.alternativeObjectiveId === null && item.opportunityCostGold === 0)).toBe(true);
  });

  it('keeps an active attack group occupied even when its actual order happens to be hold (L2)', () => {
    const { context, situation } = example(), attackId = 'AttackSite:us:enemy-hall';
    const occupied = { ...situation, units: situation.units.map(unit => unit.owner === 'us' && unit.kind !== 'worker'
      ? { ...unit, commitments: [{ source: 'landAttack', objectiveId: attackId, taskId: 'wave', role: 'frontline' as const,
        evidence: { source: 'landAttack.general.group', tick: 900, certainty: 'recorded' as const, detail: unit.id } }] } : unit) };
    const result = goals(occupied, context), expansion = result.find(goal => goal.kind === 'ExpandLand')!;
    expect(expansion.status).toBe('blocked');
    expect(expansion.reasons.some(item => item.code === 'borrow-requires-handoff')).toBe(true);
    expect(landIdleForces(occupied, result)).toEqual([]);
    const alternatives = decomposeLandObjective(occupied, expansion, context);
    expect(alternatives).toHaveLength(2);
    expect(alternatives.map(method => method.subgoals.some(child => child.kind === 'borrow-force'))).toEqual([true, false]);
    expect(alternatives.map(method => method.subgoals.some(child => child.kind === 'train-force'))).toEqual([false, true]);
  });

  it('does not erase an existing defensive commitment to make a forward post look free (L1)', () => {
    const { context, situation } = example();
    const occupied = { ...situation, units: situation.units.map(unit => unit.owner === 'us' && unit.kind !== 'worker'
      ? { ...unit, commitments: [{ source: 'expansionGarrison', objectiveId: 'DefendSite:us:home', taskId: 'post', role: 'frontline' as const,
        evidence: { source: 'unitClaims', tick: 990, certainty: 'recorded' as const, detail: 'on-station' } }] } : unit) };
    const pressure = goals(occupied, context).find(goal => goal.kind === 'ContestRoute')!;
    expect(pressure.status).toBe('blocked');
    expect(pressure.reasons.some(item => item.code === 'borrow-requires-handoff')).toBe(true);
    expect(landIdleForces(occupied, [pressure])).toEqual([]);
  });

  it('keeps patients unavailable despite an overlapping garrison claim (L3/L4)', () => {
    const { context, situation } = example();
    const patients = { ...situation, units: situation.units.map(unit => unit.owner === 'us' && unit.kind !== 'worker'
      ? { ...unit, commitments: [{ source: 'mobileCare', objectiveId: 'DefendSite:us:home', taskId: 'treatment', role: 'frontline' as const,
        evidence: { source: 'follow', tick: 990, certainty: 'recorded' as const, detail: 'distant medic' } }] } : unit) };
    const result = goals(patients, context);
    expect(result.every(goal => goal.utility.successProbability === 0)).toBe(true);
    expect(result.some(goal => goal.reasons.some(item => item.code === 'life-saving-unavailable'))).toBe(true);
    expect(landIdleForces(patients, result)).toEqual([]);
  });

  it('does not create a duplicate land mining effect for an overseas conquest (L5)', () => {
    const { context, situation } = example();
    context.memory.naval = { conquests: { mine: { mineId: 'mine', stage: 'assemble', sinceTick: 900,
      landing: { x: 1600, y: 600 }, interruptions: [], reason: 'await-clearing-force' } } };
    expect(goals(situation, context).some(goal => goal.kind === 'ExpandLand')).toBe(false);
  });

  it('does not count a spirit which expires before arrival as sustained clearing force (L6)', () => {
    const { context, situation } = example();
    const spirits = { ...situation, units: situation.units.map(unit => unit.owner === 'us' && unit.kind !== 'worker'
      ? { ...unit, expiresTick: situation.tick + 30 } : unit) };
    const expansion = goals(spirits, context).find(goal => goal.kind === 'ExpandLand')!;
    expect(expansion.utility.successProbability).toBe(0);
    expect(expansion.status).toBe('blocked');
    expect(decomposeLandObjective(spirits, expansion, context).some(method => method.subgoals.some(child => child.kind === 'train-force'))).toBe(true);
  });

  it('separately explains pressure and a main-base timing window', () => {
    const { context, situation, assets } = example();
    const responder = situation.units.find(unit => unit.id === 'responder')!;
    const away = changedUnit(situation, responder.id, { arrivals: responder.arrivals.map(item => ({ ...item, arrival: route(120) })) });
    const baseline = goals(away, context).find(goal => goal.kind === 'AttackSite')!;
    const opportunity: Opportunity = { id: 'army-away', kind: 'army-away', target: assets[2]!.target,
      valueGold: 100, evidence: [{ source: 'situation', tick: situation.tick, certainty: 'recorded', detail: 'main army absent' }] };
    const attack = goals({ ...away, opportunities: [...away.opportunities, opportunity] }, context).find(goal => goal.kind === 'AttackSite')!;
    expect(attack.utility.benefit.find(item => item.code === 'pressure')!.value).toBeGreaterThan(0);
    expect(attack.utility.benefit.find(item => item.code === 'timing-window')!.value).toBeGreaterThan(0);
    expect(attack.utility.score).toBeGreaterThan(baseline.utility.score);
    expect(attack.target.entityId).toBe('enemy-hall');
  });

  it('uses the actual route opportunity ETA, not the enemy hall ETA for a forward post', () => {
    const { context, situation } = example();
    const absent = { ...situation, units: situation.units.map(unit => ({ ...unit, arrivals: unit.arrivals.filter(item => item.targetId !== 'road') })) };
    const pressure = goals(absent, context).find(goal => goal.kind === 'ContestRoute')!;
    expect(pressure.status).toBe('blocked');
    expect(pressure.target.point).toEqual({ x: 1900, y: 600 });
    expect(decomposeLandObjective(absent, pressure, context)[0]!.estimatedTicks).toBeNull();
  });

  it('includes reinforcements beyond the default 45-second defense window', () => {
    const { context, situation } = example();
    const late = { ...situation, units: situation.units.map(unit => ({ ...unit, arrivals: unit.arrivals.map(item => ({ ...item,
      arrival: route(unit.owner === 'foe' ? 1100 : 1300) })) })) };
    const attack = goals(late, context).find(goal => goal.kind === 'AttackSite')!;
    const noResponder = goals({ ...late, units: late.units.filter(unit => unit.owner !== 'foe') }, context).find(goal => goal.kind === 'AttackSite')!;
    expect(attack.utility.successProbability).toBeLessThan(noResponder.utility.successProbability);
  });

  it('does not mistake unknown enemy response for an undefended objective', () => {
    const { context, situation } = example();
    const uncertain = { ...situation, units: situation.units.map(unit => unit.owner === 'foe' ? { ...unit, arrivals: [] } : unit) };
    const attack = goals(uncertain, context).find(goal => goal.kind === 'AttackSite')!;
    expect(attack.status).toBe('blocked');
    expect(attack.utility.successProbability).toBe(0);
    expect(attack.reasons.some(item => item.code === 'enemy-response-unknown')).toBe(true);
  });

  it('keeps conditional crossings as transport prerequisites, not instantly available troops', () => {
    const { context, situation } = example();
    const conditional: Arrival = { status: 'conditional', ticks: 1000, landTicks: 100, unmet: [], evidence: [], crossings: [{
      seaId: 'sea:1', shipId: null, departure: { x: 100, y: 100 }, landing: { x: 500, y: 500 },
      waitTicks: 100, boardingTicks: 100, sailingTicks: 600, unloadingTicks: 100, requiresNewShip: true,
    }] };
    const crossing = { ...situation, units: situation.units.map(unit => unit.owner === 'us'
      ? { ...unit, arrivals: unit.arrivals.map(item => ({ ...item, arrival: conditional })) } : unit) };
    const attack = goals(crossing, context).find(goal => goal.kind === 'AttackSite')!;
    expect(attack.status).toBe('blocked');
    const methods = decomposeLandObjective(crossing, attack, context);
    expect(methods.every(method => method.preconditions.some(item => item.kind === 'transport' && item.status === 'unmet'))).toBe(true);
    expect(methods.some(method => method.subgoals.some(child => child.kind === 'obtain-transport'))).toBe(true);
    expect(landIdleForces(crossing, [attack]).every(item => item.opportunityCostGold === 0)).toBe(true);
  });

  it('requests a real counter rather than proposing the slow army chase a rider', () => {
    const { context, situation } = example();
    const rider = context.snapshot.units.find(unit => unit.id === 'responder')!;
    Object.assign(rider, UNIT_DEFS.horseArcher, { kind: 'horseArcher', maxHp: UNIT_DEFS.horseArcher.hp });
    for (const unit of context.snapshot.units.filter(unit => unit.owner === 'us')) unit.speed = 60;
    const riding = changedUnit(situation, rider.id, { kind: 'horseArcher', strength: 1.5 });
    const attacked = { ...riding, lands: riding.lands.map(land => ({ ...land, threats: [{ siteId: 'home', horizonTicks: 900,
      attackers: [{ unitId: rider.id, arrival: route(60), strength: 1.5 }], arrivedStrength: 0, incomingStrength: 1.5,
      friendlyOnStationStrength: 9, firstArrivalTicks: 60, lossProbability: .5, evidence: [],
    }] })) };
    const counter = goals(attacked, context).find(goal => goal.kind === 'CounterHarass')!;
    expect(counter.status).toBe('blocked');
    const train = decomposeLandObjective(attacked, counter, context).flatMap(method => method.subgoals).find(child =>
      child.kind === 'train-force' && child.demands.some(demand => demand.kind === 'production'))!;
    expect(train.demands).toContainEqual(expect.objectContaining({ kind: 'production', unitKind: 'horseArcher' }));
    expect(counter.effects).toContainEqual(expect.objectContaining({ kind: 'harassment-ended', unitId: rider.id, siteId: 'home' }));
  });

  it('respects other committed budgets and never charges a founded hall twice', () => {
    const { context, situation } = example();
    const reserved: Situation = { ...situation, economy: { ...situation.economy, ledger: [{ id: 'other', objectiveId: 'ConquerIsland:us:remote',
      methodId: null, subgoalId: null, gold: 900, state: 'reserved', authority: 'committed', sinceTick: 900,
      releaseWhen: ['completed', 'failed'], releasedTick: null, evidence: [],
    }] } };
    const expansion = goals(reserved, context).find(goal => goal.kind === 'ExpandLand')!;
    expect(expansion.status).toBe('blocked');
    expect(expansion.reasons.some(item => item.code === 'hall-capital')).toBe(true);
    const home = context.snapshot.buildings.find(building => building.id === 'home')!;
    context.snapshot.buildings.push({ ...home, id: 'founded', x: 1600, y: 810, complete: false, buildProgress: 0 });
    const founded = goals(reserved, context).find(goal => goal.kind === 'ExpandLand')!;
    expect(founded.utility.benefit.some(item => item.code === 'hall-after-clear')).toBe(false);
    expect(decomposeLandObjective(reserved, founded, context)[0]!.preconditions.find(item => item.kind === 'budget')!.status).toBe('met');
  });

  it('requires an observed lost-site fact and does not duplicate the mining effect', () => {
    const { context, situation, assets } = example();
    context.memory.landExpansion = { mineId: 'mine', stage: 'complete', sinceTick: 100, interruptions: [] };
    expect(goals(situation, context).some(goal => goal.kind === 'RecoverSite')).toBe(false);
    const lost: Opportunity = { id: 'lost:mine', kind: 'lost-site', target: assets[0]!.target, valueGold: 800,
      evidence: [{ source: 'previousSituation', tick: 900, certainty: 'recorded', detail: 'old hall existed and now disappeared' }] };
    const result = goals({ ...situation, opportunities: [...situation.opportunities, lost] }, context);
    expect(result.filter(goal => goal.effects.some(effect => effect.kind === 'mining-established'))).toHaveLength(1);
    expect(result.find(goal => goal.kind === 'RecoverSite')?.id).toBe('RecoverSite:us:mine');
  });

  it('charges a real positive alternative to idle, but excludes occupied and unknown-route troops', () => {
    const { context, situation } = example();
    const result = goals(situation, context), idle = landIdleForces(situation, result);
    expect(idle.some(item => item.opportunityCostGold > 0 && item.alternativeObjectiveId !== null)).toBe(true);
    const ids = idle.flatMap(item => item.unitIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('builder');
  });

  it('produces a referentially valid alternative-method DAG, with defense handoff after construction', () => {
    const { context, situation } = example();
    const blocked = { ...situation, units: situation.units.filter(unit => unit.kind === 'worker' || unit.owner !== 'us') };
    const objective = goals(blocked, context).find(goal => goal.kind === 'ExpandLand')!;
    const methods = decomposeLandObjective(blocked, objective, context);
    expect(methods.map(method => method.id)).toEqual(objective.methodIds);
    for (const method of methods) {
      const ids = method.subgoals.map(child => child.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(method.subgoals.flatMap(child => child.dependsOn).every(id => ids.includes(id))).toBe(true);
      const hall = method.subgoals.find(child => child.kind === 'build-hall')!;
      expect(method.subgoals.find(child => child.kind === 'establish-garrison')!.dependsOn).toEqual([hall.id]);
      expect(method.subgoals.filter(child => ['borrow-force', 'train-force'].includes(child.kind))).toHaveLength(1);
    }
  });

  it('keeps a permanent-frontline subgoal when short-lived summons could clear but cannot hand over the mine', () => {
    const { context, situation } = example();
    const summons = { ...situation, units: situation.units.map(unit => unit.owner === 'us' && !unit.roles.includes('worker')
      ? { ...unit, expiresTick: situation.tick + 1800 } : unit) };
    const objective = goals(summons, context).find(goal => goal.kind === 'ExpandLand')!;
    const methods = decomposeLandObjective(summons, objective, context);
    expect(objective.status).toBe('blocked');
    expect(methods.flatMap(method => method.subgoals)).toContainEqual(expect.objectContaining({
      kind: 'train-force', demands: [expect.objectContaining({ kind: 'force', permanent: true, strength: 1 })],
    }));
  });

  it('does not turn a caster ranged-role annotation into a camp-clearing front line', () => {
    const { context, situation } = example();
    const casters = { ...situation, units: situation.units.map(unit => unit.owner === 'us' && !unit.roles.includes('worker')
      ? { ...unit, roles: ['caster', 'ranged'] as UnitRole[] } : unit) };
    const objective = goals(casters, context).find(goal => goal.kind === 'ExpandLand')!;
    const methods = decomposeLandObjective(casters, objective, context);
    expect(methods[0]!.preconditions).toContainEqual(expect.objectContaining({ kind: 'force', status: 'unmet' }));
    expect(objective.reasons.find(reason => reason.code === 'observation-only-cohort')!.detail).not.toContain('fighter-');
  });

  it('does not price an entire route occupation as one tick of work', () => {
    const { context, situation } = example();
    const objective = goals(situation, context).find(goal => goal.kind === 'ContestRoute')!;
    const method = decomposeLandObjective(situation, objective, context)[0]!;
    expect(method.estimatedTicks).toBeGreaterThanOrEqual(HORIZON);
    expect(objective.utility.cost.find(term => term.code === 'force-time')!.value).toBeGreaterThan(100);
  });

  it('distinguishes a proven out-of-window enemy from a missing route', () => {
    const { context, situation } = example();
    const outside = changedUnit(situation, 'responder', { arrivals: [{ targetId: 'enemy-hall', arrival: {
      status: 'unknown', reason: { code: 'beyond-evaluation-window', detail: 'Straight maximum-speed travel exceeds 2400 ticks', evidence: [] },
    } }] });
    const goal = goals(outside, context).find(goal => goal.kind === 'AttackSite')!;
    expect(goal.reasons.some(reason => reason.code === 'enemy-response-unknown')).toBe(false);
    expect(goal.utility.successProbability).toBe(1);
  });

  it('requires a stationed defense commitment for handoff, rather than a passing army', () => {
    const { context, situation, assets } = example();
    const ownHall = { ...context.snapshot.buildings.find(building => building.id === 'home')!, id: 'new-hall', x: 1600, y: 600 };
    const founded = { ...context, snapshot: { ...context.snapshot, buildings: [...context.snapshot.buildings, ownHall] } };
    const near = { ...situation, assets: [...assets, { ...assets[1]!, id: ownHall.id,
      target: { ...assets[0]!.target, entityId: ownHall.id } }], units: situation.units.map(unit => unit.id === 'fighter-0'
      ? { ...unit, location: { kind: 'land' as const, landId: 'land:1' as const, point: { x: 1600, y: 600 } } } : unit) };
    const handoff = (s: Situation) => {
      const objective = goals(s, founded).find(goal => goal.kind === 'ExpandLand')!;
      return decomposeLandObjective(s, objective, founded)[0]!.preconditions.find(condition => condition.kind === 'handoff')!;
    };
    expect(handoff(near).status).toBe('unmet');
    const committed = changedUnit(near, 'fighter-0', { commitments: [{ source: 'unitClaims.expansionGarrison', taskId: 'guard',
      objectiveId: 'DefendSite:us:new-hall', role: 'frontline', evidence: { source: 'claim', tick: 1000, certainty: 'recorded', detail: 'Stationed' } }] });
    expect(handoff(committed).status).toBe('met');
  });

  it('also proposes interception for a ground raider actually attacking a worker', () => {
    const { context, situation } = example();
    context.snapshot.units.find(unit => unit.id === 'responder')!.order = { type: 'attack', targetId: 'builder' };
    const threatened: Situation = { ...situation, lands: [{ ...situation.lands[0]!, threats: [{ siteId: 'home', horizonTicks: 900,
      attackers: [{ unitId: 'responder', arrival: route(0), strength: 1 }], arrivedStrength: 1, incomingStrength: 0,
      friendlyOnStationStrength: 0, firstArrivalTicks: 0, lossProbability: 1, evidence: [] }] }] };
    expect(goals(threatened, context)).toContainEqual(expect.objectContaining({ id: 'CounterHarass:us:responder' }));
  });

  it('discounts a defending summon which expires during the battle, on the enemy side too', () => {
    const { context, situation } = example();
    const whole = goals(situation, context).find(goal => goal.kind === 'AttackSite')!;
    const expiring = changedUnit(situation, 'responder', { expiresTick: situation.tick + 65 });
    const short = goals(expiring, context).find(goal => goal.kind === 'AttackSite')!;
    expect(short.utility.successProbability).toBeGreaterThan(whole.utility.successProbability);
    expect(short.utility.cost.find(term => term.code === 'expected-attrition')!.value)
      .toBeLessThan(whole.utility.cost.find(term => term.code === 'expected-attrition')!.value);
  });

  it('uses the real commitment start instead of renewing an old goal stay on observation', () => {
    const { context, situation } = example(), previous = goals(situation, context);
    context.memory.landAttack = { targetId: 'enemy-hall', sinceTick: 1200, general: { mode: 'attack' } };
    const later = { ...situation, tick: 2000 }, ctx = { ...context, snapshot: { ...context.snapshot, tick: later.tick } };
    const active = generateLandObjectives(later, ctx, previous).find(goal => goal.kind === 'AttackSite')!;
    expect(active.sinceTick).toBe(1200);
    expect(active.stability.minimumStayUntilTick).toBe(1500);
    context.memory.landAttack!.sinceTick = 1900;
    const restarted = generateLandObjectives(later, ctx, [active]).find(goal => goal.kind === 'AttackSite')!;
    expect(restarted.id).toBe(active.id);
    expect(restarted.sinceTick).toBe(1900);
    expect(restarted.stability.minimumStayUntilTick).toBe(2200);
  });

  it('reuses unchanged facts across thinks and retimes relative arrival demands', () => {
    const { context, situation } = example(), first = goals(situation, context);
    const later = { ...situation, tick: 1015 }, ctx = { ...context, snapshot: { ...context.snapshot,
      map: { ...context.snapshot.map, wind: { direction: 1, speed: 4 } }, tick: later.tick } };
    const next = generateLandObjectives(later, ctx, first), goal = next.find(goal => goal.kind === 'AttackSite')!;
    expect(goal.reasons).toContainEqual(expect.objectContaining({ code: 'assessment-reused' }));
    expect(goal.utility.evidence.find(item => item.source === 'land-objectives')!.tick).toBe(1000);
    expect(goal.utility).toEqual(first.find(previous => previous.id === goal.id)!.utility);
    const demand = decomposeLandObjective(later, goal, ctx)[0]!.demands.find(demand => demand.kind === 'force')!;
    expect(demand).toEqual(expect.objectContaining({ neededByTick: 1075 }));
    expect(generateLandObjectives(later, ctx, first)).toEqual(next);
  });

  it('ignores changes in a later unused soldier but recalculates when the sufficient prefix changes', () => {
    const { context, situation } = example(), first = goals(situation, context);
    const assess = (s: Situation, tick: number) => generateLandObjectives({ ...s, tick },
      { ...context, snapshot: { ...context.snapshot, tick } }, first).find(goal => goal.kind === 'AttackSite')!;
    context.snapshot.units.find(unit => unit.id === 'fighter-3')!.hp *= .5;
    const unused = changedUnit(situation, 'fighter-3', { hp: 50, strength: .5 });
    expect(assess(unused, 1015).reasons.some(reason => reason.code === 'assessment-reused')).toBe(true);
    context.snapshot.units.find(unit => unit.id === 'fighter-0')!.hp *= .25;
    const needed = changedUnit(unused, 'fighter-0', { hp: 20, strength: .2 });
    expect(assess(needed, 1030).reasons.some(reason => reason.code === 'assessment-reused')).toBe(false);
  });

  it('invalidates a retained expansion when reserved spending crosses its hall budget', () => {
    const { context, situation } = example(), first = goals(situation, context);
    const poor = { ...situation, tick: 1015, economy: { ...situation.economy, cashGold: 399 } };
    const ctx = { ...context, snapshot: { ...context.snapshot, tick: poor.tick } };
    const goal = generateLandObjectives(poor, ctx, first).find(goal => goal.kind === 'ExpandLand')!;
    expect(goal.reasons.some(reason => reason.code === 'assessment-reused')).toBe(false);
    expect(decomposeLandObjective(poor, goal, ctx)[0]!.preconditions).toContainEqual(expect.objectContaining({ kind: 'budget', status: 'unmet' }));
  });

  it('recalculates when a new enemy hall occupies the prospective mine', () => {
    const { context, situation } = example(), first = goals(situation, context);
    const enemy = context.snapshot.buildings.find(building => building.id === 'enemy-hall')!;
    const snapshot = { ...context.snapshot, tick: 1015, buildings: context.snapshot.buildings.map(building => building === enemy
      ? { ...building, x: 1600, y: 600 } : building) };
    const later = { ...situation, tick: snapshot.tick };
    const goal = generateLandObjectives(later, { ...context, snapshot }, first).find(goal => goal.kind === 'ExpandLand')!;
    expect(goal.reasons.some(reason => reason.code === 'assessment-reused')).toBe(false);
    expect(decomposeLandObjective(later, goal, { ...context, snapshot })[0]!.subgoals).toContainEqual(expect.objectContaining({
      kind: 'clear-beachhead', target: expect.objectContaining({ entityId: enemy.id }),
    }));
  });

  it('does not charge an existing attack for handing its own soldiers to itself', () => {
    const { context, situation } = example(), id = 'AttackSite:us:enemy-hall';
    const occupied = { ...situation, units: situation.units.map(unit => unit.owner === 'us' && unit.kind !== 'worker'
      ? { ...unit, commitments: ['landAttack', 'expansionMission'].map((source, i) => ({ source, taskId: source,
        objectiveId: i ? 'ExpandLand:us:mine' : id, role: 'frontline' as const,
        evidence: { source, tick: 990, certainty: 'recorded' as const, detail: unit.id } })) } : unit) };
    const previous = goals(situation, context).map(goal => ({ ...goal, utility: { ...goal.utility, score: 100 } }));
    const attack = generateLandObjectives(occupied, context, previous).find(goal => goal.id === id)!;
    expect(attack.utility.cost.some(term => term.code === `handoff:${id}`)).toBe(false);
    expect(attack.utility.cost.find(term => term.code === 'handoff:ExpandLand:us:mine')!.value).toBeGreaterThan(0);
  });

  it('invalidates the quotation for an exact ETA change or a life-saving interruption', () => {
    const { context, situation } = example(), first = goals(situation, context);
    const unit = situation.units.find(unit => unit.id === 'fighter-0')!;
    const delayed = { ...situation, units: situation.units.map(fighter => fighter.owner === 'us' && fighter.kind !== 'worker'
      ? { ...fighter, arrivals: fighter.arrivals.map(record => ({ ...record, arrival: route(60.125) })) } : fighter) };
    const quote = (s: Situation, tick: number) => generateLandObjectives({ ...s, tick },
      { ...context, snapshot: { ...context.snapshot, tick } }, first).find(goal => goal.kind === 'AttackSite')!;
    const delay = quote(delayed, 1015);
    expect(delay.reasons.some(reason => reason.code === 'assessment-reused')).toBe(false);
    const demand = decomposeLandObjective({ ...delayed, tick: 1015 }, delay,
      { ...context, snapshot: { ...context.snapshot, tick: 1015 } })[0]!.demands.find(demand => demand.kind === 'force')!;
    expect(demand).toEqual(expect.objectContaining({ neededByTick: 1075.125 }));
    const patient = changedUnit(delayed, unit.id, { commitments: [{ source: 'mobileCare.claimsUnits', taskId: 'treatment',
      objectiveId: null, role: 'frontline', evidence: { source: 'mobileCare', tick: 1020, certainty: 'recorded', detail: unit.id } }] });
    const interrupted = quote(patient, 1030);
    expect(interrupted.reasons.some(reason => reason.code === 'assessment-reused')).toBe(false);
    expect(interrupted.reasons.find(reason => reason.code === 'observation-only-cohort')!.detail).not.toContain(unit.id);
  });
});
