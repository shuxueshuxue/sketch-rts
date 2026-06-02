import { describe, expect, it } from "vitest";
import { LockstepRoomCoordinator } from "./lockstep-room";

describe("lockstep room coordinator", () => {
  it("orders accepted client commands into delayed command frames without sim knowledge", () => {
    const coordinator = new LockstepRoomCoordinator({ roomId: "room-lockstep", commandDelayTicks: 3 });

    const first = coordinator.acceptCommand({
      currentTick: 10,
      playerId: "enemy",
      clientSeq: 2,
      command: { type: "move", unitIds: ["enemy-worker"], x: 800, y: 800 },
    });
    const second = coordinator.acceptCommand({
      currentTick: 10,
      playerId: "player",
      clientSeq: 1,
      command: { type: "move", unitIds: ["player-worker"], x: 400, y: 400 },
    });

    expect(first).toEqual({ roomId: "room-lockstep", accepted: true, sequence: 0, targetTick: 13 });
    expect(second).toEqual({ roomId: "room-lockstep", accepted: true, sequence: 1, targetTick: 13 });
    expect(coordinator.buildFrame(12)).toEqual({ roomId: "room-lockstep", tick: 12, sequence: 0, commands: [] });
    expect(coordinator.buildFrame(13)).toEqual({
      roomId: "room-lockstep",
      tick: 13,
      sequence: 1,
      commands: [
        { playerId: "enemy", clientSeq: 2, command: { type: "move", unitIds: ["enemy-worker"], x: 800, y: 800 } },
        { playerId: "player", clientSeq: 1, command: { type: "move", unitIds: ["player-worker"], x: 400, y: 400 } },
      ],
    });
  });

  it("records checksum frames by tick and player for desync inspection", () => {
    const coordinator = new LockstepRoomCoordinator({ roomId: "room-lockstep" });

    coordinator.recordChecksum({ roomId: "room-lockstep", tick: 20, playerId: "player", hash: "aaaa" });
    coordinator.recordChecksum({ roomId: "room-lockstep", tick: 20, playerId: "enemy", hash: "bbbb" });

    expect(coordinator.checksumsForTick(20)).toEqual({ player: "aaaa", enemy: "bbbb" });
  });
});
