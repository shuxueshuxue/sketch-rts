import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import type { GameSnapshot } from '../../shared/types';
import { createAiPolicyMemory, type AiPolicyMemory } from '../memory';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { goalEconomyActionProvider } from './goal-economy-provider';
import { goalCampId, goalFact } from './goal-facts';
import { goalLandActionProvider } from './goal-land-actions';
import { goalNavalActionProvider } from './goal-naval-provider';
import { withGoalPlannerInput } from './goal-planner-input';
import type { GoalActionDeclaration, GoalFact, GoalPlanningContext } from './goal-planner-types';
import { landIdAt } from './regions';

const load = (name: string) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
const providers = [goalEconomyActionProvider, goalLandActionProvider, goalNavalActionProvider];
const persistent = new Set(['hold-position', 'defend']); // garrison uses hold-position.
const safetyKinds = new Set(['site-safe', 'shore-safe', 'assets-safe']);

/** This contract is independent of how a declaration constructs its proofs.
 * Adding a nonpersistent provider with a goal-deadline safety window fails. */
function checkSafety(action: GoalActionDeclaration, tick: number) {
  if (persistent.has(action.kind)) return 0;
  const safety = action.preconditions.filter(fact => safetyKinds.has(fact.predicate.kind));
  const finish = tick + (action.duration.state === 'met' ? action.duration.value : 0);
  for (const fact of safety) {
    if (!('throughTick' in fact.predicate)) throw Error('Safety proof has no end');
    expect(fact.predicate.throughTick, `${action.kind} safety exceeds its finish`).toBeLessThanOrEqual(finish);
    expect(action.preconditionWindows, `${action.kind} safety must follow schedule delays`)
      .toContainEqual({ factId: fact.id, through: 'finish' });
  }
  return safety.length;
}

function worldEffects(context: GoalPlanningContext): GoalFact[] {
  const { snapshot, tick } = context, byTick = tick + 12000;
  const effects: GoalFact[] = [goalFact({ kind: 'supply-cap', minimum: snapshot.players[context.owner]!.supplyCap + 6 })];
  for (const land of context.situation.lands) {
    const at = { landId: land.id, point: land.anchor };
    effects.push(goalFact({ kind: 'worker-at', at, count: 1, byTick }),
      goalFact({ kind: 'force-at', at, minimum: 1, metric: 'combat-rating', byTick }),
      goalFact({ kind: 'route-controlled', at, throughTick: tick + 600 }));
    const worker = snapshot.units.find(unit => unit.owner === context.owner && unit.kind === 'worker' && unit.hp > 0);
    if (worker) effects.push(goalFact({ kind: 'assets-safe', unitIds: [worker.id], at, throughTick: byTick }));
  }
  for (const resource of snapshot.resources.filter(resource => resource.amount > 0)) {
    const landId = landIdAt(snapshot.map, resource);
    if (landId) effects.push(goalFact({ kind: 'hall-complete', mineId: resource.id,
      at: { entityId: resource.id, landId, point: { x: resource.x, y: resource.y } } }));
  }
  for (const camp of neutralCampExposure(snapshot).camps) effects.push(goalFact({ kind: 'camp-cleared', campId: goalCampId(camp.memberIds) }));
  for (const target of snapshot.buildings.filter(target => target.owner !== context.owner && target.hp > 0)) {
    const landId = landIdAt(snapshot.map, target);
    if (landId) effects.push(goalFact({ kind: 'enemy-site-destroyed', site: {
      entityId: target.id, landId, point: { x: target.x, y: target.y } } }));
  }
  return effects;
}

describe('all provider admission safety windows on recorded worlds', () => {
  const far = load('public-ship-away-far') as GameSnapshot;
  const late = load('goal-building-324-far-t7470') as { snapshot: GameSnapshot; memoryBefore: AiPolicyMemory };
  const sapphire = load('sapphire-control-p4-4180') as { snapshot: GameSnapshot; memory: AiPolicyMemory; owner: string };
  const frames = [{ name: 'initial public far', snapshot: far, memory: createAiPolicyMemory(), owner: 'planner' },
    { name: 'original far 7470', snapshot: late.snapshot, memory: late.memoryBefore, owner: 'planner' },
    { name: 'original sapphire 4180', ...sapphire }];
  it('enumerates every registered provider on initial and late original frames in both precisions', () => {
    const coverage = new Map(providers.map(provider => [provider.id, 0]));
    let safetyCount = 0;
    for (const precision of ['coarse', 'exact'] as const) for (const frame of frames) {
      const snapshot = structuredClone(frame.snapshot), before = JSON.stringify(snapshot);
      withNavigationAudit(event => {
        if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation);
      }, () => withNavigationPhase('strategy-planning', () => withGoalPlannerInput({ snapshot,
        owner: frame.owner, version: 'v9_knight', memory: structuredClone(frame.memory), precision }, input => {
        expect(input.providers.map(provider => provider.id).sort()).toEqual(providers.map(provider => provider.id).sort());
        const effects = [...input.goals.flatMap(goal => goal.effects), ...worldEffects(input.context)];
        const seen = new Set<string>();
        // Expand native declarations' own prerequisites, without plan search,
        // allocation, a fabricated observation table or simulation steps.
        for (let cursor = 0; cursor < effects.length && seen.size < 160; cursor++) {
          const effect = effects[cursor]!;
          if (seen.has(effect.id)) continue;
          seen.add(effect.id);
          for (const provider of providers) for (const action of provider.actionsFor(effect, input.context)) {
            coverage.set(provider.id, coverage.get(provider.id)! + 1);
            safetyCount += checkSafety(action, snapshot.tick);
            effects.push(...action.preconditions);
          }
        }
        expect(input.work.receipt.used).toBeLessThanOrEqual(6144);
      })));
      expect(JSON.stringify(snapshot), frame.name).toBe(before);
    }
    for (const count of coverage.values()) expect(count).toBeGreaterThan(0);
    expect(safetyCount).toBeGreaterThan(0);
  });

  it('rejects an oversized future safety window even when it has a relative marker', () => {
    const fact = goalFact({ kind: 'site-safe', site: { point: { x: 0, y: 0 } }, throughTick: 12000 });
    const invalid: GoalActionDeclaration = { id: 'invalid-window-contract', kind: 'build', preconditions: [fact],
      effects: [], demands: [], flows: [], outputs: [], reasons: [], executor: { executor: 'goal.build', parameters: {} },
      duration: { state: 'met', value: 719, factIds: [] }, cost: { state: 'met', value: [], factIds: [] },
      successProbability: { state: 'met', value: 1, factIds: [] }, preconditionWindows: [{ factId: fact.id, through: 'finish' }] };
    expect(() => checkSafety(invalid, 0)).toThrow();
  });
});
