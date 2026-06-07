import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_FRAME_HISTORY_LIMIT, RoomHistoryLog } from "./room-history";
import type { CheckpointFrame, CommandFrame } from "../shared/net/types";
import { SAVEGAME_SCHEMA_VERSION, type SaveGameRecord } from "../shared/savegame";

describe("room history log", () => {
  it("keeps a bounded checkpoint and frame window for late observers", () => {
    const log = new RoomHistoryLog({ frameHistoryLimit: 3 });
    for (let tick = 0; tick < 5; tick += 1) {
      log.recordCheckpoint(checkpoint(tick));
      log.recordFrame("browser", frame(tick));
    }

    expect(log.checkpointAtOrBefore(2)).toMatchObject({ tick: 2 });
    expect(log.framesFrom(2).map((candidate) => candidate.tick)).toEqual([2, 3, 4]);
    expect(log.checkpointAtOrBefore(1)).toBeUndefined();
  });

  it("keeps replay frames from the debug replay start tick instead of opening a second ledger", () => {
    const log = new RoomHistoryLog({ frameHistoryLimit: 2 });
    for (let tick = 0; tick < 3; tick += 1) {
      log.recordCheckpoint(checkpoint(tick));
      log.recordFrame("browser", frame(tick));
    }
    log.retainFramesFrom(2);
    for (let tick = 3; tick < 8; tick += 1) {
      log.recordCheckpoint(checkpoint(tick));
      log.recordFrame("internal-ai", frame(tick));
    }

    const trace = log.debugReplayTrace({ id: "trace-history", initialSave: saveAt(2) });

    expect(trace.frames.map((candidate) => candidate.tick)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(trace.checkpoints.map((candidate) => candidate.tick)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("names the default retention window instead of hiding a magic number in room net", () => {
    expect(DEFAULT_ROOM_FRAME_HISTORY_LIMIT).toBe(240);
  });
});

function checkpoint(tick: number): CheckpointFrame {
  return { roomId: "room-sync", tick, snapshot: { tick } as CheckpointFrame["snapshot"], nextId: tick };
}

function frame(tick: number): CommandFrame {
  return { roomId: "room-sync", tick, sequence: tick, commands: [] };
}

function saveAt(tick: number): SaveGameRecord {
  return {
    schemaVersion: SAVEGAME_SCHEMA_VERSION,
    id: "save-history",
    createdAt: "2026-06-07T00:00:00.000Z",
    room: { id: "room-sync", status: "inMatch" } as SaveGameRecord["room"],
    snapshot: { tick } as SaveGameRecord["snapshot"],
    runtime: {
      activePlayers: [],
      teams: {},
      aiPlayers: [],
      aiVersions: {},
      nextId: tick,
    },
  };
}
