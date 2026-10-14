import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../shared/sim";
import { createSketchRtsDebugView } from "./debug-view";

describe("client debug view", () => {
  it("exposes materialized frontend world ids for authoritative room sync checks", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.tick = 17;
    const snapshot = snapshotGame(game);
    const playerUnit = snapshot.units.find((unit) => unit.owner === "player");
    const enemyUnit = snapshot.units.find((unit) => unit.owner === "enemy");
    const playerBuilding = snapshot.buildings.find((building) => building.owner === "player");
    expect(playerUnit).toBeDefined();
    expect(enemyUnit).toBeDefined();
    expect(playerBuilding).toBeDefined();

    const view = createSketchRtsDebugView({
      roomId: "room-sync-proof",
      localPlayerId: "player",
      snapshot,
      selectedIds: new Set([playerUnit!.id, "stale-unit"]),
      focusedSelectionId: playerUnit!.id,
    });

    expect(view).toMatchObject({
      roomId: "room-sync-proof",
      tick: 17,
      focusedSelectionId: playerUnit!.id,
    });
    expect(view.unitIds).toContain(playerUnit!.id);
    expect(view.unitIds).toContain(enemyUnit!.id);
    expect(view.buildingIds).toContain(playerBuilding!.id);
    expect(view.selectedIds).toEqual([playerUnit!.id, "stale-unit"]);
    expect(view.localPlayerUnitIds).toContain(playerUnit!.id);
    expect(view.enemyOrders).toBeDefined();
  });
});
