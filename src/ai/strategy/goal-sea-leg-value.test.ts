import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { unitRules } from '../../shared/catalog';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { goalFact } from './goal-facts';
import type { GoalHullCandidate, GoalSeaLeg } from './goal-grounding-ports';
import { createGoalNavalCombatGrounding } from './goal-naval-combat-grounding';
import { goalNavalActionProvider } from './goal-naval-provider';
import type { GoalEstimate, GoalPlanningContext } from './goal-planner-types';
import { valueGoalSeaLeg } from './goal-sea-leg-value';
import { regionIndex } from './regions';
import { evaluateSituation } from './situation';
import { voyageExpectedLoss } from './voyage-risk';
const strict = <T>(run: () => T) => withNavigationAudit(event => {
  if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
}, () => withNavigationPhase('strategy-planning', run));
function fixture() {
  const { snapshot, owner }: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  const ship = snapshot.units.find(unit => unit.id === 'unit-p4-transport-1151')!;
  const hull: GoalHullCandidate = { id: ship.id, reference: { kind: 'existing', entityId: ship.id }, assessment: ship,
    seaId: 'sea:1', availableTick: snapshot.tick, capacity: 0, cargoUnitIds: [], preconditions: [], factIds: [ship.id] };
  const leg: GoalEstimate<GoalSeaLeg> = { state: 'met', factIds: ['published-native-sea-leg'], value: {
    ticks: 210, endpoint: { x: ship.x + 100, y: ship.y }, heading: ship.sailing!.heading,
    risk: { status: 'known', survivalProbability: .73, expectedDamage: 12, expectedHpLoss: 12, damageErrorBound: 1,
      samples: 17, totalSamples: 17, computedTick: snapshot.tick, basis: 'native-route-exposure', threatIds: ['coastal-threat'] },
  } };
  return { snapshot, owner, ship, hull, leg };
}
it('uses the native hull residual and manifest/deck union once per atom, without losing cargo on a reposition', () => {
  const f = fixture(), before = JSON.stringify(f.snapshot), passenger = { kind: 'existing' as const, entityId: 'unit-p4-worker-2' };
  for (const passengers of [[], [passenger]]) {
    const quote = strict(() => valueGoalSeaLeg({ ...f, passengers }));
    const native = voyageExpectedLoss({ snapshot: f.snapshot, shipId: f.ship.id, passengerIds: passengers.map(p => p.entityId),
      shipResidualGold: unitRules(f.snapshot, f.ship).cost * Math.min(1, f.ship.hp / f.ship.maxHp), survivalProbability: .73 });
    expect(native.status).toBe('known');
    if (native.status !== 'known' || quote.cost.state !== 'met') throw Error('native price missing');
    expect(quote.cost.value.map(term => term.gold)).toEqual([native.hullLossGold, native.passengerLossGold]);
    expect(quote.successProbability).toMatchObject({ state: 'met', value: .73 });
    expect(native.passengers.length).toBeGreaterThan(passengers.length);
  }
  expect(JSON.stringify(f.snapshot)).toBe(before);
  if (f.leg.state !== 'met') throw Error('fixture');
  const { risk: _risk, ...unpriced } = f.leg.value;
  expect(valueGoalSeaLeg({ ...f, leg: { ...f.leg, value: unpriced } }).cost.state).toBe('pending');
  expect(valueGoalSeaLeg({ ...f, passengers: [{ kind: 'binding', name: 'future-pool-member' }] }).successProbability.state).toBe('pending');
});
it('grounds an actual pure hull move through the shared sea port and the goal-action declaration, retaining actual cargo control', () => {
  const f = fixture(), situation = evaluateSituation(f.snapshot, f.owner, createAiPolicyMemory());
  const shore = regionIndex(f.snapshot.map).shores.find(shore => shore.seaId === 'sea:1')!;
  const at = { seaId: 'sea:1' as const, point: shore.water }, effect = goalFact({ kind: 'transport-at', transport: f.hull.reference,
    at, tolerance: f.ship.radius, byTick: f.snapshot.tick + 2000 });
  const seaLeg = vi.fn(() => f.leg);
  let context: GoalPlanningContext = { snapshot: f.snapshot, owner: f.owner, situation, tick: f.snapshot.tick, version: 'v9_knight',
    readFact: () => { throw Error('domain must consume the shared sea leg, not query a land path'); } };
  const factory = createGoalNavalCombatGrounding(context, {
    arrival: () => { throw Error('private arrival'); }, landRoute: () => { throw Error('private land route'); },
    resolveCohort: refs => ({ state: 'met', factIds: [f.ship.id], candidates: refs.flatMap(reference => reference.kind === 'existing'
      && reference.entityId === f.ship.id ? [{ reference, assessment: f.ship }] : []) }), transportFacts: { seaLeg },
  });
  context = { ...context, grounding: { ...factory, buildSites: () => { throw Error('private sites'); },
    productionOptions: () => { throw Error('private producers'); }, transportOptions: () => { throw Error('private shores'); },
    resolveCohort: refs => ({ state: 'met', factIds: [], candidates: refs.map(reference => ({ reference, assessment: f.ship })) }) } };
  const candidate = strict(() => factory.combatOptions!(effect));
  expect(candidate.state).toBe('met'); if (candidate.state !== 'met') throw Error('hull missing');
  expect(candidate.candidates[0]!.successProbability).toMatchObject({ state: 'met', value: .73 });
  expect(seaLeg).toHaveBeenCalledWith(expect.objectContaining({ reference: f.hull.reference }),
    { x: f.ship.x, y: f.ship.y, heading: f.ship.sailing!.heading }, at.point, false);
  const actions = strict(() => goalNavalActionProvider.actionsFor(effect, context));
  expect(actions).toHaveLength(1); expect(actions[0]!.kind).toBe('position-transport');
  expect(actions[0]!.executor.parameters.at).toEqual(at);
  const cargo = f.snapshot.units.filter(unit => (unit.deck?.shipId ?? unit.cabin?.shipId) === f.ship.id).map(unit => unit.id).sort();
  expect(actions[0]!.executor.parameters.dependentUnitIds).toEqual(cargo);
  expect(actions[0]!.demands).toHaveLength(1 + cargo.length);
});
