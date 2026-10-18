import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sim from '../shared/sim';
import * as checksums from '../shared/sim/checksum';
import { replayTraceToTick } from '../shared/replay';
import type { GameSnapshot, ScenarioOverride } from '../shared/types';
import { createRoomHost, type HostedRoomFrameEvent, type HostedRoomLifecycleEvent } from './room-host';
import { ROOM_CHECKPOINT_INTERVAL_TICKS } from './room-history';
import { LOCKSTEP_CHECKSUM_EVERY_TICKS } from '../shared/net/cadence';

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
  it('keeps a checkpoint on its interval, replay and public copies without building an unobserved frame snapshot', () => {
    const { host, roomId, initial } = liveRoom('snapshot-no-observer');
    host.enableDebugReplay(roomId, { id: 'snapshot-no-observer-replay' });
    const command = moveWorker(initial);
    const work = snapshotWork();
    const ticks = ROOM_CHECKPOINT_INTERVAL_TICKS + 1;

    const result = host.commandTickRoom(roomId, [{ playerId: 'player', command }], ticks);

    // Pre-step checkpoints on ticks 0 and the interval, and the independent public result; nothing on the ticks between.
    expect(work.snapshots).toHaveBeenCalledTimes(3);
    expect(work.hashes).not.toHaveBeenCalled();
    expect(result.snapshot.tick).toBe(ticks);
    // Every tick is a frame (see @@@hosted-every-tick); only the first carries the command.
    expect(host.framesFrom(roomId, 0)).toEqual(Array.from({ length: ticks }, (_, tick) => ({
      roomId, tick, sequence: tick, commands: tick === 0 ? [{ playerId: 'player', command }] : [],
    })));
    expect(host.checkpointAtOrBefore(roomId, ROOM_CHECKPOINT_INTERVAL_TICKS - 1)!.tick).toBe(0);
    const checkpoint = host.checkpointAtOrBefore(roomId, ROOM_CHECKPOINT_INTERVAL_TICKS)!;
    expect(checkpoint.tick).toBe(ROOM_CHECKPOINT_INTERVAL_TICKS);
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
    expect(host.checkpointAtOrBefore(roomId, ROOM_CHECKPOINT_INTERVAL_TICKS)?.snapshot).toEqual(checkpointBeforeMutation);
    const replayed = replayTraceToTick(host.readDebugReplay(roomId), ticks);
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

  it('hands frame listeners the tick, and the world checksum only on the lockstep cadence', () => {
    const { host, roomId, initial } = liveRoom('snapshot-observer-cadence');
    host.enableDebugReplay(roomId, { id: 'snapshot-observer-cadence-replay' });
    const command = moveWorker(initial);
    const events: HostedRoomFrameEvent[] = [];
    const unsubscribe = host.observeRoomFrames(roomId, event => events.push(event));
    const work = snapshotWork();

    const first = host.tickRoomFrame(roomId, { roomId, tick: 0, sequence: 0, commands: [{ playerId: 'player', command }] });

    expect(work.snapshots).toHaveBeenCalledTimes(2); // Pre-step checkpoint (tick 0) and the public result; no listener copy.
    expect(work.hashes).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ tick: 1, frame: first.frame })]);
    expect(events[0]).not.toHaveProperty('checksum');

    for (let tick = 1; tick < LOCKSTEP_CHECKSUM_EVERY_TICKS; tick += 1) host.tickRoomFrame(roomId, { roomId, tick, sequence: tick, commands: [] });
    unsubscribe();

    const hashed = events.filter(event => event.checksum !== undefined);
    expect(events.map(event => event.tick)).toEqual(Array.from({ length: LOCKSTEP_CHECKSUM_EVERY_TICKS }, (_, index) => index + 1));
    expect(hashed.map(event => event.tick)).toEqual([LOCKSTEP_CHECKSUM_EVERY_TICKS]);
    expect(hashed[0]!.checksum).toBe(host.checksumRoom(roomId));
    expect(checksums.checksumGame(replayTraceToTick(host.readDebugReplay(roomId), LOCKSTEP_CHECKSUM_EVERY_TICKS))).toBe(hashed[0]!.checksum);
  });

  it('advances an unobserved auto-tick room with only the retained pre-step snapshots', () => {
    const { host, roomId, initial } = liveRoom('snapshot-auto-no-observer', { autoTick: true });
    host.commandRoom(roomId, 'player', moveWorker(initial));
    host.enableDebugReplay(roomId, { id: 'snapshot-auto-no-observer-replay' });
    const work = snapshotWork();

    const changed = host.tickActiveRooms(3);

    // Only the replay's own sparse checkpoint at its first tick; the ticks between keep none.
    expect(work.snapshots).toHaveBeenCalledTimes(1);
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
    let lifecycleEvent: HostedRoomLifecycleEvent | undefined;
    host.observeRoomFrames(roomId, event => {
      order.push('frame');
      frameEvent = event;
    });
    host.observeRoomLifecycle(roomId, event => {
      order.push('lifecycle');
      lifecycleEvent = event;
    });
    const work = snapshotWork();

    const result = host.tickRoomFrame(roomId, { roomId, tick: 0, sequence: 0, commands: [{
      playerId: 'player', command: { type: 'attack', unitIds: ['snapshot-finisher'], targetId: 'snapshot-enemy-hall' },
    }] });

    expect(work.snapshots).toHaveBeenCalledTimes(4); // Pre-step, finish, terminal checkpoint and public result.
    expect(work.hashes).toHaveBeenCalledTimes(1); // The last frame is hashed whatever its tick.
    expect(order).toEqual(['frame', 'lifecycle']);
    expect(result.room.status).toBe('ended');
    expect(result.room.result).toMatchObject({ winner: 'player', endedAtTick: 1 });
    expect(frameEvent?.room.status).toBe('ended');
    expect(frameEvent?.tick).toBe(1);
    expect(lifecycleEvent?.room).toBe(result.room);
    const terminalBeforeMutation = structuredClone(result.snapshot);
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
