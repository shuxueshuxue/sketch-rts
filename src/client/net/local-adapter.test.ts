import { describe, expect, it } from "vitest";
import { createGame } from "../../shared/sim";
import { LocalGameAdapter } from "./local-adapter";

describe("local game adapter", () => {
  it("applies local commands through command frames before stepping simulation", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();
    const adapter = new LocalGameAdapter(game, "player");

    adapter.sendCommand({ type: "move", unitIds: [worker!.id], x: worker!.x + 80, y: worker!.y });

    expect(adapter.currentSnapshot().tick).toBe(1);
    expect(game.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
  });
});
