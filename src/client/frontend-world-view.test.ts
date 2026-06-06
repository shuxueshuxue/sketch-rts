import { describe, expect, it } from "vitest";
import type { GameAdapter } from "./game-adapter";
import { syncFrontendWorldView } from "./frontend-world-view";
import type { ControlGroups } from "./control-groups";
import { createGame, snapshotGame } from "../shared/sim";
import type { GameCommand, GameSnapshot } from "../shared/types";

describe("frontend world view", () => {
  it("materializes adapter truth every frame and prunes stale selected ids at the same tick", () => {
    const oldGame = createGame("bareDuel", { aiPlayers: [] });
    oldGame.tick = 12;
    const oldSnapshot = snapshotGame(oldGame);
    const staleUnit = oldSnapshot.units.find((unit) => unit.owner === "player");
    expect(staleUnit).toBeDefined();

    const checkpointGame = createGame("bareDuel", { aiPlayers: [] });
    checkpointGame.tick = 12;
    checkpointGame.players.player.gold = 8744;
    checkpointGame.units = checkpointGame.units.filter((unit) => unit.id !== staleUnit!.id);
    const currentSnapshot = snapshotGame(checkpointGame);
    const adapter = new StaticSnapshotAdapter(currentSnapshot);
    const controlGroups: ControlGroups = { 1: [staleUnit!.id] };

    const view = syncFrontendWorldView(adapter, {
      owner: "player",
      snapshot: oldSnapshot,
      selectedIds: new Set([staleUnit!.id]),
      focusedSelectionId: staleUnit!.id,
      selectedCampId: undefined,
      controlGroups,
    });

    if (!view.snapshot) throw new Error("Expected frontend world view to materialize a snapshot");
    expect(view.snapshot.players.player.gold).toBe(8744);
    expect(view.snapshot.units.some((unit) => unit.id === staleUnit!.id)).toBe(false);
    expect(view.selectedIds.has(staleUnit!.id)).toBe(false);
    expect(view.focusedSelectionId).not.toBe(staleUnit!.id);
    expect(controlGroups[1]).toBeUndefined();
  });
});

class StaticSnapshotAdapter implements GameAdapter {
  constructor(private readonly snapshot: GameSnapshot) {}

  sendCommand(_command: GameCommand): void {}

  currentSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  updateToRenderTime(): boolean {
    return false;
  }

  close(): void {}
}
