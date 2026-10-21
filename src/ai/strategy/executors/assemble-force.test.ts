import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../../sdk/scene';
import { snapshotGame } from '../../../shared/sim';
import { setBuildingBodies } from '../../../shared/terrain';
import { standingBodies } from '../../../shared/structure-bodies';
import type { GameSnapshot } from '../../../shared/types';
import { assessAllocatedForce } from '../allocated-force';
import type { ExecutorInput } from '../allocation-types';
import { landIdAt } from '../regions';
import { strategicTargetCamp } from '../target-camp';
import { assembleExecutor } from './assemble';
import { assembleForceExecutor } from './assemble-force';

function request(granted = ['a']): ExecutorInput {
  const snapshot = snapshotGame(sketchScene('persistent-force-assembly').map('bareDuel').replaceDefaults()
    .player('us', { team: 'home' }).player('foe', { team: 'enemy' })
    .unit('us', 'archer', 1000, 1000, { id: 'a' }).unit('us', 'archer', 1020, 1000, { id: 'b' })
    .unit('us', 'archer', 1600, 1000, { id: 'distant' }).worker('us', 1500, 1000, { id: 'worker' })
    .unit('neutral', 'ogreWarrior', 2000, 2000).unit('neutral', 'ogreMage', 2050, 2000).build().createGame());
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const target = { point: { x: 1000, y: 1000 }, landId: landIdAt(snapshot.map, { x: 1000, y: 1000 })! };
  const campTarget = { point: { x: 2000, y: 2000 }, landId: target.landId };
  const camp = strategicTargetCamp(snapshot, campTarget)!;
  const measure = (ids: string[]) => assessAllocatedForce('us', snapshot.units.filter(unit => ids.includes(unit.id)), { metric: 'camp-force', camp }).force;
  const requiredForce = (measure(['a']) + measure(['a', 'b'])) / 2;
  const objectiveId = 'conquest', methodId = `${objectiveId}/method:staged-beachhead`, token = { actionId: `${methodId}/assemble-force`, generation: 1 };
  return { snapshot, owner: 'us', objective: { id: objectiveId, owner: 'us', kind: 'ConquerIsland', target: campTarget, effects: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'active', sinceTick: 0, rank: 1, reasons: [], methodIds: [methodId],
    stability: { minimumStayUntilTick: 0, challengerId: null, challengerThinks: 0 } },
    method: { id: methodId, objectiveId, kind: 'staged-beachhead', preconditions: [], subgoals: [], demands: [], estimatedTicks: null, status: 'selected', reasons: [] },
    execution: { token, objectiveId, methodId, executor: assembleForceExecutor.id,
      intent: { kind: 'assemble-force', campTarget, requiredForce, posts: [{ id: 'home', target, unitIds: granted }] }, target, dependsOn: [], completionEffects: [],
      status: 'active', phase: 'assembling-force', sinceTick: 0, lastProgressTick: 0, state: {} },
    grant: { revision: 1, action: token, objectiveId, methodId, assignments: [], voyages: [], orders: [], commands: [], orderOverrides: [], budgets: [],
      leases: granted.map(id => ({ id: `lease:${id}`, resourceKey: `unit:${id}`, objectiveId, methodId, action: token,
        sinceTick: 0, minimumStayUntilTick: 0, origin: 'allocator', incumbentTask: null })) }, events: [] };
}

describe('persistent clearing-force assembly', () => {
  it('keeps an arrived partial cohort active, then completes with a newly granted real member', () => {
    const partial = request();
    expect(assembleExecutor.execute(partial).status).toBe('complete');
    const before = JSON.stringify(partial), waiting = assembleForceExecutor.execute(partial);
    expect(waiting).toMatchObject({ status: 'active', phase: 'waiting-for-force', state: { arrivedUnitIds: ['a'] } });
    expect(waiting.state.assembledForce).toBeLessThan(Number(waiting.state.requiredForce));
    expect(JSON.stringify(partial)).toBe(before);
    const added = request(['a', 'b']);
    const ready = assembleForceExecutor.execute({ ...added, execution: { ...added.execution, state: waiting.state } });
    expect(ready).toMatchObject({ status: 'complete', phase: 'force-assembled', state: { arrivedUnitIds: ['a', 'b'] } });
    expect(ready.action).toEqual(waiting.action);
    expect(ready.state.assembledForce).toBeGreaterThan(Number(ready.state.requiredForce));
  });

  it('reopens a previously complete cohort after preemption and does not count an en-route member', () => {
    const enough = request(['a', 'b']);
    const completed = assembleForceExecutor.execute(enough);
    const reduced = request(['a', 'distant']);
    const result = assembleForceExecutor.execute({ ...reduced, execution: { ...reduced.execution, status: 'complete', state: completed.state } });
    expect(result.status).toBe('active');
    expect(result.state.arrivedUnitIds).toEqual(['a']);
    expect(result.commands.flatMap(row => 'unitIds' in row.command ? row.command.unitIds : [])).toContain('distant');
    expect(result.commands.flatMap(row => 'unitIds' in row.command ? row.command.unitIds : [])).not.toContain('b');
    const raised = { ...enough, execution: { ...enough.execution, status: 'complete' as const, intent: {
      kind: 'assemble-force' as const, campTarget: enough.objective.target, requiredForce: 100,
      posts: [{ id: 'home', target: enough.execution.target, unitIds: ['a', 'b'] }] } } };
    expect(assembleForceExecutor.execute(raised).status).toBe('active');
  });

  it('commands only real granted permanent fighters and preserves deterministic JSON continuation', () => {
    const input = request(['a', 'distant', 'worker']);
    const result = assembleForceExecutor.execute(input);
    const commanded = result.commands.flatMap(row => 'unitIds' in row.command ? row.command.unitIds : []);
    expect(commanded).not.toContain('b');
    expect(commanded).not.toContain('worker');
    expect(commanded).toContain('distant');
    const fork: ExecutorInput = JSON.parse(JSON.stringify(input));
    setBuildingBodies(fork.snapshot.map, standingBodies(fork.snapshot));
    expect(assembleForceExecutor.execute(fork)).toEqual(result);
  });

  it('leaves a recovering granted member outside both rally force and task commands', () => {
    const input = request(['a', 'b']), token = input.execution.token;
    const recovering: ExecutorInput = { ...input, grant: { ...input.grant, assignments: [{ authority: 'committed',
      id: 'assignment:b', leaseId: 'lease:b', unitId: 'b', role: 'ranged', objectiveId: input.objective.id,
      methodId: input.method.id, action: token, target: input.execution.target, stage: 'on-station',
      eta: { status: 'known', forecastTick: 0, arrivalTick: 0 },
      lastLocation: { kind: 'land', landId: input.execution.target.landId!, point: { x: 1020, y: 1000 } },
      interruption: { kind: 'healing', executor: 'mobileCare', sinceTick: 0, resumeStage: 'on-station', vacancyId: 'healing:b' } }] } };
    const waiting = assembleForceExecutor.execute(recovering);
    expect(waiting).toMatchObject({ status: 'active', state: { arrivedUnitIds: ['a'] } });
    expect(waiting.commands.flatMap(row => 'unitIds' in row.command ? row.command.unitIds : [])).not.toContain('b');
    expect(assembleForceExecutor.execute(input).status).toBe('complete');
  });

  it('assesses the union at distinct real island posts once and never walks a member across water', () => {
    const frame: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
      new URL('../../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString())
      .frames['Ne-sapphireArchipelago-player-4-17991'];
    const snapshot = frame.snapshot, base = request(), ids = [3661, 5287, 5642, 5789, 5909]
      .map(id => `unit-player-4-emberRavager-${id}`);
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const members = snapshot.units.filter(unit => ids.includes(unit.id));
    expect(members).toHaveLength(5);
    const mine = snapshot.resources.find(mine => mine.id === 'gold-satellite-2')!;
    const campTarget = { entityId: mine.id, point: { x: mine.x, y: mine.y }, landId: landIdAt(snapshot.map, mine)! };
    const camp = strategicTargetCamp(snapshot, campTarget)!;
    const assessment = assessAllocatedForce(frame.owner, members, { metric: 'camp-force', camp });
    const posts = members.map(unit => ({ id: `post:${unit.id}`, target: {
      point: { x: unit.x, y: unit.y }, landId: landIdAt(snapshot.map, unit)! }, unitIds: [unit.id] }));
    expect(new Set(posts.map(post => post.target.landId)).size).toBeGreaterThan(1);
    const input: ExecutorInput = { ...base, snapshot, owner: frame.owner, objective: { ...base.objective, owner: frame.owner, target: campTarget },
      execution: { ...base.execution, target: posts[0]!.target, intent: { kind: 'assemble-force', campTarget,
        requiredForce: assessment.requiredForce, posts } },
      grant: { ...base.grant, leases: ids.map(id => ({ ...base.grant.leases[0]!, id: `lease:${id}`, resourceKey: `unit:${id}` })) } };
    const ready = assembleForceExecutor.execute(input);
    expect(ready).toMatchObject({ status: 'complete', state: { assembledForce: assessment.force, arrivedUnitIds: [...ids].sort() } });
    expect(ready.commands.every(row => row.command.type === 'holdPosition')).toBe(true);
    const wrongPost = { ...input, execution: { ...input.execution, intent: { kind: 'assemble-force' as const, campTarget,
      requiredForce: assessment.requiredForce, posts: [{ id: 'wrong-island', target: posts[0]!.target, unitIds: ids }] } } };
    const blocked = assembleForceExecutor.execute(wrongPost);
    expect(blocked).toMatchObject({ status: 'blocked', commands: [] });
    expect(blocked.reasons[0]?.reason).toBe('assembly-route-unreachable');
  });

  it('rejects a granted member assigned to two posts rather than double counting it', () => {
    const input = request(['a', 'b']);
    if (input.execution.intent.kind !== 'assemble-force') throw new Error('Missing assembly intent');
    const duplicate = { ...input, execution: { ...input.execution, intent: { ...input.execution.intent,
      posts: [...input.execution.intent.posts, { id: 'duplicate', target: input.execution.target, unitIds: ['a'] }] } } };
    expect(assembleForceExecutor.execute(duplicate)).toMatchObject({ status: 'blocked', commands: [],
      reasons: [{ reason: 'assembly-member-post-ambiguous', unitIds: ['a'] }] });
  });
});
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
