import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { setBuildingBodies } from '../../../shared/terrain';
import { standingBodies } from '../../../shared/structure-bodies';
import type { GameSnapshot } from '../../../shared/types';
import { neutralCamps } from '../../policy/v7/creep';
import type { ExecutorInput } from '../allocation-types';
import { clearCampExecutor } from './clear-camp';

function clearing(snapshot: GameSnapshot, owner: string, mineId: string, unitIds: string[], memberIds: string[], refuge?: { x: number; y: number }): ExecutorInput {
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const mine = snapshot.resources.find(mine => mine.id === mineId)!;
  const objectiveId = `ConquerIsland:${owner}:${mineId}`, methodId = `${objectiveId}/method:staged-beachhead`;
  const token = { actionId: `${methodId}/clear`, generation: 1 }, target = { entityId: mineId, point: { x: mine.x, y: mine.y } };
  return { snapshot, owner, objective: { id: objectiveId, kind: 'ConquerIsland', owner, target, effects: [],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 },
    status: 'active', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [methodId],
    stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } },
    method: { id: methodId, objectiveId, kind: 'staged-beachhead', preconditions: [], subgoals: [], demands: [], estimatedTicks: null, status: 'selected', reasons: [] },
    execution: { token, objectiveId, methodId, executor: 'strategy.clear-camp', intent: { kind: 'clear-camp', memberIds },
      target, dependsOn: [], completionEffects: [], status: 'active', phase: 'gather', sinceTick: snapshot.tick,
      lastProgressTick: snapshot.tick, state: refuge ? { refuge } : {} },
    grant: { revision: 1, action: token, objectiveId, methodId,
      leases: unitIds.map(id => ({ id: `lease:${id}`, resourceKey: `unit:${id}`, objectiveId, methodId, action: token,
        sinceTick: snapshot.tick, minimumStayUntilTick: snapshot.tick, origin: 'allocator', incumbentTask: null })),
      assignments: [], budgets: [], voyages: [], orders: [], commands: [], orderOverrides: [] }, events: [] };
}

describe('allocated island clearing', () => {
  it('does not let the lone sapphire soldier charge while four borrowed soldiers are still on another island', () => {
    const frame: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
      new URL('../../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['Ne-sapphireArchipelago-player-4-17991'];
    const mine = frame.snapshot.resources.find(mine => mine.id === 'gold-satellite-2')!;
    const camp = neutralCamps(frame.snapshot).sort((a, b) => Math.hypot(a.center.x - mine.x, a.center.y - mine.y)
      - Math.hypot(b.center.x - mine.x, b.center.y - mine.y))[0]!;
    const ids = [3661, 5287, 5642, 5789, 5909].map(id => `unit-player-4-emberRavager-${id}`);
    const request = clearing(frame.snapshot, frame.owner, mine.id, ids, camp.creeps.map(creep => creep.id));
    const result = clearCampExecutor.execute(request);
    expect(result.status).toBe('blocked');
    expect(result.reasons[0]?.reason).toBe('insufficient-clearing-force');
    expect(result.commands).toEqual([]);
    expect(result.reasons[0]?.unitIds).toEqual(['unit-player-4-emberRavager-3661']);
  });

  it('reports the broken-sea approach geometry separately from its sufficient six-unit camp force', () => {
    const frame = JSON.parse(gunzipSync(readFileSync(new URL('../../bootstrap_1/fixtures/executor-broken-sea-9585.json.gz', import.meta.url))).toString());
    const snapshot = frame.snapshot as GameSnapshot;
    const camp = neutralCamps(snapshot).find(camp => camp.creeps.some(creep => creep.id === 'guard-0-0'))!;
    const ids = snapshot.units.filter(unit => unit.owner === 'p0' && unit.kind === 'emberRavager').map(unit => unit.id);
    const request = clearing(snapshot, 'p0', 'gold-mainland-0', ids, camp.creeps.map(creep => creep.id), frame.beforeMemory.naval.conquests['gold-mainland-0'].landing);
    const before = JSON.stringify(request), result = clearCampExecutor.execute(request);
    expect(result.status).toBe('blocked');
    expect(result.reasons[0]?.reason).toBe('clearing-geometry-blocked');
    expect(result.commands).toEqual([]);
    expect(JSON.stringify(request)).toBe(before);
  });
});
