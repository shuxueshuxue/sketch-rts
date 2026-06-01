import { describe, expect, it } from "vitest";
import { createRoom } from "../shared/rooms";
import { createSaveGameRecord, restoreGameFromSave } from "../shared/savegame";
import { createGame } from "../shared/sim";
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
      .unit("raider", "archer", 670, 565, { id: "raider-archer-1", hp: 40 })
      .townHall("defender", 1320, 520)
      .worker("defender", 1260, 520)
      .worker("defender", 1280, 560)
      .tower("defender", 1180, 500)
      .goldMine("north-main", 430, 520, 3200)
      .mercenaryCamp("market", 900, 900, { stock: 3 })
      .item("storm-prize", "stormStaff", 665, 525, { carrierId: "raider-archer-1" })
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
    expect(game.items.some((item) => item.id === "storm-prize" && item.kind === "stormStaff" && item.carrierId === "raider-archer-1")).toBe(true);
    expect(save.snapshot.tick).toBe(0);
    expect(restoreGameFromSave(save).units).toEqual(game.units);
    expect(trace.initialSave.id).toBe("trace-harass-retreat-initial");
  });

  it("generates complete test maps from SDK scene scripts instead of static defaults", () => {
    const scene = sketchScene("scripted-map")
      .map("bareDuel")
      .replaceDefaults()
      .player("north", { team: "north", race: "grove" })
      .player("south", { team: "south", race: "ember" })
      .townHall("north", 520, 520, { id: "script-north-hall" })
      .townHall("south", 1520, 520, { id: "script-south-hall" })
      .worker("north", 460, 520, { id: "script-north-worker" })
      .worker("south", 1580, 520, { id: "script-south-worker" })
      .goldMine("script-north-mine", 430, 520, 3200)
      .goldMine("script-south-mine", 1610, 520, 3200)
      .mercenaryCamp("script-market", 1024, 740, { stock: 2 })
      .landmark("script-road", "road", 1024, 520, 320)
      .build();

    const game = scene.createGame();

    expect(game.units.map((unit) => unit.id).sort()).toEqual(["script-north-worker", "script-south-worker"]);
    expect(game.buildings.map((building) => building.id).sort()).toEqual(["script-north-hall", "script-south-hall"]);
    expect(game.resources.map((resource) => resource.id).sort()).toEqual(["script-north-mine", "script-south-mine"]);
    expect(game.mercenaryCamps.map((camp) => camp.id)).toEqual(["script-market"]);
    expect(game.map.landmarks.map((landmark) => landmark.id)).toEqual(["script-road"]);
  });

  it("restores old upgrade-list saves into level-one tech state", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const room = { ...createRoom({ id: "old-tech-save-room", host: { id: "host", name: "Host" }, mapId: "bareDuel" }), status: "inMatch" as const };
    const save = createSaveGameRecord(game, room, { id: "old-tech-save" }, new Date("2026-05-31T00:00:00.000Z"));
    (save.snapshot.players.player.upgrades as unknown) = ["weaponTraining"];

    const restored = restoreGameFromSave(save);

    expect(restored.players.player.upgrades).toEqual({ weaponTraining: 1, reinforcedPlating: 0 });
  });
});
