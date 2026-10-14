import { describe, expect, it } from 'vitest';
import { createRoomLifecycleHost } from '../shared/room-lifecycle';
import { canStartRoom, type CreateRoomInput, type SlotPatch } from '../shared/rooms';
import type { LocalUserProfile, RoomState } from '../shared/types';
import { createDeploymentRuntime } from './deployment/runtime';
import { defaultRoomConfiguration, formatRoomRoute, parseRoomRoute } from './room-route';
import { RoomSetupSession } from './room-setup-session';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const user = { id: 'host', name: 'Host' }, server = createRoomLifecycleHost();
  const requests: string[] = [], changed: RoomState[] = [], created: string[] = [];
  const runtime = createDeploymentRuntime('server', {
    // This in-memory HTTP fixture serves the root API, independently of the build mount.
    publicBasePath: '/',
    fetchJson: async <T>(path: string, body?: unknown): Promise<T> => {
      requests.push(`${body ? 'POST' : 'GET'} ${path}`);
      if (path === '/api/rooms' && body) return server.createRoom(body as CreateRoomInput) as T;
      if (path.startsWith('/api/rooms?')) return { rooms: server.listRooms(user.id) } as T;
      const [, id, action, slotId] = path.match(/^\/api\/rooms\/([^/]+)(?:\/(join|close|slots))?(?:\/([^/]+))?$/)!;
      if (action === 'close') return server.closeRoom(id!, (body as { userId: string }).userId) as T;
      if (action === 'join') return server.joinRoom(id!, (body as { user: LocalUserProfile }).user) as T;
      if (action === 'slots') return server.updateSlot(id!, slotId!, body as SlotPatch) as T;
      return server.getRoom(id!) as T;
    },
  });
  let nextId = 0;
  let createGate: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  let closeGate: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
  let failingCloseId: string | undefined;
  let lostCreateResponse = false;
  const session = new RoomSetupSession({
    user: () => user, newId: () => `setup-${++nextId}`, changed: room => changed.push(room), busyChanged: () => {},
    runtime: {
      async createRoom(input) {
        const room = await runtime.createRoom(input); created.push(room.id);
        if (lostCreateResponse) { lostCreateResponse = false; throw new Error('Creation response was lost'); }
        const gate = createGate; createGate = undefined;
        if (gate) { gate.entered.resolve(); await gate.release.promise; }
        return room;
      },
      async closeRoom(id, userId) {
        if (id === failingCloseId) throw new Error('Cannot close previous room');
        const room = await runtime.closeRoom(id, userId);
        const gate = closeGate; closeGate = undefined;
        if (gate) { gate.entered.resolve(); await gate.release.promise; }
        return room;
      },
      updateRoomSlot: (...args) => runtime.updateRoomSlot(...args),
    },
  });
  return { session, runtime, requests, changed, created, user,
    holdCreate() { return createGate = { entered: deferred(), release: deferred() }; },
    holdClose() { return closeGate = { entered: deferred(), release: deferred() }; },
    failClose(id: string) { failingCloseId = id; },
    loseCreateResponse() { lostCreateResponse = true; },
  };
}

describe('automatic room setup lifecycle', () => {
  it('coalesces repeated map selection into one local open room without starting or contacting the server', async () => {
    const f = fixture(), configuration = defaultRoomConfiguration('stillwater');
    const first = f.session.create(configuration), second = f.session.create(configuration);
    expect(await first).toBeUndefined();
    const room = (await second)!;
    expect(room.status).toBe('open');
    expect(f.created).toEqual([room.id]); expect(f.changed).toEqual([room]); expect(f.requests).toEqual([]);
    expect(room.slots.slice(1).every(slot => slot.controller === 'ai')).toBe(true);
    expect(f.session.busy).toBe(false); f.runtime.close();
  });

  it('returns to the same local setup through history without creating another room', async () => {
    const f = fixture(), configuration = defaultRoomConfiguration('stillwater');
    const room = (await f.session.create(configuration))!;
    const { roomConfiguration } = await import('../shared/rooms');
    f.session.adopt(room);
    expect((await f.session.create(roomConfiguration(room), true))?.id).toBe(room.id);
    expect(f.created).toEqual([room.id]); expect((await f.runtime.listRooms(f.user.id)).map(room => room.id)).toEqual([room.id]); f.runtime.close();
  });

  it('moves solo to a joinable server room, preserves setup, and waits for the invited player to be ready', async () => {
    const f = fixture(), configuration = defaultRoomConfiguration('stillwater');
    const solo = (await f.session.create(configuration))!;
    await f.session.updateSlot('slot-1', { race: 'ember' });
    const multi = (await f.session.switchMode('public'))!;
    expect(f.runtime.isLocalRoom(solo.id)).toBe(false);
    expect(multi.slots[0]?.race).toBe('ember'); expect(multi.layoutSeed).toBe(solo.layoutSeed);
    expect(multi.slots.filter(slot => slot.controller === 'open')).toHaveLength(1);
    expect(canStartRoom(multi)).toBe(false);
    const entered = await f.runtime.enterRoom(multi.id, { id: 'guest', name: 'Guest' });
    expect(entered.spectating).toBe(false); expect(entered.playerId).toBe('enemy');
    f.session.accept(entered.room);
    const ready = (await f.session.updateSlot('slot-2', { ready: true }))!;
    expect(canStartRoom(ready)).toBe(true); expect(ready.status).toBe('open');
    f.runtime.close();
  });

  it('opens a public configuration URL as an immediately joinable setup without a separate creation step', async () => {
    const f = fixture(), configuration = defaultRoomConfiguration('stillwater'); configuration.visibility = 'public';
    const room = (await f.session.create(configuration))!;
    expect((await f.runtime.enterRoom(room.id, { id: 'guest', name: 'Guest' })).room.slots.some(slot => slot.userId === 'guest')).toBe(true);
    expect(room.status).toBe('open'); f.runtime.close();
  });

  it('moves multiplayer back to local solo, removes invitation seats and does not copy guest identity', async () => {
    const f = fixture(); await f.session.create(defaultRoomConfiguration('stillwater'));
    const multi = (await f.session.switchMode('public'))!;
    const entered = await f.runtime.enterRoom(multi.id, { id: 'guest', name: 'Guest' }); f.session.accept(entered.room);
    const solo = (await f.session.switchMode('private'))!;
    expect(f.runtime.isLocalRoom(solo.id)).toBe(true);
    expect(solo.slots.slice(1).every(slot => slot.controller === 'ai' && !slot.userId)).toBe(true);
    expect(canStartRoom(solo)).toBe(true);
    expect((await f.runtime.listRooms(f.user.id)).map(room => room.id)).toEqual([solo.id]); f.runtime.close();
  });

  it('keeps the final mode when toggled while the first room is still being created', async () => {
    const f = fixture(), gate = f.holdCreate();
    const first = f.session.create(defaultRoomConfiguration('stillwater')); await gate.entered.promise;
    const last = f.session.switchMode('public'); gate.release.resolve();
    expect(await first).toBeUndefined();
    const room = (await last)!;
    expect(room.visibility).toBe('public'); expect(f.changed).toEqual([room]);
    expect((await f.runtime.listRooms(f.user.id)).map(room => room.id)).toEqual([room.id]); f.runtime.close();
  });

  it('discards a delayed obsolete public creation and publishes only the last quick toggle', async () => {
    const f = fixture(); await f.session.create(defaultRoomConfiguration('stillwater'));
    const gate = f.holdCreate(), first = f.session.switchMode('public'); await gate.entered.promise;
    const middle = f.session.switchMode('private'), last = f.session.switchMode('public'); gate.release.resolve();
    expect(await first).toBeUndefined(); expect(await middle).toBeUndefined();
    const room = (await last)!;
    expect(f.changed.map(room => room.visibility)).toEqual(['private', 'public']);
    expect((await f.runtime.listRooms(f.user.id)).map(room => room.id)).toEqual([room.id]); f.runtime.close();
  });

  it('rebuilds the requested mode rather than reusing a room already closed during migration', async () => {
    const f = fixture(); const firstRoom = (await f.session.create(defaultRoomConfiguration('stillwater')))!;
    const gate = f.holdClose(), first = f.session.switchMode('public'); await gate.entered.promise;
    const last = f.session.switchMode('private'); gate.release.resolve();
    expect(await first).toBeUndefined(); const room = (await last)!;
    expect(room.id).not.toBe(firstRoom.id); expect(room.visibility).toBe('private');
    expect((await f.runtime.listRooms(f.user.id)).map(room => room.id)).toEqual([room.id]); f.runtime.close();
  });

  it('cleans a delayed newly created room after route cancellation without switching the visible room', async () => {
    const f = fixture(); await f.session.create(defaultRoomConfiguration('stillwater'));
    const gate = f.holdCreate(), request = f.session.switchMode('public'); await gate.entered.promise;
    f.session.cancel(); gate.release.resolve(); expect(await request).toBeUndefined();
    expect(f.changed).toHaveLength(1);
    expect((await f.runtime.listRooms(f.user.id)).every(room => room.visibility === 'private')).toBe(true); f.runtime.close();
  });

  it('rolls a failed migration back to the usable old room and closes the new room', async () => {
    const f = fixture(), original = (await f.session.create(defaultRoomConfiguration('stillwater')))!;
    f.failClose(original.id);
    await expect(f.session.switchMode('public')).rejects.toThrow('Cannot close previous room');
    expect(f.changed).toEqual([original]); expect(f.session.busy).toBe(false);
    expect((await f.runtime.listRooms(f.user.id)).map(room => room.id)).toEqual([original.id]);
    const same = await f.session.switchMode('private'); expect(same?.id).toBe(original.id); f.runtime.close();
  });

  it('cleans a room committed by the server when its creation response is lost', async () => {
    const f = fixture(), configuration = defaultRoomConfiguration('stillwater'); configuration.visibility = 'public';
    f.loseCreateResponse(); await expect(f.session.create(configuration)).rejects.toThrow('Creation response was lost');
    expect(f.changed).toEqual([]); expect(await f.runtime.listRooms(f.user.id)).toEqual([]);
    expect(f.session.busy).toBe(false); f.runtime.close();
  });

  it('serializes race edits on both sides of migration and restores local configuration from its URL', async () => {
    const f = fixture(); await f.session.create(defaultRoomConfiguration('stillwater'));
    const before = f.session.updateSlot('slot-1', { race: 'ember' }), migration = f.session.switchMode('public'), after = f.session.updateSlot('slot-3', { race: 'grove', aiVersion: 'v9_knight' });
    await Promise.all([before, migration, after]);
    const solo = (await f.session.switchMode('private'))!;
    const { roomConfiguration } = await import('../shared/rooms');
    const configuration = roomConfiguration(solo), route = parseRoomRoute(formatRoomRoute({ screen: 'setup', configuration }));
    expect(route).toEqual({ screen: 'setup', configuration });
    f.session.cancel();
    const restored = (await f.session.create(route.screen === 'setup' ? route.configuration! : defaultRoomConfiguration()))!;
    expect(roomConfiguration(restored)).toEqual(configuration); expect(restored.status).toBe('open');
    expect(restored.slots[0]?.race).toBe('ember'); expect(restored.slots[2]?.race).toBe('grove'); f.runtime.close();
  });
});
