import { expect } from 'vitest';
import { BUILDING_DEFS } from '../../../shared/catalog';
import type { PublicPuzzleCase } from './scenes';
import type { PuzzleWorld } from './world';

/** Read-only projection of the approved GoalPlannerOutput, not a second fact source.
 * Replace this projection with the shared type when its prerequisite stack reaches main. */
type Predicate = Readonly<{ kind: string; [key: string]: unknown }>;
type Action = Readonly<{ id: string; dependsOnActionIds: readonly string[]; startTick: number | null; finishTick: number | null;
  declaration: { kind: string; effects: readonly { fact: { predicate: Predicate }; operation: string }[] } }>;
type Plan = Readonly<{ id: string; status: string; actions: readonly Action[];
  edges: readonly { from: string; to: string }[];
  resourceTimeline: readonly { tick: number; before: number; after: number; resource: { kind: string } }[] }>;
export type PuzzlePlanObservation = Readonly<{
  output: { plans: readonly Plan[] };
  /** IDs returned by the shared goalCampId/resolveGoalCamp, never guessed by proximity. */
  campIds: { target: string; beach?: string; local?: string };
  /** Actual allocator ledger (StrategyPlanTrace.budget), not a forecast balance. */
  hallGoldReservation: number | null;
}>;
export function checkPuzzlePlan(puzzle: PublicPuzzleCase, world: PuzzleWorld, observed: PuzzlePlanObservation) {
  const plans = observed.output.plans.filter(p => p.status !== 'blocked');
  const actions = plans.flatMap(p => p.actions), effects = (a: Action) => a.declaration.effects.filter(e => e.operation === 'establish').map(e => e.fact.predicate);
  const kind = (name: string) => actions.filter(a => a.declaration.kind === name);
  const producing = (predicate: (p: Predicate) => boolean) => actions.filter(a => effects(a).some(predicate));
  const camp = (id: string) => producing(p => p.kind === 'camp-cleared' && p.campId === id);
  const building = (name: string) => producing(p => p.kind === 'building-complete' && p.buildingKind === name);
  const trained = (name: string) => producing(p => p.kind === 'unit-available' && p.unitKind === name);
  const hall = producing(p => p.kind === 'hall-complete' && p.mineId === world.mine.id);
  const required = (values: readonly Action[], label: string) => { expect(values.length, label).toBeGreaterThan(0); return values; };
  const predecessors = new Map<string, Set<string>>();
  const link = (from: string, to: string) => { const set = predecessors.get(to) ?? new Set(); set.add(from); predecessors.set(to, set); };
  for (const action of actions) for (const parent of action.dependsOnActionIds) link(parent, action.id);
  for (const plan of plans) for (const edge of plan.edges) link(edge.from, edge.to);
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (seen.has(to)) return false;
    seen.add(to);
    return [...(predecessors.get(to) ?? [])].some(id => id === from || reaches(from, id, seen));
  };
  const before = (left: readonly Action[], right: readonly Action[], label: string) => {
    required(left, `${label}: predecessor`); required(right, `${label}: successor`);
    expect(left.some(a => right.some(b => reaches(a.id, b.id))), label).toBe(true);
  };
  const ferryChain = () => {
    before(kind('transport-force'), camp(observed.campIds.target), 'army transport before camp');
    before(camp(observed.campIds.target), kind('transport-worker'), 'clear before worker transport');
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
        before(trained('knight'), camp(observed.campIds.target), 'knight clears camp');
      } else {
        before(trained('footman'), camp(observed.campIds.target), 'faster basic force clears camp');
        expect(trained('knight')).toHaveLength(0);
        expect(building('farm')).toHaveLength(0);
      }
      break;
    case 'navy-zero': {
      ferryChain();
      before(building('shipyard'), trained('transport'), 'yard before new hull');
      before(trained('transport'), kind('transport-force'), 'new hull before army transport');
      const gold = plans.flatMap(p => p.resourceTimeline).filter(e => e.resource.kind === 'gold');
      expect(gold.length, 'explicit gold timeline').toBeGreaterThan(0);
      expect(gold.every(e => e.before >= 0 && e.after >= 0), 'no insolvent prefix').toBe(true);
      expect(observed.hallGoldReservation, 'real hall reservation, separate from forecast').toBeGreaterThanOrEqual(BUILDING_DEFS.townHall.cost);
      break;
    }
    case 'defense-window': {
      const defend = required(kind('defend'), 'defense target must be present');
      required(hall, 'island target must be present');
      if (puzzle.variant === 'urgent') before(defend, kind('transport-force'), 'defense releases army for island');
      else {
        required(kind('transport-force'), 'island first');
        expect(hall.some(h => defend.some(d => h.finishTick !== null && d.startTick !== null && h.finishTick <= d.startTick)), 'island before defense').toBe(true);
        expect(defend.some(d => d.startTick !== null && d.startTick <= world.game.tick + 360 * 20), 'on defense by enemy arrival; winning the battle may finish later').toBe(true);
      }
      break;
    }
    case 'guarded-shore': {
      required(kind('transport-force'), 'army crosses water'); required(camp(observed.campIds.target), 'target camp');
      const shores = actions.flatMap(effects).filter(p => p.kind === 'shore-safe');
      const safeLanding = shores.some(p => {
        const landing = p.landing as { point?: { x: number; y: number } } | undefined;
        return landing?.point && Math.hypot(landing.point.x - world.landing.x, landing.point.y - world.landing.y) < 400;
      });
      expect(safeLanding, 'chosen native landing changes with force size').toBe(true);
      if (puzzle.variant === 'strong') before(camp(observed.campIds.beach!), camp(observed.campIds.target), 'clear near beach before target camp');
      else expect(camp(observed.campIds.beach!)).toHaveLength(0);
      break;
    }
    case 'negative-return':
      expect(camp(observed.campIds.target), 'do not commit to the loss-making camp').toHaveLength(0);
      required(camp(observed.campIds.local!), 'use army on mainland opportunity');
      required(producing(p => p.kind === 'hall-complete' && p.mineId === world.localMine!.id), 'mainland expansion');
      break;
    case 'evacuate':
      required(kind('evacuate'), 'evacuation is an action');
      expect(kind('transport-force'), 'no suicidal army reinforcement').toHaveLength(0);
      required(producing(p => p.kind === 'assets-safe'), 'rescued worker goal');
      break;
  }
}
