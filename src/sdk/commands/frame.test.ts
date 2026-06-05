import { describe, expect, it } from "vitest";
import { checksumGame } from "../../shared/sim/checksum";
import { createGame } from "../../shared/sim";
import { issueCommandFrame } from "./frame";

describe("SDK command frames", () => {
  it("applies planned SDK commands through a shared command frame", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    expect(worker).toBeDefined();

    const result = issueCommandFrame(game, [
      {
        playerId: "player",
        source: "external-agent",
        scriptId: "sdk-frame-test",
        command: { type: "move", unitIds: [worker!.id], x: worker!.x + 140, y: worker!.y },
      },
    ]);

    expect(result.frame).toEqual({
      roomId: "sdk",
      tick: 0,
      sequence: 0,
      commands: [{ playerId: "player", command: { type: "move", unitIds: [worker!.id], x: worker!.x + 140, y: worker!.y } }],
    });
    expect(result.checksum).toBe(checksumGame(game));
    expect(game.units.find((unit) => unit.id === worker!.id)?.order).toMatchObject({ type: "move" });
  });

  it("rejects invalid SDK frame commands before mutating a partial frame", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall");
    expect(worker).toBeDefined();
    expect(townHall).toBeDefined();

    expect(() =>
      issueCommandFrame(game, [
        {
          playerId: "player",
          source: "external-agent",
          scriptId: "sdk-frame-test",
          command: { type: "move", unitIds: [worker!.id], x: worker!.x + 140, y: worker!.y },
        },
        {
          playerId: "player",
          source: "external-agent",
          scriptId: "sdk-frame-test",
          command: { type: "train", buildingId: townHall!.id, unitKind: "footman" },
        },
      ]),
    ).toThrow(/SDK command frame rejected player sdk-frame-test command: townHall cannot train footman/);

    expect(game.tick).toBe(0);
    expect(game.units.find((unit) => unit.id === worker!.id)?.order).toEqual({ type: "idle" });
  });
});
