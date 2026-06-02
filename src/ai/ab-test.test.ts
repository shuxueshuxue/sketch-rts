import { describe, expect, it } from "vitest";
import { runBehaviorAbTest } from "./ab-test";
import { sketchScene } from "../sdk/scene";

describe("SDK AI behavior A/B runner", () => {
  it("runs the same scene with a v2 behavior enabled and disabled, then reports telemetry and score delta", () => {
    const scene = sketchScene("ab-economic-catchup")
      .map("openClaims")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .tower("v2", 1370, 760, { id: "v2-natural-tower" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .worker("v2", 450, 500)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .unit("v2", "archer", 850, 710)
      .unit("v2", "archer", 880, 740)
      .townHall("v1", 3300, 3300, { id: "v1-main" })
      .townHall("v1", 2800, 3000, { id: "v1-natural" })
      .townHall("v1", 2450, 2550, { id: "v1-third" })
      .worker("v1", 3350, 3300)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-natural-mine", 1420, 650, 3000)
      .goldMine("v2-third-mine", 2050, 980, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .goldMine("v1-natural-mine", 2820, 3040, 3000)
      .goldMine("v1-third-mine", 2480, 2580, 3000)
      .build();

    const report = runBehaviorAbTest({
      name: "economic catch-up expansion",
      scene,
      owner: "v2",
      behavior: "economicCatchUp",
      maxTicks: 2,
      thinkInterval: 1,
      prepare(game) {
        game.buildings = game.buildings.filter((building) =>
          ["v2-main", "v2-natural", "v2-natural-tower", "v2-barracks", "v2-archery", "v2-stables", "v1-main", "v1-natural", "v1-third"].includes(building.id),
        );
        game.resources = game.resources.filter((resource) => ["v2-main-mine", "v2-natural-mine", "v2-third-mine", "v1-main-mine", "v1-natural-mine", "v1-third-mine"].includes(resource.id));
        game.units = game.units.filter((unit) => unit.id.startsWith("scene-"));
        if (!game.players["v2"]) throw new Error("missing v2 player");
        game.players["v2"].gold = 1200;
      },
      score(snapshot) {
        return snapshot.buildings.filter((building) => building.owner === "v2" && building.kind === "townHall").length;
      },
    });

    expect(report.enabled.telemetry.behaviors.economicCatchUp.catchUpExpansions).toBe(1);
    expect(report.disabled.telemetry.behaviors.economicCatchUp.catchUpExpansions).toBe(0);
    expect(report.enabled.commandCounts.build).toBeGreaterThan(0);
    expect(report.scoreDelta).toBeGreaterThan(0);
    expect(report.improved).toBe(true);
  });

  it("runs A/B cases from a save-backed replay frame without rebuilding the scene", () => {
    const scene = sketchScene("ab-save-backed-harass")
      .map("bareDuel")
      .replaceDefaults()
      .player("raider", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("raider", 500, 500, { id: "raider-main" })
      .townHall("target", 900, 500, { id: "target-main" })
      .unit("raider", "footman", 650, 500, { id: "raider-footman-1" })
      .unit("raider", "archer", 665, 525, { id: "raider-archer-1" })
      .worker("target", 840, 500, { id: "target-worker-1" })
      .worker("target", 860, 525, { id: "target-worker-2" })
      .goldMine("target-main-mine", 860, 500, 2000)
      .build();
    const save = scene.save({ id: "save-harass-frame", label: "harass frame" });

    const report = runBehaviorAbTest({
      name: "save-backed harassment frame",
      save,
      owner: "raider",
      behavior: "earlyHarassment",
      maxTicks: save.snapshot.tick + 1,
      thinkInterval: 1,
      score(_snapshot, telemetry) {
        return telemetry.behaviors.earlyHarassment.workerRaidCommands;
      },
    });

    expect(report.enabled.snapshot.tick).toBe(save.snapshot.tick + 1);
    expect(report.enabled.telemetry.behaviors.earlyHarassment.workerRaidCommands).toBeGreaterThan(0);
    expect(report.disabled.telemetry.behaviors.earlyHarassment.disabledSkips).toBeGreaterThan(0);
    expect(report.scoreDelta).toBeGreaterThan(0);
  });

  it("scores skirmish preservation through the shared A/B runner", () => {
    const scene = sketchScene("ab-skirmish-preservation")
      .map("bareDuel")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 450, 500)
      .unit("v2", "footman", 1900, 1600)
      .unit("v2", "archer", 1940, 1640)
      .townHall("v1", 3300, 3300)
      .worker("v1", 3350, 3300)
      .unit("v1", "footman", 2040, 1600)
      .unit("v1", "lancer", 2060, 1640)
      .unit("v1", "archer", 2080, 1680)
      .unit("v1", "raider", 2100, 1720)
      .build();

    const report = runBehaviorAbTest({
      name: "skirmish preservation retreat",
      scene,
      owner: "v2",
      behavior: "skirmishPreservation",
      maxTicks: 1,
      thinkInterval: 1,
      score(_snapshot, telemetry) {
        return telemetry.behaviors.skirmishPreservation.disadvantagedRetreats;
      },
    });

    expect(report.enabled.telemetry.behaviors.skirmishPreservation.disadvantagedRetreats).toBe(1);
    expect(report.disabled.telemetry.behaviors.skirmishPreservation.disabledSkips).toBeGreaterThan(0);
    expect(report.enabled.commandCounts.move).toBeGreaterThan(0);
    expect(report.scoreDelta).toBeGreaterThan(0);
  });

  it("scores expansion regroup through the shared A/B runner", () => {
    const scene = sketchScene("ab-expansion-regroup")
      .map("bareDuel")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1450, 600, { id: "v2-expansion-townhall" })
      .worker("v2", 450, 500)
      .unit("v2", "footman", 650, 540)
      .unit("v2", "archer", 690, 560)
      .townHall("v1", 3300, 3300)
      .worker("v1", 3350, 3300)
      .unit("v1", "footman", 760, 540)
      .unit("v1", "lancer", 800, 580)
      .unit("v1", "archer", 820, 620)
      .unit("v1", "raider", 840, 660)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-expansion-mine", 1520, 620, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .build();

    const report = runBehaviorAbTest({
      name: "expansion regroup retreat",
      scene,
      owner: "v2",
      behavior: "expansionRegroup",
      maxTicks: 1,
      thinkInterval: 1,
      score(_snapshot, telemetry) {
        return telemetry.behaviors.expansionRegroup.expansionRegroupRetreats;
      },
    });

    expect(report.enabled.telemetry.behaviors.expansionRegroup.expansionRegroupRetreats).toBe(1);
    expect(report.disabled.telemetry.behaviors.expansionRegroup.disabledSkips).toBeGreaterThan(0);
    expect(report.enabled.commandCounts.move).toBeGreaterThan(0);
    expect(report.scoreDelta).toBeGreaterThan(0);
  });
});
