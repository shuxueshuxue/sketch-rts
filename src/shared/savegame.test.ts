import { describe, expect, it } from "vitest";
import { createRoom } from "./rooms";
import { createSaveGameRecord, restoreGameFromSave } from "./savegame";
import { checksumGame } from "./sim/checksum";
import { createGame, stepGame } from "./sim";

describe("savegame runtime sync metadata", () => {
  it("stores the deterministic checksum with runtime checkpoint metadata", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    stepGame(game);
    const room = {
      ...createRoom({ id: "save-room", host: { id: "host", name: "Host" }, mapId: "bareDuel" }),
      status: "inMatch" as const,
    };

    const save = createSaveGameRecord(game, room, { id: "save-checksum" }, new Date("2026-06-02T00:00:00.000Z"), []);
    const restored = restoreGameFromSave(save);

    expect(save.runtime.checksum).toBe(checksumGame(game));
    expect(checksumGame(restored)).toBe(save.runtime.checksum);
  });
});
