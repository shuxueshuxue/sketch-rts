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

type Frame = { snapshot: GameSnapshot; owner: string; nextId: number; activePlayers: string[] };
const frames: Record<string, Frame> = JSON.parse(gunzipSync(readFileSync(
  new URL('../../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames;
function request(frameId: string, kind: ActionIntent['kind'], targetId: string, resources: string[], gold: number): ExecutorInput {
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
    execution: { token, objectiveId, methodId, executor: `strategy.${kind}`, intent: { kind: kind as 'train-transport' | 'build-hall' },
      target, dependsOn: [], completionEffects: [], status: 'active', phase: 'ready', sinceTick: snapshot.tick, lastProgressTick: snapshot.tick, state: {} },
    grant: { revision: 1, action: token, objectiveId, methodId, assignments: [], voyages: [], orders: [], commands: [], orderOverrides: [],
      leases: resources.map(resourceKey => ({ id: `lease:${resourceKey}`, resourceKey: resourceKey as `unit:${string}` | `queue:${string}`,
        objectiveId, methodId, action: token, sinceTick: snapshot.tick, minimumStayUntilTick: snapshot.tick, origin: 'allocator', incumbentTask: null })),
      budgets: gold ? [{ id: 'budget', spendId: `${objectiveId}/${kind}`, objectiveId, methodId, action: token, amountGold: gold, paidGold: 0,
        state: 'reserved', sinceTick: snapshot.tick, releasedTick: null, includedUtilityTermCodes: [], externalReservationIds: [] }] : [] }, events: [] };
}

describe('allocated construction in native event frames', () => {
  it('trains exactly one sapphire transport and waits for the native hull birth across a JSON fork', () => {
    const frameId = 'Ne-sapphireArchipelago-player-4-17991', frame = frames[frameId]!;
    let input = request(frameId, 'train-transport', 'building-player-4-shipyard-1410', ['queue:building-player-4-shipyard-1410'], 240);
    const first = trainTransportExecutor.execute(input);
    expect(first.commands).toEqual([{ command: { type: 'train', buildingId: 'building-player-4-shipyard-1410', unitKind: 'transport' }, purpose: 'task' }]);
    expect(first.status).toBe('active');
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
});
