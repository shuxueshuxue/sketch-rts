import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../../shared/sim';
import { standingBodies } from '../../../shared/structure-bodies';
import { sameGround, setBuildingBodies } from '../../../shared/terrain';
import type { GameSnapshot } from '../../../shared/types';
import { issueCommandFrame } from '../../../sdk/commands/frame';
import type { ActionIntent, ExecutorInput } from '../allocation-types';
import { landIdAt, seaIdAt } from '../regions';
import { buildHallExecutor } from './build-hall';
import { trainTransportExecutor } from './train-transport';
import { trainWorkerExecutor } from './train-worker';
import { assembleExecutor } from './assemble';
import { waitIncomeExecutor } from './wait-income';
import { establishForceExecutor } from './establish-force';

type Frame = { snapshot: GameSnapshot; owner: string; nextId: number; activePlayers: string[] };
const frames: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(
  new URL('../../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;
function request(frameId: string, kind: Exclude<ActionIntent['kind'], 'assemble-force' | 'goal-action'>, targetId: string, resources: string[], gold: number): ExecutorInput {
  const frame = structuredClone(frames[frameId]!), { snapshot, owner } = frame;
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const entity = [...snapshot.resources, ...snapshot.buildings].find(entity => entity.id === targetId)!;
  const target = { entityId: entity.id, point: { x: entity.x, y: entity.y },
    ...(kind === 'train-transport' ? { seaId: seaIdAt(snapshot.map, entity)! } : { landId: landIdAt(snapshot.map, entity)! }) };
  const objectiveId = `ConquerIsland:${owner}:${targetId}`, methodId = `${objectiveId}/method`, token = { actionId: `${methodId}/${kind}`, generation: 1 };
  return { snapshot, owner, objective: { id: objectiveId, owner, kind: 'ConquerIsland', target, effects: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'active', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [methodId],
    stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } },
    method: { id: methodId, objectiveId, kind: 'staged-beachhead', preconditions: [], subgoals: [], demands: [], estimatedTicks: null, status: 'selected', reasons: [] },
    execution: { token, objectiveId, methodId, executor: `strategy.${kind}`,
      intent: kind === 'clear-camp' ? { kind, memberIds: [] } : { kind },
      target, dependsOn: [], completionEffects: [], status: 'active', phase: 'ready', sinceTick: snapshot.tick, lastProgressTick: snapshot.tick, state: {} },
    grant: { revision: 1, action: token, objectiveId, methodId, assignments: [], voyages: [], orders: [], commands: [], orderOverrides: [],
      leases: resources.map(resourceKey => ({ id: `lease:${resourceKey}`, resourceKey: resourceKey as `unit:${string}` | `queue:${string}`,
        objectiveId, methodId, action: token, sinceTick: snapshot.tick, minimumStayUntilTick: snapshot.tick, origin: 'allocator', incumbentTask: null })),
      budgets: gold ? [{ id: 'budget', spendId: `${objectiveId}/${kind}`, objectiveId, methodId, action: token, amountGold: gold, paidGold: 0,
        state: 'reserved', sinceTick: snapshot.tick, releasedTick: null, includedUtilityTermCodes: [], externalReservationIds: [] }] : [] }, events: [] };
}

describe('allocated construction in native event frames', () => {
  it('adopts a paid native worker job without submitting or paying again, including a JSON fork', () => {
    const frameId = 'Ne-sapphireArchipelago-player-4-17991', frame = frames[frameId]!, hallId = 'building-player-4-townhall';
    const game = createGame(frame.snapshot.map.id, { players: frame.activePlayers });
    restoreSnapshotIntoGame(game, structuredClone(frame.snapshot), frame.nextId);
    game.activePlayers = [...frame.activePlayers];
    issueCommandFrame(game, [{ playerId: frame.owner, scriptId: 'economy', command: { type: 'train', buildingId: hallId, unitKind: 'worker' } }]);
    stepGame(game);
    const native = game.buildings.find(building => building.id === hallId)!.queue[0]!;
    expect(native.id).toBeTruthy();
    let input = request(frameId, 'train-worker', hallId, [`queue:${hallId}`], 75);
    input = { ...input, snapshot: snapshotGame(game), execution: { ...input.execution,
      production: { producer: { kind: 'existing', buildingId: hallId }, unitKind: 'worker',
        request: { kind: 'adopt-paid', jobId: native.id!, queueIndex: 0, observedTick: game.tick, remainingTicks: native.remaining } } } };
    const first = trainWorkerExecutor.execute(input);
    expect(first).toMatchObject({ status: 'active', phase: 'training', commands: [], payments: [] });
    expect(trainWorkerExecutor.execute(JSON.parse(JSON.stringify(input)))).toEqual(first);
    const unidentified = { ...input, execution: { ...input.execution, production: { ...input.execution.production!,
      request: { kind: 'adopt-paid' as const, jobId: null, queueIndex: 0, observedTick: game.tick, remainingTicks: native.remaining } } } };
    expect(trainWorkerExecutor.execute(unidentified).reasons[0]?.reason).toBe('paid-production-job-identity-unknown');
    const replaced = structuredClone(input);
    replaced.snapshot.buildings.find(building => building.id === hallId)!.queue[0]!.id = 'different-native-job';
    expect(trainWorkerExecutor.execute(replaced).reasons[0]?.reason).toBe('paid-production-job-no-longer-observed');
    const discontinuous = structuredClone(input);
    discontinuous.snapshot.buildings.find(building => building.id === hallId)!.queue[0]!.remaining++;
    expect(trainWorkerExecutor.execute(discontinuous).reasons[0]?.reason).toBe('paid-production-job-continuity-mismatch');
    let result = first;
    for (let ticks = 0; ticks < 600 && result.status !== 'complete'; ticks += 15) {
      for (let step = 0; step < 15; step++) stepGame(game);
      input = { ...input, snapshot: snapshotGame(game), execution: { ...input.execution, state: result.state } };
      result = trainWorkerExecutor.execute(input);
      expect(result.commands).toEqual([]);
      expect(result.payments ?? []).toEqual([]);
    }
    expect(result.status).toBe('complete');
    expect(game.units.find(unit => unit.id === result.state.createdUnitId)).toMatchObject({ owner: frame.owner, kind: 'worker' });
  });

  it('requires the exact production result and registered spend instead of borrowing another queue or budget', () => {
    const hallId = 'building-player-4-townhall';
    const input = request('Ne-sapphireArchipelago-player-4-17991', 'train-worker', hallId, [`queue:${hallId}`], 75);
    const bound = { ...input, execution: { ...input.execution, production: { producer: { kind: 'existing' as const, buildingId: hallId },
      unitKind: 'worker' as const, request: { kind: 'submit' as const, spendId: 'another-production-capital' } } } };
    expect(trainWorkerExecutor.execute(bound).reasons[0]?.reason).toBe('no-granted-worker-capital');
    expect(trainWorkerExecutor.execute({ ...bound, execution: { ...bound.execution, production: { ...bound.execution.production,
      producer: { kind: 'existing', buildingId: 'another-town-hall' } } } }).reasons[0]?.reason).toBe('production-binding-producer-mismatch');
    const unresolved = { ...bound, execution: { ...bound.execution, target: { point: input.execution.target.point },
      production: { ...bound.execution.production, producer: { kind: 'action-result' as const, actionId: 'build-parent' } } } };
    expect(trainWorkerExecutor.execute(unresolved).reasons[0]?.reason).toBe('production-parent-result-unresolved');
  });

  it('pays once for an explicitly leased sapphire worker queue and admits only an actual native birth', () => {
    const frameId = 'Ne-sapphireArchipelago-player-4-17991', frame = frames[frameId]!;
    const hallId = 'building-player-4-townhall';
    let input = request(frameId, 'train-worker', hallId, [`queue:${hallId}`], 75);
    const first = trainWorkerExecutor.execute(input);
    expect(first.status).toBe('active');
    expect(first.commands).toEqual([{ command: { type: 'train', buildingId: hallId, unitKind: 'worker' }, purpose: 'task' }]);
    expect(first.payments ?? []).toEqual([]);
    const game = createGame(frame.snapshot.map.id, { players: frame.activePlayers });
    restoreSnapshotIntoGame(game, structuredClone(frame.snapshot), frame.nextId);
    game.activePlayers = [...frame.activePlayers];
    issueCommandFrame(game, first.commands.map(entry => ({ command: entry.command, playerId: frame.owner, scriptId: 'strategy.train-worker' })));
    stepGame(game);
    input = { ...input, snapshot: snapshotGame(game), execution: { ...input.execution, state: first.state, phase: first.phase },
      grant: { ...input.grant, commands: [{ id: 'accepted-worker-training', action: input.execution.token, executor: 'strategy.train-worker',
        purpose: 'task', acceptedTick: frame.snapshot.tick, command: first.commands[0]!.command,
        worldBefore: { kind: 'production', buildingId: hallId, jobs: [] } }] } };
    let result = trainWorkerExecutor.execute(input);
    expect(result.phase).toBe('training');
    expect(result.payments).toEqual([{ budgetId: 'budget', amountGold: 75, proof: { kind: 'production', buildingId: hallId,
      jobId: game.buildings.find(building => building.id === hallId)!.queue[0]!.id ?? null,
      acceptedCommandId: 'accepted-worker-training', unitKind: 'worker', queueIndex: 0 } }]);
    expect(trainWorkerExecutor.execute({ ...input, grant: { ...input.grant,
      budgets: input.grant.budgets.map(budget => ({ ...budget, paidGold: 75, state: 'spent' })) } }).payments).toEqual([]);
    const cancelled = structuredClone(input), hall = cancelled.snapshot.buildings.find(building => building.id === hallId)!;
    hall.queue = [];
    const otherBirth = { ...cancelled.snapshot.units.find(unit => unit.owner === frame.owner && unit.kind === 'worker')!,
      id: 'unrelated-new-worker', x: hall.x + 100, y: hall.y };
    cancelled.snapshot.units.push(otherBirth);
    const interrupted = trainWorkerExecutor.execute({ ...cancelled, execution: { ...cancelled.execution, state: result.state } });
    expect(interrupted.status).toBe('blocked');
    expect(interrupted.reasons[0]?.reason).toBe('production-job-ended-before-observed-completion');
    for (let ticks = 0; ticks < 600 && result.status !== 'complete'; ticks += 15) {
      for (let step = 0; step < 15; step++) stepGame(game);
      input = { ...input, snapshot: snapshotGame(game), execution: { ...input.execution, state: result.state, phase: result.phase } };
      result = trainWorkerExecutor.execute(input);
    }
    expect(result).toMatchObject({ status: 'complete', phase: 'worker-trained' });
    expect(game.units.find(unit => unit.id === result.state.createdUnitId)).toMatchObject({ owner: frame.owner, kind: 'worker' });
    expect(result.state.createdShipId).toBeUndefined();
    expect(trainWorkerExecutor.execute(JSON.parse(JSON.stringify(input)))).toEqual(result);
  });

  it('trains exactly one sapphire transport and waits for the native hull birth across a JSON fork', () => {
    const frameId = 'Ne-sapphireArchipelago-player-4-17991', frame = frames[frameId]!;
    let input = request(frameId, 'train-transport', 'building-player-4-shipyard-1410', ['queue:building-player-4-shipyard-1410'], 240);
    const first = trainTransportExecutor.execute(input);
    expect(first.commands).toEqual([{ command: { type: 'train', buildingId: 'building-player-4-shipyard-1410', unitKind: 'transport' }, purpose: 'task' }]);
    expect(first.status).toBe('active');
    expect(first.payments ?? []).toEqual([]);
    const game = createGame(frame.snapshot.map.id, { players: frame.activePlayers });
    restoreSnapshotIntoGame(game, structuredClone(frame.snapshot), frame.nextId);
    game.activePlayers = [...frame.activePlayers];
    issueCommandFrame(game, first.commands.map(entry => ({ command: entry.command, playerId: frame.owner, scriptId: 'strategy.train-transport' })));
    stepGame(game);
    input = { ...input, snapshot: snapshotGame(game), execution: { ...input.execution, state: first.state, phase: first.phase },
      grant: { ...input.grant, commands: [{ id: 'accepted-train', action: input.execution.token, executor: 'strategy.train-transport', purpose: 'task',
        acceptedTick: frame.snapshot.tick, command: first.commands[0]!.command }] } };
    const training = trainTransportExecutor.execute(input);
    expect(training.phase).toBe('training');
    expect(training.commands).toEqual([]);
    expect(training.payments).toEqual([{ budgetId: 'budget', amountGold: 240, proof: { kind: 'production',
      buildingId: 'building-player-4-shipyard-1410', jobId: game.buildings.find(building => building.id === 'building-player-4-shipyard-1410')!.queue[0]!.id ?? null,
      acceptedCommandId: 'accepted-train', unitKind: 'transport', queueIndex: 0 } }]);
    input = { ...input, execution: { ...input.execution, state: training.state, phase: training.phase } };
    const fork: ExecutorInput = JSON.parse(JSON.stringify(input));
    expect(trainTransportExecutor.execute(fork)).toEqual(trainTransportExecutor.execute(input));
    let done = training;
    for (let tick = 0; tick < 600 && done.status !== 'complete'; tick += 15) {
      for (let step = 0; step < 15; step++) stepGame(game);
      input = { ...fork, snapshot: snapshotGame(game), execution: { ...fork.execution, state: done.state, phase: done.phase } };
      done = trainTransportExecutor.execute(input);
    }
    expect(done.reasons).toEqual([]);
    expect(done.status).toBe('complete');
    expect(game.units.some(unit => unit.id === done.state.createdShipId && unit.kind === 'transport' && unit.owner === frame.owner)).toBe(true);
    expect(done.commands).toEqual([]);
  });

  it('does not charge hall capital twice or pretend an off-island worker has arrived', () => {
    const frameId = 'Ne-sapphireArchipelago-player-4-17991';
    const input = request(frameId, 'build-hall', 'gold-satellite-2', ['unit:unit-player-4-worker-1027'], 400);
    const worker = input.snapshot.units.find(unit => unit.id === 'unit-player-4-worker-1027')!;
    expect(sameGround(input.snapshot.map, worker, input.objective.target.point)).toBe(false);
    const result = buildHallExecutor.execute(input);
    expect(result.status).toBe('blocked');
    expect(result.reasons[0]?.reason).toBe('no-granted-construction-worker-on-target-land');
    expect(result.commands).toEqual([]);
    expect(result.progress).toEqual([]);
    const local = request(frameId, 'build-hall', 'gold-satellite-2', ['unit:unit-player-4-worker-3'], 0);
    expect(sameGround(local.snapshot.map, local.snapshot.units.find(unit => unit.id === 'unit-player-4-worker-3')!, local.objective.target.point)).toBe(true);
    expect(buildHallExecutor.execute(local).reasons[0]?.reason).toBe('no-granted-hall-capital');
  });

  it('reports the actual E02 foundation and never mistakes an ongoing repair for a completed hall', () => {
    const input = request('gullIsland-p0-17505', 'build-hall', 'gold-gen-4', ['unit:unit-p0-worker-1'], 0);
    const before = JSON.stringify(input), result = buildHallExecutor.execute(input);
    expect(result.phase).toBe('constructing');
    expect(result.status).toBe('active');
    expect(result.progress).toEqual([{ kind: 'hall-founded', unitIds: [], entityIds: ['building-p0-townHall-9337'], basis: 'observed-world' }]);
    expect(result.commands).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('moves only the four awarded soldiers toward assembly while their hull is being produced', () => {
    const units = [5287, 5642, 5789, 5909].map(id => `unit-player-4-emberRavager-${id}`);
    const input = request('Ne-sapphireArchipelago-player-4-17991', 'borrow-force', 'building-player-4-shipyard-1410', units.map(id => `unit:${id}`), 0);
    const result = assembleExecutor.execute(input);
    expect(result.status).toBe('active');
    expect(result.commands.flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : []).sort()).toEqual(units.sort());
    expect(result.commands.every(entry => entry.command.type === 'move' && entry.command.avoidCombat)).toBe(true);
    expect(result.progress).toEqual([]);
    const fork: ExecutorInput = JSON.parse(JSON.stringify(input));
    setBuildingBodies(fork.snapshot.map, standingBodies(fork.snapshot));
    expect(assembleExecutor.execute(fork)).toEqual(result);
  });

  it('requires reserved hall capital and physical island presence, independently of current cash or borrowed strength', () => {
    const input = request('Ne-sapphireArchipelago-player-4-17991', 'wait-income', 'gold-satellite-2', [], 0);
    expect(input.snapshot.players[input.owner]!.gold).toBe(424);
    expect(waitIncomeExecutor.execute(input).status).toBe('blocked');
    const funded = request('Ne-sapphireArchipelago-player-4-17991', 'wait-income', 'gold-satellite-2', [], 400);
    expect(waitIncomeExecutor.execute(funded).status).toBe('complete');
    const units = [3661, 5287, 5642, 5789, 5909].map(id => `unit:unit-player-4-emberRavager-${id}`);
    const party = request('Ne-sapphireArchipelago-player-4-17991', 'establish-garrison', 'gold-satellite-2', units, 0);
    const result = establishForceExecutor.execute({ ...party, execution: { ...party.execution,
      completionEffects: [{ kind: 'force-present', landId: party.execution.target.landId!, minimumStrength: 3, throughTick: party.snapshot.tick + 2400 }] } });
    expect(result.status).toBe('blocked');
    expect(result.reasons[0]?.reason).toBe('insufficient-reinforcement-force-actually-landed');
    expect(result.progress).toEqual([]);
  });
});
