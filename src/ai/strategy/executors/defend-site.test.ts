import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as terrain from '../../../shared/terrain';
import { withAllocationLandRoutes } from '../allocation-arrival-query';
import type { AllocationLandRouteReader } from '../allocation-arrival-query';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../../shared/sim';
import { standingBodies } from '../../../shared/structure-bodies';
import { setBuildingBodies } from '../../../shared/terrain';
import { issueCommandFrame } from '../../../sdk/commands/frame';
import type { GameSnapshot } from '../../../shared/types';
import type { AiPolicyMemory } from '../../memory';
import type { ExecutorInput, ExecutableMethod } from '../allocation-types';
import { buildStrategyDecision, type StrategyDecision } from '../decision';
import { defenseMethodProvider } from '../defense-methods';
import { defendSiteExecutor } from './defend-site';

type Frame = { owner: string; snapshot: GameSnapshot; memory: AiPolicyMemory; nextId: number; activePlayers: string[] };
const frames: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(new URL('../../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;
const recalled = [1687, 1720, 2015, 2047, 2066, 2094].map(id => `unit-p0-emberRavager-${id}`);
let frame: Frame, decision: StrategyDecision, methods: readonly ExecutableMethod[];

function input(unitIds: readonly string[] = recalled): ExecutorInput {
  const objective = decision.objectives.find(goal => goal.id === 'DefendSite:p0:building-p0-townHall-1166')!;
  const method = methods.find(method => method.kind === 'main-army-recall')!;
  const action = method.actions[method.actions.length - 1]!, token = { actionId: action.id, generation: 1 };
  const snapshot = structuredClone(frame.snapshot);
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  return { snapshot, owner: frame.owner, objective, method,
    execution: { token, objectiveId: objective.id, methodId: method.id, executor: action.executor, intent: action.intent,
      target: action.target, dependsOn: action.dependsOn, completionEffects: action.completionEffects,
      status: 'active', phase: 'gather', sinceTick: frame.snapshot.tick, lastProgressTick: frame.snapshot.tick, state: {} },
    grant: { revision: 1, action: token, objectiveId: objective.id, methodId: method.id,
      leases: unitIds.map(id => ({ id: `lease:${id}`, resourceKey: `unit:${id}`, objectiveId: objective.id,
        methodId: method.id, action: token, sinceTick: frame.snapshot.tick, minimumStayUntilTick: frame.snapshot.tick,
        origin: 'allocator', incumbentTask: null })),
      assignments: [], budgets: [], voyages: [], orders: [], commands: [], orderOverrides: [] }, events: [] };
}

describe('granted defense at the real E01 home raid', () => {
  beforeAll(() => {
    frame = structuredClone(frames['gullIsland-p0-9930']!);
    setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
    decision = buildStrategyDecision(frame.snapshot, frame.owner, { memory: frame.memory }, undefined, undefined, Infinity);
    const objective = decision.objectives.find(goal => goal.id === 'DefendSite:p0:building-p0-townHall-1166')!;
    methods = defenseMethodProvider.buildMethods({ snapshot: frame.snapshot, situation: decision.situation,
      objective, previous: null, executions: [], blocked: [] });
  });

  it('offers the ordered defense alternatives without silently dropping the occupied post', () => {
    expect(methods.map(method => method.kind)).toEqual(['local-squad', 'main-army-recall', 'wait-in-cover', 'cross-sea-reinforcement', 'evacuation']);
    const demand = methods[0]!.demands.find(demand => demand.kind === 'force');
    expect(demand?.kind === 'force' && demand.strength).toBeGreaterThan(0);
  });

  it('recalls only the six granted boarding ravagers and starts defending before the whole group arrives', () => {
    const request = input(), before = JSON.stringify(request);
    expect(request.snapshot.units.filter(unit => recalled.includes(unit.id)).every(unit => unit.order.type === 'board')).toBe(true);
    const result = defendSiteExecutor.execute(request);
    expect(result.status).toBe('active');
    expect(result.phase).toBe('fight');
    const commanded = result.commands.flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : []);
    expect([...commanded].sort()).toEqual([...recalled].sort());
    expect(result.commands.every(entry => entry.command.type === 'move')).toBe(true);
    expect(JSON.stringify(request)).toBe(before);
  });

  it('does not borrow the nearby army when its grant is empty or belongs to an old action generation', () => {
    const empty = defendSiteExecutor.execute(input([]));
    expect(empty.commands).toEqual([]);
    expect(empty.reasons[0]?.reason).toBe('no-granted-defenders');
    const stale = input();
    const result = defendSiteExecutor.execute({ ...stale, grant: { ...stale.grant, action: { ...stale.grant.action, generation: 0 } } });
    expect(result.commands).toEqual([]);
    expect(result.reasons[0]?.reason).toBe('invalid-action-grant');
  });

  it('never counts cabin passengers as physically defending a land post', () => {
    const request = input();
    for (const unit of request.snapshot.units.filter(unit => recalled.includes(unit.id))) unit.cabin = { shipId: 'unit-p0-transport-1665' };
    const result = defendSiteExecutor.execute(request);
    expect(result.commands).toEqual([]);
    expect(result.progress).toEqual([]);
    expect(result.reasons[0]?.reason).toBe('defenders-in-transit');
  });

  it('keeps route-pending defenders paused without native routing or an unreachable conclusion', () => {
    const request = input(), before = JSON.stringify(request), native = vi.spyOn(terrain, 'walkingDistance');
    const read = vi.fn<AllocationLandRouteReader>(() => ({ status: 'unknown', reasonCode: 'land-route-not-published' }));
    try {
      const result = withAllocationLandRoutes(read, () => defendSiteExecutor.execute(request));
      expect(read).toHaveBeenCalledTimes(recalled.length); expect(native).not.toHaveBeenCalled();
      expect(result.status).toBe('blocked'); expect(result.commands).toEqual([]); expect(result.progress).toEqual([]);
      expect(result.reasons[0]?.reason).toBe('defense-route-pending'); expect(JSON.stringify(request)).toBe(before);
    } finally { vi.restoreAllMocks(); }
  });

  it('distinguishes a published unreachable road from pending and advances only the known subgroup', () => {
    const request = input(), first = request.snapshot.units.find(unit => unit.id === recalled[0])!;
    const known = request.snapshot.units.filter(unit => recalled.includes(unit.id) && unit.x === first.x && unit.y === first.y).map(unit => unit.id);
    const read: AllocationLandRouteReader = (from, goal) => from.x === first.x && from.y === first.y
      ? { status: 'known', points: [goal], distance: 100 } : { status: 'unknown', reasonCode: 'land-route-not-published' };
    const native = vi.spyOn(terrain, 'walkingDistance');
    try {
      const result = withAllocationLandRoutes(read, () => defendSiteExecutor.execute(request));
      expect(result.status).toBe('active'); expect(native).not.toHaveBeenCalled();
      const commanded = result.commands.flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : []);
      expect(commanded.length).toBeGreaterThan(0); expect(commanded.every(id => known.includes(id))).toBe(true);
      expect(result.reasons[0]?.reason).toBe('defense-route-pending'); expect(result.reasons[0]?.outcome).toBe('paused');
      const cold: ExecutorInput = JSON.parse(JSON.stringify(request)); setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
      expect(withAllocationLandRoutes(read, () => defendSiteExecutor.execute(cold))).toEqual(result);
      const unreachable = withAllocationLandRoutes(() => ({ status: 'unreachable', reasonCode: 'land-route-unreachable' }),
        () => defendSiteExecutor.execute(request));
      expect(unreachable.status).toBe('blocked'); expect(unreachable.commands).toEqual([]);
      expect(unreachable.reasons[0]?.reason).toBe('defense-route-unreachable'); expect(native).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });

  it('preserves its physical post and decisions through a JSON fork while the native world advances', () => {
    let request = input();
    const game = createGame(frame.snapshot.map.id, { players: frame.activePlayers });
    restoreSnapshotIntoGame(game, structuredClone(frame.snapshot), frame.nextId);
    game.activePlayers = [...frame.activePlayers];
    const first = defendSiteExecutor.execute(request);
    issueCommandFrame(game, first.commands.map(entry => ({ command: entry.command, playerId: frame.owner, scriptId: 'strategy.defend-site' })));
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    request = { ...request, snapshot: snapshotGame(game), execution: { ...request.execution, state: first.state, phase: first.phase } };
    const warm = defendSiteExecutor.execute(request);
    const cold: ExecutorInput = JSON.parse(JSON.stringify(request));
    setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
    expect(warm).toEqual(defendSiteExecutor.execute(cold));
    expect(warm.state.post).toEqual(first.state.post);
  });
});
