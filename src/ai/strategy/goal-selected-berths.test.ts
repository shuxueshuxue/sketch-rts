import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { createAiPolicyMemory } from '../memory';
import type { GameSnapshot } from '../../shared/types';
import { withGoalPlannerInput } from './goal-planner-input';
import { planGoals } from './goal-planner';
import { chooseGoalCoarseShore, createGoalSelectedBerths, type GoalSelectedBerthMemory } from './goal-selected-berths';
import type { GoalTransportFactPorts } from './goal-grounding-ports';
import type { GoalGroundingReader, GoalEntityReference } from './goal-planner-types';
import { regionIndex } from './regions';
import { projectGoalResources } from './goal-resource-ledger';

it.each(['near', 'far'] as const)('uses a current-pose dock only when its full walking and sailing bound wins (%s)', variant => {
  const snapshot: GameSnapshot = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/public-ship-away-${variant}.json.gz`, import.meta.url))).toString());
  const before = JSON.stringify(snapshot), memory = createAiPolicyMemory();
  withNavigationAudit(event => { if (event.phase === 'strategy-planning' && !event.authorization) throw Error(event.operation); },
    () => withNavigationPhase('strategy-planning', () => withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight', memory }, input => {
      const { refineSelected: _refine, ...coarse } = input;
      const plan = planGoals(coarse).plans[0]!;
      const delivery = plan.actions.find(node => node.declaration.kind === 'transport-force')!;
      const ancestors = new Set<string>();
      const visit = (id: string) => {
        if (ancestors.has(id)) return;
        ancestors.add(id); plan.actions.find(node => node.id === id)?.dependsOnActionIds.forEach(visit);
      };
      delivery.dependsOnActionIds.forEach(visit);
      expect(plan.actions.filter(node => ancestors.has(node.id) && node.declaration.kind === 'position-transport'))
        .toHaveLength(variant === 'near' ? 0 : 1);
      // The hull's original pose cannot also satisfy its return after delivery.
      expect(plan.actions.filter(node => node.declaration.kind === 'position-transport'))
        .toHaveLength(variant === 'near' ? 1 : 2);
      const ledger = projectGoalResources({ epoch: snapshot.tick, initial: input.initialBalances,
        actions: plan.actions.map(node => {
          if (node.startTick === null || node.finishTick === null) throw Error('Expected a scheduled coarse prefix');
          return { action: node.declaration, startTick: node.startTick, finishTick: node.finishTick };
        }) });
      expect(ledger.state).toBe('met');
      if (ledger.state !== 'pending') expect(ledger.deficits).toEqual([]);
      if (variant === 'near') {
        const ship = snapshot.units.find(unit => unit.kind === 'transport')!;
        expect(delivery.declaration.executor.parameters.departure).toMatchObject({ water: { x: ship.x, y: ship.y }, heading: ship.sailing!.heading });
      }
    })));
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('retains a selected pending contact across actor motion, retries its proof, and releases a known failed alternative', () => {
  const snapshot: GameSnapshot = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/public-ship-away-far.json.gz', import.meta.url))).toString());
  const plan = withGoalPlannerInput({ snapshot, owner: 'planner', version: 'v9_knight', memory: createAiPolicyMemory() }, input => {
    const { refineSelected: _refine, ...coarse } = input;
    return planGoals(coarse).plans[0]!;
  });
  const selected = plan.actions.filter(node => node.declaration.kind === 'position-transport').slice(0, 1);
  const position = selected[0]!, reference = position.declaration.executor.parameters.transport as GoalEntityReference;
  const at = position.declaration.executor.parameters.at as { point: { x: number; y: number } };
  const parent = plan.actions.find(node => ['transport-force', 'transport-worker'].includes(node.declaration.kind)
    && JSON.stringify((node.declaration.executor.parameters.departure as { water: unknown }).water) === JSON.stringify(at.point))!;
  const ship = snapshot.units.find(unit => reference.kind === 'existing' && unit.id === reference.entityId)!;
  const cohort = parent.declaration.executor.parameters.cohort;
  if (!Array.isArray(cohort)) throw Error('expected declared cohort');
  const refs = cohort as Parameters<NonNullable<GoalGroundingReader['resolveCohort']>>[0];
  const resolve: NonNullable<GoalGroundingReader['resolveCohort']> = references => ({ state: 'met', candidates: references.map(reference => {
    if (reference.kind !== 'existing') throw Error('actual members required');
    return { reference, assessment: snapshot.units.find(unit => unit.id === reference.entityId)! };
  }), factIds: [] });
  const members = resolve(refs); if (members.state !== 'met') throw Error('missing real members');
  const regions = regionIndex(snapshot.map), shores = regions.shoresByLand.get('land:1')!.get('sea:1')!;
  let memory: GoalSelectedBerthMemory = { revision: 0, nextId: 1, sources: [], entries: [] };
  const build = (geometryRevision = 'same-terrain') => createGoalSelectedBerths({ memory, geometryRevision, regions,
    units: snapshot.units, berthOrientation: 'shore', currentPlanIds: () => [plan.id] });
  const pending = () => ({ state: 'pending' as const, requestIds: ['goal-geometry:finite-berth'],
    reason: { code: 'finite-native-scan-pending', factIds: [], values: {} } });
  const ports: GoalTransportFactPorts = { shores: pending, hulls: pending, seaLeg: pending, berth: vi.fn(pending) };
  let bindings = build();
  expect(bindings.prepare(plan, selected, ports, resolve)?.deferActionIds).toEqual([position.id]);
  expect(memory.entries).toHaveLength(1); expect(memory.entries[0]!.answer.state).toBe('pending');
  const original = structuredClone(memory.entries[0]!.shore);
  expect(bindings.requests(plan.id)).toEqual(['goal-geometry:finite-berth']);
  memory = JSON.parse(JSON.stringify(memory)); ship.sailing!.heading += .7;
  bindings = build(); bindings.retain([plan.id]);
  const other = shores.find(shore => Math.hypot(shore.ground.x - original.ground.x, shore.ground.y - original.ground.y) > 500)!;
  const chosen = chooseGoalCoarseShore(shores, other.ground, ship, members.candidates, bindings.published)!;
  expect(chosen.shore).toEqual(original); expect(chosen.berth).toBeUndefined();
  bindings.prepare(plan, selected, ports, resolve); expect(ports.berth).toHaveBeenCalledTimes(2);
  expect(memory.entries).toHaveLength(1);
  const rejected: GoalTransportFactPorts = { ...ports, berth: () => ({ state: 'unmet',
    reason: { code: 'native-contact-impossible', factIds: [], values: {} } }) };
  bindings.prepare(plan, selected, rejected, resolve);
  expect(chooseGoalCoarseShore(shores, other.ground, ship, members.candidates, bindings.published)!.shore).not.toEqual(original);
  expect(bindings.requests(plan.id)).toEqual([]);
  build('changed-terrain').retain([plan.id]); expect(memory.entries).toEqual([]);
});
