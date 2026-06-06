import { describe, expect, it } from "vitest";
import { runExternalAgentRoom } from "./external-agent-room-runner";
import type { GameCommand, GameSnapshot, PlayerId, RoomState } from "../shared/types";

describe("SDK external-agent room runner", () => {
  it("drives external agents through one batched command-tick cadence", async () => {
    const calls: string[] = [];
    const snapshots = [snapshotAt(0), snapshotAt(45), snapshotAt(90, "player")];
    const rooms = [roomState("inMatch"), roomState("ended", "player")];
    const sdk = {
      async startRoom(roomId: string) {
        calls.push(`start:${roomId}`);
        return roomState("inMatch");
      },
      async roomSnapshot(roomId: string) {
        calls.push(`snapshot:${roomId}`);
        return snapshots[0]!;
      },
      async commandTickRoom(roomId: string, commands: { playerId: PlayerId; command: GameCommand }[], ticks: number) {
        calls.push(`commandTick:${roomId}:${ticks}:${commands.map((entry) => `${entry.playerId}:${entry.command.type}`).join(",")}`);
        const snapshot = snapshots.shift() ?? snapshotAt(90, "player");
        snapshots[0] = snapshots[0] ?? snapshotAt(snapshot.tick + ticks);
        return {
          snapshot: snapshots[0] ?? snapshotAt(snapshot.tick + ticks),
          room: rooms[0]!,
          ticks,
          elapsedMs: 1,
          cpuMs: 2,
          memory: { rssBytes: 100, heapUsedBytes: 200 + ticks, heapDeltaBytes: 3 },
        };
      },
      async listRooms() {
        calls.push("listRooms");
        return rooms;
      },
    };

    const report = await runExternalAgentRoom({
      sdk,
      setupRoom: async () => roomState("open"),
      maxTicks: 90,
      stepTicks: 45,
      planCommands({ snapshot, externalPlayers }) {
        return externalPlayers.map((playerId) => ({
          playerId,
          source: "external-agent" as const,
          scriptId: `planner-${snapshot.tick}`,
          command: { type: "move", unitIds: [`unit-${playerId}`], x: snapshot.tick + 1, y: snapshot.tick + 2 },
        }));
      },
    });

    expect(calls).toEqual([
      "start:room-1",
      "snapshot:room-1",
      "commandTick:room-1:45:player:move,enemy:move",
      "commandTick:room-1:45:player:move,enemy:move",
      "listRooms",
    ]);
    expect(report.cadence).toMatchObject({ mode: "batched-command-tick", stepTicks: 45, maxTicks: 90 });
    expect(report.commandCount).toBe(4);
    expect(report.commandKinds.move).toBe(4);
    expect(report.scriptCounts["planner-0"]).toBe(2);
    expect(report.scriptCounts["planner-45"]).toBe(2);
    expect(report.commandsByOwner).toEqual({ player: 2, enemy: 2 });
    expect(report.externalPlayers).toEqual(["player", "enemy"]);
    expect(report.internalPlayers).toEqual(["ai-1"]);
  });
});

function roomState(status: RoomState["status"], winner: PlayerId | null = null): RoomState {
  return {
    id: "room-1",
    name: "Room",
    hostUserId: "host",
    visibility: "public",
    mapId: "bareDuel",
    status,
    autoTick: false,
    slots: [
      { id: "slot-1", playerId: "player", controller: "human", name: "Player", team: "north", race: "grove", ready: true, userId: "user-player" },
      { id: "slot-2", playerId: "enemy", controller: "human", name: "Enemy", team: "south", race: "ember", ready: true, userId: "user-enemy" },
      { id: "slot-3", playerId: "ai-1", controller: "ai", name: "AI", team: "south", race: "grove", ready: true },
    ],
    ...(winner ? { result: { winner, endedAtTick: 90, slots: [], stats: snapshotAt(90, winner).match.stats } } : {}),
  };
}

function snapshotAt(tick: number, winner: PlayerId | null = null): GameSnapshot {
  return {
    tick,
    players: {
      player: { id: "player", gold: 0, lumber: 0, supplyUsed: 0, supplyCap: 0, upgrades: [], race: "grove" },
      enemy: { id: "enemy", gold: 0, lumber: 0, supplyUsed: 0, supplyCap: 0, upgrades: [], race: "ember" },
      "ai-1": { id: "ai-1", gold: 0, lumber: 0, supplyUsed: 0, supplyCap: 0, upgrades: [], race: "grove" },
    },
    teams: { player: "north", enemy: "south", "ai-1": "south" },
    units: [],
    buildings: [],
    resources: [],
    mercenaryCamps: [],
    projectiles: [],
    effects: [],
    items: [],
    map: { id: "bareDuel", name: "Bare Duel", width: 1000, height: 1000, landmarks: [] },
    match: {
      winner,
      endedAtTick: winner ? tick : null,
      stats: {
        unitsKilled: { player: 0, enemy: 0, enemy2: 0, "ai-1": 0, neutral: 0 },
        unitsLost: { player: 0, enemy: 0, enemy2: 0, "ai-1": 0, neutral: 0 },
        buildingsDestroyed: { player: 0, enemy: 0, enemy2: 0, "ai-1": 0 },
        nonBaseBuildingsDestroyed: { player: 0, enemy: 0, enemy2: 0, "ai-1": 0 },
        goldSpent: { player: 0, enemy: 0, enemy2: 0, "ai-1": 0 },
        mercenaryKills: { player: 0, enemy: 0, enemy2: 0, "ai-1": 0 },
        neutralUnitsKilled: { player: 0, enemy: 0, enemy2: 0, "ai-1": 0 },
        unitsKilledByNeutral: { player: 0, enemy: 0, enemy2: 0, "ai-1": 0 },
      },
    },
  } as unknown as GameSnapshot;
}
