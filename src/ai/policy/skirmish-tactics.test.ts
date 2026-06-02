import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { planSkirmishPreservation } from "./skirmish-tactics";

describe("AI skirmish tactics", () => {
  it("pulls a wounded ranged unit away from a melee unit that has closed the distance", () => {
    const game = sketchScene("skirmish-tactics-ranged-kite")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .unit("v2", "archer", 820, 520, { id: "wounded-archer", hp: 28 })
      .unit("v1", "footman", 850, 520, { id: "chaser" })
      .build()
      .createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move", unitIds: ["wounded-archer"] });
    expect(command?.type === "move" ? command.x : 0).toBeLessThan(820);
  });

  it("retreats a modestly disadvantaged open-field group before it gets wiped", () => {
    const game = sketchScene("skirmish-tactics-modest-disadvantage")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3300, 3300)
      .unit("v2", "footman", 1800, 1600)
      .unit("v2", "lancer", 1840, 1640)
      .unit("v2", "archer", 1880, 1680)
      .unit("v1", "footman", 1940, 1600)
      .unit("v1", "lancer", 1980, 1640)
      .unit("v1", "contractArcher", 2020, 1680)
      .build()
      .createGame();

    const command = planSkirmishPreservation(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move" });
  });
});
