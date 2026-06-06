import type { CommandFrameEntry } from "./commands/frame";
import type { RoomTickResult, SketchRtsSdk } from "./client";
import type { GameCommand, GameSnapshot, PlayerId, RoomState } from "../shared/types";

export type ExternalAgentRoomSdk = Pick<SketchRtsSdk, "startRoom" | "roomSnapshot" | "commandTickRoom" | "listRooms">;

export type ExternalAgentRoomCadence = {
  mode: "batched-command-tick";
  stepTicks: number;
  maxTicks: number;
  wallBudgetMs: number | null;
  snapshotTiming: "latest-before-command-tick";
  endCondition: "winner-or-max-ticks";
};

export type ExternalAgentRoomPlannerContext = {
  snapshot: GameSnapshot;
  room: RoomState;
  startedRoom: RoomState;
  externalPlayers: PlayerId[];
  internalPlayers: PlayerId[];
  teams: Record<PlayerId, string>;
};

export type ExternalAgentRoomRunInput<Source extends string = string> = {
  sdk: ExternalAgentRoomSdk;
  setupRoom: () => Promise<RoomState>;
  maxTicks: number;
  stepTicks: number;
  maxWallMs?: number;
  externalPlayers?: (room: RoomState) => PlayerId[];
  planCommands: (context: ExternalAgentRoomPlannerContext) => CommandFrameEntry<Source>[];
  onProgress?: (progress: { snapshot: GameSnapshot; elapsedMs: number; totalTickCpuMs: number }) => void;
};

export type ExternalAgentRoomRunReport = {
  setupRoom: RoomState;
  startedRoom: RoomState;
  room: RoomState | undefined;
  snapshot: GameSnapshot;
  externalPlayers: PlayerId[];
  internalPlayers: PlayerId[];
  teams: Record<PlayerId, string>;
  cadence: ExternalAgentRoomCadence;
  commandCount: number;
  commandKinds: Partial<Record<GameCommand["type"], number>>;
  scriptCounts: Record<string, number>;
  commandsByOwner: Record<PlayerId, number>;
  elapsedMs: number;
  totalTickCpuMs: number;
  heapMin: number | null;
  heapMax: number | null;
};

export async function runExternalAgentRoom<Source extends string = string>(input: ExternalAgentRoomRunInput<Source>): Promise<ExternalAgentRoomRunReport> {
  if (!Number.isInteger(input.maxTicks) || input.maxTicks < 1) throw new Error("maxTicks must be a positive integer");
  if (!Number.isInteger(input.stepTicks) || input.stepTicks < 1) throw new Error("stepTicks must be a positive integer");

  const setupRoom = await input.setupRoom();
  const startedRoom = await input.sdk.startRoom(setupRoom.id);
  const externalPlayers = input.externalPlayers?.(startedRoom) ?? startedRoom.slots.filter((slot) => slot.controller === "human").map((slot) => slot.playerId);
  const internalPlayers = startedRoom.slots.filter((slot) => slot.controller === "ai").map((slot) => slot.playerId);
  const teams = Object.fromEntries(startedRoom.slots.map((slot) => [slot.playerId, slot.team])) as Record<PlayerId, string>;
  const cadence: ExternalAgentRoomCadence = {
    mode: "batched-command-tick",
    stepTicks: input.stepTicks,
    maxTicks: input.maxTicks,
    wallBudgetMs: input.maxWallMs ?? null,
    snapshotTiming: "latest-before-command-tick",
    endCondition: "winner-or-max-ticks",
  };

  const startedAt = performance.now();
  let latest = await input.sdk.roomSnapshot(setupRoom.id);
  let commandCount = 0;
  let totalTickCpuMs = 0;
  const commandKinds: Partial<Record<GameCommand["type"], number>> = {};
  const scriptCounts: Record<string, number> = {};
  const commandsByOwner = Object.fromEntries(externalPlayers.map((owner) => [owner, 0])) as Record<PlayerId, number>;
  const heapSamples: number[] = [];

  while (!latest.match.winner && latest.tick < input.maxTicks) {
    const elapsedMs = performance.now() - startedAt;
    if (input.maxWallMs !== undefined && elapsedMs > input.maxWallMs) {
      throw new Error(`External-agent room wall budget exceeded at tick ${latest.tick}: ${elapsedMs.toFixed(1)}ms`);
    }

    const planned = input.planCommands({ snapshot: latest, room: setupRoom, startedRoom, externalPlayers, internalPlayers, teams });
    const ticked = await input.sdk.commandTickRoom(
      setupRoom.id,
      planned.map((entry) => ({ playerId: entry.playerId, command: entry.command })),
      Math.min(input.stepTicks, input.maxTicks - latest.tick),
    );
    latest = ticked.snapshot;
    totalTickCpuMs += ticked.cpuMs;
    recordMemory(heapSamples, ticked);
    for (const entry of planned) {
      commandCount += 1;
      commandsByOwner[entry.playerId] = (commandsByOwner[entry.playerId] ?? 0) + 1;
      commandKinds[entry.command.type] = (commandKinds[entry.command.type] ?? 0) + 1;
      scriptCounts[entry.scriptId] = (scriptCounts[entry.scriptId] ?? 0) + 1;
    }
    input.onProgress?.({ snapshot: latest, elapsedMs: performance.now() - startedAt, totalTickCpuMs });
  }

  const room = (await input.sdk.listRooms()).find((candidate) => candidate.id === setupRoom.id);
  return {
    setupRoom,
    startedRoom,
    room,
    snapshot: latest,
    externalPlayers,
    internalPlayers,
    teams,
    cadence,
    commandCount,
    commandKinds,
    scriptCounts,
    commandsByOwner,
    elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
    totalTickCpuMs: Number(totalTickCpuMs.toFixed(3)),
    heapMin: heapSamples.length > 0 ? Math.min(...heapSamples) : null,
    heapMax: heapSamples.length > 0 ? Math.max(...heapSamples) : null,
  };
}

function recordMemory(samples: number[], ticked: RoomTickResult) {
  samples.push(ticked.memory.heapUsedBytes);
}
