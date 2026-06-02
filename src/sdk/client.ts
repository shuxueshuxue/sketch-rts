import type { SaveGameInput, SaveGameRecord } from "../shared/savegame";
import type { DebugReplayTrace } from "../shared/replay";
import type { AbilityKind, BuildingKind, GameCommand, GameSetupOptions, GameSnapshot, LocalUserProfile, MapId, PlayerId, RaceId, RoomState, RoomVisibility, SlotController, TrainableUnitKind, WorldEffect } from "../shared/types";

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
  humanCount?: number;
  aiCount?: number;
  visibility?: RoomVisibility;
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

export type RoomTickUntilOptions = {
  until: (snapshot: GameSnapshot) => boolean;
  maxTicks: number;
  chunkTicks: number;
  maxElapsedMs?: number;
  maxCpuMs?: number;
};

export type RoomTickUntilResult = {
  snapshot: GameSnapshot;
  room: RoomState;
  totalTicks: number;
  elapsedMs: number;
  cpuMs: number;
  samples: RoomTickResult[];
};

export type SceneRunStep =
  | { type: "command"; command: GameCommand }
  | { type: "commands"; commands: GameCommand[] }
  | { type: "tick"; ticks: number; label?: string };

export type SceneRunSample = FastForwardResult & {
  label: string;
};

export type SceneRunOptions = {
  mapId: MapId;
  setup?: GameSetupOptions;
  steps: SceneRunStep[];
};

export type SceneRunResult = {
  initial: GameSnapshot;
  snapshot: GameSnapshot;
  samples: SceneRunSample[];
};

export type GoldSaturationProbeOptions = {
  workerCounts: number[];
  ticks: number;
};

export type RoomEffectWaitOptions = {
  roomId: string;
  effectType?: WorldEffect["type"];
  predicate?: (effect: WorldEffect, snapshot: GameSnapshot) => boolean;
  maxTicks?: number;
  pause?: boolean;
};

export type RoomEffectWaitResult = {
  snapshot: GameSnapshot;
  effect: WorldEffect;
};

export class SketchRtsSdk {
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  serverUrl() {
    return this.baseUrl;
  }

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

  async mine(unitIds: string[], resourceId: string): Promise<GameSnapshot> {
    return this.command({ type: "mine", unitIds, resourceId });
  }

  async move(unitIds: string[], x: number, y: number): Promise<GameSnapshot> {
    return this.command({ type: "move", unitIds, x, y });
  }

  async attackMove(unitIds: string[], x: number, y: number): Promise<GameSnapshot> {
    return this.command({ type: "attackMove", unitIds, x, y });
  }

  async attack(unitIds: string[], targetId: string): Promise<GameSnapshot> {
    return this.command({ type: "attack", unitIds, targetId });
  }

  async build(unitId: string, buildingKind: BuildingKind, x: number, y: number): Promise<GameSnapshot> {
    return this.command({ type: "build", unitId, buildingKind, x, y });
  }

  async train(buildingId: string, unitKind: TrainableUnitKind): Promise<GameSnapshot> {
    return this.command({ type: "train", buildingId, unitKind });
  }

  async hire(campId: string): Promise<GameSnapshot> {
    return this.command({ type: "hire", campId });
  }

  async cast(unitId: string, ability: AbilityKind, target: { targetId: string } | { x: number; y: number }): Promise<GameSnapshot> {
    return this.command({ type: "cast", unitId, ability, ...target });
  }

  async fastForward(ticks: number): Promise<FastForwardResult> {
    return this.postJson("/api/tick", { ticks });
  }

  async listRooms(options: { userId?: string } = {}): Promise<RoomState[]> {
    const query = options.userId ? `?userId=${encodeURIComponent(options.userId)}` : "";
    const result = await this.getJson<{ rooms: RoomState[] }>(`/api/rooms${query}`);
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

  async pauseRoom(roomId: string): Promise<RoomState> {
    return this.postJson(`/api/rooms/${roomId}/pause`, {});
  }

  async resumeRoom(roomId: string): Promise<RoomState> {
    return this.postJson(`/api/rooms/${roomId}/resume`, {});
  }

  async closeRoom(roomId: string, userId: string): Promise<RoomState> {
    return this.postJson(`/api/rooms/${roomId}/close`, { userId });
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

  async waitForRoomEffect(options: RoomEffectWaitOptions): Promise<RoomEffectWaitResult> {
    if (options.pause !== false) await this.pauseRoom(options.roomId);
    const current = await this.roomSnapshot(options.roomId);
    const currentEffect = findMatchingEffect(current, options);
    if (currentEffect) return { snapshot: current, effect: currentEffect };

    const result = await this.tickRoomUntil(options.roomId, {
      maxTicks: options.maxTicks ?? 120,
      chunkTicks: 1,
      until: (snapshot) => Boolean(findMatchingEffect(snapshot, options)),
    });
    const effect = findMatchingEffect(result.snapshot, options);
    if (!effect) throw new Error(`Room ${options.roomId} reached the effect predicate without a matching effect`);
    return { snapshot: result.snapshot, effect };
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

  async tickRoomUntil(roomId: string, options: RoomTickUntilOptions): Promise<RoomTickUntilResult> {
    if (!Number.isInteger(options.maxTicks) || options.maxTicks < 1) {
      throw new Error("maxTicks must be a positive integer");
    }
    if (!Number.isInteger(options.chunkTicks) || options.chunkTicks < 1) {
      throw new Error("chunkTicks must be a positive integer");
    }

    let totalTicks = 0;
    let elapsedMs = 0;
    let cpuMs = 0;
    const samples: RoomTickResult[] = [];
    let latest: RoomTickResult | null = null;

    while (totalTicks < options.maxTicks) {
      const ticks = Math.min(options.chunkTicks, options.maxTicks - totalTicks);
      const sample = await this.tickRoom(roomId, ticks);
      if (!Number.isInteger(sample.ticks) || sample.ticks < 1) {
        throw new Error(`non-positive tick progress from /api/rooms/${roomId}/tick: ${sample.ticks}`);
      }
      samples.push(sample);
      latest = sample;
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
        return { snapshot: sample.snapshot, room: sample.room, totalTicks, elapsedMs, cpuMs, samples };
      }
    }

    throw new Error(`Room ${roomId} tick budget exceeded before condition matched: ${totalTicks}/${options.maxTicks}`);
  }

  async runScene(options: SceneRunOptions): Promise<SceneRunResult> {
    const initial = await this.reset(options.mapId, options.setup);
    let snapshot = initial;
    const samples: SceneRunSample[] = [];
    for (const [index, step] of options.steps.entries()) {
      if (step.type === "command") {
        snapshot = await this.command(step.command);
        continue;
      }
      if (step.type === "commands") {
        for (const command of step.commands) snapshot = await this.command(command);
        continue;
      }
      const sample = await this.fastForward(step.ticks);
      snapshot = sample.snapshot;
      samples.push({ ...sample, label: step.label ?? `tick-${index + 1}` });
    }
    return { initial, snapshot, samples };
  }

  async goldSaturationProbe(options: GoldSaturationProbeOptions): Promise<Record<number, number>> {
    const incomes: Record<number, number> = {};
    for (const workerCount of options.workerCounts) {
      const setup = goldSaturationSetup(workerCount);
      const workerIds = Array.from({ length: workerCount }, (_, index) => `gold-sdk-worker-${index + 1}`);
      const result = await this.runScene({
        mapId: "bareDuel",
        setup,
        steps: [
          { type: "command", command: { type: "mine", unitIds: workerIds, resourceId: "gold-sdk-saturation" } },
          { type: "tick", ticks: options.ticks, label: `${workerCount}-workers` },
        ],
      });
      incomes[workerCount] = result.snapshot.players.player.gold;
    }
    return incomes;
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

function findMatchingEffect(snapshot: GameSnapshot, options: Pick<RoomEffectWaitOptions, "effectType" | "predicate">) {
  return snapshot.effects.find((candidate) => {
    if (options.effectType && candidate.type !== options.effectType) return false;
    return options.predicate ? options.predicate(candidate, snapshot) : true;
  });
}

function goldSaturationSetup(workerCount: number): GameSetupOptions {
  return {
    aiPlayers: [],
    scenario: {
      replaceDefaultUnits: true,
      replaceDefaultResources: true,
      addResources: [{ id: "gold-sdk-saturation", kind: "goldMine", x: 620, y: 520, amount: 100_000 }],
      addUnits: Array.from({ length: workerCount }, (_, index) => ({
        id: `gold-sdk-worker-${index + 1}`,
        owner: "player" as const,
        kind: "worker" as const,
        x: 620 + index * 3,
        y: 520 + index * 3,
      })),
    },
  };
}
