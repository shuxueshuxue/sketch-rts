import { describe, expect, it } from "vitest";
import { decodeServerNetMessage, encodeNetMessage } from "../shared/net/codec";
import type { CommandFrame, ServerNetMessage } from "../shared/net/types";
import { createRoom } from "../shared/rooms";
import { createSaveGameRecord, restoreGameFromSave, type SaveGameRecord } from "../shared/savegame";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../shared/sim";
import { checksumGame } from "../shared/sim/checksum";
import { SimulationEngine } from "../shared/sim/engine";
import { createRoomHost } from "./room-host";
import { RoomNetHub, type RoomNetSocket } from "./room-net";

const hostUser = { id: "host", name: "Host" };

describe("continued room navigation preparation", () => {
  it("prepares an actual saved deep search without changing the room tick, snapshot or checksum", () => {
    const save = deepIslandSave(), host = createRoomHost();
    const room = host.continueSave(save.id, save, { roomId: "prepare-deep" });
    const before = JSON.stringify(host.snapshot(room.id)), checksum = host.checksumRoom(room.id);
    expect(host.prepareRoomTick(room.id, 0)).toBe(false);
    let preparations = 0;
    while (!host.prepareRoomTick(room.id, 1) && preparations < 32) {
      preparations++;
      expect(JSON.stringify(host.snapshot(room.id))).toBe(before);
      expect(host.checksumRoom(room.id)).toBe(checksum);
    }
    expect(preparations).toBeGreaterThanOrEqual(18);
    expect(preparations).toBeLessThan(32);
    expect(JSON.stringify(host.snapshot(room.id))).toBe(before);
    expect(host.checksumRoom(room.id)).toBe(checksum);
    expect(host.prepareRoomTick(room.id, 0)).toBe(true);
    const reference = restoreGameFromSave(save);
    stepGame(reference);
    expect(JSON.stringify(host.tickRoom(room.id, 1).snapshot)).toBe(JSON.stringify(snapshotGame(reference)));
    expect(host.checksumRoom(room.id)).toBe(checksumGame(reference));
  });

  it("leaves a continued automatic room unchanged while its derived search warms over ticker turns", () => {
    const save = deepIslandSave(), host = createRoomHost();
    const room = host.continueSave(save.id, save, { roomId: "auto-deep" });
    const before = JSON.stringify(host.snapshot(room.id)), checksum = host.checksumRoom(room.id);
    let waitingTurns = 0, advanced = false;
    for (let turn = 0; turn < 32; turn++) {
      const changed = host.tickActiveRooms(1);
      if (changed.length) { advanced = true; break; }
      waitingTurns++;
      expect(JSON.stringify(host.snapshot(room.id))).toBe(before);
      expect(host.checksumRoom(room.id)).toBe(checksum);
    }
    expect(waitingTurns).toBeGreaterThanOrEqual(18);
    expect(advanced).toBe(true);
    const reference = restoreGameFromSave(save);
    stepGame(reference);
    expect(JSON.stringify(host.snapshot(room.id))).toBe(JSON.stringify(snapshotGame(reference)));
    expect(host.checksumRoom(room.id)).toBe(checksumGame(reference));
  });

  it("retains admitted network commands and sequence numbers until a continued search is ready", () => {
    const save = deepIslandSave(), host = createRoomHost();
    const room = host.continueSave(save.id, save, { roomId: "net-deep" });
    const hub = new RoomNetHub({ roomHost: host, commandDelayTicks: 0 }), socket = new FakeSocket();
    hub.connect(room.id, socket);
    const ship = host.snapshot(room.id).units[0]!;
    const command = { type: "stop" as const, unitIds: [ship.id] };
    socket.emit(encodeNetMessage({ type: "command", roomId: room.id, playerId: "player", clientSeq: 9, epoch: 0, command }));
    const before = JSON.stringify(host.snapshot(room.id)), checksum = host.checksumRoom(room.id);
    let waitingTurns = 0, applied: CommandFrame | undefined;
    for (let turn = 0; turn < 32 && !applied; turn++) {
      applied = hub.tickRoom(room.id);
      if (!applied) {
        waitingTurns++;
        expect(JSON.stringify(host.snapshot(room.id))).toBe(before);
        expect(host.checksumRoom(room.id)).toBe(checksum);
        expect(socket.messages().some(message => message.type === "frame")).toBe(false);
      }
    }
    expect(waitingTurns).toBeGreaterThanOrEqual(18);
    expect(applied).toBeDefined();
    expect(applied!.sequence).toBe(0);
    expect(applied!.tick).toBe(save.snapshot.tick);
    expect(applied!.commands).toContainEqual({ playerId: "player", clientSeq: 9, command });
    expect(socket.messages().filter(message => message.type === "frame")).toHaveLength(1);
    const reference = new SimulationEngine(restoreGameFromSave(save));
    reference.advanceFrame(applied!);
    expect(JSON.stringify(host.snapshot(room.id))).toBe(JSON.stringify(reference.snapshot()));
    expect(host.checksumRoom(room.id)).toBe(reference.checksum());
    const next = hub.tickRoom(room.id)!;
    expect(next.sequence).toBe(1);
    expect(next.commands).not.toContainEqual({ playerId: "player", clientSeq: 9, command });
  });
});

let cachedSave: SaveGameRecord | undefined;

function deepIslandSave(): SaveGameRecord {
  if (cachedSave) return cachedSave;
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.units = []; game.items = []; game.resources = [];
  game.mercenaryCamps = []; game.obstacles = [];
  const cell = 64, cols = 256, rows = 256;
  game.map = { ...game.map, width: cols * cell, height: rows * cell, wind: { direction: Math.PI, speed: 80 },
    terrain: { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, index) => {
      const x = index % cols, y = Math.floor(index / cols);
      return x >= 65 && x < 85 && y >= 67 && y < 112 ? "." : "~";
    }).join("") } };
  const ship = game.spawnUnit("player", "warship", 1800, 5660);
  ship.sailing!.heading = 0;
  issuePlayerCommand(game, "player", { type: "move", unitIds: [ship.id], x: 9000, y: 5660, avoidCombat: true });
  for (let tick = 0; tick < 80; tick++) {
    stepGame(game);
    const job = ship.sailing!.planningJob && JSON.parse(ship.sailing!.planningJob);
    if (job?.phase === "reference" && job.searchSteps >= 19) {
      const room = { ...createRoom({ id: "deep-island-save", host: hostUser, mapId: "bareDuel" }), status: "inMatch" as const };
      cachedSave = createSaveGameRecord(game, room, { id: "deep-island-save" });
      return cachedSave;
    }
  }
  throw new Error("The adverse-wind island did not produce its actual deep reference search");
}

class FakeSocket implements RoomNetSocket {
  sent: string[] = [];
  private handler?: (raw: string) => void;

  send(raw: string): void { this.sent.push(raw); }

  on(event: "message" | "close", handler: ((raw: string) => void) | (() => void)): void {
    if (event === "message") this.handler = handler as (raw: string) => void;
  }

  emit(raw: string): void { this.handler?.(raw); }

  messages(): ServerNetMessage[] { return this.sent.map(raw => decodeServerNetMessage(raw)); }
}
