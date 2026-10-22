import { expect } from 'vitest';
import { BUILDING_DEFS } from '../../../shared/catalog';
import { seconds } from '../../../shared/time';
import type { PublicPuzzleCase } from './scenes';
import type { PuzzleWorld } from './world';

import { goalCampId, goalFact, goalValueKey } from '../goal-facts';
import { projectGoalResources, type GoalScheduledAction } from '../goal-resource-ledger';
import type { GoalActionKind, GoalActionNode, GoalFactPredicate, GoalPlannerInput, GoalPlannerOutput } from '../goal-planner-types';
import type { StrategyAllocationTrace } from '../allocation-types';

export type PuzzlePlanObservation = Readonly<{
  input: GoalPlannerInput;
  output: GoalPlannerOutput;
  /** Actual same-think allocator trace, never a resource forecast. */
  allocation: StrategyAllocationTrace | null;
}>;

/** Recompute every resource prefix from the real input and selected schedules.
 * A proposed trace balance, unknown timestamp or repeated action cannot mint
 * resources or stand in for the shared source's initial inventory. */
export function projectPuzzleResources(observed: Pick<PuzzlePlanObservation, 'input' | 'output'>) {
  const selected = observed.output.plans.filter(p => p.status !== 'blocked');
  const scheduled = new Map<string, GoalScheduledAction>();
  for (const node of selected.flatMap(p => p.actions).filter(node => node.state !== 'world-effects-met')) {
    if (node.startTick === null || node.finishTick === null) return {
      state: 'pending' as const, reason: { code: 'puzzle-action-not-scheduled', factIds: [node.id], values: {} },
    };
    const old = scheduled.get(node.declaration.id);
    if (old && (old.startTick !== node.startTick || old.finishTick !== node.finishTick
      || goalValueKey(old.action) !== goalValueKey(node.declaration))) return {
      state: 'pending' as const, reason: { code: 'puzzle-shared-action-conflict', factIds: [node.id], values: {} },
    };
    scheduled.set(node.declaration.id, { action: node.declaration, startTick: node.startTick, finishTick: node.finishTick });
  }
  return projectGoalResources({ epoch: observed.input.context.tick, initial: observed.input.initialBalances,
    actions: [...scheduled.values()] });
}
export function checkPuzzlePlan(puzzle: PublicPuzzleCase, world: PuzzleWorld, observed: PuzzlePlanObservation) {
  expect(observed.input.context.owner).toBe(world.owner);
  expect(observed.input.context.tick).toBe(world.game.tick);
  for (const request of observed.input.goals) for (const fact of request.effects)
    expect(fact.id, 'goals use the shared canonical predicate identity').toBe(goalFact(fact.predicate).id);
  const campId = (members: typeof world.guards) => members.length ? goalCampId(members.map(u => u.id)) : undefined;
  const campIds = { target: campId(world.guards), beach: campId(world.beachGuards), local: campId(world.localGuards) };
  const plans = observed.output.plans.filter(p => p.status !== 'blocked');
  const actions = plans.flatMap(p => p.actions).filter(node => node.state !== 'world-effects-met'), effects = (a: GoalActionNode) => a.declaration.effects.filter(e => e.operation === 'establish').map(e => e.fact.predicate);
  const kind = (name: GoalActionKind) => actions.filter(a => a.declaration.kind === name);
  const producing = (predicate: (p: GoalFactPredicate) => boolean) => actions.filter(a => effects(a).some(predicate));
  const camp = (id: string | undefined) => id ? actions.filter(a => a.declaration.effects.some(e => e.operation === 'establish'
    && e.fact.id === goalFact({ kind: 'camp-cleared', campId: id }).id)) : [];
  const building = (name: string) => producing(p => p.kind === 'building-complete' && p.buildingKind === name);
  const trained = (name: string) => producing(p => p.kind === 'unit-available' && p.unitKind === name);
  const hall = producing(p => p.kind === 'hall-complete' && p.mineId === world.mine.id);
  const required = (values: readonly GoalActionNode[], label: string) => { expect(values.length, label).toBeGreaterThan(0); return values; };
  const projection = projectPuzzleResources(observed);
  expect(projection.state, 'shared resource ledger must prove every prefix; pending is not solvent').toBe('met');
  if (projection.state === 'pending') throw new Error(projection.reason.code);
  expect(projection.deficits, 'real initial inventory and source-deduplicated flows must fund every selected plan').toEqual([]);
  const predecessors = new Map<string, Set<string>>();
  const link = (from: string, to: string) => { const set = predecessors.get(to) ?? new Set(); set.add(from); predecessors.set(to, set); };
  for (const action of actions) for (const parent of action.dependsOnActionIds) link(parent, action.id);
  for (const plan of plans) for (const edge of plan.edges) link(edge.from, edge.to);
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (seen.has(to)) return false;
    seen.add(to);
    return [...(predecessors.get(to) ?? [])].some(id => id === from || reaches(from, id, seen));
  };
  const before = (left: readonly GoalActionNode[], right: readonly GoalActionNode[], label: string) => {
    required(left, `${label}: predecessor`); required(right, `${label}: successor`);
    expect(left.some(a => right.some(b => reaches(a.id, b.id))), label).toBe(true);
  };
  const ferryChain = () => {
    before(kind('transport-force'), camp(campIds.target), 'army transport before camp');
    before(camp(campIds.target), kind('transport-worker'), 'clear before worker transport');
    before(kind('transport-worker'), hall, 'worker transport before hall');
  };
  switch (puzzle.key) {
    case 'ship-away':
      ferryChain();
      if (puzzle.variant === 'far') before(kind('position-transport'), kind('transport-force'), 'position hull before boarding');
      else expect(kind('position-transport').filter(p => kind('transport-force').some(f => reaches(p.id, f.id))),
        'already positioned hull needs no initial positioning; later worker pickup may still reposition').toHaveLength(0);
      break;
    case 'supply-tier':
      if (puzzle.variant === 'knight') {
        before(building('farm'), trained('knight'), 'farm unlocks knight tier');
        before(trained('knight'), camp(campIds.target), 'knight clears camp');
      } else {
        before(trained('footman'), camp(campIds.target), 'faster basic force clears camp');
        expect(trained('knight')).toHaveLength(0);
        expect(building('farm')).toHaveLength(0);
      }
      break;
    case 'navy-zero': {
      ferryChain();
      before(building('shipyard'), trained('transport'), 'yard before new hull');
      before(trained('transport'), kind('transport-force'), 'new hull before army transport');
      const gold = projection.timeline.filter(e => e.resource.kind === 'gold');
      expect(gold.length, 'recomputed gold timeline').toBeGreaterThan(0);
      expect(gold.every(e => e.before >= 0 && e.after >= 0), 'no insolvent prefix or double-counted income/bounty').toBe(true);
      const hallBindings = hall.flatMap(node => node.allocation ? [node.allocation] : []);
      const reserved = observed.allocation?.budget.filter(entry => entry.state === 'reserved' && hallBindings.some(binding =>
        binding.objectiveId === entry.objectiveId && binding.methodId === entry.methodId
        && binding.actionId === entry.action.actionId && binding.generation === entry.action.generation)) ?? [];
      expect(observed.allocation, 'actual allocation trace, not a hand-authored amount').not.toBeNull();
      expect(new Set(reserved.map(entry => entry.id)).size).toBe(reserved.length);
      expect(reserved.reduce((sum, entry) => sum + Math.max(0, entry.amountGold - entry.paidGold), 0),
        'hall capital joined to its real allocator action/generation').toBeGreaterThanOrEqual(BUILDING_DEFS.townHall.cost);
      break;
    }
    case 'defense-window': {
      const defend = required(kind('defend'), 'defense target must be present');
      required(hall, 'island target must be present');
      if (puzzle.variant === 'urgent') before(defend, kind('transport-force'), 'defense releases army for island');
      else {
        required(kind('transport-force'), 'island first');
        expect(hall.some(h => defend.some(d => h.finishTick !== null && d.startTick !== null && h.finishTick <= d.startTick)), 'island before defense').toBe(true);
        const arrival = world.game.tick + seconds(360);
        expect(defend.some(d => d.declaration.effects.some(effect => {
          const p = effect.fact.predicate;
          if (effect.operation !== 'establish' || p.kind !== 'site-safe' || p.throughTick < arrival
            || p.site.entityId !== world.home.id && Math.hypot(p.site.point.x - world.home.x, p.site.point.y - world.home.y) > 450) return false;
          // A sustained defense starts before arrival and retains its lease
          // afterward. Its protection effect, not command start or lease end,
          // must activate at the real home before the incoming army arrives.
          const active = effect.at === 'start' ? d.startTick : effect.at === 'finish' ? d.finishTick
            : d.startTick === null ? null : d.startTick + effect.at.offsetTicks;
          return active !== null && active <= arrival;
        })), 'home protection active by enemy arrival; winning the battle may finish later').toBe(true);
      }
      break;
    }
    case 'guarded-shore': {
      required(kind('transport-force'), 'army crosses water'); required(camp(campIds.target), 'target camp');
      const shoreFacts = kind('transport-force').flatMap(a => a.declaration.preconditions)
        .filter(f => f.predicate.kind === 'shore-safe');
      expect(shoreFacts.some(f => f.predicate.kind === 'shore-safe'
        && Math.hypot(f.predicate.landing.point.x - world.landing.x, f.predicate.landing.point.y - world.landing.y) < 400),
      'selected transport uses the appropriate shore; already safe needs no clear action').toBe(true);
      const near = world.beachGuards.reduce((p, u) => ({ x: p.x + u.x / world.beachGuards.length, y: p.y + u.y / world.beachGuards.length }), { x: 0, y: 0 });
      const clearNear = [...camp(campIds.beach), ...kind('clear-shore').filter(a => effects(a).some(p =>
        p.kind === 'shore-safe' && Math.hypot(p.landing.point.x - near.x, p.landing.point.y - near.y) < 400))];
      if (puzzle.variant === 'strong') before(clearNear, camp(campIds.target), 'clear near beach before target camp');
      else expect(clearNear, 'safe alternative must not clear the dangerous near beach').toHaveLength(0);
      break;
    }
    case 'negative-return':
      expect(camp(campIds.target), 'do not commit to the loss-making camp').toHaveLength(0);
      required(camp(campIds.local), 'use army on mainland opportunity');
      required(producing(p => p.kind === 'hall-complete' && p.mineId === world.localMine!.id), 'mainland expansion');
      break;
    case 'evacuate':
      required(kind('evacuate'), 'evacuation is an action');
      expect(kind('transport-force'), 'no suicidal army reinforcement').toHaveLength(0);
      required(producing(p => p.kind === 'assets-safe'), 'rescued worker goal');
      break;
  }
}
