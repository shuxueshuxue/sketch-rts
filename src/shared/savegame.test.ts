import { describe, expect, it } from "vitest";
import { createRoom } from "./rooms";
import { assertSaveGameInput, createSaveGameRecord, parseSaveGameInput, restoreGameFromSave } from "./savegame";
import { checksumGame } from "./sim/checksum";
import { createGame, stepGame } from "./sim";

describe("savegame runtime sync metadata", () => {
  it("stores the deterministic checksum with runtime checkpoint metadata", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    stepGame(game);
    game.projectiles.push({
      id: "projectile-save-sync",
      owner: "player",
      attackerId: "unit-player-archer",
      targetId: "unit-enemy-footman",
      fromX: 900,
      fromY: 900,
      toX: 1100,
      toY: 900,
      damage: 13,
      remaining: 12,
      duration: 24,
    });
    const room = {
      ...createRoom({ id: "save-room", host: { id: "host", name: "Host" }, mapId: "bareDuel" }),
      status: "inMatch" as const,
    };

    const save = createSaveGameRecord(game, room, { id: "save-checksum" }, new Date("2026-06-02T00:00:00.000Z"), []);
    const restored = restoreGameFromSave(save);

    expect(save.runtime.checksum).toBe(checksumGame(game));
    expect(restored.projectiles).toEqual(game.projectiles);
    expect(checksumGame(restored)).toBe(save.runtime.checksum);
  });

  it("normalizes save and debug replay payloads through one shared runtime schema", () => {
    expect(parseSaveGameInput({ id: "save-1", label: "opening", ignored: true })).toEqual({ id: "save-1", label: "opening" });
    expect(parseSaveGameInput({ id: "save-1" })).toEqual({ id: "save-1" });
    expect(parseSaveGameInput({ id: "" })).toBeUndefined();
    expect(parseSaveGameInput({ id: "save-1", label: 12 })).toBeUndefined();
    expect(parseSaveGameInput(undefined)).toBeUndefined();
    expect(assertSaveGameInput({ id: "trace-1", label: "" }, "debug replay input")).toEqual({ id: "trace-1", label: "" });
    expect(() => assertSaveGameInput({ label: "missing id" }, "debug replay input")).toThrow("Malformed debug replay input");
  });
});
