import { roomConfiguration, type RoomConfiguration, type SlotPatch } from '../shared/rooms';
import type { LocalUserProfile, RoomState, RoomVisibility } from '../shared/types';
import type { DeploymentRuntime } from './deployment/runtime';

type SetupRuntime = Pick<DeploymentRuntime, 'createRoom' | 'closeRoom' | 'updateRoomSlot'>;

export function configurationForRoomMode(room: RoomState | RoomConfiguration, visibility: RoomVisibility): RoomConfiguration {
  const source = 'slots' in room ? roomConfiguration(room) : room;
  const configuration = { ...source, seatSetup: source.seatSetup.map(seat => ({ ...seat })) };
  configuration.visibility = visibility;
  if (visibility === 'private') {
    configuration.seatSetup = configuration.seatSetup.map((seat, index) => index === 0 || seat.controller === 'ai' || seat.controller === 'closed' ? seat : { ...seat, controller: 'ai', aiVersion: seat.aiVersion ?? 'random' });
  } else if (!configuration.seatSetup.some(seat => seat.controller === 'open')) {
    const index = configuration.seatSetup.findIndex((seat, index) => index > 0 && seat.controller !== 'human');
    if (index >= 0) configuration.seatSetup[index] = { ...configuration.seatSetup[index]!, controller: 'open' };
  }
  return configuration;
}

/** Serialize edits with room migration; only the latest requested setup can become visible. */
export class RoomSetupSession {
  private room: RoomState | undefined;
  private draft: RoomConfiguration | undefined;
  private generation = 0;
  private intent = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  requestedVisibility: RoomVisibility | undefined;

  constructor(private readonly options: {
    runtime: SetupRuntime;
    user: () => LocalUserProfile;
    changed: (room: RoomState, replace: boolean) => void;
    busyChanged: () => void;
    newId?: () => string;
  }) {}

  get busy() { return this.pending > 0; }
  get currentRoom() { return this.room; }

  cancel() {
    this.generation++; this.intent++;
    this.room = undefined; this.draft = undefined; this.requestedVisibility = undefined;
  }

  adopt(room: RoomState) {
    this.cancel(); this.room = room; this.draft = roomConfiguration(room);
  }

  accept(room: RoomState) {
    if (this.room?.id === room.id) { this.room = room; this.draft = roomConfiguration(room); }
  }

  create(configuration: RoomConfiguration, replace = false): Promise<RoomState | undefined> {
    const generation = this.generation, intent = ++this.intent;
    const requested = configurationForRoomMode(configuration, configuration.visibility);
    this.draft = requested;
    this.requestedVisibility = configuration.visibility;
    return this.enqueue(async () => {
      const current = () => generation === this.generation && intent === this.intent;
      if (!current()) return;
      if (this.room?.status === 'open' && this.room.hostUserId === this.options.user().id && JSON.stringify(roomConfiguration(this.room)) === JSON.stringify(requested)) {
        this.options.changed(this.room, replace); return this.room;
      }
      return this.replaceRoom(requested, current, replace);
    });
  }

  switchMode(visibility: RoomVisibility): Promise<RoomState | undefined> {
    const generation = this.generation, intent = ++this.intent;
    this.requestedVisibility = visibility;
    return this.enqueue(async () => {
      const current = () => generation === this.generation && intent === this.intent;
      if (!current()) return;
      if (this.room?.visibility === visibility) return this.room;
      if (this.room && (this.room.status !== 'open' || this.room.hostUserId !== this.options.user().id)) throw new Error('Only the host can change an open room mode');
      const source = this.room ?? this.draft;
      if (!source) return;
      return this.replaceRoom(configurationForRoomMode(source, visibility), current, true);
    });
  }

  updateSlot(slotId: string, patch: SlotPatch): Promise<RoomState | undefined> {
    const generation = this.generation;
    return this.enqueue(async () => {
      if (generation !== this.generation || !this.room) return;
      const roomId = this.room.id;
      const room = await this.options.runtime.updateRoomSlot(roomId, slotId, patch);
      if (generation !== this.generation || this.room?.id !== roomId) return;
      this.room = room; this.draft = roomConfiguration(room); this.options.changed(room, true);
      return room;
    });
  }

  private enqueue(operation: () => Promise<RoomState | undefined>) {
    this.pending++; this.options.busyChanged();
    const result = this.tail.then(operation);
    this.tail = result.catch(() => {});
    return result.finally(() => {
      if (--this.pending === 0) this.requestedVisibility = undefined;
      this.options.busyChanged();
    });
  }

  private async replaceRoom(configuration: RoomConfiguration, current: () => boolean, replace: boolean) {
    const previous = this.room, user = this.options.user();
    const id = this.options.newId?.() ?? `room-${crypto.randomUUID()}`;
    const humanCount = configuration.seatSetup.filter(seat => seat.controller !== 'ai').length;
    let room: RoomState;
    try { room = await this.options.runtime.createRoom({ ...configuration, id, host: user, humanCount, aiCount: configuration.seatSetup.length - humanCount }); }
    catch (error) {
      // A server may have committed creation before its response was lost.
      try { await this.options.runtime.closeRoom(id, user.id); } catch {}
      throw error;
    }
    const discard = () => this.options.runtime.closeRoom(room.id, user.id);
    if (!current()) { await discard(); return; }
    if (previous?.status === 'open' && previous.hostUserId === user.id) {
      try { await this.options.runtime.closeRoom(previous.id, user.id); }
      catch (error) { await discard(); throw error; }
      if (this.room?.id === previous.id) this.room = undefined;
      if (!current()) { await discard(); return; }
    }
    this.room = room; this.draft = roomConfiguration(room); this.options.changed(room, replace);
    return room;
  }
}
