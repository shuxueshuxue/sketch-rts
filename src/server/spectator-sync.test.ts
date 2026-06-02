import { describe, expect, it } from "vitest";
import { DEFAULT_SPECTATOR_FRAME_HISTORY_LIMIT, SpectatorSyncLog } from "./spectator-sync";
import type { CheckpointFrame, CommandFrame } from "../shared/net/types";

describe("spectator sync log", () => {
  it("keeps a bounded checkpoint and frame window for late observers", () => {
    const log = new SpectatorSyncLog({ frameHistoryLimit: 3 });
    for (let tick = 0; tick < 5; tick += 1) {
      log.recordCheckpoint(checkpoint(tick));
      log.recordFrame(frame(tick));
    }

    expect(log.checkpointAtOrBefore(2)).toMatchObject({ tick: 2 });
    expect(log.framesFrom(2).map((candidate) => candidate.tick)).toEqual([2, 3, 4]);
    expect(log.checkpointAtOrBefore(1)).toBeUndefined();
  });

  it("names the default retention window instead of hiding a magic number in room net", () => {
    expect(DEFAULT_SPECTATOR_FRAME_HISTORY_LIMIT).toBe(240);
  });
});

function checkpoint(tick: number): CheckpointFrame {
  return { roomId: "room-sync", tick, snapshot: { tick } as CheckpointFrame["snapshot"], nextId: tick };
}

function frame(tick: number): CommandFrame {
  return { roomId: "room-sync", tick, sequence: tick, commands: [] };
}
