import { describe, expect, it, vi } from 'vitest';
import { decodeServerNetMessage, encodeNetMessage } from '../shared/net/codec';
import type { ServerNetMessage } from '../shared/net/types';
import { createRoomHost } from './room-host';
import { RoomNetHub, type RoomNetSocket } from './room-net';

class Socket implements RoomNetSocket {
  sent: string[] = [];
  private receive: ((raw: string) => void) | undefined;
  send(raw: string): void { this.sent.push(raw); }
  on(event: 'message' | 'close', handler: ((raw: string) => void) | (() => void)): void {
    if (event === 'message') this.receive = handler as (raw: string) => void;
  }
  emit(raw: string): void { this.receive?.(raw); }
  messages(): ServerNetMessage[] { return this.sent.map(decodeServerNetMessage); }
}

describe('live room scalar tick reads', () => {
  it('uses the same live-room validation and follows stepping, reset and save restoration', () => {
    const host = createRoomHost({ autoTick: false });
    expect(() => host.currentTick('missing')).toThrow('Unknown room missing');
    const room = host.createRoom({ id: 'scalar-tick', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' });
    expect(() => host.currentTick(room.id)).toThrow(`Room ${room.id} is not in a live match`);
    host.startRoom(room.id);
    expect(host.currentTick(room.id)).toBe(0);
    host.tickRoom(room.id, 3);
    expect(host.currentTick(room.id)).toBe(host.snapshot(room.id).tick);
    const saved = host.saveRoom(room.id, { id: 'saved-tick' });
    host.tickRoom(room.id, 1);
    expect(host.currentTick(room.id)).toBe(4);
    host.closeRoom(room.id, 'host');
    host.continueSave(saved.id);
    expect(host.currentTick(room.id)).toBe(3);
    host.resetRoom(room.id, 'bareDuel', { aiPlayers: [] });
    expect(host.currentTick(room.id)).toBe(0);
    host.closeRoom(room.id, 'host');
    expect(() => host.currentTick(room.id)).toThrow(`Unknown room ${room.id}`);
  });

  it('joins, schedules commands, ticks and reports checkpoint fallback time without requesting unused world snapshots', () => {
    const host = createRoomHost({ autoTick: false });
    const room = host.createRoom({ id: 'scalar-net', host: { id: 'host', name: 'Host' }, mapId: 'bareDuel' });
    host.startRoom(room.id);
    const worker = host.snapshot(room.id).units.find(unit => unit.owner === 'player' && unit.kind === 'worker')!;
    const publicSnapshot = vi.spyOn(host, 'snapshot').mockImplementation(() => { throw new Error('Unexpected whole-world tick read'); });
    try {
      const hub = new RoomNetHub({ roomHost: host, commandDelayTicks: 2 }), socket = new Socket();
      hub.connect(room.id, socket);
      socket.emit(encodeNetMessage({ type: 'join', roomId: room.id, playerId: 'player' }));
      const command = { type: 'move' as const, unitIds: [worker.id], x: worker.x + 80, y: worker.y };
      socket.emit(encodeNetMessage({ type: 'command', roomId: room.id, playerId: 'player', epoch: 0, clientSeq: 7, command }));
      hub.tickRoom(room.id); hub.tickRoom(room.id); hub.tickRoom(room.id);
      expect(host.currentTick(room.id)).toBe(3);
      socket.emit(encodeNetMessage({ type: 'requestCheckpoint', roomId: room.id, playerId: 'player', epoch: 0 }));
      const messages = socket.messages();
      expect(messages.filter(message => message.type === 'error')).toEqual([]);
      expect(messages[0]).toMatchObject({ type: 'hello', tick: 0, epoch: 0 });
      const frames = messages.filter((message): message is Extract<ServerNetMessage, { type: 'frame' }> => message.type === 'frame');
      expect(frames.map(message => message.frame.tick)).toEqual([0, 1, 2]);
      expect(frames[2]!.frame.commands).toContainEqual({ playerId: 'player', clientSeq: 7, command });
      expect(messages.find(message => message.type === 'checkpoint')).toMatchObject({ type: 'checkpoint', checkpoint: { tick: 3, snapshot: { tick: 3 } } });
      expect(hub.syncEventsForRoom(room.id).find(event => event.kind === 'checkpoint-request')).toMatchObject({ localTick: 3, serverTick: 3 });
      expect(publicSnapshot).not.toHaveBeenCalled();
    } finally {
      publicSnapshot.mockRestore();
    }
  });
});
