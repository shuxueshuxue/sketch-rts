import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { connectedSurfacePath } from '../../shared/connected-decks';
import { localToWorld, worldToLocal } from '../../shared/ship-geometry';
import { clearTransferLanes } from '../policy/transfer-lanes';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { shipNeedsRepair } from '../../shared/ship-equipment';
import { planAiOwnerCommandEntries } from '../planner-context';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';

const fixture = () => JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/service-native-reroute-28800.json.gz', import.meta.url))).toString()) as {
  provenance: { classification: string }; snapshot: GameSnapshot; nextId: number; memories: { p0: AiPolicyMemory; p1: AiPolicyMemory };
};

it('uses an actually reachable yield that lets the real28800 engineer replan around its previous ideal route', () => {
  const saved = fixture(), snapshot = saved.snapshot, before = JSON.stringify(snapshot);
  expect(saved.provenance.classification).toContain('Actual ordinary bootstrapGame opening');
  const worker = snapshot.units.find(unit => unit.id === 'unit-p0-worker-1713')!, horse = snapshot.units.find(unit => unit.id === 'unit-p0-horseArcher-2297')!;
  const target = snapshot.units.find(unit => unit.id === 'unit-p0-cutter-1174')!;
  expect(connectedSurfacePath(worker, target, snapshot.units, snapshot.map)?.complete).toBe(false);
  const commands = clearTransferLanes(snapshot, 'p0'), yieldOrder = commands.find(command => command.type === 'move' && command.unitIds.includes(horse.id));
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(yieldOrder).toBeDefined();
  if (yieldOrder?.type !== 'move') throw new Error('Expected the public horse yield');
  expect(connectedSurfacePath(horse, yieldOrder, snapshot.units, snapshot.map)?.complete).toBe(true);
  const moved = { ...horse, x: yieldOrder.x, y: yieldOrder.y, deck: { shipId: target.id, ...worldToLocal(target, yieldOrder) } };
  const units = snapshot.units.map(unit => unit.id === horse.id ? moved : unit);
  expect(connectedSurfacePath(worker, target, units, snapshot.map)?.complete).toBe(true);
  expect(localToWorld(target, moved.deck)).toEqual({ x: yieldOrder.x, y: yieldOrder.y });
});

it('preserves the real queued service across the yielding body transiently filling the cutter and completes native repair with JSON restoration', () => {
  const saved = fixture(), load = () => {
    const checkpoint = JSON.parse(JSON.stringify(saved)), game = createGame('bareDuel');
    restoreSnapshotIntoGame(game, checkpoint.snapshot, checkpoint.nextId);
    return { game, memories: checkpoint.memories };
  };
  const branches = [load(), load()], workerId = 'unit-p0-worker-1713', targetId = 'unit-p0-cutter-1174', sourceId = 'unit-p0-warship-1127';
  const target = branches[0]!.game.units.find(unit => unit.id === targetId)!, worker = branches[0]!.game.units.find(unit => unit.id === workerId)!;
  const initialLost = saved.snapshot.match.stats.unitsLost.p0, originalHulls = saved.snapshot.units.filter(unit => [sourceId, targetId].includes(unit.id));
  let completed = false, waitingRestored = false, crossed = false;
  for (let tick = 0; tick < 300; tick++) {
    const plans = [];
    for (const { game, memories } of branches) {
      if (game.tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version: 'v9_archer', memory: memories.p0 }, { teams: game.teams });
        plans.push(entries); for (const entry of entries) issuePlayerCommand(game, 'p0', entry.command);
      }
      stepGame(game);
    }
    if (plans.length) for (const plan of plans.slice(1)) expect(plan).toEqual(plans[0]);
    if (!waitingRestored && worker.order.type === 'follow') {
      expect(worker.order.targetId).toBe(sourceId);
      expect(worker.orderQueue).toEqual([{ type: 'board', transportId: targetId }]);
      const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(branches[0]!.game), nextId: branches[0]!.game.nextId, memories: branches[0]!.memories }));
      const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, checkpoint.snapshot, checkpoint.nextId);
      branches.push({ game, memories: checkpoint.memories }); waitingRestored = true;
    }
    if (worker.deck?.shipId === targetId) crossed = true;
    if (!crossed) for (const original of originalHulls) {
      const hull = branches[0]!.game.units.find(unit => unit.id === original.id)!;
      expect(hull.x).toBeCloseTo(original.x, 8); expect(hull.y).toBeCloseTo(original.y, 8);
      expect(hull.sailing!.heading).toBeCloseTo(original.sailing!.heading, 8);
    }
    if (tick % 15 === 0) for (const branch of branches.slice(1)) {
      expect(snapshotGame(branch.game)).toEqual(snapshotGame(branches[0]!.game));
      expect(branch.game.nextId).toBe(branches[0]!.game.nextId); expect(branch.memories).toEqual(branches[0]!.memories);
    }
    if (worker.deck?.shipId === targetId && !shipNeedsRepair(branches[0]!.game, target)) { completed = true; break; }
  }
  expect(completed).toBe(true); expect(waitingRestored).toBe(true); expect(crossed).toBe(true);
  expect(worker.order.type).toBe('idle'); expect(target.hp).toBe(target.maxHp);
  for (const branch of branches) {
    expect(branch.game.match.stats.unitsLost.p0).toBe(initialLost);
    expect(snapshotGame(branch.game)).toEqual(snapshotGame(branches[0]!.game));
    expect(branch.game.nextId).toBe(branches[0]!.game.nextId); expect(branch.memories).toEqual(branches[0]!.memories);
  }
}, 60000);
