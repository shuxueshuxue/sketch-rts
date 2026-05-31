import { describe, expect, it } from "vitest";
import { restoreGameFromSave } from "../shared/savegame";
import { sketchScene } from "./scene";

describe("SDK scene builder", () => {
  it("builds readable save-backed micro-scenes from a fluent API", () => {
    const scene = sketchScene("harass-retreat")
      .map("bareDuel")
      .player("raider", { team: "north", race: "ember" })
      .player("defender", { team: "south", race: "grove", ai: true })
      .townHall("raider", 520, 520)
      .worker("raider", 470, 520)
      .unit("raider", "raider", 650, 530)
      .unit("raider", "archer", 670, 565, { hp: 40 })
      .townHall("defender", 1320, 520)
      .worker("defender", 1260, 520)
      .worker("defender", 1280, 560)
      .tower("defender", 1180, 500)
      .goldMine("north-main", 430, 520, 3200)
      .mercenaryCamp("market", 900, 900, { stock: 3 })
      .landmark("road", "road", 900, 620, 260)
      .build();

    const setup = scene.toGameSetup();
    const game = scene.createGame();
    const save = scene.save({ id: "save-harass-retreat", label: "harass retreat frame" });
    const trace = scene.debugReplay({ id: "trace-harass-retreat" });

    expect(setup.players).toEqual(["raider", "defender"]);
    expect(setup.aiPlayers).toEqual(["defender"]);
    expect(setup.teams).toEqual({ raider: "north", defender: "south" });
    expect(setup.scenario?.addUnits?.map((unit) => unit.id)).toContain("scene-harass-retreat-raider-raider-1");
    expect(game.units.some((unit) => unit.owner === "raider" && unit.kind === "archer" && unit.hp === 40)).toBe(true);
    expect(game.buildings.some((building) => building.owner === "defender" && building.kind === "defenseTower")).toBe(true);
    expect(game.resources.some((resource) => resource.id === "north-main" && resource.amount === 3200)).toBe(true);
    expect(save.snapshot.tick).toBe(0);
    expect(restoreGameFromSave(save).units).toEqual(game.units);
    expect(trace.initialSave.id).toBe("trace-harass-retreat-initial");
  });
});
