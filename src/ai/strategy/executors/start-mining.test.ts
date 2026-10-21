import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../../sdk/scene';
import { issueCommandFrame } from '../../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../../shared/sim';
import { standingBodies } from '../../../shared/structure-bodies';
import { setBuildingBodies } from '../../../shared/terrain';
import type { GameSnapshot } from '../../../shared/types';
import type { ExecutorInput } from '../allocation-types';
import { startMiningExecutor } from './start-mining';

function request(snapshot: GameSnapshot, owner: string, mineId: string, unitIds: string[]): ExecutorInput {
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const mine = snapshot.resources.find(mine => mine.id === mineId)!;
  const objectiveId = `ConquerIsland:${owner}:${mineId}`, methodId = `${objectiveId}/method`, token = { actionId: `${methodId}/start-mining`, generation: 1 };
  const target = { entityId: mine.id, point: { x: mine.x, y: mine.y } };
  return { snapshot, owner, objective: { id: objectiveId, kind: 'ConquerIsland', owner, target, effects: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'active', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [methodId],
    stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } },
    method: { id: methodId, objectiveId, kind: 'staged-beachhead', preconditions: [], subgoals: [], demands: [], estimatedTicks: null, status: 'selected', reasons: [] },
    execution: { token, objectiveId, methodId, executor: 'strategy.start-mining', intent: { kind: 'start-mining' }, target,
      dependsOn: [], completionEffects: [], status: 'active', phase: 'ready', sinceTick: snapshot.tick, lastProgressTick: snapshot.tick, state: {} },
    grant: { revision: 1, action: token, objectiveId, methodId, assignments: [], budgets: [], voyages: [], orders: [], commands: [], orderOverrides: [],
      leases: unitIds.map(id => ({ id: `lease:${id}`, resourceKey: `unit:${id}`, objectiveId, methodId, action: token,
        sinceTick: snapshot.tick, minimumStayUntilTick: snapshot.tick, origin: 'allocator', incumbentTask: null })) }, events: [] };
}

describe('allocated native mining handoff', () => {
  it('waits for actual gathering, commands only its named worker and survives a JSON fork', () => {
    const game = sketchScene('allocated-mining-start').map('bareDuel').replaceDefaults()
      .player('us', { team: 'a' }).player('foe', { team: 'b' })
      .goldMine('mine', 1400, 1400, 10000).building('us', 'townHall', 1616, 1400)
      .building('foe', 'townHall', 3000, 3000)
      .worker('us', 1552, 1400, { id: 'builder' }).worker('us', 1552, 1450, { id: 'ungranted' }).build().createGame();
    let input = request(snapshotGame(game), 'us', 'mine', ['builder']);
    const before = JSON.stringify(input), first = startMiningExecutor.execute(input);
    expect(first.status).toBe('active');
    expect(first.progress).toEqual([]);
    expect(first.commands).toEqual([{ command: { type: 'mine', unitIds: ['builder'], resourceId: 'mine' }, purpose: 'task' }]);
    expect(JSON.stringify(input)).toBe(before);
    issueCommandFrame(game, first.commands.map(proposal => ({ command: proposal.command, playerId: 'us', scriptId: 'strategy.start-mining' })));
    input = { ...input, snapshot: snapshotGame(game) };
    const accepted = startMiningExecutor.execute(input);
    expect(accepted.status).toBe('active');
    expect(accepted.progress).toEqual([]);
    expect(accepted.commands).toEqual([]);
    let result = accepted;
    for (let ticks = 0; ticks < 400 && result.status !== 'complete'; ticks++) {
      stepGame(game);
      input = { ...input, snapshot: snapshotGame(game), execution: { ...input.execution, state: result.state, phase: result.phase } };
      result = startMiningExecutor.execute(input);
    }
    expect(result).toMatchObject({ status: 'complete', phase: 'mining-started' });
    expect(result.progress).toEqual([{ kind: 'mining-started', unitIds: ['builder'],
      entityIds: ['mine', game.buildings.find(building => building.owner === 'us')!.id], basis: 'observed-world' }]);
    expect(game.units.find(unit => unit.id === 'ungranted')!.order.type).toBe('idle');
    expect(startMiningExecutor.execute(JSON.parse(JSON.stringify(input)))).toEqual(result);
  });

  it('does not call the unfinished E02 island hall income or recruit its other workers', () => {
    const frame = JSON.parse(gunzipSync(readFileSync(new URL('../../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString())
      .frames['gullIsland-p0-17505'];
    const input = request(frame.snapshot, frame.owner, 'gold-gen-4', ['unit-p0-worker-1']);
    const result = startMiningExecutor.execute(input);
    expect(result.status).toBe('blocked');
    expect(result.reasons[0]?.reason).toBe('mining-hall-not-yet-complete');
    expect(result.commands).toEqual([]);
    expect(result.progress).toEqual([]);
  });
});
