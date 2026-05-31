import type { SaveGameInput, SaveGameRecord } from "../shared/savegame";
import type { DebugReplayTrace } from "../shared/replay";
import type { GameCommand, GameSetupOptions, GameSnapshot, LocalUserProfile, MapId, PlayerId, RaceId, RoomState, SlotController } from "../shared/types";

export type SketchRtsCatalog = {
  units: string[];
  buildings: string[];
  races: { id: RaceId; name: string; note: string }[];
  maps: { id: MapId; name: string; note: string; tags: string[] }[];
};

export type FastForwardResult = {
  snapshot: GameSnapshot;
  ticks: number;
  elapsedMs: number;
  cpuMs: number;
  memory: TickMemoryObservation;
};

export type CreateRoomRequest = {
  id?: string;
  host: LocalUserProfile;
  name?: string;
  mapId?: MapId;
  slotCount?: number;
};

export type GrandStressRoomRequest = {
  humanCount?: number;
  aiCount?: number;
};

export type SlotPatchRequest = {
  controller?: SlotController;
  team?: string;
  race?: RaceId;
  ready?: boolean;
  name?: string;
  userId?: string;
};

export type RoomTickResult = FastForwardResult & {
  room: RoomState;
};

export type TickMemoryObservation = {
  rssBytes: number;
  heapUsedBytes: number;
  heapDeltaBytes: number;
};

export type FastForwardUntilOptions = {
  until: (snapshot: GameSnapshot) => boolean;
  maxTicks: number;
  chunkTicks: number;
  maxElapsedMs?: number;
  maxCpuMs?: number;
};

export type FastForwardUntilResult = {
  snapshot: GameSnapshot;
  totalTicks: number;
  elapsedMs: number;
  cpuMs: number;
  samples: FastForwardResult[];
};

export class SketchRtsSdk {
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  async catalog(): Promise<SketchRtsCatalog> {
    return this.getJson("/api/catalog");
  }

  async snapshot(): Promise<GameSnapshot> {
    return this.getJson("/api/snapshot");
  }

  async reset(mapId: MapId, options?: GameSetupOptions): Promise<GameSnapshot> {
    return this.postJson("/api/reset", options ? { mapId, options } : { mapId });
  }

  async command(command: GameCommand): Promise<GameSnapshot> {
    return this.postJson("/api/command", command);
  }

  async fastForward(ticks: number): Promise<FastForwardResult> {
    return this.postJson("/api/tick", { ticks });
  }

  async listRooms(): Promise<RoomState[]> {
    const result = await this.getJson<{ rooms: RoomState[] }>("/api/rooms");
    return result.rooms;
  }

  async createRoom(input: CreateRoomRequest): Promise<RoomState> {
    return this.postJson("/api/rooms", input);
  }

  async createGrandThirtyRoom(host: LocalUserProfile, id?: string, options: GrandStressRoomRequest = {}): Promise<RoomState> {
    return this.postJson("/api/rooms/grand-thirty", { ...(id ? { id } : {}), host, ...options });
  }

  async updateRoomSlot(roomId: string, slotId: string, patch: SlotPatchRequest): Promise<RoomState> {
    return this.postJson(`/api/rooms/${roomId}/slots/${slotId}`, patch);
  }

  async updateRoomMap(roomId: string, mapId: MapId): Promise<RoomState> {
    return this.postJson(`/api/rooms/${roomId}/map`, { mapId });
  }

  async startRoom(roomId: string): Promise<RoomState> {
    return this.postJson(`/api/rooms/${roomId}/start`, {});
  }

  async resetRoom(roomId: string, mapId: MapId, options?: GameSetupOptions): Promise<{ room: RoomState; snapshot: GameSnapshot }> {
    return this.postJson(`/api/rooms/${roomId}/reset`, options ? { mapId, options } : { mapId });
  }

  async roomSnapshot(roomId: string): Promise<GameSnapshot> {
    return this.getJson(`/api/rooms/${roomId}/snapshot`);
  }

  async roomCommand(roomId: string, playerId: PlayerId, command: GameCommand): Promise<GameSnapshot> {
    return this.postJson(`/api/rooms/${roomId}/command`, { playerId, command });
  }

  async roomCommands(roomId: string, commands: { playerId: PlayerId; command: GameCommand }[]): Promise<GameSnapshot> {
    return this.postJson(`/api/rooms/${roomId}/commands`, { commands });
  }

  async tickRoom(roomId: string, ticks: number): Promise<RoomTickResult> {
    return this.postJson(`/api/rooms/${roomId}/tick`, { ticks });
  }

  async commandTickRoom(roomId: string, commands: { playerId: PlayerId; command: GameCommand }[], ticks: number): Promise<RoomTickResult> {
    return this.postJson(`/api/rooms/${roomId}/command-tick`, { commands, ticks });
  }

  async saveRoom(roomId: string, input: SaveGameInput): Promise<SaveGameRecord> {
    return this.postJson(`/api/rooms/${roomId}/save`, input);
  }

  async enableDebugReplay(roomId: string, input: SaveGameInput): Promise<DebugReplayTrace> {
    return this.postJson(`/api/rooms/${roomId}/debug-replay`, input);
  }

  async readDebugReplay(roomId: string): Promise<DebugReplayTrace> {
    return this.getJson(`/api/rooms/${roomId}/debug-replay`);
  }

  async replayDebugToTick(roomId: string, tick: number): Promise<GameSnapshot> {
    return this.getJson(`/api/rooms/${roomId}/debug-replay/ticks/${tick}`);
  }

  async saveDebugReplayFrame(roomId: string, tick: number, input: SaveGameInput): Promise<SaveGameRecord> {
    return this.postJson(`/api/rooms/${roomId}/debug-replay/ticks/${tick}/save`, input);
  }

  async listSavegames(): Promise<SaveGameRecord[]> {
    const result = await this.getJson<{ saves: SaveGameRecord[] }>("/api/savegames");
    return result.saves;
  }

  async readSavegame(saveId: string): Promise<SaveGameRecord> {
    return this.getJson(`/api/savegames/${saveId}`);
  }

  async continueSavegame(saveId: string, options: { roomId?: string } = {}): Promise<RoomState> {
    return this.postJson(`/api/savegames/${saveId}/continue`, options);
  }

  async fastForwardUntil(options: FastForwardUntilOptions): Promise<FastForwardUntilResult> {
    if (!Number.isInteger(options.maxTicks) || options.maxTicks < 1) {
      throw new Error("maxTicks must be a positive integer");
    }
    if (!Number.isInteger(options.chunkTicks) || options.chunkTicks < 1) {
      throw new Error("chunkTicks must be a positive integer");
    }

    let totalTicks = 0;
    let elapsedMs = 0;
    let cpuMs = 0;
    const samples: FastForwardResult[] = [];
    let latest: GameSnapshot | null = null;

    while (totalTicks < options.maxTicks) {
      const ticks = Math.min(options.chunkTicks, options.maxTicks - totalTicks);
      const sample = await this.fastForward(ticks);
      if (!Number.isInteger(sample.ticks) || sample.ticks < 1) {
        throw new Error(`non-positive tick progress from /api/tick: ${sample.ticks}`);
      }
      samples.push(sample);
      latest = sample.snapshot;
      totalTicks += sample.ticks;
      elapsedMs += sample.elapsedMs;
      cpuMs += sample.cpuMs;

      if (options.maxElapsedMs !== undefined && elapsedMs > options.maxElapsedMs) {
        throw new Error(`Elapsed budget exceeded: ${elapsedMs.toFixed(2)}ms > ${options.maxElapsedMs}ms`);
      }
      if (options.maxCpuMs !== undefined && cpuMs > options.maxCpuMs) {
        throw new Error(`CPU budget exceeded: ${cpuMs.toFixed(2)}ms > ${options.maxCpuMs}ms`);
      }
      if (options.until(sample.snapshot)) {
        return { snapshot: sample.snapshot, totalTicks, elapsedMs, cpuMs, samples };
      }
    }

    throw new Error(`Tick budget exceeded before condition matched: ${totalTicks}/${options.maxTicks}`);
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`);
    if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`);
    return response.json() as Promise<T>;
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`POST ${path} failed: ${response.status}`);
    return response.json() as Promise<T>;
  }
}
