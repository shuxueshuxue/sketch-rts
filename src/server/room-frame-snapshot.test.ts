import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sim from '../shared/sim';
import * as checksums from '../shared/sim/checksum';
import { replayTraceToTick } from '../shared/replay';
import type { GameSnapshot, ScenarioOverride } from '../shared/types';
import { createRoomHost, type HostedRoomFrameEvent, type HostedRoomLifecycleEvent } from './room-host';

const hostUser = { id: 'snapshot-host', name: 'Host' };

function liveRoom(id: string, options: { autoTick?: boolean; scenario?: ScenarioOverride } = {}) {
  const host = createRoomHost({ autoTick: options.autoTick ?? false });
  const room = host.createRoom({ id, host: hostUser, mapId: 'bareDuel' });
  host.startRoom(room.id);
  const initial = host.resetRoom(room.id, 'bareDuel', {
    aiPlayers: [],
    ...(options.scenario ? { scenario: options.scenario } : {}),
  }).snapshot;
  return { host, roomId: room.id, initial };
}

function moveWorker(snapshot: GameSnapshot) {
  const worker = snapshot.units.find(unit => unit.owner === 'player' && unit.kind === 'worker')!;
  return { type: 'move' as const, unitIds: [worker.id], x: worker.x + 120, y: worker.y };
}

// These spies call the real implementations; the room, simulation, history and
// replay run normally. Count before reading additional public snapshots/hashes.
function snapshotWork() {
  return {
    snapshots: vi.spyOn(sim, 'snapshotGame'),
    hashes: vi.spyOn(checksums, 'checksumGame'),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('hosted frame snapshot consumers', () => {
  it('keeps command history, replay and public copies without building an unobserved frame snapshot', () => {
    const { host, roomId, initial } = liveRoom('snapshot-no-observer');
    host.enableDebugReplay(roomId, { id: 'snapshot-no-observer-replay' });
    const command = moveWorker(initial);
    const work = snapshotWork();

    const result = host.commandTickRoom(roomId, [{ playerId: 'player', command }], 3);

    expect(work.snapshots).toHaveBeenCalledTimes(4); // Three pre-step checkpoints and the independent public result.
    expect(work.hashes).not.toHaveBeenCalled();
    expect(result.snapshot.tick).toBe(3);
    expect(host.framesFrom(roomId, 0)).toEqual([{
      roomId, tick: 0, sequence: 0, commands: [{ playerId: 'player', command }],
    }]);
    const checkpoint = host.checkpointAtOrBefore(roomId, 2)!;
    expect(checkpoint.tick).toBe(2);
    expect(checkpoint.snapshot.units.find(unit => unit.id === command.unitIds[0])?.order).toEqual({ type: 'move', x: command.x, y: command.y });
    const checkpointBeforeMutation = structuredClone(checkpoint.snapshot);
    const expected = host.snapshot(roomId);
    expect(result.snapshot).toEqual(expected);
    expect(result.snapshot).not.toBe(expected);
    result.snapshot.units[0]!.x = -999;
    result.snapshot.players.player.gold = -999;
    checkpoint.snapshot.units[0]!.x = -888;
    checkpoint.snapshot.players.player.gold = -888;
    expect(host.snapshot(roomId)).toEqual(expected);
    expect(host.checkpointAtOrBefore(roomId, 2)?.snapshot).toEqual(checkpointBeforeMutation);
    const replayed = replayTraceToTick(host.readDebugReplay(roomId), 3);
    expect(checksums.checksumGame(replayed)).toBe(host.checksumRoom(roomId));
  });

  it('keeps an authoritative frame result independent while there are no frame listeners', () => {
    const { host, roomId, initial } = liveRoom('snapshot-frame-no-observer');
    host.enableDebugReplay(roomId, { id: 'snapshot-frame-no-observer-replay' });
    const command = moveWorker(initial);
    const frame = { roomId, tick: 0, sequence: 17, commands: [{ playerId: 'player', command }] };
    const work = snapshotWork();

    const result = host.tickRoomFrame(roomId, frame);

    expect(work.snapshots).toHaveBeenCalledTimes(2); // Pre-step checkpoint and public result.
    expect(work.hashes).not.toHaveBeenCalled();
    expect(result.frame).toEqual(frame);
    expect(result.snapshot.tick).toBe(1);
    expect(host.framesFrom(roomId, 0)).toEqual([frame]);
    const expected = host.snapshot(roomId);
    result.snapshot.units[0]!.x = -999;
    expect(host.snapshot(roomId)).toEqual(expected);
    expect(host.checkpointAtOrBefore(roomId, 0)?.snapshot.units[0]?.x).toBe(initial.units[0]?.x);
  });

  it('isolates a listener-mutated frame view from the result, source and next checkpoint', () => {
    const { host, roomId, initial } = liveRoom('snapshot-observer-isolation');
    host.enableDebugReplay(roomId, { id: 'snapshot-observer-isolation-replay' });
    const command = moveWorker(initial);
    let observed: HostedRoomFrameEvent | undefined;
    let pristine: GameSnapshot | undefined;
    const unsubscribe = host.observeRoomFrames(roomId, event => {
      observed = event;
      pristine = structuredClone(event.snapshot);
      const worker = event.snapshot.units.find(unit => unit.id === command.unitIds[0])!;
      worker.x = -777;
      if (worker.order.type === 'move') worker.order.x = -777;
      event.snapshot.players.player.gold = -777;
      event.snapshot.tick = 777;
    });
    const work = snapshotWork();

    const result = host.tickRoomFrame(roomId, { roomId, tick: 0, sequence: 0, commands: [{ playerId: 'player', command }] });

    expect(work.snapshots).toHaveBeenCalledTimes(3); // Checkpoint, observed view and independent public result.
    expect(work.hashes).toHaveBeenCalledTimes(1);
    expect(observed).toBeDefined();
    expect(result.snapshot).not.toBe(observed!.snapshot);
    expect(result.snapshot.units).not.toBe(observed!.snapshot.units);
    expect(result.snapshot).toEqual(pristine);
    expect(host.snapshot(roomId)).toEqual(pristine);
    expect(host.checksumRoom(roomId)).toBe(observed!.checksum);
    expect(checksums.checksumGame(replayTraceToTick(host.readDebugReplay(roomId), 1))).toBe(observed!.checksum);

    unsubscribe();
    work.snapshots.mockClear();
    work.hashes.mockClear();
    const next = host.tickRoomFrame(roomId, { roomId, tick: 1, sequence: 1, commands: [] });
    expect(work.snapshots).toHaveBeenCalledTimes(2);
    expect(work.hashes).not.toHaveBeenCalled();
    expect(next.snapshot.tick).toBe(2);
    expect(host.checkpointAtOrBefore(roomId, 1)?.snapshot).toEqual(JSON.parse(JSON.stringify(pristine)));
  });

  it('advances an unobserved auto-tick room with only the retained pre-step snapshots', () => {
    const { host, roomId, initial } = liveRoom('snapshot-auto-no-observer', { autoTick: true });
    host.commandRoom(roomId, 'player', moveWorker(initial));
    host.enableDebugReplay(roomId, { id: 'snapshot-auto-no-observer-replay' });
    const work = snapshotWork();

    const changed = host.tickActiveRooms(3);

    expect(work.snapshots).toHaveBeenCalledTimes(3);
    expect(work.hashes).not.toHaveBeenCalled();
    expect(changed.map(room => room.id)).toEqual([roomId]);
    expect(host.currentTick(roomId)).toBe(4);
    // With no later command frame, replay retains its initial sparse checkpoint.
    expect(host.checkpointAtOrBefore(roomId, 3)?.snapshot.tick).toBe(1);
    expect(checksums.checksumGame(replayTraceToTick(host.readDebugReplay(roomId), 4))).toBe(host.checksumRoom(roomId));
  });

  it('publishes a real terminal frame before lifecycle cleanup and preserves its terminal checkpoint', () => {
    const { host, roomId } = liveRoom('snapshot-terminal-observer', { scenario: {
      replaceDefaultUnits: true,
      replaceDefaultBuildings: true,
      addBuildings: [
        { id: 'snapshot-own-hall', owner: 'player', kind: 'townHall', x: 500, y: 500 },
        { id: 'snapshot-enemy-hall', owner: 'enemy', kind: 'townHall', x: 1300, y: 1000, hp: 1 },
      ],
      addUnits: [{ id: 'snapshot-finisher', owner: 'player', kind: 'footman', x: 1220, y: 1000 }],
    } });
    host.enableDebugReplay(roomId, { id: 'snapshot-terminal-observer-replay' });
    const order: string[] = [];
    let frameEvent: HostedRoomFrameEvent | undefined;
    let terminalBeforeMutation: GameSnapshot | undefined;
    let lifecycleEvent: HostedRoomLifecycleEvent | undefined;
    host.observeRoomFrames(roomId, event => {
      order.push('frame');
      frameEvent = event;
      terminalBeforeMutation = structuredClone(event.snapshot);
      event.snapshot.units[0]!.x = -777;
      event.snapshot.match.winner = 'enemy';
      event.snapshot.tick = 777;
    });
    host.observeRoomLifecycle(roomId, event => {
      order.push('lifecycle');
      lifecycleEvent = event;
    });
    const work = snapshotWork();

    const result = host.tickRoomFrame(roomId, { roomId, tick: 0, sequence: 0, commands: [{
      playerId: 'player', command: { type: 'attack', unitIds: ['snapshot-finisher'], targetId: 'snapshot-enemy-hall' },
    }] });

    expect(work.snapshots).toHaveBeenCalledTimes(4); // Pre-step, finish/event view, terminal checkpoint and public result.
    expect(work.hashes).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['frame', 'lifecycle']);
    expect(result.room.status).toBe('ended');
    expect(result.room.result).toMatchObject({ winner: 'player', endedAtTick: 1 });
    expect(frameEvent?.room.status).toBe('ended');
    expect(lifecycleEvent?.room).toBe(result.room);
    expect(result.snapshot).toEqual(terminalBeforeMutation);
    expect(result.snapshot).not.toBe(frameEvent!.snapshot);
    expect(result.snapshot.buildings.some(building => building.id === 'snapshot-enemy-hall')).toBe(false);
    const checkpoint = host.checkpointAtOrBefore(roomId, 1)!;
    expect(checkpoint.tick).toBe(1);
    expect(checkpoint.snapshot).toEqual(JSON.parse(JSON.stringify(terminalBeforeMutation)));
    checkpoint.snapshot.match.winner = 'enemy';
    checkpoint.snapshot.units[0]!.x = -888;
    expect(host.checkpointAtOrBefore(roomId, 1)?.snapshot).toEqual(JSON.parse(JSON.stringify(terminalBeforeMutation)));
    expect(checksums.checksumGame(replayTraceToTick(host.readDebugReplay(roomId), 1))).toBe(frameEvent!.checksum);
    expect(() => host.currentTick(roomId)).toThrow(`Room ${roomId} is not in a live match`);
  });
});
