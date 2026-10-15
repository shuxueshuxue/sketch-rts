import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { deckWalkPathExists } from '../../shared/decks';
import { worldToLocal } from '../../shared/ship-geometry';
import { shipNeedsRepair } from '../../shared/ship-equipment';
import { planAiOwnerCommandEntries } from '../planner-context';
import { clearTransferLanes, pendingDeckBoarding } from '../policy/transfer-lanes';

const cases = [
  { label: 'actual ordinary 39600', path: '../../shared/sim/fixtures/ordinary-service-yaw-39600.json.gz' },
  { label: 'yaw-only diagnostic 41400 with an unreachable saved priest yield', path: './fixtures/service-yaw-only-41400.json.gz' },
];

it.each(cases)('completes the real service crossing and repair from $label using public orders and JSON restoration', ({ path }) => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(path, import.meta.url))).toString());
  const load = () => {
    const checkpoint = JSON.parse(JSON.stringify(saved)), game = createGame('bareDuel');
    restoreSnapshotIntoGame(game, checkpoint.snapshot, checkpoint.nextId);
    return { game, memories: checkpoint.memories };
  };
  const branches = [load(), load()], initialLost = saved.snapshot.match.stats.unitsLost.p0;
  const originals = saved.snapshot.units.filter((unit: { id: string }) => ['unit-p0-warship-1064', 'unit-p0-warship-1127'].includes(unit.id));
  const workerId = 'unit-p0-worker-1833', targetId = 'unit-p0-warship-1127';
  const target = branches[0]!.game.units.find(unit => unit.id === targetId)!, worker = branches[0]!.game.units.find(unit => unit.id === workerId)!;
  expect(worker.deck?.shipId).toBe('unit-p0-warship-1064'); expect(shipNeedsRepair(branches[0]!.game, target)).toBe(true);
  let completed = false, waitingRestored = false;
  for (let tick = 0; tick < 600; tick++) {
    const plans = [];
    for (const { game, memories } of branches) {
      if (game.tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version: 'v9_archer', memory: memories.p0 }, { teams: game.teams });
        plans.push(entries);
        for (const entry of entries) issuePlayerCommand(game, 'p0', entry.command);
      }
      stepGame(game);
    }
    if (plans.length) for (const plan of plans.slice(1)) expect(plan).toEqual(plans[0]);
    if (!waitingRestored && worker.order.type === 'follow' && pendingDeckBoarding(worker)) {
      const checkpoint = JSON.parse(JSON.stringify({ snapshot: snapshotGame(branches[0]!.game), nextId: branches[0]!.game.nextId, memories: branches[0]!.memories }));
      const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, checkpoint.snapshot, checkpoint.nextId);
      branches.push({ game, memories: checkpoint.memories }); waitingRestored = true;
    }
    if (tick % 30 === 0) {
      expect(snapshotGame(branches[1]!.game)).toEqual(snapshotGame(branches[0]!.game));
      expect(branches[1]!.game.nextId).toBe(branches[0]!.game.nextId);
      expect(branches[1]!.memories).toEqual(branches[0]!.memories);
    }
    if (worker.deck?.shipId === targetId && !shipNeedsRepair(branches[0]!.game, target)) { completed = true; break; }
  }
  expect(completed).toBe(true);
  if (saved.snapshot.tick === 39600) expect(waitingRestored).toBe(true);
  expect(target.shipParts!.cabin).toBe(186); expect(worker.order.type).toBe('idle');
  for (const { game } of branches) {
    expect(game.match.stats.unitsLost.p0).toBe(initialLost);
    for (const original of originals) {
      const boat = game.units.find(unit => unit.id === original.id)!;
      expect(boat.x).toBeCloseTo(original.x, 8); expect(boat.y).toBeCloseTo(original.y, 8);
      expect(boat.sailing!.heading).toBeCloseTo(original.sailing.heading, 8);
    }
  }
  for (const branch of branches.slice(1)) {
    expect(snapshotGame(branch.game)).toEqual(snapshotGame(branches[0]!.game));
    expect(branch.game.nextId).toBe(branches[0]!.game.nextId); expect(branch.memories).toEqual(branches[0]!.memories);
  }
}, 60000);

it('does not reuse a saved priest yield whose actual live deck path is blocked', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/service-yaw-only-41400.json.gz', import.meta.url))).toString());
  const snapshot = saved.snapshot, priest = snapshot.units.find((unit: { id: string }) => unit.id === 'unit-p0-priest-1901');
  const ship = snapshot.units.find((unit: { id: string }) => unit.id === priest.deck.shipId);
  expect(deckWalkPathExists(ship, priest, worldToLocal(ship, priest.order), snapshot.units)).toBe(false);
  const before = JSON.stringify(snapshot), commands = clearTransferLanes(snapshot, 'p0');
  expect(JSON.stringify(snapshot)).toBe(before);
  // The original controller already has this retreat/hold/queued-board
  // sequence; workers wait with legal follow because public hold ignores them.
  expect(commands).toContainEqual(expect.objectContaining({ type: 'move', unitIds: ['unit-p0-worker-1833'] }));
  expect(commands).toContainEqual({ type: 'follow', unitIds: ['unit-p0-worker-1833'], targetId: 'unit-p0-warship-1064', queued: true });
  expect(commands).toContainEqual({ type: 'board', unitIds: ['unit-p0-worker-1833'], transportId: 'unit-p0-warship-1127', queued: true });
});


it('recognizes only an own-deck worker follow with a saved boarding task as transfer waiting', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/service-yaw-only-41400.json.gz', import.meta.url))).toString());
  const worker = saved.snapshot.units.find((unit: { id: string }) => unit.id === 'unit-p0-worker-1833');
  const boarding = { type: 'board' as const, transportId: 'unit-p0-warship-1127' };
  worker.order = { type: 'follow', targetId: worker.deck.shipId }; worker.orderQueue = [boarding];
  expect(pendingDeckBoarding(worker)).toEqual(boarding);
  expect(pendingDeckBoarding({ ...worker, orderQueue: [] })).toBeUndefined();
  expect(pendingDeckBoarding({ ...worker, order: { type: 'follow', targetId: 'ordinary-formation-or-healer' } })).toBeUndefined();
  expect(pendingDeckBoarding({ ...worker, kind: 'footman' })).toBeUndefined();
  expect(pendingDeckBoarding({ ...worker, deck: { ...worker.deck, shipId: 'another-ship' } })).toBeUndefined();
});
