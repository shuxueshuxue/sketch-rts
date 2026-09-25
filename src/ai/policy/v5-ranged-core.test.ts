import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { UNIT_DEFS, UPGRADE_DEFS } from "../../shared/catalog";
import { AI_SCRIPT_LIBRARY, planAiCommandsFromScripts } from "../policy";
import { planSkirmishPreservation } from "./skirmish-tactics";
import { trainingChoice } from "./training-choice";

function groveBase(options: { range: boolean }) {
  let scene = sketchScene(`v5-ranged-core-${options.range}`)
    .map("openClaims")
    .replaceDefaults()
    .player("v5", { team: "north", race: "grove" })
    .player("v3", { team: "south", race: "grove" })
    .player("v4-tr", { team: "south", race: "grove" })
    .townHall("v5", 500, 500)
    .building("v5", "barracks", 620, 560, { id: "barracks" })
    .townHall("v3", 3_300, 3_300)
    .townHall("v4-tr", 3_300, 3_800);
  if (options.range) scene = scene.building("v5", "archeryRange", 700, 560, { id: "range" });
  return snapshotGame(scene.build().createGame());
}

describe("v5 ranged core", () => {
  it("lets the barracks fill in only until the first archery range stands", () => {
    const before = groveBase({ range: false });
    const after = groveBase({ range: true });
    const barracks = (snapshot: typeof before) => snapshot.buildings.find((building) => building.id === "barracks")!;
    expect(trainingChoice(before, "v5", barracks(before), { version: "v2", requestedVersion: "v5" })).toBe("footman");
    expect(trainingChoice(after, "v5", barracks(after), { version: "v2", requestedVersion: "v5" })).toBeUndefined();
    expect(trainingChoice(after, "v5", after.buildings.find((building) => building.id === "range")!, { version: "v2", requestedVersion: "v5" })).toBe("archer");
  });

  it("steps a reloading archer away from a footman that reached it, and holds still once it can shoot", () => {
    const scene = (cooldown: number) => {
      const game = sketchScene(`v5-stutter-${cooldown}`)
        .map("openClaims")
        .replaceDefaults()
        .player("v5", { team: "north", race: "grove" })
        .player("v3", { team: "south", race: "grove" })
        .player("v4-tr", { team: "south", race: "grove" })
        .townHall("v5", 500, 500)
        .townHall("v3", 3_300, 3_300)
        .townHall("v4-tr", 3_300, 3_800)
        .unit("v5", "archer", 1_200, 1_200, { id: "archer" })
        .unit("v3", "footman", 1_240, 1_200, { id: "footman" })
        .build()
        .createGame();
      game.units.find((unit) => unit.id === "archer")!.cooldown = cooldown;
      return planSkirmishPreservation(snapshotGame(game), "v5", { version: "v2", requestedVersion: "v5", teams: game.teams });
    };
    const reloading = scene(UNIT_DEFS.archer.attackCooldown - 2);
    expect(reloading).toHaveLength(1);
    expect(reloading[0]).toMatchObject({ type: "move", unitIds: ["archer"] });
    expect((reloading[0] as { x: number }).x).toBeLessThan(1_200);
    expect(scene(0)).toEqual([]);
  });

  it("researches range before weapons once a spire has shooters to carry it", () => {
    let scene = sketchScene("v5-shooter-upgrades")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 900)
      .building("v5", "emberForge", 620, 560)
      .building("v5", "cinderSpire", 700, 560, { id: "spire" })
      .townHall("v3", 3_300, 3_300)
      .townHall("v4-tr", 3_300, 3_800);
    for (let index = 0; index < 6; index += 1) scene = scene.unit("v5", "sparkArcher", 800 + index * 24, 700);
    const game = scene.build().createGame();
    game.players.v5!.gold = UPGRADE_DEFS.rangeTraining.levels[0]!.cost + UPGRADE_DEFS.weaponTraining.levels[0]!.cost;
    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.tech], { version: "v2", requestedVersion: "v5", teams: game.teams });
    expect(commands[0]).toMatchObject({ type: "research", buildingId: "spire", upgradeKind: "rangeTraining" });
  });
});
