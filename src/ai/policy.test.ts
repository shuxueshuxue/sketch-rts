import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, UNIT_DEFS, UPGRADE_DEFS } from "../shared/catalog";
import { createBuilding } from "../shared/map";
import { runAiGame, runAiGameLoop } from "./game-runner";
import { createAiRuntime } from "./runtime";
import { runPresetAiRuntimeForTest } from "./runtime-test-helpers";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../shared/sim";
import { AI_SCRIPT_LIBRARY, AI_SCRIPT_VERSIONS, createAiPolicyMemory, createAiTelemetry, planAiCommandEntriesFromScripts, planAiCommandsFromScripts, planPresetAiCommandEntries, planPresetAiCommands } from "./policy";
import { sketchScene } from "../sdk/scene";

describe("SDK preset AI policy", () => {
  it("exposes named AI script versions for SDK and room adapters", () => {
    expect(Object.keys(AI_SCRIPT_VERSIONS)).toEqual(["v1", "v2", "v3", "v3-grove", "v3-ember", "v4-tr", "v5"]);
    expect(AI_SCRIPT_VERSIONS.v1.length).toBeGreaterThan(0);
    expect(AI_SCRIPT_VERSIONS.v2.map((script) => script.id)).toEqual(AI_SCRIPT_VERSIONS.v1.map((script) => script.id));
    expect(AI_SCRIPT_VERSIONS.v3.map((script) => script.id)).toEqual(AI_SCRIPT_VERSIONS.v2.map((script) => script.id));
    expect(AI_SCRIPT_VERSIONS["v3-grove"].map((script) => script.id)).toEqual(AI_SCRIPT_VERSIONS.v3.map((script) => script.id));
    expect(AI_SCRIPT_VERSIONS["v3-ember"].map((script) => script.id)).toEqual(AI_SCRIPT_VERSIONS.v3.map((script) => script.id));
    expect(AI_SCRIPT_VERSIONS["v4-tr"].map((script) => script.id)).toContain("mercenary");
    const v2ScriptIds = AI_SCRIPT_VERSIONS.v2.map((script) => script.id);
    const v5ScriptIds = AI_SCRIPT_VERSIONS.v5.map((script) => script.id);
    const productionIndex = v2ScriptIds.findIndex((scriptId) => scriptId === "productionBuilding");
    const v5Expected = [...v2ScriptIds.slice(0, productionIndex), "economicCatchUp", "earlyTech", ...v2ScriptIds.slice(productionIndex)];
    v5Expected.splice(v5Expected.indexOf("objectiveControl"), 1);
    v5Expected.splice(v5Expected.indexOf("workerPressure"), 0, "objectiveControl");
    expect(v5ScriptIds).toEqual(v5Expected);

    const game = createGame("bareDuel", { aiPlayers: [] });
    const v1 = planPresetAiCommands(snapshotGame(game), "player", { version: "v1" });
    const v2 = planPresetAiCommands(snapshotGame(game), "player", { version: "v2" });
    const v3 = planPresetAiCommands(snapshotGame(game), "player", { version: "v3" });

    expect(v1[0]).toMatchObject({ type: "mine" });
    expect(v2[0]).toMatchObject({ type: "mine" });
    expect(v3[0]).toMatchObject({ type: "mine" });
  });

  it("rejects v2-prod on the live preset policy helper so frozen baseline must use planner context", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });

    expect(() => planPresetAiCommands(snapshotGame(game), "player", { version: "v2-prod" })).toThrow(/v2-prod.*planner context/i);
  });

  it("v5 keeps the shared early weapon timing before the next production building", () => {
    const scene = sketchScene("v5-shared-early-weapon-timing")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "barracks", 620, 560, { id: "v5-barracks" })
      .unit("v5", "footman", 720, 560)
      .unit("v5", "lancer", 760, 600)
      .unit("v5", "footman", 800, 640)
      .unit("v5", "lancer", 840, 680)
      .unit("v5", "archer", 880, 720)
      .townHall("v3", 1700, 500)
      .townHall("v4-tr", 1700, 900)
      .goldMine("v5-main", 560, 540, 3000)
      .goldMine("v3-main", 1700, 500, 3000)
      .goldMine("v4-main", 1700, 900, 3000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 160;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", AI_SCRIPT_VERSIONS.v5, {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });
    const firstTechOrProduction = entries.find((entry) => entry.scriptId === "earlyTech" || entry.scriptId === "productionBuilding");

    expect(firstTechOrProduction).toMatchObject({
      scriptId: "earlyTech",
      command: { type: "research", buildingId: "v5-barracks", upgradeKind: "weaponTraining" },
    });
  });

  it("v5 severe-economy two-base timing banks early weapon gold for the missing ranged production building", () => {
    const scene = sketchScene("v5-severe-economy-production-before-early-tech")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 700)
      .building("v5", "barracks", 620, 560, { id: "v5-barracks" })
      .worker("v5", 520, 540, { order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .worker("v5", 900, 700, { order: { type: "mine", resourceId: "v5-natural-mine", phase: "gather", timer: 0 } })
      .unit("v5", "footman", 720, 560)
      .unit("v5", "lancer", 760, 600)
      .unit("v5", "footman", 800, 640)
      .unit("v5", "lancer", 840, 680)
      .unit("v5", "footman", 880, 720)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 3000)
      .goldMine("v5-natural-mine", 900, 700, 3000)
      .goldMine("v3a-main-mine", 3340, 3000, 3000)
      .goldMine("v3b-main-mine", 3340, 3400, 3000)
      .goldMine("v3c-main-mine", 3340, 3800, 3000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = UPGRADE_DEFS.weaponTraining.levels[0]!.cost;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.earlyTech, AI_SCRIPT_LIBRARY.productionBuilding, AI_SCRIPT_LIBRARY.tech], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.command.type === "research")).toBeUndefined();
  });

  it("v5 severe no-expansion timing builds missing stables before early weapon timing", () => {
    const scene = sketchScene("v5-severe-no-expansion-stables-before-early-tech")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "v5", race: "grove" })
      .player("v3a", { team: "v3", race: "grove" })
      .player("v3b", { team: "v3", race: "ember" })
      .player("v3c", { team: "v3", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "barracks", 620, 560, { id: "v5-barracks" })
      .building("v5", "archeryRange", 700, 560)
      .building("v5", "farm", 480, 650)
      .building("v5", "farm", 560, 650)
      .building("v5", "farm", 640, 650)
      .tower("v5", 650, 500)
      .worker("v5", 520, 540, { id: "v5-builder", order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .townHall("v3a", 1700, 500)
      .townHall("v3b", 1700, 900)
      .townHall("v3c", 1700, 1300)
      .goldMine("v5-main-mine", 560, 540, 3000)
      .goldMine("v3a-main-mine", 1700, 500, 3000)
      .goldMine("v3b-main-mine", 1700, 900, 3000)
      .goldMine("v3c-main-mine", 1700, 1300, 3000);
    for (let index = 0; index < 8; index += 1) scene.unit("v5", index % 3 === 0 ? "footman" : index % 3 === 1 ? "lancer" : "archer", 720 + index * 24, 620 + (index % 2) * 28);
    const game = scene.build().createGame();
    game.players.v5!.gold = BUILDING_DEFS.stables.cost + 15;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", AI_SCRIPT_VERSIONS.v5, {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });
    const firstTechOrProduction = entries.find((entry) => entry.scriptId === "earlyTech" || entry.scriptId === "productionBuilding");

    expect(firstTechOrProduction).toMatchObject({
      scriptId: "productionBuilding",
      command: { type: "build", unitId: "v5-builder", buildingKind: "stables" },
    });
  });

  it("v5 finishes a nearby damaged objective camp before worker pressure", () => {
    const scene = sketchScene("v5-objective-before-worker-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 720, 700)
      .worker("v5", 520, 520, { order: { type: "mine", resourceId: "v5-main", phase: "gather", timer: 0 } })
      .worker("v5", 720, 700, { order: { type: "mine", resourceId: "v5-natural", phase: "gather", timer: 0 } })
      .unit("v5", "footman", 640, 520)
      .unit("v5", "footman", 670, 550)
      .unit("v5", "lancer", 700, 580)
      .unit("v5", "archer", 730, 610)
      .unit("v5", "footman", 760, 640)
      .unit("v5", "contractArcher", 790, 670)
      .mercenaryCamp("damaged-field-tent", 980, 660, { hireKind: "fieldMedic", stock: 1 })
      .unit("neutral", "barkMender", 980, 620, { id: "damaged-mender", hp: 20 })
      .unit("neutral", "wildling", 1030, 660, { id: "damaged-wildling", hp: 28 })
      .unit("neutral", "stonebackBrute", 950, 700, { id: "damaged-brute", hp: 78 })
      .townHall("v3", 3000, 3000)
      .townHall("v4-tr", 1500, 620)
      .worker("v4-tr", 1430, 620, { id: "exposed-worker" })
      .goldMine("v5-main", 540, 520, 3000)
      .goldMine("v5-natural", 740, 700, 3000)
      .goldMine("v3-main", 3000, 3000, 3000)
      .goldMine("v4-main", 1500, 620, 3000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 0;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", AI_SCRIPT_VERSIONS.v5, {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });
    const firstTacticalEntry = entries.find((entry) => entry.scriptId === "workerPressure" || entry.scriptId === "objectiveControl");

    expect(firstTacticalEntry).toMatchObject({
      scriptId: "objectiveControl",
      command: { type: "attackMove", x: 980, y: 660 },
    });
  });

  it("v5 severe no-expansion timing commits stables at five combat before more basic recovery", () => {
    const scene = sketchScene("v5-severe-no-expansion-five-combat-stables")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "v5", race: "grove" })
      .player("v3a", { team: "v3", race: "grove" })
      .player("v3b", { team: "v3", race: "ember" })
      .player("v3c", { team: "v3", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "barracks", 620, 560, { id: "v5-barracks" })
      .building("v5", "archeryRange", 700, 560)
      .building("v5", "farm", 480, 650)
      .building("v5", "farm", 560, 650)
      .building("v5", "farm", 640, 650)
      .tower("v5", 650, 500)
      .building("v5", "moonWell", 580, 690)
      .worker("v5", 520, 540, { id: "v5-builder", order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .townHall("v3a", 1700, 500)
      .unit("v3a", "footman", 960, 620)
      .unit("v3a", "lancer", 1010, 650)
      .unit("v3a", "footman", 1060, 680)
      .townHall("v3b", 1700, 900)
      .townHall("v3c", 1700, 1300)
      .goldMine("v5-main-mine", 560, 540, 3000)
      .goldMine("v3a-main-mine", 1700, 500, 3000)
      .goldMine("v3b-main-mine", 1700, 900, 3000)
      .goldMine("v3c-main-mine", 1700, 1300, 3000);
    for (let index = 0; index < 5; index += 1) scene.unit("v5", index % 3 === 0 ? "footman" : index % 3 === 1 ? "lancer" : "archer", 720 + index * 24, 620 + (index % 2) * 28);
    const game = scene.build().createGame();
    game.players.v5!.gold = BUILDING_DEFS.stables.cost + 5;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", AI_SCRIPT_VERSIONS.v5, {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });
    const firstBuild = entries.find((entry) => entry.command.type === "build");

    expect(firstBuild).toMatchObject({
      scriptId: "productionBuilding",
      command: { type: "build", unitId: "v5-builder", buildingKind: "stables" },
    });
  });

  it("v5 severe no-expansion timing builds missing stables before routine supply", () => {
    const scene = sketchScene("v5-severe-no-expansion-stables-before-supply")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "v5", race: "grove" })
      .player("v3a", { team: "v3", race: "grove" })
      .player("v3b", { team: "v3", race: "ember" })
      .player("v3c", { team: "v3", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .building("v5", "farm", 480, 650)
      .building("v5", "farm", 560, 650)
      .building("v5", "farm", 640, 650)
      .tower("v5", 650, 500)
      .worker("v5", 520, 540, { id: "v5-builder", order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .townHall("v3a", 1700, 500)
      .townHall("v3b", 1700, 900)
      .townHall("v3c", 1700, 1300)
      .goldMine("v5-main-mine", 560, 540, 3000)
      .goldMine("v3a-main-mine", 1700, 500, 3000)
      .goldMine("v3b-main-mine", 1700, 900, 3000)
      .goldMine("v3c-main-mine", 1700, 1300, 3000);
    for (let index = 0; index < 10; index += 1) scene.unit("v5", index % 3 === 0 ? "footman" : index % 3 === 1 ? "lancer" : "archer", 720 + index * 24, 620 + (index % 2) * 28);
    const game = scene.build().createGame();
    game.players.v5!.gold = BUILDING_DEFS.stables.cost + 15;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", AI_SCRIPT_VERSIONS.v5, {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });
    const firstBuild = entries.find((entry) => entry.command.type === "build");

    expect(firstBuild).toMatchObject({
      scriptId: "productionBuilding",
      command: { type: "build", unitId: "v5-builder", buildingKind: "stables" },
    });
  });

  it("v5 severe-economy two-base timing spends the shared utility bank on missing ranged production before tower or healing", () => {
    const scene = sketchScene("v5-severe-economy-production-before-utility")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 700)
      .building("v5", "barracks", 620, 560, { id: "v5-barracks" })
      .worker("v5", 520, 540, { id: "v5-builder", order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .worker("v5", 900, 700, { order: { type: "mine", resourceId: "v5-natural-mine", phase: "gather", timer: 0 } })
      .unit("v5", "footman", 720, 560, { hp: 70 })
      .unit("v5", "lancer", 760, 600, { hp: 70 })
      .unit("v5", "footman", 800, 640)
      .unit("v5", "lancer", 840, 680)
      .unit("v5", "footman", 880, 720)
      .townHall("v3a", 3300, 3000)
      .unit("v3a", "footman", 1220, 760)
      .unit("v3a", "footman", 1260, 800)
      .unit("v3a", "lancer", 1300, 840)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 3000)
      .goldMine("v5-natural-mine", 900, 700, 3000)
      .goldMine("v3a-main-mine", 3340, 3000, 3000)
      .goldMine("v3b-main-mine", 3340, 3400, 3000)
      .goldMine("v3c-main-mine", 3340, 3800, 3000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = BUILDING_DEFS.archeryRange.cost;

    const firstBuild = planAiCommandEntriesFromScripts(
      snapshotGame(game),
      "v5",
      [AI_SCRIPT_LIBRARY.emergencyDefense, AI_SCRIPT_LIBRARY.defense, AI_SCRIPT_LIBRARY.healingWell, AI_SCRIPT_LIBRARY.productionBuilding],
      { version: "v2", requestedVersion: "v5", teams: game.teams },
    ).find((entry) => entry.command.type === "build");

    expect(firstBuild).toMatchObject({ scriptId: "productionBuilding", command: { type: "build", buildingKind: "archeryRange" } });
  });

  it("v5 severe two-mine pressure holds near-tower gold instead of training another basic unit", () => {
    const scene = sketchScene("v5-severe-two-mine-main-tower-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "v5", race: "grove" })
      .player("v3a", { team: "v3", race: "grove" })
      .player("v3b", { team: "v3", race: "ember" })
      .player("v3c", { team: "v3", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 700)
      .building("v5", "barracks", 620, 560)
      .worker("v5", 520, 540, { order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .worker("v5", 540, 560, { order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .worker("v5", 900, 700, { order: { type: "mine", resourceId: "v5-natural-mine", phase: "gather", timer: 0 } })
      .worker("v5", 920, 720, { order: { type: "mine", resourceId: "v5-natural-mine", phase: "gather", timer: 0 } })
      .townHall("v3a", 1700, 500)
      .townHall("v3b", 1700, 900)
      .townHall("v3c", 1700, 1300)
      .goldMine("v5-main-mine", 560, 540, 3000)
      .goldMine("v5-natural-mine", 900, 700, 3000)
      .goldMine("v3a-main-mine", 1700, 500, 3000)
      .goldMine("v3b-main-mine", 1700, 900, 3000)
      .goldMine("v3c-main-mine", 1700, 1300, 3000);
    for (let index = 0; index < 4; index += 1) scene.unit("v5", index % 2 === 0 ? "footman" : "lancer", 700 + index * 28, 620);
    for (let index = 0; index < 6; index += 1) scene.unit("v3a", index % 2 === 0 ? "footman" : "lancer", 930 + index * 34, 610 + (index % 2) * 28);
    const game = scene.build().createGame();
    game.players.v5!.gold = BUILDING_DEFS.defenseTower.cost - 10;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries).toEqual([]);
  });

  it("v5 severe main pressure builds a second main tower despite existing tower coverage", () => {
    const scene = sketchScene("v5-severe-second-main-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "v5", race: "grove" })
      .player("v3a", { team: "v3", race: "grove" })
      .player("v3b", { team: "v3", race: "ember" })
      .player("v3c", { team: "v3", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 700)
      .building("v5", "barracks", 620, 560)
      .tower("v5", 650, 500)
      .worker("v5", 520, 540, { id: "v5-builder" })
      .worker("v5", 540, 560, { order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .worker("v5", 900, 700, { order: { type: "mine", resourceId: "v5-natural-mine", phase: "gather", timer: 0 } })
      .townHall("v3a", 1700, 500)
      .townHall("v3b", 1700, 900)
      .townHall("v3c", 1700, 1300)
      .goldMine("v5-main-mine", 560, 540, 3000)
      .goldMine("v5-natural-mine", 900, 700, 3000)
      .goldMine("v3a-main-mine", 1700, 500, 3000)
      .goldMine("v3b-main-mine", 1700, 900, 3000)
      .goldMine("v3c-main-mine", 1700, 1300, 3000);
    for (let index = 0; index < 6; index += 1) scene.unit("v5", index % 2 === 0 ? "footman" : "lancer", 700 + index * 28, 620);
    for (let index = 0; index < 10; index += 1) scene.unit("v3a", index % 2 === 0 ? "footman" : "lancer", 890 + index * 30, 610 + (index % 2) * 28);
    const game = scene.build().createGame();
    game.players.v5!.gold = BUILDING_DEFS.defenseTower.cost;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.defense], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries[0]?.command).toMatchObject({ type: "build", unitId: "v5-builder", buildingKind: "defenseTower" });
  });

  it("v5 severe main pressure holds routine supply gold for a second main tower", () => {
    const scene = sketchScene("v5-severe-second-main-tower-supply-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "v5", race: "grove" })
      .player("v3a", { team: "v3", race: "grove" })
      .player("v3b", { team: "v3", race: "ember" })
      .player("v3c", { team: "v3", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 700)
      .building("v5", "barracks", 620, 560)
      .tower("v5", 650, 500)
      .worker("v5", 520, 540, { id: "v5-builder" })
      .townHall("v3a", 1700, 500)
      .townHall("v3b", 1700, 900)
      .townHall("v3c", 1700, 1300)
      .goldMine("v5-main-mine", 560, 540, 3000)
      .goldMine("v5-natural-mine", 900, 700, 3000)
      .goldMine("v3a-main-mine", 1700, 500, 3000)
      .goldMine("v3b-main-mine", 1700, 900, 3000)
      .goldMine("v3c-main-mine", 1700, 1300, 3000);
    for (let index = 0; index < 6; index += 1) scene.unit("v5", index % 2 === 0 ? "footman" : "lancer", 700 + index * 28, 620);
    for (let index = 0; index < 10; index += 1) scene.unit("v3a", index % 2 === 0 ? "footman" : "lancer", 890 + index * 30, 610 + (index % 2) * 28);
    const game = scene.build().createGame();
    game.players.v5!.gold = BUILDING_DEFS.defenseTower.cost - 30;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.supply], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries).toEqual([]);
  });

  it("v5 severe two-mine pressure holds worker gold for the next combat unit", () => {
    const scene = sketchScene("v5-severe-two-mine-worker-bank-for-combat")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "v5", race: "grove" })
      .player("v3a", { team: "v3", race: "grove" })
      .player("v3b", { team: "v3", race: "ember" })
      .player("v3c", { team: "v3", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 700)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .tower("v5", 650, 500)
      .worker("v5", 520, 540, { order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .worker("v5", 540, 560, { order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .worker("v5", 900, 700, { order: { type: "mine", resourceId: "v5-natural-mine", phase: "gather", timer: 0 } })
      .worker("v5", 920, 720, { order: { type: "mine", resourceId: "v5-natural-mine", phase: "gather", timer: 0 } })
      .worker("v5", 940, 740)
      .townHall("v3a", 1700, 500)
      .townHall("v3b", 1700, 900)
      .townHall("v3c", 1700, 1300)
      .goldMine("v5-main-mine", 560, 540, 3000)
      .goldMine("v5-natural-mine", 900, 700, 3000)
      .goldMine("v3a-main-mine", 1700, 500, 3000)
      .goldMine("v3b-main-mine", 1700, 900, 3000)
      .goldMine("v3c-main-mine", 1700, 1300, 3000);
    for (let index = 0; index < 2; index += 1) scene.unit("v5", "footman", 700 + index * 28, 620);
    for (let index = 0; index < 5; index += 1) scene.unit("v3a", index % 2 === 0 ? "footman" : "lancer", 930 + index * 34, 610 + (index % 2) * 28);
    const game = scene.build().createGame();
    game.players.v5!.gold = UNIT_DEFS.worker.cost;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries).toEqual([]);
  });

  it("v5 severe two-mine pressure trains combat before another worker once combat gold is ready", () => {
    const scene = sketchScene("v5-severe-two-mine-combat-before-worker")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "v5", race: "grove" })
      .player("v3a", { team: "v3", race: "grove" })
      .player("v3b", { team: "v3", race: "ember" })
      .player("v3c", { team: "v3", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 700)
      .building("v5", "barracks", 620, 560, { id: "v5-barracks" })
      .building("v5", "archeryRange", 700, 560)
      .tower("v5", 650, 500)
      .worker("v5", 520, 540, { order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .worker("v5", 540, 560, { order: { type: "mine", resourceId: "v5-main-mine", phase: "gather", timer: 0 } })
      .worker("v5", 900, 700, { order: { type: "mine", resourceId: "v5-natural-mine", phase: "gather", timer: 0 } })
      .worker("v5", 920, 720, { order: { type: "mine", resourceId: "v5-natural-mine", phase: "gather", timer: 0 } })
      .worker("v5", 940, 740)
      .townHall("v3a", 1700, 500)
      .townHall("v3b", 1700, 900)
      .townHall("v3c", 1700, 1300)
      .goldMine("v5-main-mine", 560, 540, 3000)
      .goldMine("v5-natural-mine", 900, 700, 3000)
      .goldMine("v3a-main-mine", 1700, 500, 3000)
      .goldMine("v3b-main-mine", 1700, 900, 3000)
      .goldMine("v3c-main-mine", 1700, 1300, 3000);
    for (let index = 0; index < 2; index += 1) scene.unit("v5", "footman", 700 + index * 28, 620);
    for (let index = 0; index < 5; index += 1) scene.unit("v3a", index % 2 === 0 ? "footman" : "lancer", 930 + index * 34, 610 + (index % 2) * 28);
    const game = scene.build().createGame();
    game.players.v5!.gold = UNIT_DEFS.lancer.cost;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries[0]?.command).toEqual({ type: "train", buildingId: "v5-barracks", unitKind: "lancer" });
  });

  it("lets V5 keep training one-base workers beyond the ordinary saturated mine count", () => {
    const scene = sketchScene("v5-one-base-extra-workers")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v3", 1_600, 500)
      .townHall("v4-tr", 1_600, 900)
      .townHall("v5", 500, 500, { id: "hall" });
    for (let index = 0; index < 6; index += 1) scene.worker("v5", 540 + index * 18, 520, { id: `worker-${index}` });
    const game = scene.build().createGame();
    game.players.v5!.gold = 90;

    const commands = planPresetAiCommandEntries(snapshotGame(game), "v5", { version: "v5", teams: game.teams }).map((entry) => entry.command);

    expect(commands).toContainEqual({ type: "train", buildingId: "hall", unitKind: "worker" });
  });

  it("lets V5 switch two-base 1v2 spending back to army after one extra labor worker", () => {
    const scene = sketchScene("v5-two-base-labor-before-army")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "main-hall" })
      .townHall("v5", 900, 900, { id: "natural-hall" })
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .townHall("v3", 3400, 1500)
      .townHall("v4-tr", 3400, 2700)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 900, 900, 4000)
      .goldMine("v3-main-mine", 3400, 1500, 4000)
      .goldMine("v4-main-mine", 3400, 2700, 4000);
    for (let index = 0; index < 12; index += 1) scene.worker("v5", 540 + index * 16, 520 + (index % 3) * 18, { id: `worker-${index}` });
    scene
      .unit("v5", "footman", 760, 700)
      .unit("v5", "footman", 800, 720)
      .unit("v5", "lancer", 840, 740)
      .unit("v5", "archer", 880, 760)
      .unit("v5", "footman", 920, 780);
    const game = scene.build().createGame();
    game.players.v5!.gold = 95;

    const commands = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    }).map((entry) => entry.command);

    expect(commands).not.toContainEqual({ type: "train", buildingId: "main-hall", unitKind: "worker" });
    expect(commands).not.toContainEqual({ type: "train", buildingId: "natural-hall", unitKind: "worker" });
  });

  it("turns idle workers into ordinary player mine commands", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const command = planPresetAiCommands(snapshotGame(game), "player")[0];

    expect(command).toMatchObject({ type: "mine" });
    if (command?.type === "mine") {
      issuePlayerCommand(game, "player", command);
      expect(command.unitIds.length).toBeGreaterThan(0);
      for (let i = 0; i < 5; i += 1) {
        for (const nextCommand of planPresetAiCommands(snapshotGame(game), "player")) {
          if (nextCommand.type === "mine") issuePlayerCommand(game, "player", nextCommand);
        }
      }
      expect(game.units.filter((unit) => unit.owner === "player" && unit.kind === "worker").every((unit) => unit.order.type === "mine")).toBe(true);
    }
  });

  it("does not send idle workers from a depleted base to a remote guarded mine", () => {
    const game = sketchScene("economy-depleted-base-no-remote-guarded-mining")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north" })
      .townHall("player", 500, 500)
      .worker("player", 540, 520, { id: "idle-worker" })
      .goldMine("depleted-main", 560, 500, 0)
      .goldMine("guarded-remote", 1_500, 1_500, 10_000)
      .unit("neutral", "footman", 1_500, 1_500)
      .build()
      .createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "player", [AI_SCRIPT_LIBRARY.economy], { version: "v2", teams: game.teams });

    expect(entries).toEqual([]);
  });

  it("lets V5 send idle workers to a safe remote mine when owned bases are depleted and expansion gold is gone", () => {
    const game = sketchScene("economy-depleted-base-safe-remote-mining")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north" })
      .townHall("player", 500, 500)
      .worker("player", 540, 520, { id: "idle-worker" })
      .goldMine("depleted-main", 560, 500, 0)
      .goldMine("safe-remote", 1_500, 500, 10_000)
      .build()
      .createGame();
    game.players.player!.gold = BUILDING_DEFS.townHall.cost - 1;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "player", [AI_SCRIPT_LIBRARY.economy], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(entries).toContainEqual(
      expect.objectContaining({
        scriptId: "economy",
        command: { type: "mine", unitIds: ["idle-worker"], resourceId: "safe-remote" },
      }),
    );
  });

  it("uses local scripts without internal AI ownership to build train and attack", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });

    for (let i = 0; i < 1200; i += 1) {
      for (const owner of ["player", "enemy"] as const) {
        for (const command of planPresetAiCommands(snapshotGame(game), owner)) {
          issuePlayerCommand(game, owner, command);
        }
      }
      stepGame(game);
    }

    expect("ai" in game).toBe(false);
    expect(game.match.stats.goldSpent.player + game.match.stats.goldSpent.enemy).toBeGreaterThan(0);
    expect(game.buildings.some((building) => building.owner === "player" && building.kind === "barracks")).toBe(true);
    expect(game.buildings.some((building) => building.owner === "enemy" && building.kind === "emberForge")).toBe(true);
    expect(game.units.some((unit) => unit.owner === "player" && unit.kind !== "worker")).toBe(true);
    expect(game.units.some((unit) => unit.owner === "enemy" && unit.kind !== "worker")).toBe(true);
    expect(game.units.some((unit) => unit.owner === "player" && unit.order.type === "attackMove")).toBe(true);
    expect(game.units.some((unit) => unit.owner === "enemy" && unit.order.type === "attackMove")).toBe(true);
  });

  it("does not spam identical attack-move commands when the army is already on the current objective", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const soldiers = Array.from({ length: 5 }, (_, index) => game.spawnUnit("player", "footman", 900 + index * 12, 900));
    const firstAttack = planPresetAiCommands(snapshotGame(game), "player").find((command) => command.type === "attackMove");
    expect(firstAttack).toBeDefined();
    if (firstAttack?.type !== "attackMove") throw new Error("expected attackMove");
    for (const soldier of soldiers) soldier.order = { type: "attackMove", x: firstAttack.x, y: firstAttack.y };

    const repeatedAttack = planPresetAiCommands(snapshotGame(game), "player").find((command) => command.type === "attackMove");

    expect(repeatedAttack).toBeUndefined();
  });

  it("redirects attack-move armies when their current objective is stale", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const soldiers = Array.from({ length: 5 }, (_, index) => game.spawnUnit("player", "footman", 900 + index * 12, 900));
    for (const soldier of soldiers) soldier.order = { type: "attackMove", x: 80, y: 80 };

    const attack = planPresetAiCommands(snapshotGame(game), "player").find((command) => command.type === "attackMove");

    expect(attack).toBeDefined();
    expect(attack?.type === "attackMove" ? attack.unitIds.length : 0).toBe(5);
  });

  it("goes straight for the last enemy town hall when only a few defenders remain", () => {
    const scene = sketchScene("endgame-town-hall-closeout")
      .map("openClaims")
      .replaceDefaults()
      .player("winner", { team: "north", race: "grove" })
      .player("loser", { team: "south", race: "ember" })
      .townHall("winner", 3300, 3300)
      .unit("winner", "footman", 1800, 1700)
      .unit("winner", "footman", 1840, 1720)
      .unit("winner", "lancer", 1880, 1740)
      .unit("winner", "archer", 1920, 1760)
      .unit("winner", "archer", 1960, 1780)
      .townHall("loser", 500, 1450, { id: "loser-last-hall" })
      .unit("loser", "mercenary", 1150, 1220)
      .unit("loser", "contractArcher", 1200, 1240)
      .unit("loser", "fieldMedic", 1250, 1260)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "winner", [AI_SCRIPT_LIBRARY.attackWave], { version: "v1", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 500, y: 1450 });
  });

  it("does not let a few last defenders drag the winning army away from a building closeout", () => {
    const scene = sketchScene("endgame-closeout-beats-light-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("winner", { team: "north", race: "grove" })
      .player("loser", { team: "south", race: "ember" })
      .townHall("winner", 3300, 3300)
      .building("winner", "defenseTower", 1220, 1200, { id: "winner-pressured-tower" })
      .unit("winner", "footman", 1800, 1700)
      .unit("winner", "footman", 1840, 1720)
      .unit("winner", "lancer", 1880, 1740)
      .unit("winner", "lancer", 1920, 1760)
      .unit("winner", "archer", 1960, 1780)
      .unit("winner", "archer", 2000, 1800)
      .townHall("loser", 500, 1450, { id: "loser-last-hall" })
      .unit("loser", "mercenary", 1160, 1210)
      .unit("loser", "contractArcher", 1200, 1240)
      .unit("loser", "fieldMedic", 1240, 1270)
      .build();
    const game = scene.createGame();
    const pressuredTower = game.buildings.find((building) => building.id === "winner-pressured-tower");
    if (!pressuredTower) throw new Error("missing pressured tower");
    pressuredTower.hp = pressuredTower.maxHp * 0.6;

    const command = planAiCommandsFromScripts(snapshotGame(game), "winner", [AI_SCRIPT_LIBRARY.attackWave], { version: "v1", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 500, y: 1450 });
  });

  it("v2 targets a surviving combat group before the last town hall when the loser still has an army", () => {
    const scene = sketchScene("v2-endgame-army-before-last-hall")
      .map("openClaims")
      .replaceDefaults()
      .player("winner", { team: "north", race: "grove" })
      .player("loser", { team: "south", race: "ember" })
      .townHall("winner", 3300, 3300)
      .unit("winner", "footman", 1300, 1500)
      .unit("winner", "footman", 1340, 1520)
      .unit("winner", "lancer", 1380, 1540)
      .unit("winner", "lancer", 1420, 1560)
      .unit("winner", "archer", 1460, 1580)
      .unit("winner", "archer", 1500, 1600)
      .townHall("loser", 500, 1450, { id: "loser-last-hall" })
      .unit("loser", "footman", 1780, 1940)
      .unit("loser", "lancer", 1820, 1960)
      .unit("loser", "archer", 1860, 1980)
      .unit("loser", "contractArcher", 1900, 2000)
      .unit("loser", "fieldMedic", 1940, 2020)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "winner", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attack" });
    expect(command?.type === "attack" ? command.targetId : "").toContain("loser");
  });

  it("v2 cleans up a crippled opponent's buildings even while another enemy player still has an army elsewhere", () => {
    const scene = sketchScene("v2-cleanup-crippled-player-before-far-army")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1280, 1400)
      .unit("v2", "footman", 1320, 1420)
      .unit("v2", "lancer", 1360, 1440)
      .unit("v2", "lancer", 1400, 1460)
      .unit("v2", "archer", 1440, 1480)
      .unit("v2", "archer", 1480, 1500)
      .unit("v2", "raider", 1520, 1520)
      .unit("v2", "knight", 1560, 1540)
      .unit("v2", "knight", 1600, 1560)
      .unit("v2", "priest", 1640, 1580)
      .townHall("v1a", 1760, 1540, { id: "v1a-crippled-hall" })
      .building("v1a", "barracks", 1840, 1620, { id: "v1a-crippled-barracks" })
      .townHall("v1b", 3400, 3400)
      .unit("v1b", "footman", 3300, 3300)
      .unit("v1b", "footman", 3340, 3320)
      .unit("v1b", "lancer", 3380, 3340)
      .unit("v1b", "archer", 3420, 3360)
      .unit("v1b", "contractArcher", 3460, 3380)
      .unit("v1b", "fieldMedic", 3500, 3400)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1840, y: 1620 });
  });

  it("v2 does not trickle a tiny free squad into crippled cleanup while another enemy economy is alive", () => {
    const scene = sketchScene("v2-no-tiny-crippled-cleanup")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1280, 1400, { id: "busy-1", order: { type: "attack", targetId: "v1b-front-1" } })
      .unit("v2", "footman", 1320, 1420, { id: "busy-2", order: { type: "attack", targetId: "v1b-front-1" } })
      .unit("v2", "lancer", 1360, 1440, { id: "busy-3", order: { type: "attack", targetId: "v1b-front-2" } })
      .unit("v2", "lancer", 1400, 1460, { id: "busy-4", order: { type: "attack", targetId: "v1b-front-2" } })
      .unit("v2", "archer", 1440, 1480, { id: "busy-5", order: { type: "attack", targetId: "v1b-front-3" } })
      .unit("v2", "footman", 1480, 1500)
      .unit("v2", "lancer", 1520, 1520)
      .townHall("v1a", 1760, 1540, { id: "v1a-crippled-hall" })
      .building("v1a", "barracks", 1840, 1620, { id: "v1a-crippled-barracks" })
      .townHall("v1b", 3400, 3400)
      .worker("v1b", 3360, 3380)
      .worker("v1b", 3380, 3420)
      .unit("v1b", "footman", 3300, 3300, { id: "v1b-front-1" })
      .unit("v1b", "lancer", 3340, 3320, { id: "v1b-front-2" })
      .unit("v1b", "archer", 3380, 3340, { id: "v1b-front-3" })
      .unit("v1b", "contractArcher", 3420, 3360)
      .unit("v1b", "fieldMedic", 3460, 3380)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 sends a five-unit closeout wave when both 1v2 opponents have no workers", () => {
    const scene = sketchScene("v2-dead-economy-five-unit-closeout")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1300, 1700)
      .building("v2", "barracks", 620, 560)
      .unit("v2", "footman", 1740, 1900)
      .unit("v2", "footman", 1780, 1920)
      .unit("v2", "lancer", 1820, 1940)
      .unit("v2", "lancer", 1860, 1960)
      .unit("v2", "archer", 1900, 1980)
      .townHall("v1a", 3400, 1500, { id: "v1a-main-hall" })
      .building("v1a", "barracks", 3280, 1600)
      .townHall("v1b", 3400, 3300)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 3400, y: 1500 });
  });

  it("v5 directly attacks residual buildings in a dead-economy 1v2 closeout", () => {
    const scene = sketchScene("v5-dead-economy-direct-building-closeout")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 1300, 1700)
      .unit("v5", "footman", 2060, 720)
      .unit("v5", "footman", 2100, 740)
      .unit("v5", "lancer", 2140, 760)
      .unit("v5", "lancer", 2180, 780)
      .unit("v5", "archer", 2220, 800)
      .unit("v5", "priest", 2260, 820)
      .unit("v5", "contractArcher", 2300, 840)
      .building("v4-tr", "defenseTower", 2214, 585, { id: "weak-tower", hp: 53 })
      .building("v4-tr", "farm", 1994, 647)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.attackWave], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attack", targetId: "weak-tower" });
  });

  it("v5 sends a six-unit wave to clean a crippled opponent while another opponent still has workers", () => {
    const scene = sketchScene("v5-crippled-opponent-six-unit-closeout")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 720, 900)
      .unit("v5", "footman", 500, 2140)
      .unit("v5", "footman", 535, 2180)
      .unit("v5", "lancer", 570, 2160)
      .unit("v5", "footman", 605, 2200)
      .unit("v5", "archer", 555, 2100)
      .unit("v5", "lancer", 640, 2185)
      .townHall("v3", 3604, 2621)
      .worker("v3", 3520, 2600)
      .worker("v3", 3540, 2640)
      .unit("v3", "emberRavager", 3514, 2775)
      .unit("v3", "cinderRunner", 3480, 2768)
      .building("v4-tr", "defenseTower", 1136, 2147, { id: "crippled-tower", hp: 102 })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.attackWave], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1136, y: 2147 });
  });

  it("v2 all-ins with its last small army when its own economy is dead", () => {
    const scene = sketchScene("v2-no-worker-last-army-all-in")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "south", race: "grove" })
      .player("v1a", { team: "north", race: "grove" })
      .townHall("v2", 3604, 2048)
      .building("v2", "barracks", 3484, 1948)
      .unit("v2", "contractArcher", 1325, 1929)
      .unit("v2", "contractArcher", 1585, 1795)
      .unit("v2", "footman", 3572, 2004)
      .townHall("v1a", 492, 2048)
      .building("v1a", "barracks", 612, 2148)
      .worker("v1a", 520, 2040)
      .worker("v1a", 540, 2060)
      .worker("v1a", 560, 2080)
      .unit("v1a", "contractArcher", 901, 2245, { id: "hurt-contract", hp: 54 })
      .unit("v1a", "lancer", 933, 2259, { id: "hurt-lancer", hp: 20 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 36;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ targetId: "hurt-lancer" });
  });

  it("v2 attacks enemy workers with its last small army when no enemy combat remains", () => {
    const scene = sketchScene("v2-no-worker-last-army-worker-cleanup")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "south", race: "grove" })
      .player("v1a", { team: "north", race: "grove" })
      .townHall("v2", 3604, 2048)
      .building("v2", "barracks", 3484, 1948)
      .unit("v2", "contractArcher", 1358, 2226)
      .unit("v2", "contractArcher", 1472, 2209)
      .unit("v2", "footman", 2391, 2305)
      .townHall("v1a", 492, 2048)
      .building("v1a", "barracks", 612, 2148)
      .worker("v1a", 520, 2040, { id: "cleanup-worker-a" })
      .worker("v1a", 540, 2060, { id: "cleanup-worker-b" })
      .worker("v1a", 560, 2080, { id: "cleanup-worker-c" })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 36;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ targetId: expect.stringContaining("cleanup-worker") });
  });

  it("v2 attacks buildings with its last small army after both armies and enemy workers are gone", () => {
    const scene = sketchScene("v2-no-worker-last-army-building-cleanup")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "south", race: "grove" })
      .player("v1a", { team: "north", race: "grove" })
      .townHall("v2", 3604, 2048)
      .building("v2", "barracks", 3484, 1948)
      .unit("v2", "contractArcher", 1358, 2226)
      .unit("v2", "contractArcher", 1472, 2209)
      .unit("v2", "footman", 2391, 2305)
      .townHall("v1a", 492, 2048, { id: "cleanup-hall" })
      .building("v1a", "barracks", 612, 2148)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 36;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attack", targetId: "cleanup-hall" });
  });

  it("v2 focuses a one-on-one no-worker opponent's residual army instead of resetting", () => {
    const scene = sketchScene("v2-one-on-one-dead-economy-residual-focus")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "south", race: "grove" })
      .player("v1a", { team: "north", race: "grove" })
      .townHall("v2", 3604, 2048)
      .townHall("v2", 3376, 2680)
      .townHall("v1a", 492, 2048)
      .building("v1a", "barracks", 612, 2148);
    for (let i = 0; i < 22; i += 1) {
      scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 1500 + (i % 8) * 30, 1880 + Math.floor(i / 8) * 34);
    }
    for (let i = 0; i < 24; i += 1) {
      scene.unit("v1a", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 920 + (i % 8) * 26, 1860 + Math.floor(i / 8) * 32, { id: `residual-${i}` });
    }
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ targetId: expect.stringContaining("residual-") });
  });

  it("v2 does not let skirmish preservation reset a multiplayer dead-economy closeout", () => {
    const scene = sketchScene("v2-multiplayer-dead-economy-skirmish-closeout")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .player("v1c", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 2100, 2050)
      .townHall("v1a", 3600, 1475)
      .building("v1a", "barracks", 3485, 1575)
      .townHall("v1b", 3600, 2620)
      .building("v1b", "barracks", 3485, 2520)
      .townHall("v1c", 3050, 3350)
      .building("v1c", "barracks", 2930, 3250);
    for (let i = 0; i < 22; i += 1) {
      scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 1800 + (i % 8) * 28, 1700 + Math.floor(i / 8) * 32);
    }
    for (let i = 0; i < 24; i += 1) {
      scene.unit("v1b", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 1980 + (i % 8) * 26, 1740 + Math.floor(i / 8) * 30, { id: `residual-${i}` });
    }
    const game = scene.build().createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });
    const attackWave = entries.find((entry) => entry.scriptId === "attackWave")?.command;

    expect(entries.find((entry) => entry.scriptId === "skirmishPreservation")).toBeUndefined();
    expect(attackWave).toMatchObject({ type: "attackMove" });
    expect(attackWave?.type === "attackMove" ? attackWave.x : 500).not.toBeCloseTo(500, -2);
  });

  it("v2 abandons a guarded dead-economy focus owner for the other empty base", () => {
    const scene = sketchScene("v2-dead-economy-focus-fallback")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 2100, 2050)
      .unit("v2", "footman", 2720, 1740)
      .unit("v2", "footman", 2760, 1720)
      .unit("v2", "footman", 1160, 2000)
      .unit("v2", "lancer", 2800, 1740)
      .unit("v2", "lancer", 2840, 1720)
      .townHall("v1a", 3600, 1475)
      .building("v1a", "barracks", 3485, 1575)
      .unit("v1a", "contractArcher", 3450, 1740)
      .unit("v1a", "contractArcher", 3420, 1730)
      .unit("v1a", "contractArcher", 3470, 1720)
      .townHall("v1b", 3600, 2620)
      .building("v1b", "stables", 3485, 2520)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1a" };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 3600, y: 2620 });
  });

  it("v2 does not advance the verdigris committed wave past the nearby town hall into deep production", () => {
    let attackWave: ReturnType<typeof planAiCommandsFromScripts>[number] | undefined;
    const result = runAiGameLoop(
      {
        name: "verdigris committed wave stopline",
        mapId: "verdigrisSpire",
        agents: {
          v2: { controller: "internal-ai", team: "north", race: "grove", version: "v2" },
          v1a: { controller: "internal-ai", team: "south", race: "grove", version: "v1" },
          v1b: { controller: "internal-ai", team: "south", race: "grove", version: "v1" },
        },
        maxTicks: 8641,
        thinkInterval: 45,
      },
      {
        afterCommand({ tick, owner, scriptId, command }) {
          if (tick === 8640 && owner === "v2" && scriptId === "attackWave") attackWave = command;
        },
      },
    );

    if (attackWave?.type === "attackMove") expect(attackWave.x).toBeLessThanOrEqual(2300);
    const deepAttackMoveOrders = result.game.units
      .filter((unit) => unit.owner === "v2" && unit.kind !== "worker")
      .filter((unit) => unit.order.type === "attackMove" && unit.order.x > 2300)
      .map((unit) => unit.id);
    expect(deepAttackMoveOrders).toEqual([]);
  });

  it("v2 fights a nearby dead-economy residual army before racing buildings", () => {
    const scene = sketchScene("v2-dead-economy-residual-army-before-buildings")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 2100, 2050)
      .unit("v2", "footman", 2660, 1650)
      .unit("v2", "footman", 2700, 1640)
      .unit("v2", "footman", 1300, 2040)
      .unit("v2", "lancer", 2740, 1630)
      .unit("v2", "lancer", 2780, 1620)
      .unit("v2", "footman", 2820, 1640)
      .townHall("v1a", 3600, 1475)
      .building("v1a", "barracks", 3485, 1575)
      .unit("v1a", "contractArcher", 3460, 2400, { id: "residual-contract" })
      .unit("v1a", "fieldMedic", 3430, 2420)
      .unit("v1a", "archer", 3490, 2440)
      .unit("v1a", "footman", 3440, 2380)
      .unit("v1a", "contractArcher", 3470, 2360)
      .townHall("v1b", 3600, 2620)
      .unit("v1b", "archer", 3630, 2660)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1a" };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attack", targetId: expect.stringContaining("residual") });
  });

  it("v2 does not chase an isolated caster through a stronger route army", () => {
    const scene = sketchScene("v2-no-route-covered-caster-chase")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "east", race: "grove" })
      .player("v1", { team: "west", race: "grove" })
      .townHall("v2", 3604, 2048)
      .townHall("v1", 492, 2048)
      .unit("v2", "footman", 2380, 1300)
      .unit("v2", "footman", 2420, 1320)
      .unit("v2", "footman", 2460, 1280)
      .unit("v2", "lancer", 2500, 1320)
      .unit("v2", "lancer", 2540, 1280)
      .unit("v2", "archer", 2580, 1320)
      .unit("v2", "archer", 2620, 1280)
      .unit("v2", "footman", 2660, 1320)
      .unit("v1", "fieldMedic", 1230, 1581, { id: "route-medic" })
      .unit("v1", "mercenary", 1960, 840)
      .unit("v1", "mercenary", 2010, 830)
      .unit("v1", "contractArcher", 1930, 855)
      .unit("v1", "contractArcher", 1955, 905)
      .unit("v1", "fieldMedic", 1960, 872)
      .unit("v1", "footman", 1985, 896)
      .unit("v1", "footman", 1923, 825)
      .unit("v1", "lancer", 1992, 860)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams })[0];

    expect(command).not.toMatchObject({ type: "attack", targetId: "route-medic" });
  });

  it("v2 does not direct attack a distant isolated unit beside the opponent base", () => {
    const scene = sketchScene("v2-no-distant-base-side-pickoff")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "east", race: "grove" })
      .player("v1", { team: "west", race: "grove" })
      .townHall("v2", 3604, 2048)
      .townHall("v1", 492, 2048)
      .unit("v2", "footman", 2350, 1310)
      .unit("v2", "footman", 2380, 1340)
      .unit("v2", "footman", 2410, 1280)
      .unit("v2", "lancer", 2440, 1340)
      .unit("v2", "lancer", 2470, 1280)
      .unit("v2", "archer", 2500, 1340)
      .unit("v2", "archer", 2530, 1280)
      .unit("v2", "footman", 2560, 1340)
      .unit("v1", "footman", 697, 2206, { id: "base-side-footman" })
      .unit("v1", "archer", 619, 1911)
      .unit("v1", "lancer", 1992, 860)
      .unit("v1", "footman", 1923, 825)
      .unit("v1", "footman", 1986, 896)
      .unit("v1", "contractArcher", 1928, 886)
      .unit("v1", "fieldMedic", 1960, 872)
      .unit("v1", "mercenary", 1962, 840)
      .unit("v1", "contractArcher", 1954, 905)
      .unit("v1", "mercenary", 2012, 831)
      .unit("v1", "contractArcher", 1933, 855)
      .unit("v1", "fieldMedic", 1230, 1581)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams })[0];

    expect(command).not.toMatchObject({ type: "attack", targetId: "base-side-footman" });
  });

  it("v5 1v2 does not direct-chase an army target outside its unfinished first expansion defense", () => {
    const scene = sketchScene("v5-no-unfinished-natural-direct-chase")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "west", race: "grove" })
      .player("v3", { team: "east", race: "grove" })
      .player("v4-tr", { team: "east", race: "grove" })
      .townHall("v5", 500, 2048)
      .building("v5", "townHall", 760, 2540, { complete: false })
      .unit("v5", "footman", 820, 2140)
      .unit("v5", "footman", 850, 2160)
      .unit("v5", "footman", 880, 2120)
      .unit("v5", "lancer", 910, 2160)
      .unit("v5", "lancer", 940, 2120)
      .unit("v5", "archer", 970, 2160)
      .unit("v5", "archer", 1000, 2120)
      .townHall("v3", 3500, 1500)
      .unit("v3", "footman", 1_520, 2_245, { id: "runaway-footman" })
      .unit("v3", "footman", 2_550, 2_700)
      .unit("v3", "lancer", 2_620, 2_760)
      .unit("v3", "archer", 2_700, 2_820)
      .townHall("v4-tr", 3500, 2700)
      .unit("v4-tr", "contractArcher", 2_650, 1_180)
      .unit("v4-tr", "mercenary", 2_720, 1_240)
      .goldMine("v5-main-mine", 540, 2048, 4_000)
      .goldMine("v5-natural-mine", 780, 2540, 4_000)
      .goldMine("v3-main-mine", 3500, 1500, 4_000)
      .goldMine("v4-main-mine", 3500, 2700, 4_000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).not.toMatchObject({ type: "attack", targetId: "runaway-footman" });
  });

  it("v5 1v2 does not direct-chase a healthy melee front while it is approaching the home base", () => {
    const scene = sketchScene("v5-no-distant-healthy-melee-approach-chase")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "west", race: "grove" })
      .player("v3", { team: "east", race: "ember" })
      .player("v4-tr", { team: "east", race: "grove" })
      .townHall("v5", 700, 2050)
      .townHall("v5", 800, 2580)
      .building("v5", "barracks", 620, 2148)
      .building("v5", "farm", 890, 2148)
      .unit("v5", "footman", 650, 2115, { order: { type: "attackMove", x: 2138, y: 2170 } })
      .unit("v5", "footman", 690, 2130, { order: { type: "attackMove", x: 2138, y: 2170 } })
      .unit("v5", "footman", 730, 2075, { order: { type: "attackMove", x: 2138, y: 2170 } })
      .unit("v5", "footman", 760, 2160, { order: { type: "attackMove", x: 2138, y: 2170 } })
      .unit("v5", "lancer", 680, 2100, { order: { type: "attackMove", x: 2138, y: 2170 } })
      .unit("v5", "lancer", 800, 2130, { order: { type: "attackMove", x: 2138, y: 2170 } })
      .unit("v5", "archer", 670, 2060, { order: { type: "attackMove", x: 2138, y: 2170 } })
      .unit("v5", "archer", 790, 2210, { order: { type: "attackMove", x: 2138, y: 2170 } })
      .townHall("v3", 2138, 2170)
      .building("v3", "emberForge", 3518, 2749)
      .unit("v3", "emberRavager", 1965, 2249, { id: "approach-ravager", order: { type: "attackMove", x: 890, y: 2148 } })
      .unit("v3", "emberRavager", 1960, 2260, { order: { type: "attackMove", x: 890, y: 2148 } })
      .unit("v3", "cinderRunner", 2120, 2300, { order: { type: "attackMove", x: 890, y: 2148 } })
      .unit("v3", "cinderRunner", 2200, 2340, { order: { type: "attackMove", x: 890, y: 2148 } })
      .unit("v3", "cinderRunner", 2240, 2360, { order: { type: "attackMove", x: 890, y: 2148 } })
      .unit("v3", "emberRavager", 2350, 2400, { order: { type: "attackMove", x: 890, y: 2148 } })
      .unit("v3", "emberRavager", 2500, 2360, { order: { type: "attackMove", x: 890, y: 2148 } })
      .worker("v3", 3500, 2650)
      .worker("v3", 3520, 2670)
      .townHall("v4-tr", 3500, 1450)
      .unit("v4-tr", "contractArcher", 3600, 1450)
      .worker("v4-tr", 3460, 1420)
      .worker("v4-tr", 3480, 1440)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.attackWave], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command?.type).not.toBe("attack");
  });

  it("v2 does not creep a neutral camp through a stronger route army in one-on-one", () => {
    const scene = sketchScene("v2-no-route-covered-neutral-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "east", race: "grove" })
      .player("v1", { team: "west", race: "grove" })
      .townHall("v2", 3604, 2048)
      .townHall("v1", 492, 2048)
      .unit("v2", "footman", 2353, 1309)
      .unit("v2", "footman", 2361, 1344)
      .unit("v2", "lancer", 2314, 1337)
      .unit("v2", "archer", 2410, 1387)
      .unit("v2", "footman", 2393, 1307)
      .unit("v2", "archer", 2443, 1350)
      .unit("v2", "footman", 2326, 1285)
      .unit("v2", "footman", 2397, 1343)
      .unit("neutral", "wildling", 2808, 937)
      .unit("neutral", "mossGnawer", 2830, 960)
      .unit("v1", "lancer", 1992, 860)
      .unit("v1", "footman", 1923, 825)
      .unit("v1", "footman", 1986, 896)
      .unit("v1", "contractArcher", 1928, 886)
      .unit("v1", "fieldMedic", 1960, 872)
      .unit("v1", "mercenary", 1962, 840)
      .unit("v1", "contractArcher", 1954, 905)
      .unit("v1", "mercenary", 2012, 831)
      .unit("v1", "contractArcher", 1933, 855)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("v2 recalls an active creep claim when the route becomes enemy controlled", () => {
    const scene = sketchScene("v2-recall-route-covered-creep-claim")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "east", race: "grove" })
      .player("v1", { team: "west", race: "grove" })
      .townHall("v2", 3604, 2048)
      .townHall("v1", 492, 2048);
    const v2Units = [
      ["claim-footman-1", "footman", 2353, 1309],
      ["claim-footman-2", "footman", 2361, 1344],
      ["claim-lancer", "lancer", 2314, 1337],
      ["claim-archer-1", "archer", 2410, 1387],
      ["claim-footman-3", "footman", 2393, 1307],
      ["claim-archer-2", "archer", 2443, 1350],
      ["claim-footman-4", "footman", 2326, 1285],
      ["claim-footman-5", "footman", 2397, 1343],
    ] as const;
    for (const [id, kind, x, y] of v2Units) scene.unit("v2", kind, x, y, { id, order: { type: "attackMove", x: 2819, y: 948.5 } });
    scene
      .unit("neutral", "wildling", 2808, 937, { id: "blocked-creep" })
      .unit("neutral", "mossGnawer", 2830, 960)
      .unit("v1", "lancer", 1992, 860)
      .unit("v1", "footman", 1923, 825)
      .unit("v1", "footman", 1986, 896)
      .unit("v1", "contractArcher", 1928, 886)
      .unit("v1", "fieldMedic", 1960, 872)
      .unit("v1", "mercenary", 1962, 840)
      .unit("v1", "contractArcher", 1954, 905)
      .unit("v1", "mercenary", 2012, 831)
      .unit("v1", "contractArcher", 1933, 855);
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();
    for (const [unitId] of v2Units) {
      memory.unitClaims[unitId] = { kind: "creep", targetId: "blocked-creep", x: 2808, y: 937, sinceTick: 0, expiresTick: 3600 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toMatchObject({ type: "move" });
    expect(memory.unitClaims["claim-footman-1"]).toMatchObject({ kind: "retreat", targetId: "retreat" });
    expect(Object.keys(memory.unitClaims)).toHaveLength(v2Units.length);
  });

  it("v2 focuses enemies on a mining worker line outside the main rally", () => {
    const scene = sketchScene("v2-mining-worker-line-defense")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 2050)
      .townHall("v2", 780, 2620)
      .unit("v2", "footman", 500, 2140)
      .unit("v2", "footman", 540, 2160)
      .unit("v2", "lancer", 580, 2140)
      .unit("v2", "archer", 620, 2160)
      .unit("v2", "footman", 660, 2140)
      .worker("v2", 760, 2600, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .worker("v2", 800, 2620, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .unit("v1b", "footman", 830, 2600, { id: "worker-line-raider" })
      .unit("v1b", "contractArcher", 900, 2630)
      .townHall("v1a", 3400, 1500)
      .townHall("v1b", 3400, 2700)
      .goldMine("v2-natural-mine", 780, 2620, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attack", targetId: "worker-line-raider" });
  });

  it("v2 waits for a real wave before crossing the map in ordinary one-on-one pressure", () => {
    const scene = sketchScene("v2-no-single-unit-cross-map-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 720, 600)
      .townHall("v1", 3300, 3300)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 does not spend its first one-on-one wave diving an unsoftened enemy base", () => {
    const scene = sketchScene("v2-no-first-wave-base-dive")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 5; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 1450 + i * 24, 1320 + i * 18);
    scene
      .townHall("v1", 3300, 3300)
      .building("v1", "barracks", 3220, 3200)
      .building("v1", "defenseTower", 3160, 3140)
      .unit("v1", "footman", 3120, 3100)
      .unit("v1", "archer", 3180, 3120)
      .unit("v1", "lancer", 3240, 3160);
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 does not count untouched neutral camps as enemy army when deciding whether to push", () => {
    const scene = sketchScene("v2-neutral-camps-do-not-freeze-closeout")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1280, 1400)
      .unit("v2", "footman", 1320, 1420)
      .unit("v2", "lancer", 1360, 1440)
      .unit("v2", "lancer", 1400, 1460)
      .unit("v2", "archer", 1440, 1480)
      .unit("v2", "archer", 1480, 1500)
      .unit("v2", "raider", 1520, 1520)
      .townHall("v1a", 1760, 1540, { id: "v1a-last-hall" })
      .unit("neutral", "ancientStag", 3400, 3400)
      .unit("neutral", "ancientStag", 3480, 3440)
      .unit("neutral", "stonebackBrute", 3520, 3360)
      .unit("neutral", "gladeWitch", 3560, 3420)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1760, y: 1540 });
  });

  it("v2 does not target nearby neutral camps as attack-wave enemy army", () => {
    const scene = sketchScene("v2-attack-wave-ignores-neutral-army-target")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1280, 1400)
      .unit("v2", "archer", 1320, 1420)
      .unit("v2", "footman", 1360, 1380)
      .unit("v2", "lancer", 1400, 1400)
      .unit("v2", "archer", 1440, 1420)
      .townHall("v1a", 3100, 1450, { id: "v1a-last-hall" })
      .unit("neutral", "stonebackBrute", 1520, 1460, { id: "neutral-brute" })
      .unit("neutral", "thornSlinger", 1560, 1500)
      .unit("neutral", "gladeWitch", 1600, 1460)
      .unit("neutral", "wildling", 1640, 1500)
      .unit("neutral", "mossGnawer", 1680, 1460)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    expect(command).not.toMatchObject({ type: "attack", targetId: "neutral-brute" });
  });

  it("v2 holds the main rally instead of oscillating back to natural clearing while a stronger army approaches", () => {
    const scene = sketchScene("v2-main-hold-blocks-natural-oscillation")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 500, 500)
      .unit("v2", "lancer", 530, 520)
      .unit("v2", "archer", 470, 520)
      .unit("v2", "contractArcher", 510, 540)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 1250, 500)
      .unit("v1", "footman", 1280, 530)
      .unit("v1", "lancer", 1310, 560)
      .unit("v1", "lancer", 1340, 590)
      .unit("v1", "archer", 1370, 620)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 920, 920, 4000)
      .unit("neutral", "stonebackBrute", 920, 920)
      .unit("neutral", "thornSlinger", 960, 960)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove" || candidate.type === "move");

    expect(command).toBeUndefined();
  });

  it("v2 keeps ordinary neutral objective control pointed at the guarded first natural", () => {
    const scene = sketchScene("v2-natural-preempts-neutral-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 900, 760)
      .unit("v2", "footman", 930, 790)
      .unit("v2", "lancer", 960, 820)
      .unit("v2", "archer", 990, 850)
      .unit("v2", "footman", 1020, 880)
      .townHall("v1", 3400, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1000, 2200, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .unit("neutral", "stonebackBrute", 1000, 2200)
      .unit("neutral", "thornSlinger", 1040, 2240)
      .unit("neutral", "gladeWitch", 960, 2240)
      .unit("neutral", "mossGnawer", 1600, 1150)
      .unit("neutral", "wildling", 1640, 1190)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1000, y: 2226.6666666666665 });
  });

  it("v2 clears its guarded first natural before a nearby guarded mercenary camp", () => {
    const scene = sketchScene("v2-natural-before-guarded-merc-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 720, 720)
      .unit("v2", "footman", 760, 740)
      .unit("v2", "footman", 800, 760)
      .unit("v2", "lancer", 840, 780)
      .townHall("v1", 3400, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 900, 1120, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .unit("neutral", "wildling", 900, 1120)
      .unit("neutral", "mossGnawer", 930, 1150)
      .mercenaryCamp("near-bow-post", 1180, 980, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 1160, 980)
      .unit("neutral", "mossGnawer", 1190, 1010)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 915, y: 1135 });
  });

  it("v2 does not start a second neutral objective while its cleared first natural is only claimed", () => {
    const scene = sketchScene("v2-cleared-natural-claim-pauses-merc-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 1010, 650, { id: "natural-footman-a" })
      .unit("v2", "lancer", 1040, 680, { id: "natural-lancer" })
      .unit("v2", "footman", 1070, 650, { id: "natural-footman-b" })
      .unit("v2", "footman", 1180, 850)
      .unit("v2", "lancer", 1210, 880)
      .unit("v2", "archer", 1240, 850)
      .unit("v2", "footman", 1270, 880)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 2500, 2100)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1040, 660, 4000)
      .goldMine("v1-main-mine", 3300, 3240, 4000)
      .mercenaryCamp("guarded-contract-post", 1240, 900, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 1210, 890)
      .unit("neutral", "mossGnawer", 1270, 930)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 3600 };
    for (const unitId of ["natural-footman-a", "natural-lancer", "natural-footman-b"]) {
      memory.unitClaims[unitId] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1040, y: 660, sinceTick: 3600, expiresTick: 7200 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 does not clear an enemy-side guarded mercenary camp before its first expansion", () => {
    const scene = sketchScene("v2-no-enemy-side-guarded-merc-objective-before-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 1_560, 1_000)
      .unit("v2", "footman", 1_600, 1_030)
      .unit("v2", "lancer", 1_640, 1_060)
      .unit("v2", "archer", 1_680, 1_090)
      .townHall("v1", 3_300, 3_300)
      .unit("v1", "footman", 2_600, 2_200)
      .goldMine("v2-main-mine", 560, 540, 4_000)
      .goldMine("v2-cleared-natural", 900, 900, 4_000)
      .goldMine("v1-main-mine", 3_340, 3_300, 4_000)
      .mercenaryCamp("enemy-side-contract-post", 2_650, 1_320, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 2_630, 1_310)
      .unit("neutral", "mossGnawer", 2_670, 1_350)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 recalls wounded first-natural claimants into moon well range while banking the town hall", () => {
    const scene = sketchScene("v2-wounded-natural-claim-recalls-to-well")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "moonWell", 420, 620, { id: "v2-well" })
      .unit("v2", "footman", 1040, 650, { id: "wounded-footman", hp: 94 })
      .unit("v2", "lancer", 1080, 680, { id: "wounded-lancer", hp: 88 })
      .unit("v2", "footman", 1120, 650, { id: "healthy-footman", hp: 145 })
      .unit("v2", "archer", 1160, 690)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1080, 660, 4000)
      .goldMine("v1-main-mine", 3300, 3240, 4000)
      .mercenaryCamp("guarded-contract-post", 1240, 900, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 1240, 900)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost - 80;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 3600 };
    for (const unitId of ["wounded-footman", "wounded-lancer", "healthy-footman"]) {
      memory.unitClaims[unitId] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1080, y: 660, sinceTick: 3600, expiresTick: 7200 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toMatchObject({ type: "move" });
    expect(command?.type === "move" ? command.unitIds : []).toEqual(expect.arrayContaining(["wounded-footman", "wounded-lancer"]));
    expect(command?.type === "move" ? command.unitIds : []).not.toContain("healthy-footman");
    if (command?.type === "move") expect(distance(command, { x: 420, y: 620 })).toBeLessThanOrEqual(BUILDING_DEFS.moonWell.attackRange);
  });

  it("v2 does not spend the expansion frame clearing a guarded natural while its main worker line is threatened", () => {
    const scene = sketchScene("v2-expansion-pauses-for-main-worker-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 750, 560)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 900, 760)
      .unit("v2", "footman", 930, 790)
      .unit("v2", "lancer", 960, 820)
      .unit("v2", "archer", 990, 850)
      .unit("v2", "footman", 1020, 880)
      .unit("v2", "archer", 1050, 910)
      .unit("v1", "footman", 660, 540)
      .unit("v1", "archer", 700, 560)
      .unit("v1", "lancer", 740, 580)
      .townHall("v1", 3400, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1000, 2200, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .unit("neutral", "stonebackBrute", 1000, 2200)
      .unit("neutral", "thornSlinger", 1040, 2240)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 does not pre-claim a local mercenary camp before its first expansion while enemy combat is on the field", () => {
    const scene = sketchScene("v2-no-merc-preclaim-before-first-expansion-fight")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 750, 560)
      .unit("v2", "footman", 900, 760)
      .unit("v2", "footman", 930, 790)
      .unit("v2", "lancer", 960, 820)
      .unit("v2", "archer", 990, 850)
      .unit("v2", "footman", 1020, 880)
      .townHall("v1", 3400, 3300)
      .unit("v1", "footman", 2400, 1900)
      .unit("v1", "archer", 2440, 1940)
      .unit("v1", "footman", 2480, 1980)
      .unit("v1", "lancer", 2520, 2020)
      .unit("v1", "archer", 2560, 2060)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1000, 920, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .mercenaryCamp("local-contract-post", 1600, 900, { hireKind: "contractArcher", cost: 140, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 attack-wave does not count a badly wounded unit as ready combat strength", () => {
    const scene = sketchScene("v2-attack-wave-sends-healthy-units")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "archer", 1300, 1400, { id: "wounded-archer", hp: 10 })
      .unit("v2", "footman", 1340, 1420)
      .unit("v2", "footman", 1380, 1440)
      .unit("v2", "lancer", 1420, 1460)
      .unit("v2", "lancer", 1460, 1480)
      .unit("v2", "archer", 1500, 1500)
      .townHall("v1", 3400, 3300)
      .unit("v1", "footman", 2100, 1800)
      .unit("v1", "lancer", 2140, 1840)
      .unit("v1", "archer", 2180, 1880)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command?.unitIds).not.toContain("wounded-archer");
  });

  it("v5 1v2 attack-wave does not retask moderately wounded units before it has a healing source", () => {
    const scene = sketchScene("v2-attack-wave-holds-moderate-wounds-before-healing")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1300, 1400, { id: "wounded-footman", hp: 54 })
      .unit("v2", "lancer", 1340, 1420, { id: "wounded-lancer", hp: 55 })
      .unit("v2", "footman", 1380, 1440, { id: "healthy-footman-a" })
      .unit("v2", "footman", 1420, 1460, { id: "healthy-footman-b" })
      .unit("v2", "lancer", 1460, 1480, { id: "healthy-lancer" })
      .unit("v2", "archer", 1500, 1500, { id: "healthy-archer-a" })
      .unit("v2", "archer", 1540, 1520, { id: "healthy-archer-b" })
      .unit("v2", "footman", 1580, 1540, { id: "healthy-footman-c" })
      .unit("v2", "lancer", 1620, 1560, { id: "healthy-lancer-b" })
      .townHall("v1a", 3100, 1700)
      .unit("v1a", "footman", 2600, 1700)
      .unit("v1a", "lancer", 2640, 1740)
      .townHall("v1b", 3300, 2300)
      .unit("v1b", "archer", 2680, 1780)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3100, 1700, 4000)
      .goldMine("v1b-main-mine", 3300, 2300, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", requestedVersion: "v5", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command?.unitIds).not.toEqual(expect.arrayContaining(["wounded-footman", "wounded-lancer"]));
    expect(command?.unitIds).toEqual(expect.arrayContaining(["healthy-footman-a", "healthy-footman-b", "healthy-lancer", "healthy-archer-a", "healthy-archer-b", "healthy-footman-c", "healthy-lancer-b"]));
  });

  it("v2 lets attack-wave closeout preempt neutral objective control when the enemy has no army or workers", () => {
    const scene = sketchScene("v2-closeout-preempts-neutral-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1300, 760)
      .unit("v2", "footman", 1280, 1400)
      .unit("v2", "footman", 1320, 1420)
      .unit("v2", "lancer", 1360, 1440)
      .unit("v2", "lancer", 1400, 1460)
      .unit("v2", "archer", 1440, 1480)
      .unit("v2", "archer", 1480, 1500)
      .unit("v2", "raider", 1520, 1520)
      .townHall("v1a", 3100, 1450, { id: "v1a-last-hall" })
      .unit("neutral", "ancientStag", 1300, 2500)
      .unit("neutral", "stonebackBrute", 1360, 2560)
      .unit("neutral", "gladeWitch", 1420, 2520)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", AI_SCRIPT_VERSIONS.v2, { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "objectiveControl")).toBe(false);
    expect(entries.find((entry) => entry.scriptId === "attackWave")?.command).toMatchObject({ type: "attackMove", x: 3100, y: 1450 });
  });

  it("v2 lets closeout preempt neutral objective control when the enemy has only a small residual army", () => {
    const scene = sketchScene("v2-closeout-preempts-creep-with-residual-army")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1300, 760)
      .unit("v2", "footman", 1280, 1400)
      .unit("v2", "footman", 1320, 1420)
      .unit("v2", "lancer", 1360, 1440)
      .unit("v2", "lancer", 1400, 1460)
      .unit("v2", "archer", 1440, 1480)
      .unit("v2", "archer", 1480, 1500)
      .unit("v2", "raider", 1520, 1520)
      .townHall("v1a", 3100, 1450, { id: "v1a-closeout-hall" })
      .unit("v1a", "footman", 3030, 1410, { hp: 44 })
      .unit("v1a", "lancer", 3070, 1480, { hp: 52 })
      .unit("v1a", "archer", 3140, 1430, { hp: 35 })
      .unit("neutral", "ancientStag", 1300, 2500)
      .unit("neutral", "stonebackBrute", 1360, 2560)
      .unit("neutral", "gladeWitch", 1420, 2520)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", AI_SCRIPT_VERSIONS.v2, { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "objectiveControl")).toBe(false);
    expect(entries.find((entry) => entry.scriptId === "attackWave")?.command).toMatchObject({ type: "attackMove", x: 3100, y: 1450 });
  });

  it("v2 pauses neutral objective control when a 1v2 enemy squad controls its unfinished expansion", () => {
    const scene = sketchScene("v2-1v2-pauses-creep-for-unfinished-expansion-threat")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 820, 900, { id: "v2-natural" })
      .building("v2", "townHall", 1940, 3060, { id: "v2-third-building", complete: false })
      .unit("v2", "footman", 1540, 3000)
      .unit("v2", "footman", 1580, 3040)
      .unit("v2", "lancer", 1620, 3000)
      .unit("v2", "lancer", 1660, 3040)
      .unit("v2", "archer", 1500, 2960)
      .unit("v2", "contractArcher", 1540, 2920)
      .unit("v2", "contractArcher", 1580, 2960)
      .unit("v2", "contractArcher", 1620, 2920)
      .townHall("v1a", 3400, 1500)
      .townHall("v1b", 3400, 2600)
      .unit("v1b", "footman", 2360, 3220)
      .unit("v1b", "footman", 2400, 3260)
      .unit("v1b", "lancer", 2380, 3180)
      .unit("v1b", "mercenary", 2420, 3220)
      .unit("v1b", "mercenary", 2440, 3280)
      .unit("neutral", "wildling", 920, 3340, { id: "west-objective-a" })
      .unit("neutral", "wildling", 950, 3370, { id: "west-objective-b" })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 820, 900, 4000)
      .goldMine("v2-third-mine", 1940, 3060, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("worker-pressure closeout targets a weak single opponent as a rewrite candidate module", () => {
    const scene = sketchScene("v2-closeout-preempts-cleared-mercenary")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .unit("v2", "footman", 1480, 1400)
      .unit("v2", "footman", 1520, 1420)
      .unit("v2", "lancer", 1560, 1440)
      .unit("v2", "archer", 1600, 1460)
      .unit("v2", "contractArcher", 1640, 1480)
      .townHall("v1a", 3100, 1450)
      .worker("v1a", 3040, 1440)
      .worker("v1a", 3060, 1480)
      .unit("v1a", "footman", 2980, 1450)
      .unit("v1a", "archer", 3000, 1490)
      .mercenaryCamp("cleared-contract-post", 1800, 1540, { hireKind: "contractArcher", cost: 140 })
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressureCloseout], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "workerPressureCloseout")?.command).toMatchObject({ type: "attack" });
  });

  it("v2 does not call worker pressure closeout while a single opponent can still produce and fight", () => {
    const scene = sketchScene("v2-no-fake-worker-closeout")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .unit("v2", "footman", 1480, 1400)
      .unit("v2", "footman", 1520, 1420)
      .unit("v2", "lancer", 1560, 1440)
      .townHall("v1a", 3100, 1450)
      .building("v1a", "barracks", 3000, 1360)
      .tower("v1a", 2960, 1500)
      .worker("v1a", 3040, 1440)
      .worker("v1a", 3060, 1480)
      .unit("v1a", "footman", 2980, 1450)
      .unit("v1a", "archer", 3000, 1490)
      .mercenaryCamp("cleared-contract-post", 1800, 1540, { hireKind: "contractArcher", cost: 140 })
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", AI_SCRIPT_VERSIONS.v2, { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "workerPressureCloseout")).toBe(false);
  });

  it("v2 preset keeps a stranded 1v2 combat squad pressuring workers instead of idling", () => {
    const scene = sketchScene("v2-stranded-squad-worker-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 2860, 900)
      .unit("v2", "lancer", 2900, 880)
      .unit("v2", "archer", 2920, 920)
      .unit("v2", "contractArcher", 2940, 900)
      .townHall("v1a", 3600, 1480)
      .worker("v1a", 3420, 1410, { id: "v1a-target-worker" })
      .worker("v1a", 3460, 1450)
      .townHall("v1b", 3600, 2620)
      .worker("v1b", 3440, 2600)
      .worker("v1b", 3480, 2640)
      .build();
    const game = scene.createGame();

    const entry = planPresetAiCommandEntries(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.scriptId === "workerPressure");

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "v1a-target-worker" } });
  });

  it("v2 builds missing core production before spending the economy frame on mercenary control", () => {
    const scene = sketchScene("v2-production-before-mercenary")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "farm", 650, 500)
      .building("v2", "barracks", 650, 560)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 820, 700)
      .unit("v2", "footman", 860, 720)
      .unit("v2", "lancer", 900, 740)
      .townHall("v1a", 3100, 1450)
      .building("v1a", "barracks", 3000, 1360)
      .worker("v1a", 3040, 1440)
      .unit("v1a", "footman", 2980, 1450)
      .mercenaryCamp("cleared-contract-post", 1080, 860, { hireKind: "contractArcher", cost: 140 })
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 200;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", AI_SCRIPT_VERSIONS.v2, { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "productionBuilding")?.command).toMatchObject({ type: "build", buildingKind: "archeryRange" });
    expect(entries.some((entry) => entry.scriptId === "mercenary")).toBe(false);
  });

  it("expansion candidate builds a cleared first expansion before mercenary control", () => {
    const scene = sketchScene("v2-expansion-before-mercenary")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 820, 700)
      .unit("v2", "footman", 860, 720)
      .unit("v2", "lancer", 900, 740)
      .unit("v2", "archer", 940, 760)
      .unit("v2", "footman", 980, 780)
      .unit("v2", "lancer", 1020, 800)
      .unit("v2", "archer", 1060, 820)
      .townHall("v1a", 3100, 1450)
      .worker("v1a", 3040, 1440)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .mercenaryCamp("cleared-contract-post", 1060, 860, { hireKind: "contractArcher", cost: 140 })
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 420;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion, AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "expansion")?.command).toMatchObject({ type: "build", buildingKind: "townHall" });
    expect(entries.some((entry) => entry.scriptId === "mercenary")).toBe(false);
  });

  it("v2 does not spend catch-up expansion gold before a five-unit field group exists", () => {
    const scene = sketchScene("v2-no-thin-catchup-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 820, 700)
      .unit("v2", "lancer", 860, 720)
      .unit("v2", "archer", 900, 740)
      .unit("v2", "contractArcher", 940, 760)
      .townHall("v1", 3100, 1450)
      .townHall("v1", 2860, 1600)
      .worker("v1", 3040, 1440)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 335;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams });

    expect(entries).toEqual([]);
  });

  it("v5 takes a safe third base in 1v2 where v2's live-army gate stays conservative", () => {
    const scene = sketchScene("v5-safe-third-base-over-live-army-gate")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 920)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .building("v5", "stables", 780, 560)
      .worker("v5", 900, 940)
      .unit("v5", "footman", 1120, 1100)
      .unit("v5", "footman", 1160, 1120)
      .unit("v5", "lancer", 1200, 1140)
      .unit("v5", "archer", 1240, 1160)
      .unit("v5", "archer", 1280, 1180)
      .townHall("v3", 3400, 1500)
      .unit("v3", "footman", 2600, 1900)
      .unit("v3", "footman", 2640, 1940)
      .unit("v3", "lancer", 2680, 1980)
      .unit("v3", "lancer", 2720, 2020)
      .unit("v3", "archer", 2760, 2060)
      .unit("v3", "archer", 2800, 2100)
      .unit("v3", "contractArcher", 2840, 2140)
      .townHall("v4", 3400, 2700)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 900, 920, 4000)
      .goldMine("v5-safe-third-mine", 1500, 1500, 4000)
      .goldMine("v3-main-mine", 3400, 1500, 4000)
      .goldMine("v4-main-mine", 3400, 2700, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = BUILDING_DEFS.townHall.cost;

    const v2Entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", requestedVersion: "v2", teams: game.teams });
    const v5Entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(v2Entries).toEqual([]);
    expect(v5Entries.find((entry) => entry.scriptId === "expansion")?.command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("v5 restores missing two-base core production before banking for a catch-up third", () => {
    const scene = sketchScene("v5-two-base-core-production-before-third-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 920)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .worker("v5", 540, 520, { id: "v5-builder" })
      .worker("v5", 560, 540)
      .worker("v5", 580, 560)
      .worker("v5", 600, 580)
      .worker("v5", 620, 600)
      .worker("v5", 880, 900)
      .worker("v5", 900, 920)
      .worker("v5", 920, 940)
      .worker("v5", 940, 960)
      .unit("v5", "footman", 850, 820)
      .unit("v5", "footman", 890, 840)
      .unit("v5", "lancer", 930, 860)
      .unit("v5", "lancer", 970, 880)
      .unit("v5", "archer", 1010, 900)
      .unit("v5", "archer", 1050, 920)
      .townHall("v3", 3400, 1500)
      .townHall("v3", 3000, 1500)
      .townHall("v4", 3400, 2700)
      .townHall("v4", 3000, 2700)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 900, 920, 4000)
      .goldMine("v5-third-mine", 1500, 1500, 4000)
      .goldMine("v3-main-mine", 3400, 1500, 4000)
      .goldMine("v4-main-mine", 3400, 2700, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 375;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.productionBuilding], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.scriptId === "productionBuilding")?.command).toMatchObject({ type: "build", unitId: "v5-builder", buildingKind: "stables" });
  });

  it("v5 grove adds workshop tech after its two-base 1v2 core army and caster chain are online", () => {
    const scene = sketchScene("v5-grove-two-base-workshop-tech")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 920)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .building("v5", "stables", 780, 560)
      .building("v5", "barracks", 620, 640)
      .building("v5", "archeryRange", 700, 640)
      .building("v5", "stables", 780, 640)
      .building("v5", "sanctum", 860, 560)
      .worker("v5", 540, 520, { id: "v5-builder" })
      .townHall("v3", 3_400, 1_500)
      .townHall("v4", 3_400, 2_700)
      .goldMine("v5-main-mine", 560, 540, 4_000)
      .goldMine("v5-natural-mine", 900, 920, 4_000)
      .goldMine("v3-main-mine", 3_400, 1_500, 4_000)
      .goldMine("v4-main-mine", 3_400, 2_700, 4_000);
    for (let index = 0; index < 12; index += 1) {
      scene.unit("v5", index % 3 === 0 ? "footman" : index % 3 === 1 ? "lancer" : "archer", 850 + index * 28, 820 + (index % 4) * 22);
    }
    const game = scene.build().createGame();
    game.players.v5!.gold = 260;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.productionBuilding], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.scriptId === "productionBuilding")?.command).toMatchObject({ type: "build", unitId: "v5-builder", buildingKind: "workshop" });
  });

  it("v5 grove builds missing sanctum from a mature mining economy before reserving the next expansion", () => {
    const scene = sketchScene("v5-grove-mature-sanctum-before-next-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 920)
      .townHall("v5", 1_500, 1_500)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .building("v5", "stables", 780, 560)
      .worker("v5", 540, 520, { id: "v5-builder" })
      .townHall("v3", 3_400, 1_500)
      .townHall("v4-tr", 3_400, 2_700)
      .goldMine("v5-main-mine", 560, 540, 4_000)
      .goldMine("v5-natural-mine", 900, 920, 4_000)
      .goldMine("v5-third-mine", 1_500, 1_500, 4_000)
      .goldMine("v5-fourth-mine", 2_000, 2_100, 4_000)
      .goldMine("v3-main-mine", 3_400, 1_500, 4_000)
      .goldMine("v4-main-mine", 3_400, 2_700, 4_000);
    for (let index = 0; index < 12; index += 1) {
      scene.unit("v5", index % 3 === 0 ? "footman" : index % 3 === 1 ? "lancer" : "archer", 850 + index * 28, 820 + (index % 4) * 22);
    }
    const game = scene.build().createGame();
    game.players.v5!.gold = BUILDING_DEFS.sanctum.cost;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.productionBuilding], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.scriptId === "productionBuilding")?.command).toMatchObject({ type: "build", unitId: "v5-builder", buildingKind: "sanctum" });
  });

  it("v5 grove spends an already-affordable mature workshop window on a golem before another basic unit", () => {
    const scene = sketchScene("v5-grove-affordable-golem-priority")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 900)
      .townHall("v5", 1300, 1100)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .building("v5", "stables", 780, 560)
      .building("v5", "barracks", 620, 640)
      .building("v5", "archeryRange", 700, 640)
      .building("v5", "stables", 780, 640)
      .building("v5", "sanctum", 860, 560)
      .building("v5", "workshop", 940, 560, { id: "v5-workshop" })
      .building("v5", "farm", 560, 680)
      .building("v5", "farm", 620, 720)
      .building("v5", "farm", 680, 760)
      .building("v5", "farm", 740, 800)
      .townHall("v3", 3_400, 1_500)
      .townHall("v4-tr", 3_400, 2_700)
      .goldMine("v5-main-mine", 560, 540, 4_000)
      .goldMine("v5-natural-mine", 900, 900, 4_000)
      .goldMine("v5-third-mine", 1300, 1100, 4_000)
      .goldMine("v3-main-mine", 3_400, 1_500, 4_000)
      .goldMine("v4-main-mine", 3_400, 2_700, 4_000);
    for (let index = 0; index < 16; index += 1) {
      scene.worker("v5", 540 + index * 18, 520 + (index % 3) * 18, {
        order: { type: "mine", resourceId: index < 5 ? "v5-main-mine" : index < 10 ? "v5-natural-mine" : "v5-third-mine", phase: "gather", timer: 0 },
      });
    }
    for (let index = 0; index < 12; index += 1) {
      scene.unit("v5", index % 3 === 0 ? "footman" : index % 3 === 1 ? "lancer" : "archer", 850 + index * 28, 820 + (index % 4) * 22);
    }
    const game = scene.build().createGame();
    game.players.v5!.gold = UNIT_DEFS.golem.cost;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(commands[0]).toEqual({ type: "train", buildingId: "v5-workshop", unitKind: "golem" });
  });

  it("v5 spends a cleared first-expansion bank on training when the larger enemy wave is entering main", () => {
    const scene = sketchScene("v5-cleared-natural-bank-breaks-for-main-approach")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "emberForge", 620, 560)
      .building("v5", "cinderSpire", 700, 560)
      .building("v5", "farm", 560, 680)
      .building("v5", "farm", 620, 720)
      .building("v5", "farm", 680, 760)
      .worker("v5", 520, 520)
      .worker("v5", 540, 540)
      .worker("v5", 560, 560)
      .worker("v5", 580, 580)
      .worker("v5", 600, 600)
      .worker("v5", 620, 620)
      .worker("v5", 640, 640)
      .worker("v5", 660, 660)
      .worker("v5", 680, 680)
      .unit("v5", "emberRavager", 780, 560)
      .unit("v5", "emberRavager", 820, 580)
      .unit("v5", "cinderRunner", 860, 600)
      .unit("v5", "cinderRunner", 900, 620)
      .unit("v5", "sparkArcher", 940, 640)
      .townHall("v3", 3_400, 1_500)
      .townHall("v4", 3_400, 2_700)
      .unit("v3", "footman", 1_260, 520)
      .unit("v3", "footman", 1_300, 560)
      .unit("v3", "contractArcher", 1_340, 600)
      .unit("v3", "footman", 2_220, 900)
      .unit("v3", "lancer", 2_260, 940)
      .unit("v3", "archer", 2_300, 980)
      .unit("v3", "footman", 2_340, 1_020)
      .unit("v3", "lancer", 2_380, 1_060)
      .goldMine("v5-main-mine", 560, 540, 4_000)
      .goldMine("v5-cleared-natural", 900, 900, 4_000)
      .goldMine("v3-main-mine", 3_400, 1_500, 4_000)
      .goldMine("v4-main-mine", 3_400, 2_700, 4_000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 265;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.scriptId === "training")?.command).toMatchObject({ type: "train" });
  });

  it("v5 grove keeps the cleared first-expansion bank against the same trailing wave shape", () => {
    const scene = sketchScene("v5-grove-keeps-cleared-natural-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .building("v5", "stables", 780, 560)
      .building("v5", "farm", 560, 680)
      .building("v5", "farm", 620, 720)
      .building("v5", "farm", 680, 760)
      .worker("v5", 520, 520)
      .worker("v5", 540, 540)
      .worker("v5", 560, 560)
      .worker("v5", 580, 580)
      .worker("v5", 600, 600)
      .worker("v5", 620, 620)
      .worker("v5", 640, 640)
      .worker("v5", 660, 660)
      .worker("v5", 680, 680)
      .unit("v5", "footman", 780, 560)
      .unit("v5", "footman", 820, 580)
      .unit("v5", "lancer", 860, 600)
      .unit("v5", "lancer", 900, 620)
      .unit("v5", "archer", 940, 640)
      .townHall("v3", 3_400, 1_500)
      .townHall("v4", 3_400, 2_700)
      .unit("v3", "footman", 1_260, 520)
      .unit("v3", "footman", 1_300, 560)
      .unit("v3", "contractArcher", 1_340, 600)
      .unit("v3", "footman", 2_220, 900)
      .unit("v3", "lancer", 2_260, 940)
      .unit("v3", "archer", 2_300, 980)
      .unit("v3", "footman", 2_340, 1_020)
      .unit("v3", "lancer", 2_380, 1_060)
      .goldMine("v5-main-mine", 560, 540, 4_000)
      .goldMine("v5-cleared-natural", 900, 900, 4_000)
      .goldMine("v3-main-mine", 3_400, 1_500, 4_000)
      .goldMine("v4-main-mine", 3_400, 2_700, 4_000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 265;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.scriptId === "training")).toBeUndefined();
  });

  it("v5 ember keeps a quiet cleared first-expansion bank before its first spark support", () => {
    const scene = sketchScene("v5-cleared-natural-bank-before-first-spark")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "emberForge", 620, 560)
      .building("v5", "cinderSpire", 700, 560)
      .building("v5", "farm", 560, 680)
      .building("v5", "farm", 620, 720)
      .building("v5", "farm", 680, 760)
      .worker("v5", 520, 520)
      .worker("v5", 540, 540)
      .worker("v5", 560, 560)
      .worker("v5", 580, 580)
      .worker("v5", 600, 600)
      .worker("v5", 620, 620)
      .worker("v5", 640, 640)
      .worker("v5", 660, 660)
      .worker("v5", 680, 680)
      .unit("v5", "emberRavager", 780, 560, { hp: 70 })
      .unit("v5", "emberRavager", 820, 580, { hp: 80 })
      .unit("v5", "cinderRunner", 860, 600)
      .unit("v5", "cinderRunner", 900, 620)
      .townHall("v3", 3_400, 1_500)
      .townHall("v4", 3_400, 2_700)
      .unit("v3", "emberRavager", 2_900, 1_500)
      .unit("v3", "cinderRunner", 2_950, 1_540)
      .unit("v3", "sparkArcher", 3_000, 1_580)
      .unit("v4", "contractArcher", 3_000, 2_600)
      .unit("v4", "mercenary", 3_050, 2_640)
      .goldMine("v5-main-mine", 560, 540, 4_000)
      .goldMine("v5-cleared-natural", 900, 900, 4_000)
      .goldMine("v3-main-mine", 3_400, 1_500, 4_000)
      .goldMine("v4-main-mine", 3_400, 2_700, 4_000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 110;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.scriptId === "training")).toBeUndefined();
  });

  it("v5 ember spends a guarded first-expansion bank on its first spark support", () => {
    const scene = sketchScene("v5-guarded-natural-first-spark")
      .map("cobaltVale")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 492, 2048, { id: "v5-main" })
      .building("v5", "emberForge", 578, 2176, { id: "forge" })
      .building("v5", "cinderSpire", 578, 1976, { id: "spire" })
      .building("v5", "emberShrine", 406, 2166)
      .building("v5", "farm", 716, 1948)
      .building("v5", "farm", 716, 2176)
      .goldMine("gold-v5-main", 702, 1958, 4_000)
      .goldMine("gold-v5-natural", 810, 2610, 4_000)
      .goldMine("gold-v3-main", 3_604, 2_048, 4_000)
      .goldMine("gold-v4-main", 3_604, 2_680, 4_000);
    for (let index = 0; index < 9; index += 1) scene.worker("v5", 560 + index * 18, 2_000 + (index % 2) * 28);
    scene
      .unit("v5", "emberRavager", 716, 2104)
      .unit("v5", "emberRavager", 760, 2130)
      .unit("v5", "cinderRunner", 800, 2156)
      .unit("v5", "cinderRunner", 840, 2182)
      .unit("neutral", "wildling", 810, 2610)
      .townHall("v3", 3_604, 2_048)
      .townHall("v4-tr", 3_604, 2_680);
    const game = scene.build().createGame();
    game.players.v5!.gold = 305;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    })[0];

    expect(command).toMatchObject({ type: "train", buildingId: "spire", unitKind: "sparkArcher" });
  });

  it("v5 ember spends a cleared near-hall bank on first spark when two enemy armies are far ahead", () => {
    const scene = sketchScene("v5-cleared-natural-first-spark-army-deficit")
      .map("spruceCircuit")
      .replaceDefaults()
      .player("v5", { team: "south", race: "ember" })
      .player("v3", { team: "north", race: "grove" })
      .player("v4-tr", { team: "north", race: "grove" })
      .townHall("v5", 492, 2048, { id: "v5-main" })
      .building("v5", "emberForge", 578, 2176, { id: "forge" })
      .building("v5", "cinderSpire", 578, 1976, { id: "spire" })
      .building("v5", "farm", 716, 1948)
      .building("v5", "farm", 716, 2176)
      .building("v5", "farm", 716, 2404)
      .goldMine("gold-v5-main", 702, 1958, 4_000)
      .goldMine("gold-v5-natural", 810, 2610, 4_000)
      .goldMine("gold-v3-main", 3_500, 1_420, 4_000)
      .goldMine("gold-v4-main", 3_050, 3_150, 4_000);
    for (let index = 0; index < 9; index += 1) scene.worker("v5", 560 + index * 18, 2_000 + (index % 2) * 28);
    scene
      .unit("v5", "emberRavager", 817, 2603, { hp: 55 })
      .unit("v5", "cinderRunner", 792, 2628, { hp: 62 })
      .unit("v5", "emberRavager", 672, 2265)
      .unit("v5", "cinderRunner", 667, 2230)
      .townHall("v3", 3_500, 1_420)
      .townHall("v4-tr", 3_050, 3_150)
      .unit("v3", "footman", 2388, 839)
      .unit("v3", "footman", 2355, 824)
      .unit("v3", "lancer", 2286, 821)
      .unit("v3", "footman", 2322, 811)
      .unit("v3", "contractArcher", 2326, 853, { hp: 45 })
      .unit("v3", "lancer", 2359, 860)
      .unit("v3", "footman", 3570, 1635)
      .unit("v3", "archer", 3471, 1314)
      .unit("v4-tr", "mercenary", 2953, 3175)
      .unit("v4-tr", "mercenary", 2935, 3106)
      .unit("v4-tr", "mercenary", 2944, 3141);
    const game = scene.build().createGame();
    game.players.v5!.gold = 305;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    })[0];

    expect(command).toMatchObject({ type: "train", buildingId: "spire", unitKind: "sparkArcher" });
  });

  it("v5 waits for a larger two-base 1v2 group before starting a neutral objective", () => {
    const scene = sketchScene("v5-two-base-objective-group-size")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 1_100, 900)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .unit("v5", "footman", 900, 720)
      .unit("v5", "footman", 940, 740)
      .unit("v5", "lancer", 980, 760)
      .unit("v5", "archer", 1020, 780)
      .unit("v5", "contractArcher", 1060, 800)
      .townHall("v3", 3400, 1500)
      .townHall("v4", 3400, 2700)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 1_100, 900, 4000)
      .goldMine("v3-main-mine", 3400, 1500, 4000)
      .goldMine("v4-main-mine", 3400, 2700, 4000)
      .unit("neutral", "mossGnawer", 1300, 860)
      .unit("neutral", "thornSlinger", 1340, 900)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.objectiveControl], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.scriptId === "objectiveControl")).toBeUndefined();
  });

  it("v5 waits for a larger two-base 1v2 group before ordinary attack-wave pressure", () => {
    const scene = sketchScene("v5-two-base-attack-wave-group-size")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 1_100, 900)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .unit("v5", "footman", 900, 720)
      .unit("v5", "footman", 940, 740)
      .unit("v5", "lancer", 980, 760)
      .unit("v5", "archer", 1020, 780)
      .unit("v5", "footman", 1060, 800)
      .unit("v5", "lancer", 1100, 820)
      .townHall("v3", 3400, 1500)
      .building("v3", "barracks", 3300, 1460)
      .unit("v3", "footman", 2600, 2100)
      .unit("v3", "footman", 2640, 2140)
      .unit("v3", "lancer", 2680, 2180)
      .townHall("v4", 3400, 2700)
      .building("v4", "barracks", 3300, 2660)
      .unit("v4", "footman", 2700, 2300)
      .unit("v4", "contractArcher", 2740, 2340)
      .unit("v4", "mercenary", 2780, 2380)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 1_100, 900, 4000)
      .goldMine("v3-main-mine", 3400, 1500, 4000)
      .goldMine("v4-main-mine", 3400, 2700, 4000)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.attackWave], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.scriptId === "attackWave")).toBeUndefined();
  });

  it("v5 waits for a larger 1v2 group after the first natural is cleared even before the second base mines", () => {
    const scene = sketchScene("v5-cleared-natural-attack-wave-group-size")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .unit("v5", "footman", 900, 720)
      .unit("v5", "footman", 940, 740)
      .unit("v5", "lancer", 980, 760)
      .unit("v5", "archer", 1020, 780)
      .unit("v5", "footman", 1060, 800)
      .unit("v5", "lancer", 1100, 820)
      .townHall("v3", 3400, 1500)
      .building("v3", "barracks", 3300, 1460)
      .unit("v3", "footman", 2600, 2100)
      .unit("v3", "footman", 2640, 2140)
      .unit("v3", "lancer", 2680, 2180)
      .townHall("v4", 3400, 2700)
      .building("v4", "barracks", 3300, 2660)
      .unit("v4", "footman", 2700, 2300)
      .unit("v4", "contractArcher", 2740, 2340)
      .unit("v4", "mercenary", 2780, 2380)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 1_100, 900, 4000)
      .goldMine("v3-main-mine", 3400, 1500, 4000)
      .goldMine("v4-main-mine", 3400, 2700, 4000)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.attackWave], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.scriptId === "attackWave")).toBeUndefined();
  });

  it("v5 can clear a local mercenary objective while holding first-expansion gold", () => {
    const scene = sketchScene("v5-first-expansion-local-merc-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "west", race: "grove" })
      .player("v3", { team: "east", race: "grove" })
      .player("v4", { team: "east", race: "grove" })
      .townHall("v5", 500, 2048)
      .building("v5", "barracks", 620, 2100)
      .unit("v5", "footman", 900, 2160)
      .unit("v5", "footman", 940, 2200)
      .unit("v5", "lancer", 980, 2160)
      .unit("v5", "footman", 1020, 2200)
      .unit("v5", "lancer", 1060, 2160)
      .townHall("v3", 3500, 2600)
      .townHall("v4", 3500, 1500)
      .unit("neutral", "mossGnawer", 1180, 2060)
      .unit("neutral", "thornSlinger", 1210, 2090)
      .mercenaryCamp("local-bow-post", 1180, 2060, { hireKind: "contractArcher", cost: 145, stock: 3, cooldownRemaining: 0 })
      .goldMine("v5-main-mine", 540, 2048, 4000)
      .goldMine("v5-natural-mine", 780, 2540, 4000)
      .goldMine("v3-main-mine", 3500, 2600, 4000)
      .goldMine("v4-main-mine", 3500, 1500, 4000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v5-natural-mine", expansionClaimTick: 0 };

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.objectiveControl], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
      memory,
    });

    expect(entries.find((entry) => entry.scriptId === "objectiveControl")).toMatchObject({
      command: { type: "attackMove", x: 1180, y: 2060 },
    });
  });

  it("v5 attacks an enemy town hall planted on its cleared natural before clearing another mine", () => {
    const scene = sketchScene("v5-contested-cleared-natural-before-next-mine")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "emberForge", 620, 560)
      .building("v5", "cinderSpire", 700, 560)
      .worker("v5", 540, 520)
      .unit("v5", "emberRavager", 850, 820)
      .unit("v5", "emberRavager", 890, 840)
      .unit("v5", "cinderRunner", 930, 860)
      .unit("v5", "cinderRunner", 970, 880)
      .unit("v5", "emberRavager", 1010, 900)
      .building("v4", "townHall", 900, 900, { id: "enemy-stolen-natural", complete: false })
      .townHall("v3", 3400, 1500)
      .townHall("v4", 3400, 2700)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-cleared-natural", 900, 900, 4000)
      .goldMine("next-guarded-mine", 1500, 1500, 4000)
      .goldMine("v3-main-mine", 3400, 1500, 4000)
      .goldMine("v4-main-mine", 3400, 2700, 4000)
      .unit("neutral", "wildling", 1500, 1500)
      .unit("neutral", "mossGnawer", 1530, 1530)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 60;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "expansion")?.command).toMatchObject({ type: "attack", targetId: "enemy-stolen-natural" });
  });

  it("v5 does not attack a stolen natural through another opponent's covering army", () => {
    const scene = sketchScene("v5-contested-natural-covered-by-second-opponent")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "emberForge", 620, 560)
      .building("v5", "cinderSpire", 700, 560)
      .worker("v5", 540, 520)
      .unit("v5", "emberRavager", 820, 780)
      .unit("v5", "emberRavager", 860, 800)
      .unit("v5", "cinderRunner", 900, 820)
      .unit("v5", "cinderRunner", 940, 840)
      .unit("v5", "emberRavager", 980, 860)
      .building("v4", "townHall", 900, 900, { id: "enemy-stolen-natural", complete: false })
      .townHall("v3", 3400, 1500)
      .townHall("v4", 3400, 2700)
      .unit("v3", "footman", 1080, 940)
      .unit("v3", "footman", 1120, 980)
      .unit("v3", "lancer", 1160, 1020)
      .unit("v3", "archer", 1200, 1060)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-cleared-natural", 900, 900, 4000)
      .goldMine("next-guarded-mine", 1500, 1500, 4000)
      .goldMine("v3-main-mine", 3400, 1500, 4000)
      .goldMine("v4-main-mine", 3400, 2700, 4000)
      .unit("neutral", "wildling", 1500, 1500)
      .unit("neutral", "mossGnawer", 1530, 1530)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 60;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "expansion")?.command).not.toMatchObject({ type: "attack", targetId: "enemy-stolen-natural" });
  });

  it("does not use expansion clearing to enter an enemy-controlled guarded mine", () => {
    const scene = sketchScene("expansion-clear-respects-enemy-objective-control")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 760, 620)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 900, 500)
      .unit("v2", "footman", 940, 520)
      .unit("v2", "lancer", 980, 540)
      .unit("v2", "lancer", 1020, 560)
      .unit("v2", "archer", 1060, 580)
      .unit("v2", "archer", 1100, 600)
      .unit("v2", "contractArcher", 1140, 620)
      .unit("v2", "fieldMedic", 1180, 640)
      .townHall("v1", 3400, 3300, { id: "v1-main" })
      .worker("v1", 3360, 3300)
      .worker("v1", 3380, 3340)
      .unit("v1", "footman", 1920, 500)
      .unit("v1", "footman", 1960, 540)
      .unit("v1", "lancer", 2000, 580)
      .unit("v1", "archer", 2040, 620)
      .unit("v1", "contractArcher", 2080, 660)
      .unit("v1", "footman", 2040, 500)
      .unit("v1", "lancer", 2080, 540)
      .unit("v1", "mercenary", 2120, 580)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("contested-guarded-mine", 2000, 560, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .unit("neutral", "wildling", 2000, 560, { id: "last-natural-guard", hp: 56 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 235;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    }

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "expansion")?.command).not.toMatchObject({ type: "attackMove", x: 2000, y: 560 });
  });

  it("v5 emergency defense guards the fresh natural before dropping another main-side tower", () => {
    const scene = sketchScene("v5-fresh-natural-emergency-guard")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 820, 980)
      .building("v5", "barracks", 620, 560)
      .building("v5", "archeryRange", 700, 560)
      .worker("v5", 780, 900)
      .unit("v5", "footman", 930, 820)
      .unit("v5", "footman", 960, 850)
      .unit("v5", "lancer", 990, 880)
      .unit("v5", "lancer", 1_020, 910)
      .unit("v5", "archer", 1_050, 940)
      .unit("v5", "archer", 1_080, 970)
      .townHall("v3", 3_400, 1_500)
      .unit("v3", "footman", 1_420, 930)
      .unit("v3", "footman", 1_460, 960)
      .unit("v3", "footman", 1_500, 990)
      .unit("v3", "lancer", 1_540, 1_020)
      .unit("v3", "archer", 1_580, 1_050)
      .unit("v3", "contractArcher", 1_620, 1_080)
      .townHall("v4", 3_400, 2_700)
      .goldMine("v5-main-mine", 560, 540, 4_000)
      .goldMine("v5-natural-mine", 820, 980, 4_000)
      .goldMine("v3-main-mine", 3_400, 1_500, 4_000)
      .goldMine("v4-main-mine", 3_400, 2_700, 4_000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = BUILDING_DEFS.defenseTower.cost;

    const command = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.emergencyDefense, AI_SCRIPT_LIBRARY.defense], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    }).find((entry) => entry.command.type === "build")?.command;

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
    if (command?.type !== "build") throw new Error("expected defense tower build");
    const distanceToNatural = Math.hypot(command.x - 820, command.y - 980);
    const distanceToMain = Math.hypot(command.x - 500, command.y - 500);
    expect(distanceToNatural).toBeLessThan(distanceToMain);
  });

  it("v5 severe economy guards the main before a remote fresh natural with its first tower", () => {
    const scene = sketchScene("v5-severe-economy-first-tower-main-before-remote-natural")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3a", { team: "south", race: "ember" })
      .player("v3b", { team: "south", race: "grove" })
      .player("v3c", { team: "south", race: "ember" })
      .townHall("v5", 1370, 550, { id: "v5-main" })
      .townHall("v5", 550, 570, { id: "v5-natural" })
      .building("v5", "emberForge", 1456, 678)
      .worker("v5", 560, 590, { id: "v5-builder", order: { type: "mine", resourceId: "v5-natural-mine", phase: "gather", timer: 0 } })
      .worker("v5", 1320, 580)
      .worker("v5", 1390, 590)
      .townHall("v3a", 1456, 1618)
      .townHall("v3b", 1490, 2710)
      .townHall("v3c", 3580, 1618)
      .goldMine("v5-main-mine", 1580, 640, 4000)
      .goldMine("v5-natural-mine", 640, 640, 4000)
      .goldMine("v3a-main-mine", 1580, 1580, 4000)
      .goldMine("v3b-main-mine", 1580, 2520, 4000)
      .goldMine("v3c-main-mine", 3456, 1580, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = BUILDING_DEFS.defenseTower.cost;

    const command = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.defense], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    }).find((entry) => entry.command.type === "build")?.command;

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
    if (command?.type !== "build") throw new Error("expected defense tower build");
    expect(Math.hypot(command.x - 1370, command.y - 550)).toBeLessThan(Math.hypot(command.x - 550, command.y - 570));
  });

  it("v5 emergency defense can guard the first natural while the town hall is still building", () => {
    const scene = sketchScene("v5-incomplete-natural-emergency-guard")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "townHall", 820, 980, { complete: false })
      .building("v5", "emberForge", 620, 560)
      .building("v5", "cinderSpire", 700, 560)
      .worker("v5", 780, 900)
      .unit("v5", "emberRavager", 930, 820)
      .unit("v5", "emberRavager", 960, 850)
      .unit("v5", "cinderRunner", 990, 880)
      .unit("v5", "cinderRunner", 1_020, 910)
      .unit("v5", "sparkArcher", 1_050, 940)
      .townHall("v3", 3_400, 1_500)
      .unit("v3", "emberRavager", 1_420, 930)
      .unit("v3", "emberRavager", 1_460, 960)
      .unit("v3", "cinderRunner", 1_500, 990)
      .unit("v3", "sparkArcher", 1_540, 1_020)
      .unit("v3", "mercenary", 1_580, 1_050)
      .townHall("v4", 3_400, 2_700)
      .goldMine("v5-main-mine", 560, 540, 4_000)
      .goldMine("v5-natural-mine", 820, 980, 4_000)
      .goldMine("v3-main-mine", 3_400, 1_500, 4_000)
      .goldMine("v4-main-mine", 3_400, 2_700, 4_000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = BUILDING_DEFS.defenseTower.cost;

    const command = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.emergencyDefense, AI_SCRIPT_LIBRARY.defense], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    }).find((entry) => entry.command.type === "build")?.command;

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
    if (command?.type !== "build") throw new Error("expected defense tower build");
    expect(Math.hypot(command.x - 820, command.y - 980)).toBeLessThan(Math.hypot(command.x - 500, command.y - 500));
  });

  it("v5 emergency defense guards the main before a fresh natural when the first hit reaches main production", () => {
    const scene = sketchScene("v5-main-pressure-before-fresh-natural-tower")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 492, 2048, { id: "v5-main" })
      .townHall("v5", 720, 2540, { id: "v5-natural" })
      .building("v5", "emberForge", 578, 2176)
      .building("v5", "cinderSpire", 578, 1976)
      .worker("v5", 520, 2080, { id: "v5-builder" })
      .worker("v5", 555, 2080)
      .worker("v5", 590, 2080)
      .worker("v5", 690, 2520)
      .unit("v5", "emberRavager", 1267, 1395)
      .unit("v5", "emberRavager", 1292, 1370)
      .unit("v5", "cinderRunner", 1296, 1335)
      .unit("v5", "cinderRunner", 1129, 1810, { id: "main-lane-runner" })
      .unit("v5", "contractArcher", 1224, 1742)
      .unit("v5", "fieldMedic", 1085, 1620)
      .townHall("v3", 3604, 1475)
      .unit("v3", "emberRavager", 1106, 1779, { order: { type: "attack", targetId: "main-lane-runner" } })
      .unit("v3", "emberRavager", 1371, 1817, { order: { type: "attack", targetId: "main-lane-runner" } })
      .unit("v3", "cinderRunner", 1352, 1772, { order: { type: "attack", targetId: "main-lane-runner" } })
      .unit("v3", "cinderRunner", 1397, 1835, { order: { type: "attack", targetId: "main-lane-runner" } })
      .unit("v3", "contractArcher", 1273, 2012, { order: { type: "attack", targetId: "main-lane-runner" } })
      .unit("v3", "contractArcher", 1320, 1980, { order: { type: "attack", targetId: "main-lane-runner" } })
      .townHall("v4", 3604, 2621)
      .goldMine("v5-main-mine", 492, 2048, 4000)
      .goldMine("v5-natural-mine", 720, 2640, 4000)
      .goldMine("v3-main-mine", 3604, 1475, 4000)
      .goldMine("v4-main-mine", 3604, 2621, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = BUILDING_DEFS.defenseTower.cost;

    const command = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.emergencyDefense, AI_SCRIPT_LIBRARY.defense], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    }).find((entry) => entry.command.type === "build")?.command;

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
    if (command?.type !== "build") throw new Error("expected defense tower build");
    expect(Math.hypot(command.x - 492, command.y - 2048)).toBeLessThan(Math.hypot(command.x - 720, command.y - 2540));
  });

  it("v2 does not spend near-complete first-expansion gold on a moon well", () => {
    const scene = sketchScene("v2-holds-first-expansion-gold-before-moon-well")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "farm", 650, 500)
      .building("v2", "farm", 690, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .tower("v2", 590, 620)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 650, 620, { hp: 80 })
      .unit("v2", "footman", 690, 640, { hp: 82 })
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "lancer", 770, 680)
      .unit("v2", "archer", 810, 700)
      .unit("v2", "archer", 850, 720)
      .unit("v2", "footman", 890, 740)
      .unit("v2", "lancer", 930, 760)
      .townHall("v1", 3100, 1450)
      .unit("v1", "footman", 1560, 500)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 285;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", teams: game.teams });

    expect(entries).toEqual([]);
  });

  it("v2 does not spend near-complete first-expansion gold on routine training", () => {
    const scene = sketchScene("v2-holds-first-expansion-gold-before-training")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "farm", 650, 500)
      .building("v2", "farm", 690, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .building("v2", "stables", 770, 560)
      .tower("v2", 590, 620)
      .worker("v2", 560, 540)
      .worker("v2", 580, 540)
      .worker("v2", 600, 540)
      .worker("v2", 620, 540)
      .worker("v2", 640, 540)
      .unit("v2", "footman", 650, 620, { hp: 80 })
      .unit("v2", "footman", 690, 640)
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "lancer", 770, 680)
      .unit("v2", "archer", 810, 700)
      .unit("v2", "archer", 850, 720)
      .unit("v2", "footman", 890, 740)
      .unit("v2", "lancer", 930, 760)
      .townHall("v1", 3100, 1450)
      .unit("v1", "footman", 1560, 500)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 285;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(entries).toEqual([]);
  });

  it("v2 spends the first-expansion bank when support units overstate the army body count", () => {
    const scene = sketchScene("v2-support-heavy-first-expansion-bank-break")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "farm", 650, 500)
      .building("v2", "farm", 690, 500)
      .building("v2", "barracks", 650, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 710, 560, { id: "v2-archery" })
      .building("v2", "stables", 770, 560, { id: "v2-stables" })
      .worker("v2", 560, 540)
      .worker("v2", 580, 540)
      .worker("v2", 600, 540)
      .worker("v2", 620, 540)
      .worker("v2", 640, 540)
      .unit("v2", "footman", 650, 620)
      .unit("v2", "footman", 690, 640)
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "archer", 770, 680)
      .unit("v2", "contractArcher", 810, 700)
      .unit("v2", "fieldMedic", 850, 720)
      .unit("v2", "fieldMedic", 890, 740)
      .townHall("v1", 3100, 1450)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 285;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.command.type === "train" && entry.command.unitKind !== "worker")).toBe(true);
  });

  it("v2 keeps combat production active before the first expansion bank in the copperWeald control timing", () => {
    const report = runAiGame({
      name: "copperWeald first expansion training timing",
      mapId: "copperWeald",
      agents: {
        v2: { controller: "external-agent", team: "north", race: "grove", version: "v2", versionLabel: "v2" },
        v1a: { controller: "external-agent", team: "south", race: "grove", version: "v1", versionLabel: "v1" },
      },
      maxTicks: 4_501,
      thinkInterval: 45,
      trace: { commands: true },
    });

    const combatTrainingBeforeBankStall = report.commands.filter(
      (entry) =>
        entry.tick >= 2_000 &&
        entry.tick <= 3_600 &&
        entry.owner === "v2" &&
        entry.scriptId === "training" &&
        entry.command.type === "train" &&
        entry.command.unitKind !== "worker",
    );

    expect(combatTrainingBeforeBankStall.length).toBeGreaterThanOrEqual(1);
  });

  it("v2 spends a low-gold melee-only training window on the first archer", () => {
    const scene = sketchScene("v2-first-archer-before-more-melee")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "farm", 650, 500)
      .building("v2", "barracks", 650, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 710, 560, { id: "v2-archery" })
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 700, 620)
      .unit("v2", "footman", 730, 640)
      .unit("v2", "lancer", 760, 660)
      .unit("v2", "footman", 790, 680)
      .townHall("v1a", 3100, 1450)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 115;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([{ type: "train", buildingId: "v2-archery", unitKind: "archer" }]);
  });

  it("v2 preserves worker gold for first combat recovery when its army has been wiped", () => {
    const scene = sketchScene("v2-first-combat-recovery-before-workers")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1_250, 760, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .townHall("v1a", 3_300, 3_300)
      .unit("v1a", "footman", 850, 820)
      .unit("v1a", "lancer", 900, 840)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1_300, 760, 4000)
      .goldMine("v1a-main-mine", 3_300, 3_240, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 75;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands.find((command) => command.type === "train")).toBeUndefined();
  });

  it("v2 does not split a thin post-expansion army just to pre-claim a mercenary camp", () => {
    const scene = sketchScene("v2-no-thin-merc-preclaim")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1_250, 760)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 1_850, 1_650)
      .unit("v2", "footman", 1_890, 1_680)
      .unit("v2", "lancer", 1_930, 1_710)
      .unit("v2", "footman", 1_970, 1_740)
      .unit("v2", "lancer", 2_010, 1_770)
      .unit("v2", "footman", 2_050, 1_800)
      .townHall("v1a", 3_300, 3_300)
      .unit("v1a", "footman", 2_350, 2_200)
      .unit("v1a", "footman", 2_390, 2_230)
      .unit("v1a", "lancer", 2_430, 2_260)
      .unit("v1a", "lancer", 2_470, 2_290)
      .unit("v1a", "archer", 2_510, 2_320)
      .unit("v1a", "archer", 2_550, 2_350)
      .mercenaryCamp("thin-claim-camp", 1_340, 1_520, { hireKind: "mercenary", stock: 2, cost: 220 })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1_300, 760, 4000)
      .goldMine("v1a-main-mine", 3_300, 3_240, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 50;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams });

    expect(commands.find((command) => command.type === "attackMove")).toBeUndefined();
  });

  it("v2 does not pre-claim a mercenary camp with only the first three fighters", () => {
    const scene = sketchScene("v2-no-first-three-merc-preclaim")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .unit("v2", "footman", 900, 780)
      .unit("v2", "footman", 940, 800)
      .unit("v2", "lancer", 980, 820)
      .townHall("v1a", 3_300, 3_300)
      .mercenaryCamp("first-three-camp", 1_120, 920, { hireKind: "mercenary", stock: 2, cost: 220 })
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams });

    expect(commands.find((command) => command.type === "attackMove")).toBeUndefined();
  });

  it("v2 does not spend near-complete first-expansion gold on extra supply", () => {
    const scene = sketchScene("v2-holds-first-expansion-gold-before-supply")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "farm", 610, 500)
      .building("v2", "farm", 650, 500)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .tower("v2", 590, 620)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 650, 620)
      .unit("v2", "footman", 690, 640)
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "lancer", 770, 680)
      .unit("v2", "archer", 810, 700)
      .unit("v2", "archer", 850, 720)
      .unit("v2", "footman", 890, 740)
      .unit("v2", "lancer", 930, 760)
      .townHall("v1", 3100, 1450)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 285;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.supply], { version: "v2", teams: game.teams });

    expect(entries).toEqual([]);
  });

  it("v2 does not spend the first main-guard tower bank on a moon well", () => {
    const scene = sketchScene("v2-main-guard-tower-before-moon-well")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1160, 980, { id: "v2-natural" })
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 780, 620, { hp: 85 })
      .unit("v2", "footman", 820, 650, { hp: 90 })
      .unit("v2", "lancer", 860, 680)
      .unit("v2", "contractArcher", 900, 710)
      .townHall("v1", 3100, 1450)
      .unit("v1", "footman", 1_160, 760)
      .unit("v1", "lancer", 1_200, 790)
      .unit("v1", "contractArcher", 1_240, 820)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 115;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v5 builds its first healing well before a distant main-guard reserve when critical defenders are stranded", () => {
    const scene = sketchScene("v2-critical-wounds-before-distant-main-guard-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 560)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 560, 540, { id: "v2-builder" })
      .unit("v2", "footman", 470, 620, { hp: 44 })
      .unit("v2", "footman", 520, 650, { hp: 48 })
      .unit("v2", "lancer", 740, 680)
      .townHall("v1a", 3300, 1700)
      .unit("v1a", "footman", 1750, 500)
      .unit("v1a", "lancer", 1790, 540)
      .townHall("v1b", 3300, 2700)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3300, 1700, 4000)
      .goldMine("v1b-main-mine", 3300, 2700, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = BUILDING_DEFS.defenseTower.cost + BUILDING_DEFS.moonWell.cost - 5;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "moonWell" });
  });

  it("v2 restores combat before extra workers when production survives an army wipe", () => {
    const scene = sketchScene("v2-combat-before-worker-after-army-wipe")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1160, 980)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .worker("v2", 560, 540)
      .worker("v2", 590, 540)
      .worker("v2", 620, 540)
      .worker("v2", 1160, 980)
      .worker("v2", 1190, 980)
      .townHall("v1", 3100, 1450)
      .unit("v1", "footman", 900, 700)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 105;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([{ type: "train", buildingId: "scene-v2-combat-before-worker-after-army-wipe-v2-barracks-1", unitKind: "footman" }]);
  });

  it("v2 trains a sixth one-base worker as build and repair labor after core production exists", () => {
    const scene = sketchScene("v2-one-base-repair-labor-worker")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 650, 560, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 540, 520, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 560, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 590, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 620, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 650, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 800, 640)
      .townHall("v1", 3100, 1450)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 125;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([{ type: "train", buildingId: "v2-main", unitKind: "worker" }]);
  });

  it("v2 keeps training workers toward two-mine saturation when it can also rebuild army", () => {
    const scene = sketchScene("v2-two-mine-worker-saturation-after-army-loss")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1160, 980, { id: "v2-natural" })
      .building("v2", "barracks", 650, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 710, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 560, 540, { id: "main-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 590, 540, { id: "main-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 620, 540, { id: "main-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 1160, 980, { id: "natural-worker-a", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 10 } })
      .worker("v2", 1190, 980, { id: "natural-worker-b", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 10 } })
      .townHall("v1", 3100, 1450)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 1000;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual(
      expect.arrayContaining([
        { type: "train", buildingId: "v2-main", unitKind: "worker" },
        { type: "train", buildingId: "v2-barracks", unitKind: "footman" },
      ]),
    );
  });

  it("v2 does not spend the thin two-mine defense bank on extra workers", () => {
    const scene = sketchScene("v2-two-mine-defense-bank-before-workers")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1160, 980, { id: "v2-natural" })
      .building("v2", "barracks", 650, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 710, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 560, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 590, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 620, 540, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } })
      .worker("v2", 1160, 980, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 10 } })
      .worker("v2", 1190, 980, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 10 } })
      .unit("v2", "footman", 780, 620)
      .unit("v2", "footman", 820, 650)
      .unit("v2", "lancer", 860, 680)
      .unit("v2", "contractArcher", 900, 710)
      .townHall("v1", 3100, 1450)
      .unit("v1", "footman", 1180, 760)
      .unit("v1", "footman", 1220, 790)
      .unit("v1", "lancer", 1260, 820)
      .unit("v1", "contractArcher", 1300, 850)
      .unit("v1", "mercenary", 1340, 880)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 75;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).not.toContainEqual({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("v2 still saturates the main mine to five workers while banking for the first expansion", () => {
    const scene = sketchScene("v2-main-mine-workers-before-expansion-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "farm", 560, 660)
      .building("v2", "farm", 610, 700)
      .building("v2", "barracks", 650, 560)
      .building("v2", "archeryRange", 710, 560)
      .worker("v2", 540, 520)
      .worker("v2", 570, 520)
      .worker("v2", 600, 520)
      .unit("v2", "footman", 650, 620)
      .unit("v2", "footman", 690, 640)
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "archer", 770, 680)
      .townHall("v1", 3100, 1450)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1160, 980, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .build();
    const game = scene.createGame();
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 300;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toContainEqual({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("v2 does not trickle the first soldier into two enemy economies", () => {
    const teams = { v2: "north", v1a: "south", v1b: "south" };
    const game = createGame("bareDuel", {
      players: ["v2", "v1a", "v1b"],
      aiPlayers: [],
      teams,
      races: { v2: "grove", v1a: "grove", v1b: "ember" },
    });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    game.spawnUnit("v2", "footman", 900, 2050);
    game.spawnUnit("v1a", "footman", 3000, 1600);
    game.spawnUnit("v1b", "lancer", 3000, 2600);

    const attack = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams }).find((command) => command.type === "attackMove");

    expect(attack).toBeUndefined();
  });

  it("v2 does not spend its first two soldiers on a worker raid against two economies", () => {
    const scene = sketchScene("v2-no-first-pair-raid")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "archer", 790, 650)
      .townHall("v1a", 3400, 3300)
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attack")).toBe(false);
  });

  it("places early main-base production away from nearby neutral camps on multiplayer starts", () => {
    const game = createGame("wildMarches", {
      players: ["v2", "v1a", "v1b"],
      aiPlayers: [],
      teams: { v2: "north", v1a: "south", v1b: "south" },
      races: { v2: "grove", v1a: "grove", v1b: "ember" },
    });

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build" && candidate.buildingKind === "barracks");
    const nearestNeutralDistance =
      command?.type === "build"
        ? Math.min(...game.units.filter((unit) => unit.owner === "neutral").map((unit) => Math.hypot(unit.x - command.x, unit.y - command.y)))
        : 0;

    expect(command).toMatchObject({ type: "build", buildingKind: "barracks" });
    expect(nearestNeutralDistance).toBeGreaterThan(330);
  });

  it("v2 does not use worker pressure to cross the map while one-base and globally outmatched", () => {
    const scene = sketchScene("v2-no-outmatched-raid")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "archer", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .townHall("v1a", 3400, 3300)
      .worker("v1a", 3360, 3300)
      .unit("v1a", "footman", 3280, 3300)
      .unit("v1a", "archer", 3300, 3340)
      .unit("v1a", "lancer", 3320, 3380)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .unit("v1b", "raider", 3280, 3800)
      .unit("v1b", "lancer", 3300, 3840)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment, AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "earlyHarassment")).toBeUndefined();
    expect(entries.find((entry) => entry.scriptId === "workerPressure")).toBeUndefined();
  });

  it("v2 pulls a wounded melee unit out of a neutral camp instead of donating it while creeping", () => {
    const scene = sketchScene("v2-neutral-creep-wounded-melee-save")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 520, 520)
      .townHall("v1", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .unit("v2", "footman", 910, 2520, { id: "wounded-footman", hp: 42, order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "lancer", 950, 2530, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "archer", 990, 2540, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("neutral", "stonebackBrute", 850, 2515)
      .unit("neutral", "thornSlinger", 820, 2560)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move", unitIds: expect.arrayContaining(["wounded-footman"]), x: 520, y: 520 });
  });

  it("v2 preset combat policy pulls wounded units before attack-wave can retask them", () => {
    const scene = sketchScene("v2-combat-preset-wounded-retreat")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 150, 800, { id: "v2-anchor" })
      .unit("v2", "archer", 700, 800, { id: "wounded-archer", hp: 28 })
      .unit("v2", "footman", 680, 835, { id: "healthy-footman" })
      .unit("v1a", "footman", 740, 800, { id: "enemy-footman" })
      .townHall("v1a", 1450, 800, { id: "v1a-anchor" })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v2", { version: "v2", teams: game.teams, policyMode: "combat", memory });
    const retreat = entries.find((entry) => entry.scriptId === "skirmishPreservation" && entry.command.type === "move")?.command;

    expect(retreat).toMatchObject({ type: "move", unitIds: ["wounded-archer"], x: 502, y: 800 });
    expect(memory.unitClaims["wounded-archer"]).toMatchObject({ kind: "retreat", targetId: "retreat", x: 502, y: 800 });
    expect(entries.filter((entry) => entry.command.type === "attack" || entry.command.type === "attackMove").some((entry) => "unitIds" in entry.command && entry.command.unitIds.includes("wounded-archer"))).toBe(false);
  });

  it("v2 pulls wounded units away from neutral camps that are already near the main economy", () => {
    const scene = sketchScene("v2-neutral-near-main-retreat-away")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 610, 500)
      .townHall("v1", 3400, 3400)
      .unit("v2", "footman", 700, 560, { id: "wounded-footman", hp: 40, order: { type: "attackMove", x: 760, y: 560 } })
      .unit("neutral", "stonebackBrute", 820, 560)
      .unit("neutral", "thornSlinger", 860, 600)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move", unitIds: expect.arrayContaining(["wounded-footman"]) });
    expect(command?.type === "move" ? command.x : 500).toBeLessThan(500);
  });

  it("does not let objective control keep sending a sliced remnant squad after creep-preservation retreats", () => {
    const scene = sketchScene("v2-neutral-creep-sliced-squad")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 520, 520)
      .townHall("v1", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .unit("v2", "footman", 910, 2520, { id: "wounded-footman-a", hp: 42, order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "footman", 940, 2540, { id: "wounded-footman-b", hp: 42, order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "archer", 980, 2560, { id: "fresh-archer" })
      .unit("v2", "lancer", 1020, 2520, { id: "fresh-lancer-a" })
      .unit("v2", "lancer", 1050, 2540, { id: "fresh-lancer-b" })
      .unit("neutral", "mossGnawer", 850, 2515)
      .unit("neutral", "wildling", 880, 2540)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands.filter((command) => command.type === "move").length).toBeGreaterThan(0);
    expect(commands.some((command) => command.type === "attackMove")).toBe(false);
  });

  it("v2 breaks a neutral camp claim when the committed squad is too wounded to keep creeping", () => {
    const scene = sketchScene("v2-neutral-creep-claim-recovery")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 520, 2048)
      .townHall("v1", 3400, 3400)
      .unit("v2", "footman", 520, 3140, { id: "creep-footman-a", hp: 54, order: { type: "attackMove", x: 540, y: 3220 } })
      .unit("v2", "footman", 560, 3160, { id: "creep-footman-b", hp: 92, order: { type: "attackMove", x: 540, y: 3220 } })
      .unit("v2", "lancer", 600, 3140, { id: "creep-lancer-a", hp: 56, order: { type: "attackMove", x: 540, y: 3220 } })
      .unit("v2", "lancer", 640, 3160, { id: "creep-lancer-b", hp: 82, order: { type: "attackMove", x: 540, y: 3220 } })
      .unit("v2", "archer", 680, 3140, { id: "creep-archer", hp: 72, order: { type: "attackMove", x: 540, y: 3220 } })
      .unit("neutral", "wildling", 520, 3220, { id: "danger-camp-a" })
      .unit("neutral", "thornSlinger", 570, 3260, { id: "danger-camp-b" })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unit of game.units.filter((candidate) => candidate.owner === "v2" && candidate.kind !== "worker")) {
      memory.unitClaims[unit.id] = { kind: "creep", targetId: "danger-camp-a", x: 540, y: 3220, sinceTick: 0, expiresTick: 3600 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toMatchObject({ type: "move" });
    expect(memory.unitClaims["creep-footman-a"]).toMatchObject({ kind: "retreat", targetId: "retreat" });
    expect(memory.unitClaims["creep-archer"]).toMatchObject({ kind: "retreat", targetId: "retreat" });
  });

  it("v2 cancels a wounded neutral claim when the squad is near rally but still ordered toward the camp", () => {
    const scene = sketchScene("v2-neutral-recovery-cancels-near-rally-outbound-order")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3700)
      .unit("v2", "footman", 610, 560, { id: "claimed-a", hp: 70, order: { type: "attackMove", x: 1180, y: 980 } })
      .unit("v2", "footman", 620, 600, { id: "claimed-b", hp: 86, order: { type: "attackMove", x: 1180, y: 980 } })
      .unit("v2", "footman", 650, 570, { id: "claimed-c", hp: 86, order: { type: "attackMove", x: 1180, y: 980 } })
      .unit("neutral", "wildling", 1160, 980, { id: "camp-guard-a" })
      .unit("neutral", "thornSlinger", 1210, 1010, { id: "camp-guard-b" })
      .mercenaryCamp("guarded-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["claimed-a", "claimed-b", "claimed-c"]) {
      memory.unitClaims[unitId] = { kind: "mercenary", targetId: "guarded-melee-camp", x: 1180, y: 980, sinceTick: 0, expiresTick: 3600 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toMatchObject({ type: "move", unitIds: expect.arrayContaining(["claimed-a", "claimed-b", "claimed-c"]), x: 500, y: 500 });
    expect(memory.unitClaims["claimed-a"]).toMatchObject({ kind: "retreat", targetId: "retreat" });
  });

  it("v2 breaks a wounded early creep claim when the one-on-one enemy army has pulled ahead", () => {
    const scene = sketchScene("v2-neutral-creep-tempo-recovery")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 520, 2048)
      .townHall("v1", 3400, 2048)
      .unit("v2", "footman", 720, 2260, { id: "tempo-footman-a", hp: 68, order: { type: "attackMove", x: 820, y: 2260 } })
      .unit("v2", "lancer", 760, 2280, { id: "tempo-lancer", hp: 88, order: { type: "attackMove", x: 820, y: 2260 } })
      .unit("v2", "footman", 800, 2260, { id: "tempo-footman-b", hp: 103, order: { type: "attackMove", x: 820, y: 2260 } })
      .unit("v2", "footman", 840, 2280, { id: "tempo-footman-c", hp: 127, order: { type: "attackMove", x: 820, y: 2260 } })
      .unit("neutral", "wildling", 820, 2260, { id: "tempo-camp-a" })
      .unit("neutral", "mossGnawer", 850, 2290, { id: "tempo-camp-b" })
      .unit("v1", "footman", 2600, 2040)
      .unit("v1", "footman", 2640, 2070)
      .unit("v1", "footman", 2680, 2010)
      .unit("v1", "lancer", 2720, 2040)
      .unit("v1", "archer", 2760, 2070)
      .unit("v1", "archer", 2800, 2010)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unit of game.units.filter((candidate) => candidate.owner === "v2" && candidate.kind !== "worker")) {
      memory.unitClaims[unit.id] = { kind: "creep", targetId: "tempo-camp-a", x: 820, y: 2260, sinceTick: 0, expiresTick: 3600 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toMatchObject({ type: "move" });
    expect(memory.unitClaims["tempo-footman-a"]).toMatchObject({ kind: "retreat", targetId: "retreat" });
    expect(memory.unitClaims["tempo-footman-c"]).toMatchObject({ kind: "retreat", targetId: "retreat" });
  });

  it("does not break a first-natural creep claim for moderate wounds before a moon well exists", () => {
    const scene = sketchScene("v2-no-well-moderate-natural-claim")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3400, 3400)
      .unit("v2", "footman", 820, 650, { id: "claim-footman-a", hp: 103, order: { type: "attackMove", x: 860, y: 650 } })
      .unit("v2", "footman", 850, 675, { id: "claim-footman-b", hp: 68, order: { type: "attackMove", x: 860, y: 650 } })
      .unit("v2", "lancer", 880, 650, { id: "claim-lancer", hp: 88, order: { type: "attackMove", x: 860, y: 650 } })
      .unit("v2", "footman", 910, 675, { id: "claim-footman-c", hp: 103, order: { type: "attackMove", x: 860, y: 650 } })
      .unit("neutral", "stonebackBrute", 860, 650, { id: "natural-brute" })
      .unit("neutral", "gladeWitch", 895, 680, { id: "natural-witch" })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unit of game.units.filter((candidate) => candidate.owner === "v2" && candidate.kind !== "worker")) {
      memory.unitClaims[unit.id] = { kind: "creep", targetId: "natural-brute", x: 860, y: 650, sinceTick: 0, expiresTick: 3600 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toBeUndefined();
  });

  it("does not treat a nearby neutral camp as main-base pressure for attack-wave rally logic", () => {
    const scene = sketchScene("v2-neutral-camp-not-main-pressure")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 520, 2048)
      .townHall("v1", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .unit("v2", "footman", 760, 2350, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "footman", 790, 2370, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "lancer", 820, 2390, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "archer", 850, 2410, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("v2", "archer", 880, 2430, { order: { type: "attackMove", x: 860, y: 2520 } })
      .unit("neutral", "stonebackBrute", 860, 2520)
      .unit("neutral", "thornSlinger", 900, 2560)
      .unit("neutral", "gladeWitch", 820, 2560)
      .unit("neutral", "barkMender", 860, 2600)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 pauses neutral objective control when an enemy combat unit reaches the main worker line", () => {
    const scene = sketchScene("v2-main-worker-line-pauses-objectives")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .worker("v2", 560, 540)
      .unit("v2", "footman", 650, 620)
      .unit("v2", "footman", 690, 640)
      .unit("v2", "lancer", 730, 660)
      .unit("v2", "archer", 770, 680)
      .unit("v2", "archer", 810, 700)
      .townHall("v1", 3100, 1450)
      .unit("v1", "mercenary", 660, 540)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1-main-mine", 3100, 1450, 4000)
      .unit("neutral", "stonebackBrute", 1180, 760)
      .unit("neutral", "thornSlinger", 1220, 800)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 does not send leftover ranged units as an attack wave while the main group is recovering", () => {
    const scene = sketchScene("v2-no-leftover-ranged-attack-wave")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 491.52, 2048)
      .unit("v2", "footman", 620, 2050, { hp: 55, order: { type: "move", x: 491.52, y: 2048 } })
      .unit("v2", "lancer", 650, 2070, { hp: 58, order: { type: "move", x: 491.52, y: 2048 } })
      .unit("v2", "fieldMedic", 680, 2090, { hp: 40, order: { type: "move", x: 491.52, y: 2048 } })
      .unit("v2", "fieldMedic", 710, 2110, { hp: 42, order: { type: "move", x: 491.52, y: 2048 } })
      .unit("v2", "footman", 740, 2130, { hp: 56, order: { type: "move", x: 491.52, y: 2048 } })
      .unit("v2", "contractArcher", 1050, 1580)
      .unit("v2", "contractArcher", 1080, 1600)
      .unit("v2", "contractArcher", 1110, 1620)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 1220, 1640)
      .unit("v1", "contractArcher", 1260, 1660)
      .unit("v1", "mercenary", 1300, 1680)
      .unit("v1", "fieldMedic", 1340, 1700)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 keeps expansion regroup from pulling defenders away while the main worker line is under attack", () => {
    const scene = sketchScene("v2-main-mine-does-not-regroup-to-expansion")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 491.52, 2048)
      .townHall("v2", 720, 2540)
      .worker("v2", 608, 2002)
      .unit("v2", "footman", 670, 2511)
      .unit("v2", "lancer", 705, 2511)
      .unit("v2", "fieldMedic", 757, 2536)
      .unit("v2", "fieldMedic", 742, 2566)
      .unit("v2", "footman", 678, 2544)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 645, 2148)
      .unit("v1", "contractArcher", 680, 2160)
      .unit("v1", "contractArcher", 710, 2180)
      .unit("v1", "mercenary", 740, 2200)
      .unit("v1", "contractArcher", 770, 2220)
      .unit("v1", "mercenary", 800, 2240)
      .unit("v1", "fieldMedic", 830, 2260)
      .unit("v1", "footman", 860, 2280)
      .goldMine("v2-main-mine", 640, 2040, 4000)
      .goldMine("v2-natural-mine", 720, 2540, 4000)
      .goldMine("v1-main-mine", 3300, 3300, 4000)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionRegroup], { version: "v2", teams: game.teams });

    expect(commands[0]).toMatchObject({ type: "move", x: 491.52, y: 2048 });
  });

  it("does not reassign wounded units that are already moving home into another neutral objective", () => {
    const scene = sketchScene("v2-neutral-creep-recovery-commitment")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 520, 520)
      .townHall("v1", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .unit("v2", "footman", 760, 2350, { id: "recovering-a", hp: 48, order: { type: "move", x: 520, y: 520 } })
      .unit("v2", "footman", 800, 2370, { id: "recovering-b", hp: 48, order: { type: "move", x: 520, y: 520 } })
      .unit("v2", "archer", 980, 2560, { id: "fresh-archer" })
      .unit("v2", "lancer", 1020, 2520, { id: "fresh-lancer-a" })
      .unit("v2", "lancer", 1050, 2540, { id: "fresh-lancer-b" })
      .unit("neutral", "mossGnawer", 850, 2515)
      .unit("neutral", "wildling", 880, 2540)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("does not count wounded attack movers as ready for a fresh neutral objective", () => {
    const scene = sketchScene("v2-wounded-attack-movers-not-fresh-objective-power")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 520, 520)
      .townHall("v1a", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .unit("v2", "footman", 980, 2360, { id: "wounded-footman-a", hp: 32, order: { type: "attackMove", x: 980, y: 2360 } })
      .unit("v2", "lancer", 1020, 2380, { id: "wounded-lancer-a", hp: 38, order: { type: "attackMove", x: 980, y: 2360 } })
      .unit("v2", "footman", 1060, 2400)
      .unit("v2", "archer", 1100, 2420)
      .unit("v2", "contractArcher", 1140, 2440)
      .unit("neutral", "wildling", 1380, 2560)
      .unit("neutral", "thornSlinger", 1420, 2600)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 waits for a full first squad before taking neutral objectives", () => {
    const scene = sketchScene("v2-no-first-three-neutral-objective")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 520, 520)
      .townHall("v1a", 3400, 3400)
      .unit("v2", "footman", 900, 2000)
      .unit("v2", "footman", 940, 2020)
      .unit("v2", "lancer", 980, 2040)
      .unit("neutral", "mossGnawer", 1260, 1550)
      .unit("neutral", "wildling", 1300, 1580)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 still takes a locally safe neutral objective while globally outpowered in a 1v2", () => {
    const scene = sketchScene("v2-local-objective-while-globally-outpowered")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 2048)
      .unit("v2", "footman", 900, 2000)
      .unit("v2", "footman", 940, 2020)
      .unit("v2", "lancer", 980, 2040)
      .unit("v2", "lancer", 1020, 2060)
      .unit("v2", "archer", 1060, 2080)
      .unit("v2", "archer", 1100, 2100)
      .unit("v2", "footman", 1140, 2120)
      .unit("v2", "archer", 1180, 2140)
      .unit("v2", "footman", 1220, 2160)
      .unit("v2", "lancer", 1260, 2180)
      .unit("v2", "footman", 1220, 2160)
      .unit("v2", "lancer", 1260, 2180)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 2600, 3200)
      .unit("v1a", "footman", 2640, 3220)
      .unit("v1a", "lancer", 2680, 3240)
      .unit("v1a", "lancer", 2720, 3260)
      .unit("v1a", "archer", 2760, 3280)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "raider", 2600, 3600)
      .unit("v1b", "footman", 2640, 3620)
      .unit("v1b", "lancer", 2680, 3640)
      .unit("v1b", "archer", 2720, 3660)
      .unit("v1b", "archer", 2760, 3680)
      .unit("neutral", "stonebackBrute", 1260, 1550)
      .unit("neutral", "thornSlinger", 1300, 1580)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands[0]).toMatchObject({ type: "attackMove", x: 1280, y: 1565 });
  });

  it("v2 skips a neutral objective when an enemy detachment already controls that local area", () => {
    const scene = sketchScene("v2-no-creep-through-local-enemy-control")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1650, 1650)
      .unit("v2", "footman", 1690, 1670)
      .unit("v2", "lancer", 1730, 1690)
      .unit("v2", "lancer", 1770, 1710)
      .unit("v2", "archer", 1810, 1730)
      .unit("v2", "archer", 1850, 1750)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "footman", 2120, 2060)
      .unit("v1b", "lancer", 2160, 2100)
      .unit("v1b", "archer", 2200, 2140)
      .unit("v1b", "footman", 2240, 2180)
      .unit("v1b", "lancer", 2280, 2220)
      .unit("neutral", "stonebackBrute", 2060, 2020)
      .unit("neutral", "thornSlinger", 2100, 2060)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 still takes a neutral objective through a weaker local enemy screen", () => {
    const scene = sketchScene("v2-creeps-through-weaker-local-screen")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1650, 1650)
      .unit("v2", "footman", 1690, 1670)
      .unit("v2", "lancer", 1730, 1690)
      .unit("v2", "lancer", 1770, 1710)
      .unit("v2", "archer", 1810, 1730)
      .unit("v2", "archer", 1850, 1750)
      .unit("v2", "footman", 1890, 1770)
      .unit("v2", "archer", 1930, 1790)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "footman", 2120, 2060)
      .unit("v1b", "lancer", 2160, 2100)
      .unit("v1b", "archer", 2200, 2140)
      .unit("neutral", "stonebackBrute", 2060, 2020)
      .unit("neutral", "thornSlinger", 2100, 2060)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(commands[0]).toMatchObject({ type: "attackMove", x: 2080, y: 2040 });
  });

  it("does not reassign wounded units that are already moving home into an attack wave", () => {
    const scene = sketchScene("v2-attack-wave-respects-wounded-retreat")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 5; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "lancer", 1500 + i * 30, 1450 + i * 20, { hp: 42, order: { type: "move", x: 500, y: 500 } });
    scene
      .unit("v2", "archer", 1640, 1540)
      .unit("v2", "raider", 1680, 1560)
      .townHall("v1a", 2200, 1600)
      .building("v1a", "barracks", 2140, 1560)
      .unit("v1a", "footman", 2100, 1560)
      .unit("v1a", "archer", 2140, 1600)
      .townHall("v1b", 3600, 3600)
      .unit("v1b", "footman", 3500, 3500)
      .unit("v1b", "archer", 3540, 3540);
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove" || candidate.type === "attack");

    expect(command).toBeUndefined();
  });

  it("v2 can fold safe stopped retreat claims back into a full attack wave", () => {
    const scene = sketchScene("v2-retreat-claims-rejoin-wave")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500);
    scene
      .unit("v2", "footman", 520, 500, { id: "recovered-footman", hp: 60 })
      .unit("v2", "lancer", 550, 520, { id: "recovered-lancer", hp: 60 })
      .unit("v2", "archer", 580, 540, { id: "recovered-archer", hp: 70 })
      .unit("v2", "footman", 620, 560, { id: "fresh-footman" })
      .unit("v2", "archer", 650, 580, { id: "fresh-archer" })
      .townHall("v1", 2200, 1600)
      .building("v1", "barracks", 2140, 1560)
      .unit("v1", "footman", 2080, 1540)
      .unit("v1", "lancer", 2110, 1570)
      .unit("v1", "archer", 2140, 1600);
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["recovered-footman", "recovered-lancer", "recovered-archer"]) {
      memory.unitClaims[unitId] = { kind: "retreat", targetId: "retreat", x: 500, y: 500, sinceTick: 0, expiresTick: 900 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attackMove" || candidate.type === "attack");

    expect(command).toBeDefined();
    expect(command && "unitIds" in command ? command.unitIds : []).toEqual(expect.arrayContaining(["recovered-footman", "recovered-lancer", "recovered-archer", "fresh-footman", "fresh-archer"]));
  });

  it("v2 recalls safe moving retreat claims into a multiplayer dead-economy attack wave", () => {
    const scene = sketchScene("v2-dead-economy-moving-retreat-claims-rejoin-wave")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1300, 900)
      .townHall("v1a", 3100, 1500)
      .townHall("v1b", 3300, 2500)
      .building("v1b", "barracks", 3180, 2400);
    const retreatingIds: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const id = `retreating-${i}`;
      retreatingIds.push(id);
      scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 680 + (i % 4) * 36, 620 + Math.floor(i / 4) * 34, { id, order: { type: "move", x: 500, y: 500 } });
    }
    for (let i = 0; i < 8; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 760 + (i % 4) * 34, 760 + Math.floor(i / 4) * 32);
    for (let i = 0; i < 12; i += 1) scene.unit("v1b", i % 2 === 0 ? "footman" : "archer", 2800 + (i % 6) * 30, 2280 + Math.floor(i / 6) * 34);
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of retreatingIds) memory.unitClaims[unitId] = { kind: "retreat", targetId: "retreat", x: 500, y: 500, sinceTick: 0, expiresTick: 900 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attackMove" || candidate.type === "attack");

    expect(command).toBeDefined();
    expect(command && "unitIds" in command ? command.unitIds : []).toEqual(expect.arrayContaining(retreatingIds));
  });

  it("v2 does not launch a dead-economy attack wave into a stronger residual army", () => {
    const scene = sketchScene("v2-dead-economy-stronger-residual-stopline")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .player("v1c", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1300, 900)
      .townHall("v1a", 3100, 1500)
      .townHall("v1b", 3300, 2500)
      .townHall("v1c", 3050, 3350);
    for (let i = 0; i < 40; i += 1) {
      scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 620 + (i % 10) * 30, 1820 + Math.floor(i / 10) * 32, { order: { type: "attackMove", x: 2200, y: 2140 } });
    }
    for (let i = 0; i < 58; i += 1) {
      scene.unit(i < 48 ? "v1b" : "v1c", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 3000 + (i % 12) * 28, 2260 + Math.floor(i / 12) * 30);
    }
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move" });
    expect(command?.type === "move" ? command.x : 0).toBeCloseTo(500, -2);
  });

  it("worker-pressure candidate raids an exposed enemy economy when the other enemy army is too far away to matter", () => {
    const scene = sketchScene("v2-local-worker-raid")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 2780, 3250)
      .unit("v2", "archer", 2810, 3280)
      .unit("v2", "lancer", 2840, 3310)
      .townHall("v1a", 3300, 3300)
      .worker("v1a", 3240, 3300, { id: "exposed-worker-a" })
      .worker("v1a", 3270, 3330)
      .worker("v1a", 3300, 3360)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .unit("v1b", "raider", 3600, 3900)
      .unit("v1b", "lancer", 3630, 3930)
      .unit("v1b", "footman", 3660, 3960)
      .unit("v1b", "archer", 3690, 3990)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "exposed-worker-a" });
  });

  it("v2 does not drain its first one-base 1v2 squad into cross-map worker pressure", () => {
    const scene = sketchScene("v2-no-cross-map-first-raid")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "archer", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .townHall("v1a", 3400, 3300)
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment, AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams });

    const pressure = entries.find((entry) => entry.scriptId === "workerPressure");
    expect(entries.find((entry) => entry.scriptId === "earlyHarassment")).toBeUndefined();
    expect(pressure).toBeUndefined();
  });

  it("v2 sends only a small worker-pressure detachment after its expansion is online", () => {
    const scene = sketchScene("v2-worker-pressure-detachment-after-expansion")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 900, 500)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v2-natural", 900, 520, 3000)
      .unit("v2", "footman", 760, 620, { id: "reserve-a" })
      .unit("v2", "archer", 790, 650, { id: "reserve-b" })
      .unit("v2", "lancer", 820, 680, { id: "reserve-c" })
      .unit("v2", "footman", 860, 710, { id: "raid-a" })
      .unit("v2", "archer", 890, 740, { id: "raid-b" })
      .unit("v2", "lancer", 920, 770, { id: "raid-c" })
      .unit("v2", "footman", 950, 800, { id: "reserve-d" })
      .townHall("v1a", 3400, 3300)
      .worker("v1a", 3360, 3300, { id: "far-worker" })
      .worker("v1a", 3380, 3340)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .build();
    const game = scene.createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "far-worker" } });
    expect(entry?.command.type === "attack" ? entry.command.unitIds : []).toHaveLength(3);
  });

  it("v2 does not send worker pressure through the other opponent's route army", () => {
    const scene = sketchScene("v2-worker-pressure-route-covered-by-other-opponent")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 900, 500)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v2-natural", 900, 520, 3000)
      .unit("v2", "footman", 1760, 1780)
      .unit("v2", "archer", 1790, 1810)
      .unit("v2", "lancer", 1820, 1840)
      .unit("v2", "footman", 1860, 1870)
      .unit("v2", "archer", 1890, 1900)
      .unit("v2", "lancer", 1920, 1930)
      .townHall("v1a", 3400, 3300)
      .worker("v1a", 2360, 2160, { id: "covered-worker" })
      .worker("v1a", 3380, 3340)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .unit("v1b", "footman", 2050, 1980)
      .unit("v1b", "lancer", 2100, 2020)
      .unit("v1b", "archer", 2140, 2060)
      .unit("v1b", "footman", 2180, 2100)
      .build();
    const game = scene.createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "move" } });
  });

  it("v5 fights the covering army instead of recalling the whole army from local worker pressure", () => {
    const scene = sketchScene("v5-worker-pressure-whole-army-fights-route-cover")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 720, 900)
      .goldMine("v5-main", 420, 500, 3000)
      .goldMine("v5-natural", 720, 900, 3000)
      .townHall("v3", 3600, 2600)
      .townHall("v4", 2138, 2170, { id: "v4-natural" })
      .worker("v4", 2050, 2100, { id: "v4-local-worker" })
      .goldMine("v3-main", 3600, 2600, 3000)
      .goldMine("v4-natural-mine", 2138, 2170, 3000);
    for (let index = 0; index < 10; index += 1) {
      scene.unit("v5", index % 3 === 0 ? "lancer" : "footman", 1460 + index * 24, 2030 + (index % 4) * 28, { id: `v5-fighter-${index}` });
    }
    scene
      .unit("v3", "emberRavager", 1940, 2050, { id: "blocker-wounded", hp: 40 })
      .unit("v3", "emberRavager", 1980, 2090)
      .unit("v3", "emberRavager", 2020, 2130)
      .unit("v3", "emberRavager", 2060, 2170)
      .unit("v3", "cinderRunner", 2100, 2090)
      .unit("v3", "sparkArcher", 2140, 2130)
      .unit("v3", "emberRavager", 2180, 2170)
      .unit("v3", "cinderRunner", 2220, 2210);
    const game = scene.build().createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.workerPressure], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "blocker-wounded" } });
    expect(entry?.command.type === "attack" ? entry.command.unitIds : []).toHaveLength(10);
  });

  it("v2 does not send its first harassment pair across the whole map in a 1v1", () => {
    const scene = sketchScene("v2-no-cross-map-first-raid-1v1")
      .map("campRush")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 2048)
      .unit("v2", "footman", 720, 2030)
      .unit("v2", "footman", 760, 2070)
      .townHall("v1", 3600, 1840)
      .worker("v1", 3520, 1840, { id: "far-worker" })
      .worker("v1", 3560, 1880)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attack",
    );

    expect(command).toBeUndefined();
  });

  it("v2 does not launch an offensive attack wave into a much stronger combined army", () => {
    const scene = sketchScene("v2-no-outmatched-wave")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .unit("v2", "lancer", 850, 710)
      .unit("v2", "archer", 880, 740)
      .unit("v2", "footman", 910, 770)
      .unit("v2", "lancer", 940, 800)
      .townHall("v2", 1500, 900, { id: "v2-natural" })
      .worker("v2", 1480, 900)
      .goldMine("v2-natural-mine", 1560, 920, 3000)
      .townHall("v1a", 3400, 1400)
      .unit("v1a", "footman", 3000, 1400)
      .unit("v1a", "footman", 3040, 1420)
      .unit("v1a", "lancer", 3080, 1440)
      .unit("v1a", "archer", 3120, 1460)
      .unit("v1a", "footman", 3160, 1480)
      .unit("v1a", "lancer", 3200, 1500)
      .townHall("v1b", 3400, 2800)
      .unit("v1b", "raider", 3000, 2800)
      .unit("v1b", "lancer", 3040, 2820)
      .unit("v1b", "lancer", 3080, 2840)
      .unit("v1b", "footman", 3120, 2860)
      .unit("v1b", "footman", 3160, 2880)
      .unit("v1b", "archer", 3200, 2900)
      .build();
    const game = scene.createGame();
    for (const unit of game.units.filter((unit) => unit.owner === "v2" && unit.kind !== "worker")) unit.order = { type: "idle" };

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attackMove")).toBe(false);
  });

  it("v2 does not launch a one-on-one attack wave into a stronger mercenary army", () => {
    const scene = sketchScene("v2-no-stronger-merc-wave")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "east", race: "grove" })
      .player("v1", { team: "west", race: "grove" })
      .townHall("v2", 3604, 2048)
      .townHall("v1", 492, 2048)
      .unit("v2", "lancer", 2366, 1283)
      .unit("v2", "footman", 2372, 1319)
      .unit("v2", "lancer", 2329, 1312)
      .unit("v2", "archer", 2313, 1422)
      .unit("v2", "footman", 2405, 1283)
      .unit("v2", "archer", 2457, 1333)
      .unit("v2", "footman", 2332, 1268)
      .unit("v2", "footman", 2408, 1319)
      .unit("v1", "lancer", 1992, 860)
      .unit("v1", "footman", 1923, 825)
      .unit("v1", "footman", 1986, 895)
      .unit("v1", "contractArcher", 1928, 886)
      .unit("v1", "fieldMedic", 1960, 872)
      .unit("v1", "mercenary", 1962, 840)
      .unit("v1", "contractArcher", 1954, 905)
      .unit("v1", "mercenary", 2012, 831)
      .unit("v1", "contractArcher", 1933, 855)
      .unit("v1", "fieldMedic", 1230, 1581)
      .unit("v1", "footman", 698, 2209)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attackMove")).toBe(false);
  });

  it("v2 can pressure before expanding when no current expansion plan is actionable", () => {
    const scene = sketchScene("v2-pressure-before-nonactionable-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .unit("v2", "archer", 850, 710)
      .unit("v2", "archer", 880, 740)
      .unit("v2", "lancer", 910, 770)
      .unit("v2", "footman", 940, 800)
      .townHall("v1a", 3300, 3300)
      .building("v1a", "barracks", 3180, 3180, { id: "v1a-forward-barracks" })
      .worker("v1a", 3360, 3300)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .unit("v1b", "footman", 3500, 3900)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("central-but-unaffordable", 2060, 2030, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 120;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    expect(command?.type === "attackMove" ? command.x : 0).toBeGreaterThan(2000);
  });

  it("v2 keeps objective control from pulling the defense squad out while the main is under pressure", () => {
    const scene = sketchScene("v2-objective-control-yields-to-main-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 610, 560)
      .unit("v2", "footman", 620, 580)
      .unit("v2", "footman", 650, 600)
      .unit("v2", "lancer", 680, 620)
      .unit("v2", "archer", 710, 640)
      .unit("v2", "archer", 740, 660)
      .townHall("v1", 3400, 3400, { id: "v1-main" })
      .unit("v1", "footman", 780, 560)
      .unit("v1", "footman", 820, 600)
      .unit("v1", "lancer", 860, 640)
      .unit("v1", "archer", 900, 680)
      .unit("neutral", "stonebackBrute", 1260, 1060)
      .unit("neutral", "thornSlinger", 1300, 1100)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", AI_SCRIPT_VERSIONS.v2, { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "objectiveControl")).toBe(false);
    expect(entries.some((entry) => (entry.scriptId === "focusFire" || entry.scriptId === "attackWave") && (entry.command.type === "move" || entry.command.type === "attackMove" || entry.command.type === "attack"))).toBe(true);
  });

  it("v2 evacuates workers instead of ordering them to fight when the main defense line exists", () => {
    const scene = sketchScene("v2-worker-evacuation-under-main-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .worker("v2", 520, 500, { id: "v2-worker-a" })
      .worker("v2", 540, 520, { id: "v2-worker-b" })
      .worker("v2", 560, 540, { id: "v2-worker-c" })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .unit("v1", "contractArcher", 780, 560)
      .unit("v1", "fieldMedic", 820, 600)
      .unit("v1", "footman", 860, 640)
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    if (!workerDefense) throw new Error("expected worker defense command");
    expect(workerDefense).toMatchObject({ scriptId: "workerDefense", command: { type: "move" } });
    expect(workerDefense.command.type === "move" ? workerDefense.command.unitIds : []).toEqual(expect.arrayContaining(["v2-worker-a", "v2-worker-b", "v2-worker-c"]));
  });

  it("v2 keeps the only saturated mine working while a main defense line handles pressure", () => {
    const scene = sketchScene("v2-defended-main-keeps-saturated-mine")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .goldMine("v2-main-mine", 570, 530, 4000)
      .worker("v2", 520, 500, { id: "v2-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 520, { id: "v2-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 560, 540, { id: "v2-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 580, 520, { id: "v2-worker-d", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 600, 540, { id: "v2-worker-e", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .unit("v1", "contractArcher", 780, 560)
      .unit("v1", "fieldMedic", 820, 600)
      .unit("v1", "footman", 860, 640)
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    expect(workerDefense).toBeUndefined();
  });

  it("v2 repairs a damaged main tower with an available non-mining worker", () => {
    const scene = sketchScene("v2-repairs-damaged-main-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .worker("v2", 520, 500, { id: "v2-builder" })
      .goldMine("v2-main-mine", 570, 530, 4000)
      .townHall("v1", 3400, 3400)
      .build();
    const game = scene.createGame();
    const tower = game.buildings.find((building) => building.id === "v2-main-tower");
    if (!tower) throw new Error("missing v2 tower");
    tower.hp = 80;
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 30;

    const repair = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.repair], { version: "v2", teams: game.teams })[0];

    expect(repair).toMatchObject({ scriptId: "repair", command: { type: "repair", buildingId: "v2-main-tower", unitIds: ["v2-builder"] } });
  });

  it("v2 trains a sixth one-base worker when the saturated main needs tower repair labor", () => {
    const scene = sketchScene("v2-one-base-repair-worker")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .building("v2", "barracks", 650, 560)
      .building("v2", "farm", 560, 700)
      .goldMine("v2-main-mine", 570, 530, 4000)
      .worker("v2", 520, 500, { id: "v2-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 520, { id: "v2-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 560, 540, { id: "v2-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 580, 520, { id: "v2-worker-d", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 600, 540, { id: "v2-worker-e", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .build();
    const game = scene.createGame();
    const tower = game.buildings.find((building) => building.id === "v2-main-tower");
    if (!tower) throw new Error("missing v2 tower");
    tower.hp = 80;
    const v2State = game.players.v2;
    if (!v2State) throw new Error("missing v2 state");
    v2State.gold = 80;

    const train = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(train).toMatchObject({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("v2 keeps the only currently saturated mine working after a fresh second town hall completes", () => {
    const scene = sketchScene("v2-fresh-second-hall-keeps-paying-mine")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1100, 650, { id: "v2-natural" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .goldMine("v2-main-mine", 570, 530, 4000)
      .goldMine("v2-natural-mine", 1140, 650, 4000)
      .worker("v2", 520, 500, { id: "v2-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 520, { id: "v2-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 560, 540, { id: "v2-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 580, 520, { id: "v2-worker-d", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 600, 540, { id: "v2-worker-e", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 1080, 650, { id: "v2-natural-builder" })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .unit("v1", "contractArcher", 780, 560)
      .unit("v1", "fieldMedic", 820, 600)
      .unit("v1", "footman", 860, 640)
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    expect(workerDefense).toBeUndefined();
  });

  it("v2 keeps a damaged but still-paying sole mine working instead of zeroing income", () => {
    const scene = sketchScene("v2-damaged-paying-mine-keeps-working")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .goldMine("v2-main-mine", 570, 530, 4000)
      .worker("v2", 520, 500, { id: "v2-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 520, { id: "v2-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 560, 540, { id: "v2-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 580, 520, { id: "v2-worker-d", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .unit("v1", "contractArcher", 780, 560)
      .unit("v1", "fieldMedic", 820, 600)
      .unit("v1", "footman", 860, 640)
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    expect(workerDefense).toBeUndefined();
  });

  it("v2 keeps saturated main miners working even after a second mine is online", () => {
    const scene = sketchScene("v2-two-paying-mines-keep-main-saturation")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1120, 720, { id: "v2-natural" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .goldMine("v2-main-mine", 570, 530, 4000)
      .goldMine("v2-natural-mine", 1160, 720, 4000)
      .worker("v2", 520, 500, { id: "v2-main-worker-a", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 540, 520, { id: "v2-main-worker-b", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 560, 540, { id: "v2-main-worker-c", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 580, 520, { id: "v2-main-worker-d", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 600, 540, { id: "v2-main-worker-e", order: { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 1130, 720, { id: "v2-natural-worker-a", order: { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 } })
      .worker("v2", 1150, 740, { id: "v2-natural-worker-b", order: { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 700, 580)
      .unit("v2", "archer", 730, 620)
      .townHall("v1", 3400, 3400)
      .unit("v1", "contractArcher", 780, 560)
      .unit("v1", "fieldMedic", 820, 600)
      .unit("v1", "footman", 860, 640)
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    expect(workerDefense).toBeUndefined();
  });

  it("v5 evacuates workers instead of taking a no-defense-line 1v3 main fight", () => {
    const scene = sketchScene("v5-worker-evacuation-without-defense-line")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .worker("v5", 510, 500, { id: "v5-worker-a" })
      .worker("v5", 530, 520, { id: "v5-worker-b" })
      .worker("v5", 550, 540, { id: "v5-worker-c" })
      .worker("v5", 570, 560, { id: "v5-worker-d" })
      .unit("v5", "mercenary", 1700, 1700)
      .unit("v5", "contractArcher", 1740, 1740)
      .townHall("v3b", 3400, 3800)
      .townHall("v3c", 3500, 3900)
      .unit("v3b", "footman", 760, 540, { id: "enemy-front-a" })
      .unit("v3b", "lancer", 800, 580, { id: "enemy-front-b" })
      .unit("v3c", "archer", 780, 620, { id: "enemy-front-c" })
      .build();
    const game = scene.createGame();

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.desperateWorkerFight, AI_SCRIPT_LIBRARY.workerDefense], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    })[0];

    expect(workerDefense).toMatchObject({ scriptId: "workerDefense", command: { type: "move" } });
    expect(workerDefense?.command.type === "move" ? workerDefense.command.unitIds : []).toEqual(["v5-worker-a", "v5-worker-b", "v5-worker-c", "v5-worker-d"]);
  });

  it("v2 rebuilds core production before spending its last recovery bank on an emergency tower", () => {
    const scene = sketchScene("v2-rebuilds-production-before-last-bank-tower")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .unit("v2", "footman", 610, 560)
      .unit("v2", "archer", 650, 590)
      .unit("v2", "lancer", 690, 620)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 930, 650)
      .unit("v1a", "lancer", 970, 680)
      .unit("v1b", "footman", 900, 760)
      .unit("v1b", "archer", 940, 790)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.emergencyDefense, AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "emergencyDefense")).toBeUndefined();
    expect(entries.find((entry) => entry.scriptId === "productionBuilding")?.command).toMatchObject({ type: "build", unitId: "v2-builder", buildingKind: "barracks" });
  });

  it("v2 rebuilds core production before spending its last recovery bank on a routine defense tower", () => {
    const scene = sketchScene("v2-rebuilds-production-before-last-bank-defense")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 820, 600)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.defense, AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "defense")).toBeUndefined();
    expect(entries.find((entry) => entry.scriptId === "productionBuilding")?.command).toMatchObject({ type: "build", unitId: "v2-builder", buildingKind: "barracks" });
  });

  it("v2 guards a fresh 1v2 mining expansion before banking for late macro", () => {
    const scene = sketchScene("v2-fresh-expansion-guard")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1100, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 520)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1140, 650, 4000)
      .worker("v2", 1120, 650, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 1100, 700)
      .unit("v2", "archer", 1140, 720)
      .townHall("v1a", 3400, 3300)
      .townHall("v1b", 3400, 3800)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 130;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.defense], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
  });

  it("v2 pulls workers into the fight when the main hall is dying and no combat unit remains", () => {
    const scene = sketchScene("v2-desperate-worker-fight-for-dying-main")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 560, 540, { id: "v2-main-tower" })
      .worker("v2", 520, 500, { id: "v2-worker-a" })
      .worker("v2", 540, 520, { id: "v2-worker-b" })
      .worker("v2", 560, 540, { id: "v2-worker-c" })
      .townHall("v1", 3400, 3400)
      .unit("v1", "footman", 610, 520, { id: "main-killer-a" })
      .unit("v1", "lancer", 640, 550, { id: "main-killer-b" })
      .unit("v1", "raider", 670, 580, { id: "main-killer-c" })
      .build();
    const game = scene.createGame();
    const main = game.buildings.find((building) => building.id === "v2-main");
    if (!main) throw new Error("missing main");
    main.hp = main.maxHp * 0.32;

    const workerDefense = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerDefense], { version: "v2", teams: game.teams })[0];

    expect(workerDefense).toMatchObject({ scriptId: "workerDefense", command: { type: "attack" } });
  });

  it("v2 pulls a small worker group into a towerless close 1v2 main fight before the hall is critical", () => {
    const scene = sketchScene("v2-early-towerless-worker-fight")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .worker("v2", 510, 500, { id: "v2-worker-a" })
      .worker("v2", 530, 520, { id: "v2-worker-b" })
      .worker("v2", 550, 540, { id: "v2-worker-c" })
      .worker("v2", 570, 560, { id: "v2-worker-d" })
      .worker("v2", 505, 505, { id: "v2-new-near-worker" })
      .unit("v2", "footman", 620, 540)
      .unit("v2", "lancer", 650, 570)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 820, 540, { id: "enemy-front" })
      .unit("v1b", "lancer", 860, 590)
      .unit("v1b", "archer", 830, 620)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.desperateWorkerFight], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attack" });
    expect(command?.type === "attack" ? command.unitIds : []).toEqual(["v2-worker-a", "v2-worker-b", "v2-worker-c"]);
  });

  it("v2 rebuilds workers after a raid instead of reserving scarce gold for future macro", () => {
    const scene = sketchScene("v2-worker-recovery-after-raid")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .worker("v2", 520, 520)
      .worker("v2", 540, 520)
      .goldMine("v2-main-mine", 570, 530, 4000)
      .townHall("v1", 3400, 3400)
      .unit("v1", "footman", 780, 560)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 120;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "train",
    );

    expect(command).toMatchObject({ type: "train", unitKind: "worker" });
  });

  it("v2 attacks an isolated opponent even when the two enemy armies are globally larger", () => {
    const scene = sketchScene("v2-isolated-opponent-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1550, 1500)
      .unit("v2", "footman", 1585, 1530)
      .unit("v2", "lancer", 1620, 1500)
      .unit("v2", "lancer", 1655, 1530)
      .unit("v2", "archer", 1690, 1500)
      .unit("v2", "archer", 1725, 1530)
      .unit("v2", "raider", 1760, 1500)
      .townHall("v1a", 2200, 1650, { id: "v1a-main" })
      .building("v1a", "barracks", 2100, 1600, { id: "isolated-v1a-barracks" })
      .unit("v1a", "footman", 2050, 1620)
      .unit("v1a", "archer", 2080, 1660)
      .townHall("v1b", 3600, 3600, { id: "v1b-main" })
      .unit("v1b", "footman", 3520, 3600)
      .unit("v1b", "footman", 3550, 3630)
      .unit("v1b", "lancer", 3580, 3660)
      .unit("v1b", "lancer", 3610, 3690)
      .unit("v1b", "archer", 3640, 3720)
      .unit("v1b", "raider", 3670, 3750)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack" || candidate.type === "attackMove");

    expect(command).toBeDefined();
    if (command?.type === "attack") expect(command.targetId).toContain("v1a");
    if (command?.type === "attackMove") {
      expect(command.x).toBeGreaterThan(1700);
      expect(command.x).toBeLessThan(2300);
    }
  });

  it("v2 concentrates on a small enemy detachment before respecting the global two-army disadvantage", () => {
    const scene = sketchScene("v2-local-detachment-pickoff")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 1600 + i * 24, 1500 + i * 12);
    scene
      .townHall("v1a", 2300, 1620)
      .unit("v1a", "footman", 2060, 1540, { id: "isolated-footman" })
      .unit("v1a", "archer", 2100, 1580, { id: "isolated-archer" })
      .townHall("v1b", 3600, 3600);
    for (let i = 0; i < 9; i += 1) scene.unit("v1b", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 3500 + i * 30, 3500 + i * 25);
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: expect.stringContaining("isolated") });
  });

  it("v2 commits into one locally beatable opponent base even when the combined enemy army is larger", () => {
    const scene = sketchScene("v2-local-base-commit")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 1600 + i * 24, 1500 + i * 12);
    scene
      .townHall("v1a", 2300, 1620)
      .building("v1a", "barracks", 2200, 1580, { id: "locally-beatable-barracks" });
    for (let i = 0; i < 6; i += 1) scene.unit("v1a", i % 2 === 0 ? "footman" : "archer", 2140 + i * 25, 1580 + i * 20);
    scene.townHall("v1b", 3600, 3600);
    for (let i = 0; i < 9; i += 1) scene.unit("v1b", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 3500 + i * 30, 3500 + i * 25);
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 2200, y: 1580 });
  });

  it("v2 keeps a committed attack wave on the same opponent instead of pinballing between two enemy fronts", () => {
    const scene = sketchScene("v2-committed-attack-wave-owner")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 2300 + i * 20, 2300 + i * 10, { order: { type: "attackMove", x: 3380, y: 3300 } });
    scene
      .townHall("v1a", 2500, 2450, { id: "v1a-main" })
      .building("v1a", "barracks", 2440, 2390, { id: "v1a-closer-barracks" })
      .townHall("v1b", 3450, 3300, { id: "v1b-main" })
      .building("v1b", "barracks", 3380, 3300, { id: "v1b-committed-barracks" });
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    if (command?.type === "attackMove") expect(command.x).toBeGreaterThan(3200);
  });

  it("v2 stores a focused opponent owner when it chooses a 1v2 attack target", () => {
    const scene = sketchScene("v2-memory-focus-owner-record")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 1600 + i * 24, 1500 + i * 12);
    scene
      .townHall("v1a", 2300, 1620)
      .building("v1a", "barracks", 2200, 1580, { id: "focus-v1a-barracks" })
      .townHall("v1b", 3600, 3600);
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 2200, y: 1580 });
    expect(memory.strategicPlan?.focusTargetOwner).toBe("v1a");
  });

  it("v2 keeps attacking the remembered focused opponent instead of swapping to a closer building", () => {
    const scene = sketchScene("v2-memory-focus-owner-reuse")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500);
    for (let i = 0; i < 7; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "archer" : "footman", 2300 + i * 20, 2300 + i * 10);
    scene
      .townHall("v1a", 2500, 2450, { id: "v1a-closer-main" })
      .building("v1a", "barracks", 2440, 2390, { id: "v1a-closer-barracks" })
      .townHall("v1b", 3450, 3300, { id: "v1b-focused-main" })
      .building("v1b", "barracks", 3380, 3300, { id: "v1b-focused-barracks" });
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1b" };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 3380, y: 3300 });
  });

  it("v1 keeps its expansion-map attack-wave gate so the version duel compares against a stable baseline", () => {
    const scene = sketchScene("v1-stable-expansion-gate")
      .map("openClaims")
      .replaceDefaults()
      .player("v1", { team: "south", race: "grove" })
      .player("target", { team: "north", race: "ember" })
      .townHall("v1", 3400, 3300)
      .unit("v1", "footman", 3300, 3200)
      .townHall("target", 500, 500)
      .worker("target", 540, 540)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .goldMine("target-main-mine", 560, 540, 4000)
      .goldMine("open-third", 2100, 2100, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v1", [AI_SCRIPT_LIBRARY.attackWave], { version: "v1", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v1 does not lock attack waves forever after an established expansion mine is depleted", () => {
    const scene = sketchScene("v1-depleted-expansion-still-attacks")
      .map("openClaims")
      .replaceDefaults()
      .player("v1", { team: "south", race: "grove" })
      .player("target", { team: "north", race: "ember" })
      .townHall("v1", 3400, 3300)
      .townHall("v1", 2500, 2800, { id: "v1-established-natural" })
      .unit("v1", "footman", 3300, 3200)
      .unit("v1", "footman", 3330, 3230)
      .unit("v1", "lancer", 3360, 3260)
      .unit("v1", "archer", 3390, 3290)
      .unit("v1", "archer", 3420, 3320)
      .townHall("target", 500, 500)
      .worker("target", 540, 540)
      .goldMine("v1-main-mine", 3340, 3300, 0)
      .goldMine("v1-depleted-natural", 2520, 2810, 0)
      .goldMine("open-third", 2100, 2100, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v1", [AI_SCRIPT_LIBRARY.attackWave], { version: "v1", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
  });

  it("does not let attack-wave commands override candidate retreat decisions in the same policy pass", () => {
    const scene = sketchScene("v2-retreat-not-overridden")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1450, 600, { id: "v2-expansion" })
      .unit("v2", "footman", 1400, 620)
      .unit("v2", "archer", 1430, 650)
      .unit("v2", "lancer", 1460, 680)
      .unit("v2", "footman", 620, 420)
      .unit("v2", "footman", 650, 450)
      .unit("v2", "archer", 680, 480)
      .unit("v2", "lancer", 710, 510)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 1500, 620)
      .unit("v1", "lancer", 1530, 650)
      .unit("v1", "archer", 1560, 680)
      .unit("v1", "raider", 1590, 710)
      .unit("v1", "footman", 1620, 740)
      .unit("v1", "lancer", 1650, 770)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-expansion-mine", 1520, 620, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "attackMove", x: 500, y: 500 });
  });

  it("v2 does not pull the whole army into a doomed expansion defense against a much stronger force", () => {
    const scene = sketchScene("v2-doomed-expansion-defense")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1400, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .unit("v2", "footman", 700, 560)
      .unit("v2", "footman", 735, 595)
      .unit("v2", "lancer", 770, 560)
      .unit("v2", "archer", 805, 595)
      .unit("v2", "archer", 840, 560)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .townHall("v1b", 3300, 3700, { id: "v1b-main" });
    for (let i = 0; i < 9; i += 1) {
      scene.unit(i % 2 === 0 ? "v1a" : "v1b", i % 3 === 0 ? "raider" : "footman", 1360 + (i % 3) * 34, 680 + Math.floor(i / 3) * 34);
    }
    const game = scene.build().createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attackMove")).toBe(false);
  });

  it("v2 rallies the army at the main defense point after declining a doomed expansion defense", () => {
    const scene = sketchScene("v2-rally-main-after-doomed-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 650, 620, { id: "v2-main-tower" })
      .townHall("v2", 1400, 650, { id: "v2-natural" })
      .unit("v2", "footman", 900, 560)
      .unit("v2", "footman", 935, 595)
      .unit("v2", "lancer", 970, 560)
      .unit("v2", "archer", 1005, 595)
      .unit("v2", "archer", 1040, 560)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .townHall("v1b", 3300, 3700, { id: "v1b-main" });
    for (let i = 0; i < 9; i += 1) {
      scene.unit(i % 2 === 0 ? "v1a" : "v1b", i % 3 === 0 ? "raider" : "footman", 1360 + (i % 3) * 34, 680 + Math.floor(i / 3) * 34);
    }
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move" });
    expect(command?.type === "move" ? command.x : 9999).toBeLessThan(720);
    expect(command?.type === "move" ? command.y : 9999).toBeLessThan(700);
  });

  it("v2 holds the main defense point instead of meeting a stronger army outside tower cover", () => {
    const scene = sketchScene("v2-main-defense-hold")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 650, 620, { id: "v2-main-tower" })
      .unit("v2", "footman", 860, 650)
      .unit("v2", "footman", 900, 690)
      .unit("v2", "lancer", 940, 650)
      .unit("v2", "archer", 980, 690)
      .unit("v2", "archer", 1020, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700);
    for (let i = 0; i < 9; i += 1) {
      scene.unit(i % 2 === 0 ? "v1a" : "v1b", i % 3 === 0 ? "raider" : "footman", 1080 + (i % 3) * 34, 760 + Math.floor(i / 3) * 34);
    }
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move" });
    expect(command?.type === "move" ? command.x : 9999).toBeLessThan(720);
    expect(command?.type === "move" ? command.y : 9999).toBeLessThan(700);
  });

  it("v2 keeps a one-on-one main defense behind cover instead of breaking into a stronger farm siege", () => {
    const scene = sketchScene("v2-no-outmatched-farm-break-in")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 492, 2048, { id: "v2-main" })
      .tower("v2", 342, 2041, { id: "v2-main-tower" })
      .building("v2", "moonWell", 406, 2166)
      .building("v2", "farm", 786, 1816, { id: "pressured-farm" })
      .unit("v2", "footman", 478, 2064)
      .unit("v2", "footman", 467, 2028)
      .unit("v2", "lancer", 515, 2067)
      .unit("v2", "footman", 502, 2034)
      .unit("v2", "lancer", 395, 2022)
      .unit("v2", "footman", 540, 1964)
      .unit("v2", "footman", 420, 2048)
      .townHall("v1a", 3604, 2048);
    const enemyKinds = ["footman", "footman", "lancer", "footman", "lancer", "archer", "footman", "archer", "footman", "archer", "contractArcher"] as const;
    enemyKinds.forEach((kind, index) => {
      scene.unit("v1a", kind, 930 + (index % 4) * 38, 1720 + Math.floor(index / 4) * 52, {
        id: `farm-sieger-${index}`,
        order: { type: "attackMove", x: 786, y: 1816, targetId: "pressured-farm" },
      });
    });
    const game = scene.build().createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attackMove")).toBe(false);
  });

  it("v2 counter-pushes a late main-base standoff instead of staying pinned to its own pressured building", () => {
    const scene = sketchScene("v2-late-main-standoff-counter-push")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "south", race: "grove" })
      .player("v1a", { team: "north", race: "grove" })
      .townHall("v2", 3376, 2680, { id: "v2-main" })
      .townHall("v1a", 600, 2000, { id: "v1a-main" });
    const currentHold = { type: "attackMove" as const, x: 3376, y: 2680 };
    for (let i = 0; i < 30; i += 1) {
      scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 3290 + (i % 8) * 18, 2600 + Math.floor(i / 8) * 26, { id: `v2-defender-${i}`, order: currentHold });
    }
    for (let i = 0; i < 5; i += 1) {
      scene.unit("v1a", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 3020 + i * 16, 3130, { id: `v1a-pressure-near-${i}` });
    }
    for (let i = 0; i < 19; i += 1) {
      scene.unit("v1a", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 2920 + (i % 7) * 18, 3200 + Math.floor(i / 7) * 28, { id: `v1a-pressure-outer-${i}` });
    }
    const game = scene.build().createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    expect(command?.type === "attackMove" ? command.x : 9999).toBeLessThan(3100);
    expect(command?.type === "attackMove" ? command.unitIds.length : 0).toBeGreaterThanOrEqual(24);
  });

  it("v2 does not leave main tower cover to body-block a pressured production building while outmatched", () => {
    const scene = sketchScene("v2-main-pressure-stays-in-cover")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 360, 500, { id: "v2-main-tower" })
      .building("v2", "barracks", 660, 560, { id: "v2-barracks" })
      .unit("v2", "footman", 660, 560)
      .unit("v2", "lancer", 690, 590)
      .unit("v2", "archer", 720, 620)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800);
    for (let i = 0; i < 7; i += 1) scene.unit(i % 2 === 0 ? "v1a" : "v1b", i % 3 === 0 ? "lancer" : "footman", 760 + (i % 3) * 32, 600 + Math.floor(i / 3) * 32);
    const game = scene.build().createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attackMove")).toBe(false);
    expect(commands.some((command) => command.type === "move" || command.type === "attack")).toBe(true);
  });

  it("v2 pulls nearby workers into a desperate main-base fight when no defense line exists", () => {
    const scene = sketchScene("v2-worker-emergency-defense")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .worker("v2", 520, 540, { id: "pulled-worker-a" })
      .worker("v2", 545, 560, { id: "pulled-worker-b" })
      .worker("v2", 570, 540)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 690, 610, { id: "base-invader" })
      .unit("v1b", "lancer", 720, 640)
      .unit("v1a", "footman", 750, 670)
      .unit("v1b", "lancer", 780, 700)
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attack" && candidate.unitIds.includes("pulled-worker-a"),
    );

    expect(command).toMatchObject({ type: "attack", targetId: "base-invader" });
  });

  it("v1 baseline also pulls workers when the main base is being overrun", () => {
    const scene = sketchScene("v1-worker-emergency-defense")
      .map("bareDuel")
      .replaceDefaults()
      .player("v1", { team: "south", race: "grove" })
      .player("v2", { team: "north", race: "grove" })
      .townHall("v1", 3300, 3300, { id: "v1-main" })
      .building("v1", "barracks", 3180, 3180, { id: "v1-barracks" })
      .worker("v1", 3260, 3300, { id: "v1-pulled-worker-a" })
      .worker("v1", 3290, 3330, { id: "v1-pulled-worker-b" })
      .worker("v1", 3320, 3300)
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 3210, 3230, { id: "v2-base-invader" })
      .unit("v2", "lancer", 3240, 3260)
      .unit("v2", "footman", 3270, 3290)
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v1", { version: "v1", teams: game.teams }).find(
      (candidate) => candidate.type === "attack" && candidate.unitIds.includes("v1-pulled-worker-a"),
    );

    expect(command).toMatchObject({ type: "attack" });
  });

  it("v2 focuses fire on a weak high-threat attacker inside the main defense zone", () => {
    const scene = sketchScene("v2-main-defense-focus")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 650, 620, { id: "v2-main-tower" })
      .unit("v2", "footman", 610, 560)
      .unit("v2", "lancer", 640, 590)
      .unit("v2", "archer", 670, 620)
      .unit("v2", "archer", 700, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .unit("v1a", "footman", 730, 650, { id: "healthy-front" })
      .unit("v1b", "raider", 760, 660, { id: "weak-raider", hp: 35 })
      .unit("v1a", "archer", 790, 670, { id: "healthy-archer" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "weak-raider" });
  });

  it("v2 focus-fire module targets the highest-value nearby combat unit through a normal attack command", () => {
    const scene = sketchScene("v2-general-focus-fire")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 900, 900)
      .unit("v2", "lancer", 930, 930)
      .unit("v2", "archer", 960, 960)
      .townHall("v1", 3000, 3000)
      .unit("v1", "footman", 1000, 900, { id: "healthy-front" })
      .unit("v1", "raider", 1030, 930, { id: "weak-raider-focus", hp: 28 })
      .unit("v1", "archer", 1060, 960, { id: "healthy-archer" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.focusFire], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "weak-raider-focus" });
    expect(command?.type === "attack" ? command.unitIds.length : 0).toBeGreaterThanOrEqual(2);
  });

  it("v2 refocuses a split combat tail onto a wounded caster it can pick off", () => {
    const scene = sketchScene("v2-combat-tail-pickoff")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 150, 800)
      .unit("v2", "archer", 690, 690, { id: "tail-archer-a" })
      .unit("v2", "archer", 705, 740, { id: "tail-archer-b" })
      .townHall("v1", 1450, 800)
      .unit("v1", "summoner", 900, 710, { id: "wounded-summoner", hp: 19 })
      .unit("v1", "witch", 930, 665, { id: "healthy-witch" })
      .unit("v1", "priest", 940, 755, { id: "healthy-priest" })
      .unit("v1", "archer", 965, 710, { id: "healthy-archer" })
      .build();
    const game = scene.createGame();
    game.units.find((unit) => unit.id === "tail-archer-a")!.order = { type: "attack", targetId: "healthy-witch" };
    game.units.find((unit) => unit.id === "tail-archer-b")!.order = { type: "attack", targetId: "healthy-priest" };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.focusFire], { version: "v2", teams: game.teams, policyMode: "combat" }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "wounded-summoner" });
    expect(command?.type === "attack" ? command.unitIds.sort() : []).toEqual(["tail-archer-a", "tail-archer-b"]);
  });

  it("v2 combat focus memory yields to an immediately killable nearby target", () => {
    const scene = sketchScene("v2-combat-focus-finisher-before-memory")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 150, 800)
      .unit("v2", "footman", 820, 790)
      .unit("v2", "lancer", 835, 820)
      .unit("v2", "archer", 790, 760)
      .unit("v2", "archer", 795, 850)
      .townHall("v1", 1450, 800)
      .unit("v1", "archer", 900, 790, { id: "remembered-archer", hp: 28 })
      .unit("v1", "raider", 905, 830, { id: "free-kill-raider", hp: 9 })
      .unit("v1", "footman", 970, 810)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1", focusTargetId: "remembered-archer", focusTargetSinceTick: 0, focusTargetUpdatedTick: 0 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.focusFire], { version: "v2", teams: game.teams, policyMode: "combat", memory }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "free-kill-raider" });
  });

  it("v2 preset reintroduces focus-fire through the memory-backed executable stack", () => {
    const scene = sketchScene("v2-preset-focus-fire-wiring")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 900, 900)
      .unit("v2", "lancer", 930, 930)
      .unit("v2", "archer", 960, 960)
      .townHall("v1", 3000, 3000)
      .unit("v1", "footman", 1000, 900, { id: "healthy-front" })
      .unit("v1", "raider", 1030, 930, { id: "weak-raider-preset", hp: 28 })
      .unit("v1", "archer", 1060, 960, { id: "healthy-archer" })
      .build();
    const game = scene.createGame();

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "focusFire")).toMatchObject({
      scriptId: "focusFire",
      command: { type: "attack", targetId: "weak-raider-preset" },
    });
    expect(entries.find((entry) => entry.scriptId === "attackWave" && entry.command.type === "attackMove")).toBeUndefined();
  });

  it("does not drag out-of-range melee out of tower cover for main-defense focus fire", () => {
    const scene = sketchScene("v2-main-defense-focus-leash")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 650, 620, { id: "v2-main-tower" })
      .unit("v2", "footman", 610, 560, { id: "cover-footman" })
      .unit("v2", "lancer", 640, 590, { id: "cover-lancer" })
      .unit("v2", "archer", 670, 620, { id: "cover-archer-a" })
      .unit("v2", "archer", 700, 650, { id: "cover-archer-b" })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .unit("v1a", "footman", 730, 650, { id: "healthy-front" })
      .unit("v1b", "raider", 760, 660, { id: "weak-raider", hp: 35 })
      .unit("v1a", "archer", 790, 670, { id: "healthy-archer" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "weak-raider" });
    expect(command?.type === "attack" ? command.unitIds : []).toEqual(["cover-archer-a", "cover-archer-b"]);
  });

  it("v2 lets nearby melee outside tower cover join main-defense focus fire", () => {
    const scene = sketchScene("v2-main-defense-melee-rejoin")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 250, 500, { id: "v2-main-tower" })
      .building("v2", "farm", 760, 500, { id: "pressured-farm" })
      .unit("v2", "footman", 820, 500, { id: "main-footman", order: { type: "move", x: 760, y: 500 } })
      .unit("v2", "lancer", 840, 530, { id: "main-lancer", order: { type: "move", x: 760, y: 500 } })
      .unit("v2", "archer", 860, 540, { id: "main-archer", order: { type: "move", x: 760, y: 500 } })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .unit("v1a", "raider", 900, 500, { id: "wounded-base-attacker", hp: 32, order: { type: "attackMove", x: 760, y: 500, targetId: "pressured-farm" } })
      .unit("v1b", "footman", 940, 540, { id: "healthy-base-attacker" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "wounded-base-attacker" });
    expect(command?.type === "attack" ? command.unitIds.sort() : []).toEqual(["main-archer", "main-footman", "main-lancer"]);
  });

  it("v2 sends the covered main squad into a one-on-one building break-in instead of tiny focus fire", () => {
    const scene = sketchScene("v2-main-building-break-in")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 340, 500, { id: "v2-main-tower" })
      .building("v2", "farm", 720, 500, { id: "pressured-farm" })
      .unit("v2", "footman", 500, 500, { id: "covered-footman-a" })
      .unit("v2", "footman", 530, 530, { id: "covered-footman-b" })
      .unit("v2", "footman", 560, 500, { id: "covered-footman-c" })
      .unit("v2", "lancer", 675, 455, { id: "loose-lancer-a" })
      .unit("v2", "lancer", 675, 545, { id: "loose-lancer-b" })
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 720, 455, { id: "front-shield", hp: 127, order: { type: "attack", targetId: "loose-lancer-a" } })
      .unit("v1a", "contractArcher", 895, 485, { id: "farm-archer-a", order: { type: "attackMove", x: 720, y: 500, targetId: "pressured-farm" } })
      .unit("v1a", "contractArcher", 910, 530, { id: "farm-archer-b", order: { type: "attackMove", x: 720, y: 500, targetId: "pressured-farm" } })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attackMove", x: 720, y: 500 });
    expect(command?.type === "attackMove" ? command.unitIds : []).toEqual(expect.arrayContaining(["covered-footman-a", "covered-footman-b", "covered-footman-c"]));
  });

  it("v5 counterattacks a small ranged detachment pressuring its main before respecting the global 1v2 stopline", () => {
    const scene = sketchScene("v5-main-approach-detachment-pickoff")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 2048, { id: "v5-main" })
      .unit("v5", "cinderRunner", 462, 1999, { id: "runner-a", order: { type: "move", x: 451, y: 1985 } })
      .unit("v5", "emberRavager", 566, 2097, { id: "ravager-a" })
      .unit("v5", "cinderRunner", 442, 1977, { id: "runner-b" })
      .unit("v5", "emberRavager", 476, 2031, { id: "ravager-b", order: { type: "move", x: 451, y: 1985 } })
      .unit("v5", "cinderRunner", 427, 1946, { id: "runner-c" })
      .townHall("v3", 3600, 2800)
      .unit("v3", "emberRavager", 2005, 2061)
      .unit("v3", "emberRavager", 1981, 2128)
      .unit("v3", "sparkArcher", 2027, 2110)
      .unit("v3", "emberAcolyte", 2058, 2099)
      .townHall("v4-tr", 3600, 1475)
      .unit("v4-tr", "contractArcher", 1383, 2243, { id: "main-pressure-archer-a", order: { type: "attack", targetId: "runner-b" } })
      .unit("v4-tr", "contractArcher", 1330, 2207, { id: "main-pressure-archer-b", order: { type: "attack", targetId: "runner-b" } })
      .unit("v4-tr", "contractArcher", 1356, 2225, { id: "main-pressure-archer-c", order: { type: "attack", targetId: "runner-b" } })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", requestedVersion: "v5", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: expect.stringContaining("main-pressure-archer") });
  });

  it("v2 defends a tech building targeted by ranged attackers before waiting behind a stronger-army stopline", () => {
    const scene = sketchScene("v2-targeted-tech-building-defense")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "sanctum", 620, 560, { id: "v2-sanctum" })
      .unit("v2", "footman", 510, 520)
      .unit("v2", "footman", 540, 550)
      .unit("v2", "lancer", 570, 520)
      .unit("v2", "archer", 600, 550)
      .unit("v2", "archer", 630, 520)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "contractArcher", 960, 540, { id: "sanctum-archer-a", order: { type: "attackMove", x: 620, y: 560, targetId: "v2-sanctum" } })
      .unit("v1a", "contractArcher", 1000, 585, { id: "sanctum-archer-b", order: { type: "attackMove", x: 620, y: 560, targetId: "v2-sanctum" } })
      .unit("v1a", "mercenary", 1550, 940)
      .unit("v1a", "mercenary", 1600, 980)
      .unit("v1a", "footman", 1650, 940)
      .unit("v1a", "lancer", 1700, 980)
      .build();
    const game = scene.createGame();
    const sanctum = game.buildings.find((building) => building.id === "v2-sanctum");
    if (!sanctum) throw new Error("missing sanctum");
    sanctum.hp = sanctum.maxHp * 0.9;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attack" || candidate.type === "attackMove",
    );

    expect(command).toBeDefined();
    if (command?.type === "attackMove") expect(command).toMatchObject({ x: 620, y: 560 });
    if (command?.type === "attack") expect(command.targetId).toContain("sanctum-archer");
  });

  it("v2 focuses ranged attackers that can hit a main tech building from outside the normal defense bubble", () => {
    const scene = sketchScene("v2-long-range-tech-building-focus")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 340, 500, { id: "v2-main-tower" })
      .building("v2", "sanctum", 620, 560, { id: "v2-sanctum" })
      .unit("v2", "footman", 430, 520)
      .unit("v2", "footman", 460, 550)
      .unit("v2", "lancer", 490, 520)
      .unit("v2", "archer", 610, 550)
      .unit("v2", "contractArcher", 650, 560, { id: "v2-cover-contract" })
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "contractArcher", 980, 548, { id: "sanctum-archer-a", order: { type: "attackMove", x: 620, y: 560, targetId: "v2-sanctum" } })
      .unit("v1a", "contractArcher", 1020, 592, { id: "sanctum-archer-b", order: { type: "attackMove", x: 620, y: 560, targetId: "v2-sanctum" } })
      .unit("v1a", "mercenary", 1040, 640)
      .unit("v1a", "mercenary", 1080, 680)
      .unit("v1a", "footman", 1060, 720)
      .unit("v1a", "lancer", 1100, 760)
      .build();
    const game = scene.createGame();
    const sanctum = game.buildings.find((building) => building.id === "v2-sanctum");
    if (!sanctum) throw new Error("missing sanctum");
    sanctum.hp = sanctum.maxHp * 0.9;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attack");

    expect(command).toMatchObject({ type: "attack", targetId: "sanctum-archer-a" });
    expect(command?.type === "attack" ? command.unitIds : []).toContain("v2-cover-contract");
  });

  it("does not let main-defense focus override wounded-unit pullbacks in the same policy pass", () => {
    const scene = sketchScene("v2-wounded-pullback-not-overridden")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .tower("v2", 650, 620, { id: "v2-main-tower" })
      .unit("v2", "footman", 610, 560)
      .unit("v2", "footman", 640, 590)
      .unit("v2", "lancer", 670, 620)
      .unit("v2", "archer", 700, 650, { id: "wounded-archer", hp: 20 })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .unit("v1a", "footman", 720, 650, { id: "enemy-front" })
      .unit("v1b", "raider", 760, 660, { id: "enemy-raider", hp: 35 })
      .unit("v1a", "archer", 790, 670, { id: "enemy-archer" })
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });
    const pullback = commands.find((command) => command.type === "move" && command.unitIds.includes("wounded-archer"));
    const overwrites = commands.filter((command) => (command.type === "attack" || command.type === "attackMove") && command.unitIds.includes("wounded-archer"));

    expect(pullback).toMatchObject({ type: "move" });
    expect(overwrites).toEqual([]);
  });

  it("prioritizes core production over expansion-guard tower spam", () => {
    const game = createGame("openClaims", { aiPlayers: [] });
    game.players.player.gold = 5000;
    game.buildings.push(createBuilding("building-player-expanded-townhall", "player", "townHall", 1800, 1800, true));
    const mine = game.resources[0]!;
    for (const worker of game.units.filter((unit) => unit.owner === "player" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: mine.id, phase: "toMine", timer: 0 };
    }

    const command = planPresetAiCommands(snapshotGame(game), "player")[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "barracks" });
  });

  it("v2 builds core production before economic catch-up expansions when outnumbered", () => {
    const teams = { v2: "north", v1a: "south", v1b: "south" };
    const game = createGame("openClaims", {
      players: ["v2", "v1a", "v1b"],
      aiPlayers: [],
      teams,
      races: { v2: "grove", v1a: "grove", v1b: "ember" },
    });
    game.players.v2!.gold = 1200;
    const mine = game.resources[0]!;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: mine.id, phase: "toMine", timer: 0 };
    }

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "barracks" });
  });

  it("v5 takes a safe first expansion before core production when severely outnumbered by enemy economies", () => {
    const scene = sketchScene("v5-severe-economy-gap-first-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .worker("v5", 520, 540, { id: "v5-builder" })
      .worker("v5", 540, 560)
      .worker("v5", 560, 540)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 1220, 650, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 560;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("v5 skips the severe-economy first expansion when an enemy base controls the target mine", () => {
    const scene = sketchScene("v5-severe-economy-gap-close-enemy-production-first")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .worker("v5", 520, 540, { id: "v5-builder" })
      .worker("v5", 540, 560)
      .worker("v5", 560, 540)
      .townHall("v3a", 1700, 650)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-contested-natural", 1220, 650, 4000)
      .goldMine("v3a-main-mine", 1740, 650, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 560;

    const expansion = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];
    const production = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(expansion).toBeUndefined();
    expect(production).toMatchObject({ type: "build", buildingKind: "barracks" });
  });

  it("v5 banks two-mine worker gold for the first core production building when severely outnumbered", () => {
    const scene = sketchScene("v5-severe-economy-gap-core-production-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .townHall("v5", 1220, 650, { id: "v5-natural" })
      .worker("v5", 520, 540, { id: "v5-worker-a" })
      .worker("v5", 540, 560, { id: "v5-worker-b" })
      .worker("v5", 1220, 650, { id: "v5-worker-c" })
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 1260, 650, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 75;
    for (const worker of game.units.filter((unit) => unit.owner === "v5" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: worker.x > 900 ? "v5-natural-mine" : "v5-main-mine", phase: "toMine", timer: 0 };
    }

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v5 banks one-mine worker gold for the first core production building after early mercenary tempo", () => {
    const scene = sketchScene("v5-severe-economy-gap-one-mine-core-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .worker("v5", 520, 540, { id: "v5-worker-a" })
      .worker("v5", 540, 560, { id: "v5-worker-b" })
      .unit("v5", "mercenary", 620, 540)
      .unit("v5", "contractArcher", 640, 560)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 75;
    for (const worker of game.units.filter((unit) => unit.owner === "v5" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v5-main-mine", phase: "toMine", timer: 0 };
    }

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v5 keeps the first core-production bank after one configured enemy has been eliminated", () => {
    const scene = sketchScene("v5-severe-economy-gap-configured-core-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .worker("v5", 520, 540, { id: "v5-worker-a" })
      .worker("v5", 540, 560, { id: "v5-worker-b" })
      .worker("v5", 560, 540, { id: "v5-worker-c" })
      .unit("v5", "mercenary", 620, 540)
      .unit("v5", "contractArcher", 640, 560)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 155;
    for (const worker of game.units.filter((unit) => unit.owner === "v5" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v5-main-mine", phase: "toMine", timer: 0 };
    }

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v5 builds first core production while the severe-economy first expansion is still incomplete", () => {
    const scene = sketchScene("v5-severe-economy-gap-production-during-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .townHall("v5", 1220, 650, { id: "v5-natural", complete: false })
      .worker("v5", 520, 540, { id: "v5-builder-a" })
      .worker("v5", 540, 560, { id: "v5-builder-b" })
      .worker("v5", 560, 540)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 1260, 650, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 170;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "barracks" });
  });

  it("v5 builds first core production while a severe-economy opening tower is still incomplete", () => {
    const scene = sketchScene("v5-severe-economy-gap-production-during-tower")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .building("v5", "defenseTower", 620, 540, { id: "v5-opening-tower", complete: false })
      .worker("v5", 520, 540, { id: "v5-builder-a" })
      .worker("v5", 540, 560, { id: "v5-builder-b" })
      .worker("v5", 560, 540)
      .townHall("v3a", 1700, 650)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-contested-natural", 1220, 650, 4000)
      .goldMine("v3a-main-mine", 1740, 650, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 170;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "barracks" });
  });

  it("v5 banks worker gold while the severe-economy first core production is still building", () => {
    const scene = sketchScene("v5-severe-economy-gap-first-core-under-construction-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .building("v5", "barracks", 620, 620, { id: "v5-barracks", complete: false })
      .worker("v5", 520, 540, { id: "v5-worker-a" })
      .worker("v5", 540, 560, { id: "v5-worker-b" })
      .worker("v5", 560, 540)
      .townHall("v3a", 1700, 650)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-contested-natural", 1220, 650, 4000)
      .goldMine("v3a-main-mine", 1740, 650, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 75;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v5 does not spend the pending first combat bank on another worker", () => {
    const scene = sketchScene("v5-severe-economy-gap-pending-combat-bank-margin")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .building("v5", "barracks", 620, 620, { id: "v5-barracks", complete: false })
      .worker("v5", 520, 540, { id: "v5-worker-a" })
      .worker("v5", 540, 560, { id: "v5-worker-b" })
      .worker("v5", 560, 540)
      .worker("v5", 580, 560)
      .townHall("v3a", 1700, 650)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-contested-natural", 1220, 650, 4000)
      .goldMine("v3a-main-mine", 1740, 650, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 130;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v5 converts early mercenary tempo into the first trained combat unit before more workers", () => {
    const scene = sketchScene("v5-severe-economy-gap-first-trained-combat")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .building("v5", "emberForge", 620, 620, { id: "v5-forge" })
      .worker("v5", 520, 540, { id: "v5-worker-a" })
      .worker("v5", 540, 560, { id: "v5-worker-b" })
      .unit("v5", "mercenary", 620, 540)
      .unit("v5", "contractArcher", 640, 560)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 120;
    for (const worker of game.units.filter((unit) => unit.owner === "v5" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v5-main-mine", phase: "toMine", timer: 0 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "train", buildingId: "v5-forge", unitKind: "emberRavager" });
  });

  it("v5 banks worker gold for the first trained combat unit after early mercenary tempo", () => {
    const scene = sketchScene("v5-severe-economy-gap-first-trained-combat-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .building("v5", "emberForge", 620, 620, { id: "v5-forge" })
      .worker("v5", 520, 540, { id: "v5-worker-a" })
      .worker("v5", 540, 560, { id: "v5-worker-b" })
      .unit("v5", "mercenary", 620, 540)
      .unit("v5", "contractArcher", 640, 560)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 75;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v5 spends the severe-economy production reserve on a controlled combat mercenary", () => {
    const scene = sketchScene("v5-severe-economy-gap-controlled-merc-before-production")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .worker("v5", 620, 540, { id: "v5-camp-worker" })
      .worker("v5", 540, 560)
      .worker("v5", 560, 540)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .mercenaryCamp("controlled-contract", 620, 540, { hireKind: "contractArcher", cost: 145, stock: 1, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 145;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "hire", campId: "controlled-contract" });
  });

  it("v5 preclaims a safe local mercenary camp with a worker when outnumbered", () => {
    const scene = sketchScene("v5-safe-local-mercenary-preclaim")
      .map("mercPocket")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .worker("v5", 520, 540, { id: "v5-worker" })
      .worker("v5", 540, 560)
      .worker("v5", 560, 540)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .mercenaryCamp("safe-local-contract", 900, 560, { hireKind: "contractArcher", cost: 145, stock: 1, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 40;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move", x: 900, y: 560 });
    if (command?.type !== "move") throw new Error("expected a move command");
    expect(command.unitIds).toHaveLength(1);
  });

  it("v5 recalls a distant early severe-economy squad when three enemies approach the main", () => {
    const scene = sketchScene("v5-severe-economy-three-enemy-main-recall")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .worker("v5", 520, 540)
      .worker("v5", 540, 560)
      .worker("v5", 560, 540)
      .unit("v5", "mercenary", 1580, 520, { id: "v5-merc" })
      .unit("v5", "contractArcher", 1620, 560, { id: "v5-bow-a" })
      .unit("v5", "contractArcher", 1640, 600, { id: "v5-bow-b" })
      .townHall("v3a", 3300, 3000)
      .unit("v3a", "footman", 1270, 500)
      .unit("v3a", "footman", 1300, 540)
      .unit("v3a", "lancer", 1330, 580)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();

    const openingCommand = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];
    expect(openingCommand).toBeUndefined();

    game.tick = 1_800;
    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move", x: 500, y: 500 });
    if (command?.type !== "move") throw new Error("expected a move command");
    expect(command.unitIds).toEqual(["v5-merc", "v5-bow-a", "v5-bow-b"]);
  });

  it("v5 banks worker gold for the second early combat unit when severely outnumbered", () => {
    const scene = sketchScene("v5-severe-economy-gap-second-combat-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .building("v5", "barracks", 620, 620, { id: "v5-barracks" })
      .worker("v5", 520, 540, { id: "v5-worker-a" })
      .worker("v5", 540, 560, { id: "v5-worker-b" })
      .worker("v5", 560, 540)
      .worker("v5", 580, 560)
      .unit("v5", "footman", 650, 620)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 75;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v5 trains the second early combat unit before another worker when severely outnumbered", () => {
    const scene = sketchScene("v5-severe-economy-gap-second-combat-priority")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .building("v5", "barracks", 620, 620, { id: "v5-barracks" })
      .worker("v5", 520, 540, { id: "v5-worker-a" })
      .worker("v5", 540, 560, { id: "v5-worker-b" })
      .worker("v5", 560, 540)
      .worker("v5", 580, 560)
      .unit("v5", "footman", 650, 620)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 100;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "train", buildingId: "v5-barracks", unitKind: "footman" });
  });

  it("v5 keeps core combat production ahead of two-mine worker saturation when severely outnumbered", () => {
    const scene = sketchScene("v5-severe-economy-gap-sustain-combat")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .townHall("v5", 900, 640, { id: "v5-natural" })
      .building("v5", "barracks", 620, 620, { id: "v5-barracks" })
      .worker("v5", 520, 540)
      .worker("v5", 540, 560)
      .worker("v5", 900, 650)
      .worker("v5", 920, 670)
      .unit("v5", "footman", 650, 620)
      .unit("v5", "footman", 690, 650)
      .unit("v5", "lancer", 730, 620)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 930, 650, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 100;
    for (const worker of game.units.filter((unit) => unit.owner === "v5" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: worker.x > 700 ? "v5-natural-mine" : "v5-main-mine", phase: "toMine", timer: 0 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "train", buildingId: "v5-barracks", unitKind: "footman" });
  });

  it("v5 banks two-mine worker gold for second production when severely outnumbered", () => {
    const scene = sketchScene("v5-severe-economy-gap-second-production-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .townHall("v5", 900, 640, { id: "v5-natural" })
      .building("v5", "barracks", 620, 620, { id: "v5-barracks" })
      .worker("v5", 520, 540)
      .worker("v5", 540, 560)
      .worker("v5", 900, 650)
      .worker("v5", 920, 670)
      .unit("v5", "footman", 650, 620)
      .unit("v5", "footman", 690, 650)
      .unit("v5", "lancer", 730, 620)
      .unit("v5", "footman", 770, 650)
      .unit("v5", "lancer", 810, 620)
      .unit("v5", "footman", 850, 650)
      .unit("v5", "footman", 890, 620)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 930, 650, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 75;
    for (const worker of game.units.filter((unit) => unit.owner === "v5" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: worker.x > 700 ? "v5-natural-mine" : "v5-main-mine", phase: "toMine", timer: 0 };
    }

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v5 can take a third mining base before the full production chain when severely outnumbered", () => {
    const scene = sketchScene("v5-severe-economy-gap-third-expansion-before-full-chain")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .player("v3d", { team: "south", race: "ember" })
      .player("v3e", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .townHall("v5", 900, 640, { id: "v5-natural" })
      .building("v5", "barracks", 620, 620, { id: "v5-barracks" })
      .worker("v5", 520, 540, { id: "v5-builder" })
      .worker("v5", 540, 560)
      .worker("v5", 900, 650)
      .worker("v5", 920, 670)
      .unit("v5", "footman", 650, 620)
      .unit("v5", "footman", 690, 650)
      .unit("v5", "lancer", 730, 620)
      .unit("v5", "footman", 770, 650)
      .unit("v5", "lancer", 810, 620)
      .unit("v5", "footman", 850, 650)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .townHall("v3d", 3700, 3000)
      .townHall("v3e", 3700, 3400)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 930, 650, 4000)
      .goldMine("v5-third-mine", 1540, 760, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .goldMine("v3d-main-mine", 3740, 3000, 4000)
      .goldMine("v3e-main-mine", 3740, 3400, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 560;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("v5 banks two-base catch-up expansion gold before routine workers when severely outnumbered", () => {
    const scene = sketchScene("v5-severe-economy-gap-third-expansion-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .player("v3d", { team: "south", race: "ember" })
      .player("v3e", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .townHall("v5", 900, 640, { id: "v5-natural" })
      .building("v5", "barracks", 620, 620, { id: "v5-barracks" })
      .building("v5", "archeryRange", 660, 620, { id: "v5-archery" })
      .building("v5", "stables", 700, 620, { id: "v5-stables" })
      .worker("v5", 520, 540)
      .worker("v5", 540, 560)
      .worker("v5", 900, 650)
      .worker("v5", 920, 670)
      .unit("v5", "footman", 650, 620)
      .unit("v5", "footman", 690, 650)
      .unit("v5", "lancer", 730, 620)
      .unit("v5", "footman", 770, 650)
      .unit("v5", "lancer", 810, 620)
      .unit("v5", "footman", 850, 650)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .townHall("v3d", 3700, 3000)
      .townHall("v3e", 3700, 3400)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 930, 650, 4000)
      .goldMine("v5-third-mine", 1540, 760, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .goldMine("v3d-main-mine", 3740, 3000, 4000)
      .goldMine("v3e-main-mine", 3740, 3400, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 75;
    for (const worker of game.units.filter((unit) => unit.owner === "v5" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: worker.x > 700 ? "v5-natural-mine" : "v5-main-mine", phase: "toMine", timer: 0 };
    }

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.training], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v5 does not spend the severe-economy opening bundle on a pre-production tower", () => {
    const scene = sketchScene("v5-severe-economy-gap-no-opening-tower")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3a", { team: "south", race: "grove" })
      .player("v3b", { team: "south", race: "ember" })
      .player("v3c", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .worker("v5", 520, 540, { id: "v5-worker-a" })
      .worker("v5", 540, 560)
      .worker("v5", 560, 540)
      .townHall("v3a", 3300, 3000)
      .townHall("v3b", 3300, 3400)
      .townHall("v3c", 3300, 3800)
      .unit("v3a", "footman", 820, 540)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .goldMine("v5-natural-mine", 1220, 650, 4000)
      .goldMine("v3a-main-mine", 3340, 3000, 4000)
      .goldMine("v3b-main-mine", 3340, 3400, 4000)
      .goldMine("v3c-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 500;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.defense], { version: "v2", requestedVersion: "v5", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 scales production before spending catch-up gold on more towers", () => {
    const scene = sketchScene("v2-production-before-extra-tower")
      .map("openClaims")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .worker("v2", 1320, 620)
      .townHall("v1", 3300, 3300, { id: "v1-main" })
      .townHall("v1", 2800, 3000, { id: "v1-natural" })
      .townHall("v1", 2450, 2550, { id: "v1-third" })
      .worker("v1", 3350, 3300)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-natural-mine", 1420, 650, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .build();
    const game = scene.createGame();
    keepOnlyIds(game, {
      buildings: ["v2-main", "v2-natural", "v2-barracks", "v1-main", "v1-natural", "v1-third"],
      resources: ["v2-main-mine", "v2-natural-mine", "v1-main-mine"],
    });
    game.players.v2!.gold = 1600;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "archeryRange" });
  });

  it("v2 scales core production before buying a comfort tower when facing two enemy economies", () => {
    const scene = sketchScene("v2-core-production-before-comfort-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .building("v2", "farm", 610, 735, { id: "v2-farm-2" })
      .building("v2", "farm", 660, 770, { id: "v2-farm-3" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .unit("v2", "footman", 820, 660)
      .unit("v2", "archer", 850, 680)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .worker("v1a", 3400, 3360)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .worker("v1b", 3400, 3860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 500;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "build", buildingKind: "archeryRange" });
  });

  it("v2 takes a safe catch-up expansion before finishing every production family once it has a first squad", () => {
    const scene = sketchScene("v2-safe-expansion-before-third-production")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .building("v2", "farm", 610, 735, { id: "v2-farm-2-safe-expansion" })
      .building("v2", "farm", 660, 770, { id: "v2-farm-3-safe-expansion" })
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 820, 660)
      .unit("v2", "footman", 850, 690)
      .unit("v2", "lancer", 880, 660)
      .unit("v2", "archer", 910, 690)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .townHall("v1a", 2900, 3050, { id: "v1a-natural" })
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .worker("v1a", 3400, 3360)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .townHall("v1b", 2900, 3800, { id: "v1b-natural" })
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .worker("v1b", 3400, 3860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1420, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1a-natural-mine", 2920, 3060, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .goldMine("v1b-natural-mine", 2920, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 560;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    }
    const telemetry = createAiTelemetry();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
    expect(telemetry.behaviors.economicCatchUp.catchUpExpansions).toBe(1);
  });

  it("v2 reserves gold for a safe catch-up expansion instead of spending the float on extra production or units", () => {
    const scene = sketchScene("v2-reserve-safe-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .building("v2", "farm", 610, 735, { id: "v2-farm-2" })
      .building("v2", "farm", 660, 770, { id: "v2-farm-3" })
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 820, 660)
      .unit("v2", "footman", 850, 690)
      .unit("v2", "lancer", 880, 660)
      .unit("v2", "archer", 910, 690)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .townHall("v1a", 2900, 3050, { id: "v1a-natural" })
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .worker("v1a", 3400, 3360)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .townHall("v1b", 2900, 3800, { id: "v1b-natural" })
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .worker("v1b", 3400, 3860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1420, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1a-natural-mine", 2920, 3060, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .goldMine("v1b-natural-mine", 2920, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 250;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    }

    const economicSpend = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(economicSpend).toBeUndefined();
  });

  it("v2 reserves for a nearly cleared first natural before adding the third production building", () => {
    const scene = sketchScene("v2-reserve-nearly-cleared-natural")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 920, 790)
      .unit("v2", "footman", 950, 820)
      .unit("v2", "lancer", 980, 790)
      .unit("v2", "lancer", 1010, 820)
      .unit("v2", "archer", 1040, 790)
      .unit("v2", "archer", 1070, 820)
      .unit("v2", "contractArcher", 1100, 790)
      .unit("v2", "fieldMedic", 1130, 820)
      .townHall("v1", 3400, 3300, { id: "v1-main" })
      .worker("v1", 3360, 3300)
      .worker("v1", 3380, 3340)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1120, 820, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .unit("neutral", "wildling", 1128, 820, { id: "last-natural-guard", hp: 56 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 235;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    }

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "productionBuilding")).toBe(false);
    expect(entries.find((entry) => entry.scriptId === "expansion")?.command).toMatchObject({ type: "attackMove", x: 1120, y: 820 });
  });

  it("v2 builds a cleared first natural before spending the bank on priority weapon tech", () => {
    const scene = sketchScene("v2-cleared-natural-before-weapon-tech")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 920, 790)
      .unit("v2", "lancer", 950, 820)
      .unit("v2", "archer", 980, 790)
      .unit("v2", "archer", 1010, 820)
      .unit("v2", "footman", 1040, 790)
      .unit("v2", "lancer", 1070, 820)
      .unit("v2", "archer", 1100, 790)
      .townHall("v1", 3400, 3300, { id: "v1-main" })
      .worker("v1", 3360, 3300)
      .worker("v1", 3380, 3340)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1120, 820, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 340;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) {
      worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    }

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.command.type === "research")).toBe(false);
    expect(entries.find((entry) => entry.scriptId === "expansion")?.command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("queues training from multiple idle production buildings in one policy pass when resources allow it", () => {
    const scene = sketchScene("multi-production-training")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "sanctum", 820, 620, { id: "v2-sanctum" })
      .building("v2", "farm", 560, 700, { id: "v2-farm-1" })
      .building("v2", "farm", 610, 735, { id: "v2-farm-2" })
      .building("v2", "farm", 660, 770, { id: "v2-farm-3" })
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .townHall("target", 3300, 3300)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 900;
    game.players.v2.upgrades.weaponTraining = 3;
    game.players.v2.upgrades.reinforcedPlating = 3;

    const trainCommands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).filter((command) => command.type === "train");

    expect(trainCommands.map((command) => (command.type === "train" ? command.buildingId : ""))).toEqual(expect.arrayContaining(["v2-archery", "v2-barracks", "v2-sanctum", "v2-stables"]));
  });

  it("v2 spends scarce training gold on a wounded-group priest before another basic soldier", () => {
    const scene = sketchScene("v2-wounded-priest-before-basic-soldier")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 620, { id: "v2-archery" })
      .building("v2", "stables", 780, 620, { id: "v2-stables" })
      .building("v2", "sanctum", 860, 620, { id: "v2-sanctum" })
      .worker("v2", 510, 520)
      .worker("v2", 530, 520)
      .worker("v2", 550, 520)
      .worker("v2", 570, 520)
      .worker("v2", 590, 520)
      .worker("v2", 610, 520)
      .worker("v2", 630, 520)
      .worker("v2", 650, 520)
      .worker("v2", 670, 520)
      .worker("v2", 690, 520)
      .unit("v2", "footman", 840, 700, { hp: 40 })
      .unit("v2", "lancer", 875, 700, { hp: 44 })
      .unit("v2", "archer", 910, 700, { hp: 25 })
      .unit("v2", "footman", 945, 700)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000);
    const game = scene.build().createGame();
    game.players.v2!.gold = UNIT_DEFS.priest.cost;
    game.players.v2!.supplyUsed = 18;
    game.players.v2!.supplyCap = 40;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([{ type: "train", buildingId: "v2-sanctum", unitKind: "priest" }]);
  });

  it("v2 keeps a thin two-base training bank on routine basic units", () => {
    const scene = sketchScene("v2-mature-bank-late-tech-before-basic")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 920, 760, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 620, { id: "v2-archery" })
      .building("v2", "stables", 780, 620, { id: "v2-stables" })
      .building("v2", "sanctum", 860, 620, { id: "v2-sanctum" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .building("v2", "farm", 710, 805)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 920, 760, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000);
    for (let i = 0; i < 10; i += 1) {
      scene.worker("v2", 520 + (i % 5) * 18, 520 + Math.floor(i / 5) * 26, {
        order: { type: "mine", resourceId: i < 5 ? "v2-main-mine" : "v2-natural-mine", phase: "gather", timer: 10 },
      });
    }
    for (let i = 0; i < 10; i += 1) scene.unit("v2", i % 3 === 0 ? "footman" : i % 3 === 1 ? "archer" : "lancer", 760 + i * 24, 760);
    const game = scene.build().createGame();
    game.players.v2!.gold = UNIT_DEFS.priest.cost + UNIT_DEFS.knight.cost;
    game.players.v2!.supplyUsed = 36;
    game.players.v2!.supplyCap = 60;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([
      { type: "train", buildingId: "v2-barracks", unitKind: "footman" },
      { type: "train", buildingId: "v2-archery", unitKind: "archer" },
    ]);
  });

  it("v2 spends a mature two-base training bank on late-tech units while keeping a basic unit window", () => {
    const scene = sketchScene("v2-mature-bank-late-tech-plus-basic")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 920, 760, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 620, { id: "v2-archery" })
      .building("v2", "stables", 780, 620, { id: "v2-stables" })
      .building("v2", "sanctum", 860, 620, { id: "v2-sanctum" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .building("v2", "farm", 710, 805)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 920, 760, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000);
    for (let i = 0; i < 10; i += 1) {
      scene.worker("v2", 520 + (i % 5) * 18, 520 + Math.floor(i / 5) * 26, {
        order: { type: "mine", resourceId: i < 5 ? "v2-main-mine" : "v2-natural-mine", phase: "gather", timer: 10 },
      });
    }
    for (let i = 0; i < 10; i += 1) scene.unit("v2", i % 3 === 0 ? "footman" : i % 3 === 1 ? "archer" : "lancer", 760 + i * 24, 760);
    const game = scene.build().createGame();
    game.players.v2!.gold = UNIT_DEFS.priest.cost + UNIT_DEFS.knight.cost + UNIT_DEFS.footman.cost;
    game.players.v2!.supplyUsed = 36;
    game.players.v2!.supplyCap = 60;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([
      { type: "train", buildingId: "v2-sanctum", unitKind: "priest" },
      { type: "train", buildingId: "v2-stables", unitKind: "knight" },
      { type: "train", buildingId: "v2-barracks", unitKind: "footman" },
    ]);
  });

  it("v2 spends tech reserve on immediate training when a stronger one-on-one army is near its bases", () => {
    const scene = sketchScene("v2-tech-reserve-breaks-for-one-on-one-base-threat")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 720, 980, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 620, { id: "v2-archery" })
      .tower("v2", 420, 560)
      .building("v2", "farm", 780, 620)
      .building("v2", "farm", 860, 620)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 760, 960, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000);
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 520 + i * 18, 520, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } });
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 730 + i * 18, 960, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 10 } });
    for (let i = 0; i < 9; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 760 + (i % 5) * 22, 620 + Math.floor(i / 5) * 24);
    for (let i = 0; i < 14; i += 1) scene.unit("v1a", i % 4 === 0 ? "contractArcher" : i % 4 === 1 ? "lancer" : "footman", 1280 + (i % 7) * 24, 720 + Math.floor(i / 7) * 24);
    const game = scene.build().createGame();
    game.players.v2!.gold = UNIT_DEFS.footman.cost + 35;
    game.players.v2!.supplyUsed = 28;
    game.players.v2!.supplyCap = 44;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "train" && command.buildingId === "v2-barracks")).toBe(true);
  });

  it("v2 spends weapon upgrade bank on immediate training when a stronger one-on-one army is near its bases", () => {
    const scene = sketchScene("v2-weapon-bank-breaks-for-one-on-one-base-threat")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 720, 980, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 620)
      .building("v2", "stables", 780, 620)
      .building("v2", "sanctum", 860, 620)
      .tower("v2", 420, 560)
      .building("v2", "farm", 940, 620)
      .building("v2", "farm", 1020, 620)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 760, 960, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000);
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 520 + i * 18, 520, { order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 10 } });
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 730 + i * 18, 960, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 10 } });
    for (let i = 0; i < 9; i += 1) scene.unit("v2", i % 3 === 0 ? "lancer" : i % 3 === 1 ? "footman" : "archer", 760 + (i % 5) * 22, 620 + Math.floor(i / 5) * 24);
    for (let i = 0; i < 14; i += 1) scene.unit("v1a", i % 4 === 0 ? "contractArcher" : i % 4 === 1 ? "lancer" : "footman", 1280 + (i % 7) * 24, 720 + Math.floor(i / 7) * 24);
    const game = scene.build().createGame();
    game.players.v2!.gold = UNIT_DEFS.footman.cost + 35;
    game.players.v2!.supplyUsed = 28;
    game.players.v2!.supplyCap = 44;
    game.players.v2!.upgrades.weaponTraining = 1;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "train" && command.buildingId === "v2-barracks")).toBe(true);
  });

  it("v2 rebuilds workers after a raid instead of waiting to afford the next tech building", () => {
    const scene = sketchScene("v2-worker-recovery-after-raid")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .unit("v2", "footman", 650, 580)
      .unit("v2", "archer", 690, 610)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 90;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(command).toMatchObject({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("v2 saturates two mining bases to five workers each when two enemy economies are ahead", () => {
    const scene = sketchScene("v2-two-base-worker-saturation-against-two")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .building("v2", "barracks", 620, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .building("v2", "farm", 610, 735, { id: "v2-farm-2" })
      .unit("v2", "footman", 650, 580)
      .unit("v2", "archer", 690, 610)
      .unit("v2", "footman", 660, 620)
      .unit("v2", "archer", 710, 650)
      .unit("v2", "lancer", 740, 620)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 470, 3000)
      .goldMine("v1a-main-mine", 3300, 3240, 3000)
      .goldMine("v1b-main-mine", 3400, 3740, 3000)
      .goldMine("v2-natural-mine", 1350, 620, 3000);
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 520 + i * 20, 540 + i * 10);
    for (let i = 0; i < 4; i += 1) scene.worker("v2", 1330 + i * 20, 650 + i * 10);
    for (let i = 0; i < 8; i += 1) {
      scene.worker("v1a", 3280 + i * 12, 3300 + i * 8);
      scene.worker("v1b", 3380 + i * 12, 3800 + i * 8);
    }
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 90;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(command).toMatchObject({ type: "train", unitKind: "worker" });
  });

  it("v2 does not delay its first fighting squad to saturate extra workers", () => {
    const scene = sketchScene("v2-first-squad-before-extra-workers")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .unit("v2", "footman", 650, 580)
      .unit("v2", "archer", 690, 610)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 470, 3000)
      .goldMine("v1a-main-mine", 3300, 3240, 3000)
      .goldMine("v1b-main-mine", 3400, 3740, 3000)
      .goldMine("v2-natural-mine", 1350, 620, 3000);
    for (let i = 0; i < 6; i += 1) scene.worker("v2", 520 + i * 20, 540 + i * 10);
    for (let i = 0; i < 8; i += 1) {
      scene.worker("v1a", 3280 + i * 12, 3300 + i * 8);
      scene.worker("v1b", 3380 + i * 12, 3800 + i * 8);
    }
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 90;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(command).toBeUndefined();
  });

  it("v2 rebuilds a damaged two-base worker line even while core army is thin", () => {
    const scene = sketchScene("v2-worker-recovery-two-base-under-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .building("v2", "barracks", 620, 560, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .unit("v2", "footman", 650, 580)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 470, 3000)
      .goldMine("v2-natural-mine", 1350, 620, 3000)
      .goldMine("v1a-main-mine", 3300, 3240, 3000)
      .goldMine("v1b-main-mine", 3400, 3740, 3000);
    for (let i = 0; i < 5; i += 1) scene.worker("v2", 520 + i * 24, 540 + i * 12);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 90;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands).toContainEqual({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("v2 trains cheap recovery workers when the main is pressured and it cannot afford soldiers", () => {
    const scene = sketchScene("v2-cheap-worker-recovery-under-main-pressure")
      .map("wildMarches")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 1460, { id: "v2-main" })
      .building("v2", "barracks", 620, 1500, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 1500, { id: "v2-archery" })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 760, 1500)
      .unit("v1b", "lancer", 790, 1530)
      .unit("v1a", "archer", 820, 1560);
    for (let i = 0; i < 6; i += 1) scene.worker("v2", 470 + i * 22, 1410 + i * 12);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 90;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(command).toMatchObject({ type: "train", buildingId: "v2-main", unitKind: "worker" });
  });

  it("keeps scaling supply past seven farms when a rich army is population capped", () => {
    const scene = sketchScene("supply-scaling-past-seven-farms")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .worker("v2", 540, 520, { id: "v2-builder" })
      .townHall("v1", 3300, 3300);
    for (let i = 0; i < 7; i += 1) scene.building("v2", "farm", 560 + i * 45, 700 - i * 25);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 1000;
    game.players.v2.supplyUsed = game.players.v2.supplyCap;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build" && candidate.buildingKind === "farm");

    expect(command).toMatchObject({ type: "build", buildingKind: "farm" });
  });

  it("does not spend a cleared first-expansion bank on a routine farm", () => {
    const scene = sketchScene("v2-cleared-natural-bank-vs-farm")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650)
      .unit("v2", "footman", 1080, 680)
      .unit("v2", "lancer", 1010, 620)
      .unit("v2", "archer", 1000, 700)
      .unit("v2", "archer", 960, 660)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1-main-mine", 3300, 3240, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 215;
    game.players.v2.supplyUsed = 23;
    game.players.v2.supplyCap = 28;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 0 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.supply], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toBeUndefined();
  });

  it("does not spend a nearly-cleared first-expansion bank on a routine farm before supply is capped", () => {
    const scene = sketchScene("v2-nearly-cleared-natural-bank-vs-farm")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "footman", 1080, 680, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "lancer", 1010, 620, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "archer", 1000, 700, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "footman", 1030, 720, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "lancer", 1060, 730, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("neutral", "stonebackBrute", 1130, 655, { hp: 78 })
      .unit("neutral", "gladeWitch", 1160, 690)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-nearly-cleared-natural", 1120, 650, 4000)
      .goldMine("v1-main-mine", 3300, 3240, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = BUILDING_DEFS.farm.cost;
    game.players.v2.supplyUsed = 18;
    game.players.v2.supplyCap = 22;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.supply], { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("does not spend the first active-natural-clearing bank on a routine farm", () => {
    const scene = sketchScene("v2-active-natural-clearing-bank-vs-farm")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "lancer", 1040, 650, { hp: 106, order: { type: "attackMove", x: 1120, y: 650, targetId: "natural-brute" } })
      .unit("v2", "footman", 1080, 680, { hp: 121, order: { type: "attackMove", x: 1120, y: 650, targetId: "natural-brute" } })
      .unit("v2", "footman", 1030, 720, { hp: 136, order: { type: "attackMove", x: 1120, y: 650, targetId: "natural-brute" } })
      .unit("v2", "lancer", 990, 620, { hp: 3, order: { type: "move", x: 320, y: 520 } })
      .unit("neutral", "stonebackBrute", 1130, 655, { id: "natural-brute", hp: 116 })
      .unit("neutral", "gladeWitch", 1160, 690, { id: "natural-witch" })
      .townHall("v1a", 3300, 3300)
      .worker("v1a", 3280, 3280)
      .worker("v1a", 3290, 3290)
      .worker("v1a", 3300, 3300)
      .worker("v1a", 3310, 3310)
      .worker("v1a", 3320, 3320)
      .worker("v1a", 3330, 3330)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-active-natural", 1120, 650, 4000)
      .goldMine("v1-main-mine", 3300, 3240, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = BUILDING_DEFS.farm.cost;
    game.players.v2.supplyUsed = 18;
    game.players.v2.supplyCap = 22;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.supply], { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("does not spend a ready cleared-natural town-hall bank on one more routine footman", () => {
    const scene = sketchScene("v2-cleared-natural-bank-vs-routine-footman")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 650, 770)
      .building("v2", "moonWell", 420, 620)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1120, 650, { hp: 121 })
      .unit("v2", "footman", 1160, 670, { hp: 59 })
      .unit("v2", "lancer", 1080, 650, { hp: 106 })
      .unit("v2", "footman", 1100, 700, { hp: 118 })
      .unit("v2", "lancer", 540, 700, { hp: 130 })
      .unit("v2", "footman", 1150, 720, { hp: 145 })
      .unit("v2", "archer", 680, 560, { hp: 85 })
      .unit("v1a", "footman", 1440, 480, { hp: 145, order: { type: "attackMove", x: 1560, y: 520 } })
      .unit("v1a", "lancer", 1460, 510, { hp: 79, order: { type: "attackMove", x: 1560, y: 520 } })
      .unit("v1a", "footman", 1470, 540, { hp: 74, order: { type: "attackMove", x: 1560, y: 520 } })
      .unit("v1a", "footman", 1490, 500, { hp: 145, order: { type: "attackMove", x: 1560, y: 520 } })
      .unit("v1a", "lancer", 1510, 520, { hp: 60, order: { type: "attackMove", x: 1560, y: 520 } })
      .unit("v1a", "footman", 1530, 540, { hp: 64, order: { type: "attackMove", x: 1560, y: 520 } })
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 3520, 3320, { id: "v1a-natural" })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1-main-mine", 3300, 3240, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = BUILDING_DEFS.townHall.cost - 5;
    game.players.v2.supplyUsed = 20;
    game.players.v2.supplyCap = 28;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("spends an early first-expansion bank on one more defender before the bank is near complete", () => {
    const scene = sketchScene("v2-early-first-expansion-bank-trains-defender")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 492, 2048, { id: "v2-main" })
      .building("v2", "barracks", 612, 2148, { id: "v2-barracks" })
      .building("v2", "archeryRange", 612, 1976, { id: "v2-archery" })
      .building("v2", "farm", 716, 1948)
      .building("v2", "farm", 856, 1816)
      .worker("v2", 520, 2080)
      .unit("v2", "footman", 782, 2613, { id: "claim-footman-a", hp: 94 })
      .unit("v2", "lancer", 818, 2605, { id: "claim-lancer", hp: 88 })
      .unit("v2", "footman", 1132, 2041)
      .unit("v2", "footman", 1172, 2045)
      .unit("v2", "archer", 1138, 2014)
      .unit("v2", "footman", 1142, 2048)
      .unit("v2", "lancer", 1173, 2065)
      .townHall("v1a", 3604, 2048)
      .unit("v1a", "footman", 1900, 1980)
      .unit("v1a", "footman", 1940, 2010)
      .unit("v1a", "lancer", 1980, 2040)
      .unit("v1a", "archer", 2020, 2070)
      .unit("v1a", "footman", 2060, 2100)
      .unit("v1a", "lancer", 2100, 2130)
      .unit("v1a", "archer", 2140, 2160)
      .unit("v1a", "footman", 2180, 2190)
      .goldMine("v2-main-mine", 440, 2048, 4000)
      .goldMine("v2-cleared-natural", 720, 2540, 4000)
      .goldMine("v1a-main-mine", 3680, 2048, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost - 75;
    game.players.v2!.supplyUsed = 20;
    game.players.v2!.supplyCap = 22;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 4800 };
    for (const unitId of ["claim-footman-a", "claim-lancer"]) {
      memory.unitClaims[unitId] = { kind: "expansion", targetId: "v2-cleared-natural", x: 720, y: 2540, sinceTick: 4800, expiresTick: 8400 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toMatchObject({ type: "train" });
  });

  it("spends a cleared first-natural bank on training when the five-unit claim is outpowered at home", () => {
    const scene = sketchScene("v2-cleared-natural-bank-breaks-for-home-army")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 492, 2048, { id: "v2-main" })
      .building("v2", "barracks", 612, 2148, { id: "v2-barracks" })
      .building("v2", "archeryRange", 612, 1976, { id: "v2-archery" })
      .building("v2", "farm", 716, 1948)
      .building("v2", "farm", 786, 1816)
      .worker("v2", 468, 2043)
      .worker("v2", 528, 2082)
      .worker("v2", 493, 2091)
      .worker("v2", 500, 2058)
      .worker("v2", 501, 2025)
      .worker("v2", 520, 2060)
      .unit("v2", "footman", 468, 2043, { id: "wounded-claim-footman", hp: 45, order: { type: "move", x: 492, y: 2048 } })
      .unit("v2", "lancer", 528, 2082, { id: "claim-lancer", hp: 121, order: { type: "move", x: 492, y: 2048 } })
      .unit("v2", "archer", 493, 2091, { id: "claim-archer", hp: 79, order: { type: "move", x: 492, y: 2048 } })
      .unit("v2", "footman", 500, 2058, { id: "home-footman-a", order: { type: "move", x: 492, y: 2048 } })
      .unit("v2", "footman", 501, 2025, { id: "home-footman-b", order: { type: "move", x: 492, y: 2048 } })
      .townHall("v1a", 3604, 2048)
      .townHall("v1a", 3300, 2240)
      .townHall("v1b", 3604, 2600)
      .townHall("v1b", 3300, 2800)
      .unit("v1a", "footman", 1378, 2039)
      .unit("v1a", "footman", 1294, 2081, { hp: 125 })
      .unit("v1a", "lancer", 1256, 2018, { hp: 107 })
      .unit("v1a", "footman", 1267, 2052, { hp: 107 })
      .unit("v1a", "contractArcher", 1416, 2107, { hp: 73 })
      .unit("v1a", "lancer", 1349, 2059)
      .unit("v1b", "footman", 1946, 2197, { hp: 61 })
      .unit("v1b", "footman", 2029, 2036, { hp: 88 })
      .unit("v1b", "lancer", 1993, 2109)
      .unit("v1b", "footman", 2024, 2090, { hp: 106 })
      .unit("v1b", "lancer", 2057, 2104, { hp: 90 })
      .goldMine("v2-main-mine", 440, 2048, 4000)
      .goldMine("v2-cleared-natural", 810, 2610, 4000)
      .goldMine("v1a-main-mine", 3680, 2048, 4000)
      .goldMine("v1a-natural", 3300, 2240, 4000)
      .goldMine("v1b-main-mine", 3680, 2600, 4000)
      .goldMine("v1b-natural", 3300, 2800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 235;
    game.players.v2!.supplyUsed = 16;
    game.players.v2!.supplyCap = 22;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 3300 };
    for (const unitId of ["wounded-claim-footman", "claim-lancer", "claim-archer"]) {
      memory.unitClaims[unitId] = { kind: "expansion", targetId: "v2-cleared-natural", x: 810, y: 2610, sinceTick: 3300, expiresTick: 6900 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toMatchObject({ type: "train" });
  });

  it("builds the ready cleared-natural town hall through distant main approach pressure", () => {
    const scene = sketchScene("v2-cleared-natural-build-through-approach-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1120, 650)
      .unit("v2", "footman", 1160, 670)
      .unit("v2", "lancer", 1080, 650)
      .unit("v2", "footman", 1100, 700)
      .unit("v2", "lancer", 540, 700)
      .unit("v2", "footman", 1150, 720)
      .unit("v2", "archer", 680, 560)
      .unit("v1a", "footman", 1440, 480, { order: { type: "attackMove", x: 1560, y: 520 } })
      .unit("v1a", "lancer", 1460, 510, { order: { type: "attackMove", x: 1560, y: 520 } })
      .unit("v1a", "footman", 1470, 540, { order: { type: "attackMove", x: 1560, y: 520 } })
      .unit("v1a", "footman", 1490, 500, { order: { type: "attackMove", x: 1560, y: 520 } })
      .unit("v1a", "lancer", 1510, 520, { order: { type: "attackMove", x: 1560, y: 520 } })
      .unit("v1a", "footman", 1530, 540, { order: { type: "attackMove", x: 1560, y: 520 } })
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 3520, 3320, { id: "v1a-natural" })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1-main-mine", 3300, 3240, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = BUILDING_DEFS.townHall.cost;
    game.players.v2.supplyUsed = 20;
    game.players.v2.supplyCap = 28;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("does not spend an exact cleared-natural town-hall plus farm bank before the hall frame", () => {
    const scene = sketchScene("v2-cleared-natural-exact-hall-plus-farm-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650, { id: "v2-claim-footman-a" })
      .unit("v2", "lancer", 1080, 680, { id: "v2-claim-lancer" })
      .unit("v2", "footman", 1010, 620, { id: "v2-claim-footman-b" })
      .unit("v2", "lancer", 760, 720)
      .unit("v2", "archer", 800, 740)
      .unit("v2", "footman", 840, 720)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost + BUILDING_DEFS.farm.cost;
    game.players.v2!.supplyUsed = 18;
    game.players.v2!.supplyCap = 22;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 3600 };
    memory.unitClaims["v2-claim-footman-a"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 3600, expiresTick: 7200 };
    memory.unitClaims["v2-claim-lancer"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 3600, expiresTick: 7200 };
    memory.unitClaims["v2-claim-footman-b"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 3600, expiresTick: 7200 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.supply], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toBeUndefined();
  });

  it("builds a farm from a cleared-natural town-hall bank when hard supply capped", () => {
    const scene = sketchScene("v2-cleared-natural-bank-hard-supply-cap-farm")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650, { id: "v2-claim-footman-a" })
      .unit("v2", "lancer", 1080, 680, { id: "v2-claim-lancer" })
      .unit("v2", "footman", 1010, 620, { id: "v2-claim-footman-b" })
      .unit("v2", "lancer", 760, 720)
      .unit("v2", "archer", 800, 740)
      .unit("v2", "footman", 840, 720)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost - 25;
    game.players.v2!.supplyUsed = 26;
    game.players.v2!.supplyCap = 22;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 3600 };
    memory.unitClaims["v2-claim-footman-a"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 3600, expiresTick: 7200 };
    memory.unitClaims["v2-claim-lancer"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 3600, expiresTick: 7200 };
    memory.unitClaims["v2-claim-footman-b"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 3600, expiresTick: 7200 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.supply], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "farm" });
  });

  it("builds an active cleared-natural town hall with six combat units", () => {
    const scene = sketchScene("v2-active-cleared-natural-six-unit-build")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .worker("v2", 520, 540, { id: "builder-a" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650, { id: "v2-claim-footman-a" })
      .unit("v2", "lancer", 1080, 680, { id: "v2-claim-lancer" })
      .unit("v2", "footman", 1010, 620, { id: "v2-claim-footman-b" })
      .unit("v2", "lancer", 760, 720)
      .unit("v2", "archer", 800, 740)
      .unit("v2", "footman", 840, 720)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    game.tick = 5520;
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 3600 };
    memory.unitClaims["v2-claim-footman-a"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 3600, expiresTick: 7200 };
    memory.unitClaims["v2-claim-lancer"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 3600, expiresTick: 7200 };
    memory.unitClaims["v2-claim-footman-b"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 3600, expiresTick: 7200 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("reserves near-duplicate-production gold instead of spending it on routine training", () => {
    const scene = sketchScene("v2-reserve-duplicate-production")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1380, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "sanctum", 820, 620, { id: "v2-sanctum" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700);
    for (let i = 0; i < 9; i += 1) scene.worker("v2", 520 + i * 12, 540 + i * 6);
    for (let i = 0; i < 6; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 650 + i * 22, 720);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 215;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });
    const training = commands.find((candidate) => candidate.type === "train");
    const productionBuilding = commands.find((candidate) => candidate.type === "build" && candidate.buildingKind !== "townHall");

    expect(training).toBeUndefined();
    expect(productionBuilding).toBeUndefined();
  });

  it("hires from the nearer useful mercenary camp instead of blindly using the first camp", () => {
    const scene = sketchScene("v2-nearest-mercenary-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("far-melee", 3300, 3200, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .mercenaryCamp("near-archer", 760, 760, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("v2", "footman", 760, 760)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 450;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "hire", campId: "near-archer" });
  });

  it("can hire a different mercenary role after already owning two melee mercenaries", () => {
    const scene = sketchScene("v2-diverse-mercenary-role")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540)
      .unit("v2", "mercenary", 650, 640)
      .unit("v2", "mercenary", 690, 660)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("field-medic-camp", 780, 760, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .unit("v2", "footman", 780, 760)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 450;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "hire", campId: "field-medic-camp" });
  });

  it("buys a combat mercenary before the first healer so camp control becomes fighting power", () => {
    const scene = sketchScene("first-mercenary-is-combat")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "moonWell", 500, 680)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 760, 720, { hp: 55 })
      .unit("v2", "lancer", 800, 740)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("field-medic-camp", 780, 760, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .mercenaryCamp("contract-archer-camp", 830, 780, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 900;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "hire");

    expect(command).toMatchObject({ type: "hire", campId: "contract-archer-camp" });
  });

  it("v2 clears a guarded mercenary camp before trying to hire from it", () => {
    const scene = sketchScene("v2-clear-guarded-merc-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 760, 720)
      .unit("v2", "footman", 790, 750)
      .unit("v2", "lancer", 820, 720)
      .unit("v2", "archer", 850, 750)
      .unit("v2", "archer", 880, 720)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("guarded-contract-archers", 980, 860, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "stonebackBrute", 950, 850)
      .unit("neutral", "thornSlinger", 1010, 890)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 250;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "hire")).toBe(false);
    expect(commands.find((command) => command.type === "attackMove")).toMatchObject({ type: "attackMove", x: 980, y: 860 });
  });

  it("v2 takes a slightly farther guarded mercenary objective with a five-unit squad when the fight is favorable", () => {
    const scene = sketchScene("v2-earlier-far-merc-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 700, 700)
      .unit("v2", "lancer", 735, 730)
      .unit("v2", "archer", 770, 760)
      .unit("v2", "footman", 805, 790)
      .unit("v2", "archer", 840, 820)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("far-but-winnable-medic-camp", 1500, 1120, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 1460, 1100)
      .unit("neutral", "thornSlinger", 1530, 1140)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1500, y: 1120 });
  });

  it("v2 counts neutral assist-linked guards as one camp before choosing a creep objective", () => {
    const scene = sketchScene("v2-counts-neutral-assist-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 700, 700)
      .unit("v2", "lancer", 735, 730)
      .unit("v2", "archer", 770, 760)
      .townHall("v1", 3300, 3300)
      .unit("neutral", "ancientStag", 1120, 960)
      .unit("neutral", "ancientStag", 1460, 960)
      .unit("neutral", "ancientStag", 1800, 960)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 does not bleed a three-unit squad into medium guarded objectives while facing two economies", () => {
    const scene = sketchScene("v2-avoids-greedy-1v2-medium-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 700, 700)
      .unit("v2", "lancer", 735, 730)
      .unit("v2", "archer", 770, 760)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .mercenaryCamp("medium-field-camp", 1260, 1550, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "stonebackBrute", 1220, 1530)
      .unit("neutral", "barkMender", 1300, 1570)
      .unit("neutral", "wildling", 1260, 1500)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 objective control does not trickle a lone stale unit into a camp while the squad is split", () => {
    const scene = sketchScene("v2-objective-control-no-trickle")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 700, 700, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "lancer", 735, 730, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "archer", 770, 760, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "footman", 805, 790, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "archer", 840, 820)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .mercenaryCamp("medium-field-camp", 1260, 1550, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "stonebackBrute", 1220, 1530)
      .unit("neutral", "barkMender", 1300, 1570)
      .unit("neutral", "wildling", 1260, 1500)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 clears nearby non-mercenary treasure camps instead of ignoring objective rewards", () => {
    const scene = sketchScene("v2-green-treasure-camp")
      .map("campRush")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 720, 720)
      .unit("v2", "lancer", 750, 750)
      .unit("v2", "archer", 780, 720)
      .unit("v2", "footman", 810, 750)
      .unit("v2", "archer", 840, 720)
      .townHall("v1", 3300, 3300)
      .unit("neutral", "wildling", 1040, 980, { id: "book-guard-a" })
      .unit("neutral", "thornSlinger", 1090, 1015, { id: "book-guard-b" })
      .item("nearby-xp-book", "experienceBook", 0, 0, { carrierId: "book-guard-b" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    if (command?.type !== "attackMove") throw new Error("expected treasure-camp attackMove");
    expect(command.x).toBeCloseTo(1065, -1);
    expect(command.y).toBeCloseTo(998, -1);
    expect(command.unitIds.length).toBe(5);
  });

  it("records a creep claim when assigning a squad to a neutral treasure camp", () => {
    const scene = sketchScene("v2-green-treasure-camp-claim")
      .map("campRush")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 720, 720, { id: "creep-footman" })
      .unit("v2", "lancer", 750, 750, { id: "creep-lancer" })
      .unit("v2", "archer", 780, 720, { id: "creep-archer" })
      .unit("v2", "footman", 810, 750, { id: "creep-footman-b" })
      .unit("v2", "archer", 840, 720, { id: "creep-archer-b" })
      .townHall("v1", 3300, 3300)
      .unit("neutral", "wildling", 1040, 980, { id: "book-guard-a" })
      .unit("neutral", "thornSlinger", 1090, 1015, { id: "book-guard-b" })
      .item("nearby-xp-book", "experienceBook", 0, 0, { carrierId: "book-guard-b" })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory });
    const command = entries.find((entry) => entry.scriptId === "objectiveControl" && entry.command.type === "attackMove")?.command;

    if (!command || command.type !== "attackMove") throw new Error("missing neutral camp assignment");
    expect(Object.keys(memory.unitClaims).sort()).toEqual([...command.unitIds].sort());
    expect(memory.unitClaims["creep-footman"]).toMatchObject({ kind: "creep", targetId: "book-guard-a", sinceTick: 0 });
  });

  it("v5 prefers a slightly farther experience-book camp over a nearer combat trinket", () => {
    const scene = sketchScene("v5-book-camp-priority")
      .map("campRush")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .unit("v5", "footman", 900, 700)
      .unit("v5", "lancer", 930, 730)
      .unit("v5", "archer", 960, 700)
      .unit("v5", "footman", 990, 730)
      .unit("v5", "archer", 1_020, 700)
      .townHall("v3", 3300, 3300)
      .townHall("v4", 3400, 3300)
      .unit("neutral", "wildling", 1_100, 720, { id: "storm-guard-a" })
      .unit("neutral", "thornSlinger", 1_140, 760, { id: "storm-guard-b" })
      .item("nearby-storm", "stormStaff", 0, 0, { carrierId: "storm-guard-b" })
      .unit("neutral", "wildling", 1_510, 720, { id: "book-guard-a" })
      .unit("neutral", "thornSlinger", 1_550, 760, { id: "book-guard-b" })
      .item("farther-book", "experienceBook", 0, 0, { carrierId: "book-guard-b" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.objectiveControl], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    if (command?.type !== "attackMove") throw new Error("expected book-camp attackMove");
    expect(command.x).toBeCloseTo(1_530, -1);
    expect(command.y).toBeCloseTo(740, -1);
  });

  it("v2 feeds experience books to a unit near a star breakpoint instead of a capped veteran", () => {
    const scene = sketchScene("v2-xp-book-breakpoint-carrier")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "knight", 760, 740, { id: "capped-knight" })
      .unit("v2", "contractArcher", 790, 760, { id: "near-breakpoint-archer" })
      .item("xp-book", "experienceBook", 780, 750)
      .townHall("v1", 3000, 3000)
      .build();
    const game = scene.createGame();
    const capped = game.units.find((unit) => unit.id === "capped-knight");
    const nearBreakpoint = game.units.find((unit) => unit.id === "near-breakpoint-archer");
    if (!capped || !nearBreakpoint) throw new Error("expected scene units");
    capped.level = 3;
    capped.xp = 360;
    nearBreakpoint.level = 1;
    nearBreakpoint.xp = 120;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.items], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "pickupItem",
    );

    expect(command).toMatchObject({ type: "pickupItem", unitId: "near-breakpoint-archer", itemId: "xp-book" });
  });

  it("v2 denies an exposed enemy expansion before routine pressure on a nearer production building", () => {
    const scene = sketchScene("v2-denies-exposed-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .unit("v2", "footman", 1500, 1500)
      .unit("v2", "footman", 1540, 1500)
      .unit("v2", "lancer", 1500, 1540)
      .unit("v2", "archer", 1540, 1540)
      .unit("v2", "archer", 1580, 1520)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .building("v1b", "barracks", 1780, 1520, { id: "nearer-decoy-barracks" })
      .unit("v1b", "footman", 1760, 1580)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toMatchObject({ type: "attackMove", x: 2200, y: 1750 });
  });

  it("v2 does not recruit retreat-claimed soldiers for cross-map expansion denial", () => {
    const scene = sketchScene("v2-expansion-denial-respects-retreat-claims")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .unit("v2", "footman", 1500, 1500, { id: "retreat-footman-a", order: { type: "move", x: 500, y: 500 } })
      .unit("v2", "footman", 1540, 1500, { id: "retreat-footman-b", order: { type: "move", x: 500, y: 500 } })
      .unit("v2", "lancer", 1500, 1540, { id: "retreat-lancer", order: { type: "move", x: 500, y: 500 } })
      .unit("v2", "archer", 1540, 1540, { id: "retreat-archer-a", order: { type: "move", x: 500, y: 500 } })
      .unit("v2", "archer", 1580, 1520, { id: "retreat-archer-b", order: { type: "move", x: 500, y: 500 } })
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["retreat-footman-a", "retreat-footman-b", "retreat-lancer", "retreat-archer-a", "retreat-archer-b"]) {
      memory.unitClaims[unitId] = { kind: "retreat", targetId: "retreat", x: 500, y: 500, sinceTick: 0, expiresTick: 900 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams, memory }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 preset denies a one-on-one enemy expansion before taking another neutral camp", () => {
    const scene = sketchScene("v2-1v1-denies-expansion-before-creep")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 2048, { id: "v2-main" })
      .townHall("v2", 720, 2540, { id: "v2-natural" })
      .unit("v2", "footman", 2100, 1020)
      .unit("v2", "footman", 2140, 1040)
      .unit("v2", "lancer", 2180, 1060)
      .unit("v2", "lancer", 2220, 1080)
      .unit("v2", "archer", 2260, 1100)
      .unit("v2", "archer", 2300, 1120)
      .unit("v2", "fieldMedic", 2340, 1140)
      .townHall("v1", 3400, 2048, { id: "v1-main" })
      .building("v1", "barracks", 3260, 1960, { id: "v1-barracks" })
      .building("v1", "townHall", 3376, 2680, { id: "v1-greedy-expansion", complete: false })
      .worker("v1", 3340, 2640)
      .worker("v1", 3400, 2720)
      .unit("neutral", "wildling", 2800, 760, { id: "north-camp-a" })
      .unit("neutral", "thornSlinger", 2840, 790, { id: "north-camp-b" })
      .build();
    const game = scene.createGame();

    const entries = planPresetAiCommandEntries(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "expansionDenial")).toMatchObject({
      command: { type: "attackMove", x: 3376, y: 2680 },
    });
    expect(entries.find((entry) => entry.scriptId === "objectiveControl")).toBeUndefined();
  });

  it("v2 does not deny an exposed expansion when the route is covered by a much stronger combined army", () => {
    const scene = sketchScene("v2-skips-covered-expansion-denial")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .unit("v2", "footman", 1500, 1500)
      .unit("v2", "footman", 1540, 1500)
      .unit("v2", "lancer", 1500, 1540)
      .unit("v2", "archer", 1540, 1540)
      .unit("v2", "archer", 1580, 1520)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .unit("v1a", "footman", 1580, 1220)
      .unit("v1a", "footman", 1620, 1260)
      .unit("v1a", "lancer", 1660, 1300)
      .unit("v1a", "archer", 1700, 1340)
      .unit("v1a", "archer", 1740, 1380)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .unit("v1b", "footman", 1600, 1820)
      .unit("v1b", "footman", 1640, 1860)
      .unit("v1b", "lancer", 1680, 1900)
      .unit("v1b", "raider", 1720, 1940)
      .unit("v1b", "archer", 1760, 1980)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 does not deny an exposed expansion while a different 1v2 army is already stronger in the field", () => {
    const scene = sketchScene("v2-skips-denial-while-other-army-stronger")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .unit("v2", "footman", 1500, 1500)
      .unit("v2", "footman", 1540, 1500)
      .unit("v2", "lancer", 1500, 1540)
      .unit("v2", "archer", 1540, 1540)
      .unit("v2", "archer", 1580, 1520)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .building("v1a", "townHall", 2300, 1850, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2260, 1820)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .unit("v1b", "footman", 2600, 3200)
      .unit("v1b", "footman", 2640, 3220)
      .unit("v1b", "footman", 2680, 3240)
      .unit("v1b", "lancer", 2720, 3260)
      .unit("v1b", "lancer", 2760, 3280)
      .unit("v1b", "archer", 2800, 3300)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 does not use the 1v2 expansion-denial primitive in a one-on-three game", () => {
    const scene = sketchScene("v2-no-1v2-denial-primitive-in-1v3")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .player("v1c", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1500, 1500)
      .unit("v2", "footman", 1540, 1500)
      .unit("v2", "lancer", 1500, 1540)
      .unit("v2", "archer", 1540, 1540)
      .unit("v2", "archer", 1580, 1520)
      .townHall("v1a", 3300, 3300)
      .building("v1a", "townHall", 2300, 1850, { complete: false })
      .townHall("v1b", 3400, 3800)
      .townHall("v1c", 3600, 3000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 does not dive an enemy expansion pocket controlled by combined local armies", () => {
    const scene = sketchScene("v2-skips-locally-controlled-expansion-pocket")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .unit("v2", "footman", 1450, 1450)
      .unit("v2", "footman", 1490, 1470)
      .unit("v2", "footman", 1530, 1490)
      .unit("v2", "lancer", 1570, 1510)
      .unit("v2", "lancer", 1610, 1530)
      .unit("v2", "archer", 1650, 1550)
      .unit("v2", "archer", 1690, 1570)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .building("v1b", "townHall", 2600, 1760, { id: "v1b-pocket-expansion" })
      .worker("v1b", 2570, 1760)
      .worker("v1b", 2630, 1760)
      .unit("v1a", "archer", 2520, 980)
      .unit("v1a", "contractArcher", 2580, 960)
      .unit("v1a", "fieldMedic", 2640, 980)
      .unit("v1b", "footman", 2700, 1000)
      .unit("v1b", "footman", 2760, 1040)
      .unit("v1b", "lancer", 2820, 1080)
      .unit("v1b", "mercenary", 2880, 1120)
      .unit("v1b", "archer", 2760, 1180)
      .unit("v1a", "footman", 2460, 1080)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 keeps its main army on its own guarded natural before chasing enemy expansion denial", () => {
    const scene = sketchScene("v2-own-natural-before-denial")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .goldMine("v2-natural", 820, 1120, 6000)
      .unit("v2", "footman", 1500, 1500)
      .unit("v2", "footman", 1540, 1500)
      .unit("v2", "lancer", 1500, 1540)
      .unit("v2", "archer", 1540, 1540)
      .unit("v2", "archer", 1580, 1520)
      .unit("neutral", "stonebackBrute", 820, 1120)
      .unit("neutral", "thornSlinger", 860, 1160)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 does not chase enemy expansion denial before claiming its own clear natural", () => {
    const scene = sketchScene("v2-own-clear-natural-before-denial")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .goldMine("v2-natural", 820, 1120, 6000)
      .unit("v2", "footman", 1500, 1500)
      .unit("v2", "footman", 1540, 1500)
      .unit("v2", "lancer", 1500, 1540)
      .unit("v2", "archer", 1540, 1540)
      .unit("v2", "archer", 1580, 1520)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionDenial], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 objective control does not pull a committed expansion-denial squad back into creeps", () => {
    const scene = sketchScene("v2-objective-control-yields-to-expansion-denial")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1500, 1500, { order: { type: "attackMove", x: 2200, y: 1750 } })
      .unit("v2", "footman", 1540, 1500, { order: { type: "attackMove", x: 2200, y: 1750 } })
      .unit("v2", "lancer", 1500, 1540, { order: { type: "attackMove", x: 2200, y: 1750 } })
      .unit("v2", "archer", 1540, 1540, { order: { type: "attackMove", x: 2200, y: 1750 } })
      .unit("v2", "archer", 1580, 1520, { order: { type: "attackMove", x: 2200, y: 1750 } })
      .townHall("v1a", 3300, 3300)
      .building("v1a", "townHall", 2200, 1750, { id: "v1a-greedy-expansion", complete: false })
      .worker("v1a", 2140, 1720)
      .worker("v1a", 2180, 1800)
      .townHall("v1b", 3400, 3800)
      .unit("neutral", "stonebackBrute", 1260, 1550)
      .unit("neutral", "thornSlinger", 1300, 1580)
      .unit("neutral", "barkMender", 1230, 1520)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v1 waits on the same farther guarded mercenary objective until it has a fuller squad", () => {
    const scene = sketchScene("v1-waits-far-merc-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v1", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("v1", 500, 500)
      .unit("v1", "footman", 700, 700)
      .unit("v1", "lancer", 735, 730)
      .unit("v1", "archer", 770, 760)
      .unit("v1", "footman", 805, 790)
      .townHall("target", 3300, 3300)
      .mercenaryCamp("far-but-winnable-medic-camp", 1500, 1120, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 1460, 1100)
      .unit("neutral", "thornSlinger", 1530, 1140)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v1", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v1", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 hires from a cleared mercenary camp after the guards are gone", () => {
    const scene = sketchScene("v2-hire-cleared-merc-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 760, 720)
      .unit("v2", "lancer", 820, 720)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-contract-archers", 980, 860, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("v2", "footman", 980, 860)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 250;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "hire", campId: "cleared-contract-archers" });
  });

  it("v2 does not preclaim a cleared mercenary camp while the first natural still needs clearing", () => {
    const scene = sketchScene("v2-natural-before-merc-preclaim")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .goldMine("v2-main-mine", 570, 500, 6000)
      .goldMine("v2-natural-mine", 980, 860, 6000)
      .unit("v2", "footman", 1000, 720, { order: { type: "attackMove", x: 700, y: 760 } })
      .unit("v2", "lancer", 1040, 760, { order: { type: "attackMove", x: 980, y: 860 } })
      .unit("v2", "archer", 1080, 720, { order: { type: "attackMove", x: 980, y: 860 } })
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-contract-archers", 700, 760, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "stonebackBrute", 970, 850)
      .unit("neutral", "thornSlinger", 1010, 890)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 0;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 turns a controlled cleared mercenary objective into fighting power after the first expansion is secured", () => {
    const scene = sketchScene("v2-hire-controlled-camp-before-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 980, 860, { id: "v2-natural-townhall" })
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 950, 850)
      .unit("v2", "lancer", 990, 880)
      .unit("v2", "archer", 1020, 850)
      .unit("v2", "archer", 1040, 880)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 980, 860, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .mercenaryCamp("cleared-contract-archers", 980, 860, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 200;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "hire", campId: "cleared-contract-archers" });
  });

  it("v2 does not spend ready first-expansion town-hall gold on a controlled combat mercenary", () => {
    const scene = sketchScene("v2-controlled-merc-does-not-steal-ready-natural")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 960, 850)
      .unit("v2", "lancer", 1000, 880)
      .unit("v2", "archer", 1040, 850)
      .unit("v2", "contractArcher", 980, 860)
      .townHall("v1", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 980, 860, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .mercenaryCamp("cleared-contract-archers", 980, 860, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = BUILDING_DEFS.townHall.cost;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "hire",
    );

    expect(command).toBeUndefined();
  });

  it("does not hire from a cleared mercenary camp until a friendly unit reaches it", () => {
    const scene = sketchScene("v2-no-remote-merc-hire")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 700, 700)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("distant-cleared-camp", 1400, 1200, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "hire");

    expect(command).toBeUndefined();
  });

  it("moves a squad to a cleared mercenary camp before hiring from it", () => {
    const scene = sketchScene("v2-move-to-cleared-merc-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 700, 700)
      .unit("v2", "lancer", 735, 730)
      .unit("v2", "archer", 770, 760)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1180, y: 980 });
  });

  it("v2 pre-claims a cleared mercenary camp with a small squad instead of one unit or the whole army", () => {
    const scene = sketchScene("v2-mercenary-claim-small-team")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 880, 740, { id: "near-claimant" })
      .unit("v2", "lancer", 735, 730, { id: "main-army-a" })
      .unit("v2", "archer", 770, 760, { id: "main-army-b" })
      .unit("v2", "footman", 805, 790, { id: "main-army-c" })
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-melee-camp", 1600, 1200, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", unitIds: ["near-claimant", "main-army-c", "main-army-b"], x: 1600, y: 1200 });
  });

  it("does not break a local mercenary route to chase a stronger distant army target", () => {
    const scene = sketchScene("v2-no-far-strong-army-chase")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1260, 1550, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "footman", 1290, 1570, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "lancer", 1320, 1590, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "contractArcher", 1240, 1580, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .unit("v2", "contractArcher", 1270, 1610, { order: { type: "attackMove", x: 1260, y: 1550 } })
      .mercenaryCamp("local-field-tent", 1260, 1550, { hireKind: "fieldMedic", cost: 155, stock: 2, cooldownRemaining: 0 })
      .townHall("v1", 3400, 2048)
      .unit("v1", "footman", 2920, 1940)
      .unit("v1", "footman", 2960, 1960)
      .unit("v1", "lancer", 2940, 2000)
      .unit("v1", "contractArcher", 2990, 1900, { id: "bait-archer" })
      .unit("v1", "contractArcher", 3010, 1940)
      .unit("v1", "contractArcher", 2970, 1980)
      .build();
    const game = scene.createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "attack")).toBe(false);
  });

  it("records a mercenary unit claim when sending a squad to a cleared camp", () => {
    const scene = sketchScene("v2-mercenary-claim-memory")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 700, 700, { id: "claim-footman" })
      .unit("v2", "lancer", 735, 730, { id: "claim-lancer" })
      .unit("v2", "archer", 770, 760, { id: "claim-archer" })
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;
    const memory = createAiPolicyMemory();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams, memory });
    const command = entries.find((entry) => entry.command.type === "attackMove")?.command;
    if (!command || command.type !== "attackMove") throw new Error("missing mercenary attackMove");

    expect(Object.keys(memory.unitClaims).sort()).toEqual([...command.unitIds].sort());
    expect(memory.unitClaims[command.unitIds[0]!]).toMatchObject({ kind: "mercenary", targetId: "cleared-melee-camp", x: 1180, y: 980, sinceTick: 0 });
  });

  it("records retreat claims so mercenary claims do not pull recovering units back out", () => {
    const scene = sketchScene("v2-retreat-memory-blocks-mercenary-reclaim")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "townHall", 980, 860, { id: "v2-natural-townhall" })
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 900, 760, { id: "retreat-footman", hp: 28 })
      .unit("v2", "lancer", 940, 790, { id: "retreat-lancer", hp: 35 })
      .unit("v1", "footman", 980, 800, { id: "pressure-footman" })
      .unit("v1", "lancer", 1020, 830, { id: "pressure-lancer" })
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-melee-camp", 1260, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;
    const memory = createAiPolicyMemory();

    const retreatEntries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, memory });
    const retreat = retreatEntries.find((entry) => entry.command.type === "move")?.command;
    if (!retreat || retreat.type !== "move") throw new Error("missing retreat move");

    expect(Object.fromEntries(Object.entries(memory.unitClaims).map(([unitId, claim]) => [unitId, claim.kind]))).toEqual({
      "retreat-footman": "retreat",
      "retreat-lancer": "retreat",
    });

    const mercenary = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "attackMove");

    expect(mercenary).toBeUndefined();
  });

  it("v2 still moves to claim a cleared mercenary camp before it has hire gold", () => {
    const scene = sketchScene("v2-claim-merc-camp-before-expansion-spend")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 720, 720)
      .unit("v2", "footman", 760, 740)
      .unit("v2", "lancer", 800, 760)
      .unit("v2", "archer", 840, 780)
      .townHall("v1", 3300, 3300)
      .goldMine("v2-natural", 1180, 980, 4000)
      .mercenaryCamp("cleared-contract-archers", 1300, 980, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;
    for (let index = 0; index < 10; index += 1) game.spawnUnit("v1", "worker", 3300 + index * 8, 3360);

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1300, y: 980 });
  });

  it("v2 yields late mercenary movement when idle core production has a training backlog", () => {
    const scene = sketchScene("v2-mercenary-move-yields-to-training-backlog")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "townHall", 980, 860, { id: "v2-natural-townhall" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .unit("v2", "footman", 720, 720, { id: "claim-footman" })
      .unit("v2", "footman", 760, 740, { id: "claim-footman-2" })
      .unit("v2", "lancer", 800, 760, { id: "claim-lancer" })
      .unit("v2", "lancer", 840, 790)
      .unit("v2", "archer", 880, 820)
      .unit("v2", "archer", 920, 850)
      .unit("v2", "footman", 960, 880)
      .unit("v2", "lancer", 1000, 910)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-contract-archers", 1300, 980, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 500;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary, AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(entries.some((entry) => entry.scriptId === "mercenary")).toBe(false);
    expect(entries).toContainEqual(expect.objectContaining({ scriptId: "training", command: expect.objectContaining({ type: "train" }) }));
  });

  it("v2 preserves early training gold for a controlled field medic camp with wounded fighters", () => {
    const scene = sketchScene("v2-controlled-field-medic-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 920, 760)
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 760, 620)
      .building("v2", "farm", 560, 700)
      .building("v2", "moonWell", 680, 700)
      .unit("v2", "footman", 1180, 980, { hp: 52 })
      .unit("v2", "lancer", 1210, 1000, { hp: 60 })
      .unit("v2", "archer", 1240, 980)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural", 920, 760, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .mercenaryCamp("controlled-field-medic", 1200, 980, { hireKind: "fieldMedic", cost: UNIT_DEFS.fieldMedic.cost, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    for (let index = 0; index < 10; index += 1) game.spawnUnit("v2", "worker", 500 + index * 12, 540);
    game.players.v2!.gold = UNIT_DEFS.footman.cost;
    game.players.v2!.supplyUsed = 21;
    game.players.v2!.supplyCap = 38;

    const economyCommand = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "train" || candidate.type === "build" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(economyCommand).toBeUndefined();
  });

  it("v2 spends a controlled field medic bank on training when the visible enemy army is larger", () => {
    const scene = sketchScene("v2-field-medic-bank-yields-to-army-deficit")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 920, 760)
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 760, 620)
      .building("v2", "farm", 560, 700)
      .building("v2", "moonWell", 680, 700)
      .unit("v2", "footman", 1180, 980, { hp: 52 })
      .unit("v2", "lancer", 1210, 1000, { hp: 60 })
      .unit("v2", "archer", 1240, 980)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 3000, 3000)
      .unit("v1a", "footman", 3040, 3020)
      .unit("v1a", "lancer", 3080, 3040)
      .unit("v1a", "archer", 3120, 3060)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural", 920, 760, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .mercenaryCamp("controlled-field-medic", 1200, 980, { hireKind: "fieldMedic", cost: UNIT_DEFS.fieldMedic.cost, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    for (let index = 0; index < 10; index += 1) game.spawnUnit("v2", "worker", 500 + index * 12, 540);
    game.players.v2!.gold = UNIT_DEFS.footman.cost;
    game.players.v2!.supplyUsed = 21;
    game.players.v2!.supplyCap = 38;

    const trainingCommand = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(trainingCommand).toMatchObject({ type: "train", unitKind: "footman" });
  });

  it("v2 spends an unaffordable main guard tower bank on training when the visible enemy army is larger", () => {
    const scene = sketchScene("v2-tower-bank-yields-to-army-deficit")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 920, 760)
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 760, 620)
      .building("v2", "farm", 560, 700)
      .building("v2", "moonWell", 680, 700)
      .unit("v2", "footman", 1180, 980, { hp: 52 })
      .unit("v2", "lancer", 1210, 1000, { hp: 60 })
      .unit("v2", "archer", 1240, 980)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1800, 1600)
      .unit("v1a", "footman", 1840, 1620)
      .unit("v1a", "lancer", 1880, 1640)
      .unit("v1a", "archer", 1920, 1660)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural", 920, 760, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    for (let index = 0; index < 10; index += 1) game.spawnUnit("v2", "worker", 500 + index * 12, 540);
    game.players.v2!.gold = UNIT_DEFS.footman.cost + 20;
    game.players.v2!.supplyUsed = 21;
    game.players.v2!.supplyCap = 38;

    const trainingCommand = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "train");

    expect(trainingCommand).toMatchObject({ type: "train", unitKind: "footman" });
  });

  it("v2 reserves near-hire gold once a squad controls a cleared combat mercenary camp", () => {
    const scene = sketchScene("v2-controlled-merc-camp-reserve")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 520)
      .worker("v2", 560, 500)
      .worker("v2", 580, 520)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1290, 980)
      .unit("v2", "footman", 1320, 1000)
      .unit("v2", "lancer", 1300, 960)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("controlled-contract-archers", 1300, 980, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 140;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.tech, AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("keeps V5's first cleared expansion bank ahead of controlled combat mercenary hires", () => {
    const scene = sketchScene("v5-cleared-natural-before-controlled-merc")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "emberForge", 620, 620)
      .building("v5", "cinderSpire", 700, 560)
      .building("v5", "farm", 560, 700)
      .building("v5", "farm", 610, 735)
      .worker("v5", 520, 540)
      .worker("v5", 540, 520)
      .unit("v5", "emberRavager", 1290, 980)
      .unit("v5", "cinderRunner", 1320, 1000)
      .unit("v5", "sparkArcher", 1300, 960)
      .townHall("v3", 3300, 3300)
      .townHall("v4-tr", 3400, 3800)
      .goldMine("v5-main", 560, 540, 4000)
      .goldMine("v5-natural", 1_080, 860, 4000)
      .goldMine("v3-main", 3340, 3300, 4000)
      .goldMine("v4-main", 3440, 3800, 4000)
      .mercenaryCamp("controlled-contract-archers", 1300, 980, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = 220;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.mercenary], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    })[0];

    expect(command).toBeUndefined();
  });

  it("lets V5 punish a locally exposed 1v2 expansion despite the other opponent's larger field army", () => {
    const scene = sketchScene("v5-punish-exposed-expansion-before-global-stopline")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 680)
      .unit("v5", "emberRavager", 1_280, 1_060)
      .unit("v5", "cinderRunner", 1_310, 1_080)
      .unit("v5", "sparkArcher", 1_340, 1_060)
      .unit("v5", "emberRavager", 1_370, 1_080)
      .unit("v5", "cinderRunner", 1_400, 1_060)
      .townHall("v4-tr", 3_300, 1_000)
      .townHall("v4-tr", 1_760, 1_120, { id: "exposed-expansion" })
      .worker("v4-tr", 1_790, 1_140)
      .townHall("v3", 3_300, 3_100)
      .unit("v3", "footman", 3_050, 3_050)
      .unit("v3", "footman", 3_090, 3_080)
      .unit("v3", "lancer", 3_130, 3_110)
      .unit("v3", "archer", 3_170, 3_140)
      .unit("v3", "raider", 3_210, 3_170)
      .unit("v3", "knight", 3_250, 3_200)
      .goldMine("v5-main", 560, 540, 4000)
      .goldMine("v5-natural", 940, 720, 4000)
      .goldMine("exposed-mine", 1_820, 1_160, 4000)
      .goldMine("v4-main", 3_340, 1_000, 4000)
      .goldMine("v3-main", 3_340, 3_100, 4000)
      .build()
      .createGame();

    const command = planAiCommandsFromScripts(snapshotGame(scene), "v5", [AI_SCRIPT_LIBRARY.expansionDenial], {
      version: "v2",
      requestedVersion: "v5",
      teams: scene.teams,
    })[0];

    expect(command).toMatchObject({ type: "attackMove" });
  });

  it("v2 reserves near-hire gold for a controlled combat mercenary before starting a main guard tower", () => {
    const scene = sketchScene("v2-controlled-merc-before-guard-tower")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .worker("v2", 520, 540)
      .worker("v2", 540, 520)
      .unit("v2", "footman", 1290, 980)
      .unit("v2", "lancer", 1320, 1000)
      .unit("v1", "footman", 880, 620)
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("controlled-contract-archers", 1300, 980, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 140;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.defense], { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("v2 sends four early idle fighters to a nearby winnable objective instead of waiting for five", () => {
    const scene = sketchScene("v2-four-fighter-early-objective")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 720, 720)
      .unit("v2", "footman", 760, 740)
      .unit("v2", "footman", 800, 760)
      .unit("v2", "lancer", 840, 780)
      .unit("neutral", "wildling", 1160, 980)
      .unit("neutral", "mossGnawer", 1190, 1010)
      .mercenaryCamp("near-bow-post", 1180, 980, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .townHall("v1", 3300, 3300)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1180, y: 980 });
  });

  it("v2 does not pre-claim an enemy-side mercenary camp with a small squad before securing its first expansion", () => {
    const scene = sketchScene("v2-no-enemy-side-merc-preclaim-before-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 1260, 980)
      .unit("v2", "footman", 1300, 1010)
      .unit("v2", "lancer", 1340, 1040)
      .unit("v2", "archer", 1380, 1070)
      .townHall("v1", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural", 1180, 980, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .mercenaryCamp("enemy-side-contract-post", 3000, 1900, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 does not pre-claim an enemy-side mercenary camp with a larger army before securing its first expansion", () => {
    const scene = sketchScene("v2-no-enemy-side-merc-preclaim-even-with-army")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 1260, 980)
      .unit("v2", "footman", 1300, 1010)
      .unit("v2", "lancer", 1340, 1040)
      .unit("v2", "lancer", 1380, 1070)
      .unit("v2", "archer", 1420, 1100)
      .unit("v2", "archer", 1460, 1130)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 3100, 3040)
      .unit("v1", "lancer", 3140, 3080)
      .unit("v1", "archer", 3180, 3120)
      .unit("v1", "footman", 3220, 3160)
      .unit("v1", "archer", 3260, 3200)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural", 1180, 980, 4000)
      .goldMine("v1-main-mine", 3340, 3300, 4000)
      .mercenaryCamp("enemy-side-contract-post", 3000, 1900, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 does not detour to a cleared mercenary camp before hire gold while facing two opponents", () => {
    const scene = sketchScene("v2-no-free-merc-detour-while-outnumbered")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 720, 720)
      .unit("v2", "footman", 760, 740)
      .unit("v2", "lancer", 800, 760)
      .unit("v2", "archer", 840, 780)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3700)
      .goldMine("v2-natural", 1180, 980, 4000)
      .mercenaryCamp("cleared-contract-archers", 1300, 980, { hireKind: "contractArcher", cost: 145, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("keeps a mercenary-camp claim active while the squad is already walking there", () => {
    const scene = sketchScene("v2-keep-merc-claim-active")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 760, 700, { order: { type: "attackMove", x: 1180, y: 980 } })
      .unit("v2", "lancer", 790, 730, { order: { type: "attackMove", x: 1180, y: 980 } })
      .unit("v2", "archer", 820, 760, { order: { type: "attackMove", x: 1180, y: 980 } })
      .townHall("v1", 3300, 3300)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1180, y: 980 });
  });

  it("keeps mercenary claims alive across the next economy decision interval", () => {
    const scene = sketchScene("v2-merc-claim-survives-next-decision")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 760, 700, { id: "claim-a" })
      .unit("v2", "lancer", 790, 730, { id: "claim-b" })
      .unit("v2", "archer", 820, 760, { id: "claim-c" })
      .townHall("v1", 3300, 3300)
      .unit("neutral", "mossGnawer", 900, 1120, { id: "distracting-creep" })
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 80;
    const memory = createAiPolicyMemory();

    planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary], { version: "v2", teams: game.teams, memory });
    game.tick = 225;

    const objectiveCommand = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(Object.keys(memory.unitClaims).sort()).toEqual(["claim-a", "claim-b", "claim-c"]);
    expect(objectiveCommand).toBeUndefined();
  });

  it("v2 yields mercenary-camp movement to main-base defense under real pressure", () => {
    const scene = sketchScene("v2-main-pressure-yields-mercenary-move")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 680, 620, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 760, 740, { id: "defender-a" })
      .unit("v2", "footman", 790, 760, { id: "defender-b" })
      .unit("v2", "lancer", 820, 780, { id: "defender-c" })
      .unit("v2", "archer", 850, 800, { id: "defender-d" })
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .unit("v1a", "footman", 690, 620, { id: "attacker-a" })
      .unit("v1a", "lancer", 720, 650, { id: "attacker-b" })
      .unit("v1b", "raider", 735, 690, { id: "attacker-c" })
      .unit("v1b", "archer", 760, 680, { id: "attacker-d" })
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "mercenary")).toBeUndefined();
    expect(entries.find((entry) => entry.scriptId === "attackWave")).toMatchObject({ command: { type: "attack" } });
  });

  it("does not let a later attack wave steal units claimed by a previous mercenary task", () => {
    const scene = sketchScene("v2-attack-wave-respects-memory-claims")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1260, 980, { id: "claimed-a" })
      .unit("v2", "footman", 1300, 1010, { id: "claimed-b" })
      .unit("v2", "lancer", 1340, 1040, { id: "claimed-c" })
      .unit("v2", "lancer", 1380, 1070, { id: "claimed-d" })
      .unit("v2", "archer", 1420, 1100, { id: "claimed-e" })
      .unit("v2", "archer", 1460, 1130, { id: "claimed-f" })
      .unit("v2", "raider", 1500, 1160, { id: "claimed-g" })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3700)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["claimed-a", "claimed-b", "claimed-c", "claimed-d", "claimed-e", "claimed-f", "claimed-g"]) {
      memory.unitClaims[unitId] = { kind: "mercenary", targetId: "cleared-melee-camp", x: 1180, y: 980, sinceTick: 0, expiresTick: 900 };
    }

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory });

    expect(entries).toEqual([]);
  });

  it("releases mercenary claims after the squad has stopped at the cleared camp", () => {
    const scene = sketchScene("v2-mercenary-claim-completes-at-camp")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1160, 980, { id: "claimed-a" })
      .unit("v2", "footman", 1190, 1000, { id: "claimed-b" })
      .unit("v2", "lancer", 1220, 1020, { id: "claimed-c" })
      .unit("v2", "lancer", 1250, 1040, { id: "claimed-d" })
      .unit("v2", "archer", 1280, 1060, { id: "claimed-e" })
      .unit("v2", "archer", 1310, 1080, { id: "claimed-f" })
      .unit("v2", "raider", 1340, 1100, { id: "claimed-g" })
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3700)
      .mercenaryCamp("cleared-melee-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .build();
    const game = scene.createGame();
    game.tick = 420;
    const memory = createAiPolicyMemory();
    for (const unitId of ["claimed-a", "claimed-b", "claimed-c", "claimed-d", "claimed-e", "claimed-f", "claimed-g"]) {
      memory.unitClaims[unitId] = { kind: "mercenary", targetId: "cleared-melee-camp", x: 1180, y: 980, sinceTick: 0, expiresTick: 900 };
    }

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory });

    expect(entries.find((entry) => entry.scriptId === "attackWave")).toMatchObject({ command: { type: "attackMove" } });
  });

  it("keeps a committed attack wave from being tugged into neutral objective control", () => {
    const scene = sketchScene("v2-attack-wave-claim-blocks-creep-tug")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 980, 980, { id: "wave-a" })
      .unit("v2", "footman", 1010, 1000, { id: "wave-b" })
      .unit("v2", "lancer", 1040, 1020, { id: "wave-c" })
      .unit("v2", "archer", 1070, 1040, { id: "wave-d" })
      .unit("v2", "archer", 1100, 1060, { id: "wave-e" })
      .townHall("v1a", 1750, 980, { id: "v1a-main" })
      .building("v1a", "barracks", 1680, 960, { id: "v1a-barracks" })
      .unit("neutral", "wildling", 860, 900, { id: "camp-a" })
      .unit("neutral", "thornSlinger", 900, 940, { id: "camp-b" })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    const snapshot = snapshotGame(game);

    const firstWave = planAiCommandEntriesFromScripts(snapshot, "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory });
    const objective = planAiCommandEntriesFromScripts(snapshot, "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams, memory });
    const secondWave = planAiCommandEntriesFromScripts(snapshot, "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory });

    expect(firstWave.find((entry) => entry.scriptId === "attackWave")?.command).toMatchObject({ type: "attackMove" });
    expect(Object.fromEntries(Object.entries(memory.unitClaims).map(([unitId, claim]) => [unitId, claim.kind]))).toEqual({
      "wave-a": "attack",
      "wave-b": "attack",
      "wave-c": "attack",
      "wave-d": "attack",
      "wave-e": "attack",
    });
    expect(objective).toEqual([]);
    expect(secondWave.find((entry) => entry.scriptId === "attackWave")?.command).toMatchObject({ type: "attackMove" });
  });

  it("recalls a committed one-versus-two attack wave when the route is covered by the enemy army", () => {
    const scene = sketchScene("v2-committed-attack-wave-route-recall")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1a", 3100, 1450, { id: "v1a-main" })
      .building("v1a", "barracks", 3040, 1500)
      .townHall("v1b", 3500, 3300);
    const waveUnits = ["wave-a", "wave-b", "wave-c", "wave-d", "wave-e", "wave-f", "wave-g"] as const;
    waveUnits.forEach((id, index) => {
      scene.unit("v2", index % 3 === 0 ? "footman" : index % 3 === 1 ? "lancer" : "archer", 1760 + index * 34, 1230 + index * 18, {
        id,
        order: { type: "attackMove", x: 3100, y: 1450 },
      });
    });
    (["footman", "lancer", "archer", "contractArcher", "fieldMedic", "mercenary", "footman", "lancer", "contractArcher"] as const).forEach((kind, index) => {
      scene.unit("v1a", kind, 2160 + index * 28, 1300 + index * 20);
    });
    (["footman", "lancer", "archer", "contractArcher", "mercenary"] as const).forEach((kind, index) => {
      scene.unit("v1b", kind, 2300 + index * 30, 1370 + index * 24);
    });
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of waveUnits) {
      memory.unitClaims[unitId] = { kind: "attack", targetId: "v1a-main", x: 3100, y: 1450, sinceTick: 0, expiresTick: 900 };
    }

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ scriptId: "attackWave", command: { type: "move", unitIds: [...waveUnits], x: 500, y: 500 } });
    expect(Object.fromEntries(Object.entries(memory.unitClaims).map(([unitId, claim]) => [unitId, claim.kind]))).toEqual({
      "wave-a": "retreat",
      "wave-b": "retreat",
      "wave-c": "retreat",
      "wave-d": "retreat",
      "wave-e": "retreat",
      "wave-f": "retreat",
      "wave-g": "retreat",
    });
  });

  it("recalls a committed one-versus-two building attack when the route is covered by the enemy army", () => {
    const scene = sketchScene("v2-committed-building-attack-route-recall")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1a", 3100, 1450, { id: "v1a-main" })
      .building("v1a", "barracks", 3040, 1500, { id: "v1a-barracks" })
      .townHall("v1b", 3500, 3300, { id: "v1b-main" });
    const waveUnits = ["wave-a", "wave-b", "wave-c", "wave-d", "wave-e", "wave-f", "wave-g"] as const;
    waveUnits.forEach((id, index) => {
      scene.unit("v2", index % 3 === 0 ? "footman" : index % 3 === 1 ? "lancer" : "archer", 1760 + index * 34, 1230 + index * 18, {
        id,
        order: { type: "attack", targetId: "v1a-barracks" },
      });
    });
    (["footman", "lancer", "archer", "contractArcher", "fieldMedic", "mercenary", "footman", "lancer", "contractArcher"] as const).forEach((kind, index) => {
      scene.unit("v1a", kind, 2160 + index * 28, 1300 + index * 20);
    });
    (["footman", "lancer", "archer", "contractArcher", "mercenary"] as const).forEach((kind, index) => {
      scene.unit("v1b", kind, 2300 + index * 30, 1370 + index * 24);
    });
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of waveUnits) {
      memory.unitClaims[unitId] = { kind: "attack", targetId: "v1a-barracks", x: 3040, y: 1500, sinceTick: 0, expiresTick: 900 };
    }

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ scriptId: "attackWave", command: { type: "move", unitIds: [...waveUnits], x: 500, y: 500 } });
  });

  it("v2 idle rally defenders focus wounded attackers during outmatched expansion pressure", () => {
    const scene = sketchScene("v2-expansion-pressure-pickoff")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 760, 960, { id: "v2-natural" })
      .building("v2", "defenseTower", 840, 1040, { id: "v2-natural-tower" })
      .unit("v2", "footman", 500, 510, { id: "defender-a" })
      .unit("v2", "footman", 530, 520, { id: "defender-b" })
      .unit("v2", "lancer", 480, 530, { id: "defender-c" })
      .unit("v2", "archer", 520, 470, { id: "defender-d" })
      .townHall("v1a", 3100, 1450)
      .townHall("v1b", 3500, 3300);
    scene.unit("v1a", "lancer", 940, 1060, { id: "wounded-lancer", hp: 14, order: { type: "attackMove", x: 760, y: 960, targetId: "v2-natural-tower" } });
    scene.unit("v1a", "footman", 970, 1080, { id: "wounded-footman", hp: 38, order: { type: "attackMove", x: 760, y: 960 } });
    (["footman", "footman", "footman", "lancer", "archer", "archer", "mercenary"] as const).forEach((kind, index) => {
      scene.unit("v1a", kind, 980 + index * 26, 1010 + index * 18, { order: { type: "attackMove", x: 760, y: 960 } });
    });
    const game = scene.build().createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ scriptId: "attackWave", command: { type: "attack", targetId: "wounded-lancer" } });
  });

  it("retasks a committed building attack squad into a local cross-opponent army fight", () => {
    const scene = sketchScene("v2-committed-building-attack-local-fight")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 500, 520, { id: "home-a" })
      .unit("v2", "lancer", 540, 520, { id: "home-b" })
      .unit("v2", "archer", 580, 520, { id: "home-c" })
      .unit("v2", "footman", 620, 520, { id: "home-d" })
      .townHall("v1a", 3400, 2400)
      .townHall("v1b", 3500, 3300)
      .building("v1b", "barracks", 3380, 3160, { id: "v1b-barracks" });
    const waveUnits = ["wave-a", "wave-b", "wave-c", "wave-d", "wave-e"] as const;
    waveUnits.forEach((id, index) => {
      scene.unit("v2", index % 3 === 0 ? "footman" : index % 3 === 1 ? "lancer" : "archer", 3160 + index * 28, 3020 + index * 18, {
        id,
        order: { type: "attack", targetId: "v1b-barracks" },
      });
    });
    scene.unit("v1a", "lancer", 3260, 2940, { id: "wounded-lancer", hp: 32, order: { type: "attackMove", x: 3380, y: 3160 } });
    scene.unit("v1a", "footman", 3300, 2980, { order: { type: "attackMove", x: 3380, y: 3160 } });
    scene.unit("v1a", "archer", 3340, 3010, { order: { type: "attackMove", x: 3380, y: 3160 } });
    const game = scene.build().createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ scriptId: "attackWave", command: { type: "attack", unitIds: [...waveUnits], targetId: "wounded-lancer" } });
  });

  it("keeps a committed attack wave from being retasked into worker pressure", () => {
    const scene = sketchScene("v2-attack-wave-claim-blocks-worker-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 520, { id: "wave-a" })
      .unit("v2", "footman", 790, 550, { id: "wave-b" })
      .unit("v2", "lancer", 820, 580, { id: "wave-c" })
      .townHall("v1a", 1350, 520)
      .worker("v1a", 1290, 520, { id: "v1a-target-worker" })
      .worker("v1a", 1320, 560)
      .townHall("v1b", 3350, 3300)
      .worker("v1b", 3300, 3300)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 1260, 520, 3000)
      .goldMine("v1b-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["wave-a", "wave-b", "wave-c"]) {
      memory.unitClaims[unitId] = { kind: "attack", targetId: "v1a-main", x: 1350, y: 520, sinceTick: 0, expiresTick: 900 };
    }

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toBeUndefined();
  });

  it("lets worker pressure continue units already claimed for harassment", () => {
    const scene = sketchScene("v2-harass-claim-continues-worker-pressure")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 520, { id: "harass-a" })
      .unit("v2", "footman", 790, 550, { id: "harass-b" })
      .unit("v2", "lancer", 820, 580, { id: "harass-c" })
      .townHall("v1a", 1350, 520)
      .worker("v1a", 1290, 520, { id: "v1a-target-worker" })
      .worker("v1a", 1320, 560)
      .townHall("v1b", 3350, 3300)
      .worker("v1b", 3300, 3300)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 1260, 520, 3000)
      .goldMine("v1b-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["harass-a", "harass-b", "harass-c"]) {
      memory.unitClaims[unitId] = { kind: "harass", targetId: "v1a-target-worker", x: 1290, y: 520, sinceTick: 0, expiresTick: 900 };
    }

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "v1a-target-worker" } });
    expect(entry?.command.type === "attack" ? entry.command.unitIds : []).toEqual(["harass-a", "harass-b", "harass-c"]);
  });

  it("keeps a committed attack wave from being retasked into early harassment", () => {
    const scene = sketchScene("v2-attack-wave-claim-blocks-early-harass")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "ember" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "raider", 1220, 520, { id: "wave-a" })
      .unit("v2", "archer", 1240, 550, { id: "wave-b" })
      .townHall("v1", 1350, 520)
      .worker("v1", 1290, 520, { id: "v1-worker-a" })
      .worker("v1", 1320, 560)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["wave-a", "wave-b"]) {
      memory.unitClaims[unitId] = { kind: "attack", targetId: "v1-main", x: 1350, y: 520, sinceTick: 0, expiresTick: 900 };
    }

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toBeUndefined();
  });

  it("v2 pauses neutral objectives when two enemy armies are approaching the main before buildings are hit", () => {
    const scene = sketchScene("v2-pre-pressure-pauses-objectives")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620)
      .unit("v2", "footman", 820, 760)
      .unit("v2", "footman", 850, 790)
      .unit("v2", "lancer", 880, 820)
      .unit("v2", "archer", 910, 850)
      .unit("v2", "archer", 940, 880)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3400, 3800)
      .unit("v1a", "footman", 1540, 520)
      .unit("v1a", "lancer", 1580, 560)
      .unit("v1b", "footman", 1500, 650)
      .unit("v1b", "archer", 1560, 700)
      .mercenaryCamp("tempting-cleared-camp", 1180, 980, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 1120, 930)
      .unit("neutral", "thornSlinger", 1210, 1010)
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(entries.find((entry) => entry.scriptId === "objectiveControl")).toBeUndefined();
  });

  it("v2 pauses neutral objectives when a one-on-one army is already on the main approach", () => {
    const scene = sketchScene("v2-1v1-main-approach-pauses-objectives")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 610, 560)
      .unit("v2", "footman", 1680, 920)
      .unit("v2", "footman", 1710, 950)
      .unit("v2", "lancer", 1740, 980)
      .unit("v2", "lancer", 1770, 1010)
      .unit("v2", "archer", 1800, 1040)
      .townHall("v1", 3400, 3400)
      .unit("v1", "footman", 1500, 760)
      .unit("v1", "footman", 1530, 790)
      .unit("v1", "lancer", 1560, 820)
      .unit("v1", "lancer", 1590, 850)
      .unit("v1", "archer", 1620, 880)
      .unit("neutral", "wildling", 1960, 760, { id: "approach-camp-a" })
      .unit("neutral", "thornSlinger", 2010, 790, { id: "approach-camp-b" })
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams });

    expect(entries).toEqual([]);
  });

  it("v2 recalls objective-claimed fighters when a one-on-one army crosses the main approach", () => {
    const scene = sketchScene("v2-1v1-main-approach-recalls-objective-claims")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 610, 560)
      .unit("v2", "footman", 1680, 920, { id: "claimed-a", order: { type: "attackMove", x: 1980, y: 760 } })
      .unit("v2", "footman", 1710, 950, { id: "claimed-b", order: { type: "attackMove", x: 1980, y: 760 } })
      .unit("v2", "lancer", 1740, 980, { id: "claimed-c", order: { type: "attackMove", x: 1980, y: 760 } })
      .unit("v2", "lancer", 1770, 1010, { id: "claimed-d", order: { type: "attackMove", x: 1980, y: 760 } })
      .unit("v2", "archer", 1800, 1040, { id: "claimed-e", order: { type: "attackMove", x: 1980, y: 760 } })
      .townHall("v1", 3400, 3400)
      .unit("v1", "footman", 1500, 760)
      .unit("v1", "footman", 1530, 790)
      .unit("v1", "lancer", 1560, 820)
      .unit("v1", "lancer", 1590, 850)
      .unit("v1", "archer", 1620, 880)
      .unit("neutral", "wildling", 1960, 760, { id: "approach-camp-a" })
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    for (const unitId of ["claimed-a", "claimed-b", "claimed-c", "claimed-d", "claimed-e"]) {
      memory.unitClaims[unitId] = { kind: "creep", targetId: "approach-camp-a", x: 1960, y: 760, sinceTick: 0, expiresTick: 3600 };
    }

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams, memory });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ scriptId: "attackWave", command: { type: "move" } });
    expect(entries[0]?.command.type === "move" ? entries[0].command.unitIds : []).toEqual(["claimed-a", "claimed-b", "claimed-c", "claimed-d", "claimed-e"]);
    expect(Object.fromEntries(Object.entries(memory.unitClaims).map(([unitId, claim]) => [unitId, claim.kind]))).toEqual({
      "claimed-a": "retreat",
      "claimed-b": "retreat",
      "claimed-c": "retreat",
      "claimed-d": "retreat",
      "claimed-e": "retreat",
    });
  });

  it("does not let later tactics overwrite a mercenary-camp move in the same policy pass", () => {
    const scene = sketchScene("v2-merc-move-arbitration")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1200, 900)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 650, 650)
      .building("v2", "stables", 680, 680)
      .building("v2", "farm", 560, 700)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1200, 900, 4000)
      .unit("v2", "footman", 700, 700)
      .unit("v2", "lancer", 735, 730)
      .unit("v2", "archer", 770, 760)
      .unit("v2", "footman", 805, 790)
      .unit("v2", "lancer", 840, 820)
      .unit("v2", "archer", 875, 850)
      .unit("v2", "footman", 910, 880)
      .unit("v2", "lancer", 945, 910)
      .townHall("v1", 3300, 3300)
      .unit("v1", "footman", 3100, 3100)
      .unit("v1", "lancer", 3140, 3140)
      .unit("v1", "archer", 3180, 3180)
      .unit("v1", "footman", 3220, 3220)
      .unit("v1", "lancer", 3260, 3260)
      .mercenaryCamp("cleared-melee-camp", 1600, 1200, { hireKind: "mercenary", cost: 160, stock: 2, cooldownRemaining: 0 })
      .unit("neutral", "wildling", 900, 1180, { id: "tempting-free-camp-1" })
      .unit("neutral", "thornSlinger", 940, 1200, { id: "tempting-free-camp-2" })
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.mercenary, AI_SCRIPT_LIBRARY.objectiveControl, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });
    const mercenaryMove = entries.find((entry) => entry.scriptId === "mercenary" && entry.command.type === "attackMove");
    if (!mercenaryMove || mercenaryMove.command.type !== "attackMove") throw new Error("missing mercenary move");
    const movingToMerc = new Set(mercenaryMove.command.unitIds);
    const conflicting = entries
      .filter((entry) => entry.scriptId !== "mercenary")
      .filter((entry) => (entry.command.type === "attack" || entry.command.type === "attackMove" || entry.command.type === "move") && entry.command.unitIds.some((unitId) => movingToMerc.has(unitId)));

    expect(conflicting).toEqual([]);
  });

  it("v2 assigns flame cloak pickup to a high-star durable melee unit instead of the closest body", () => {
    const scene = sketchScene("v2-flame-cloak-carrier")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3000, 3000)
      .unit("v2", "archer", 760, 740, { id: "closer-archer" })
      .unit("v2", "knight", 800, 760, { id: "star-knight" })
      .item("red-flame-cloak", "flameCloak", 770, 748)
      .build();
    const game = scene.createGame();
    const knight = game.units.find((unit) => unit.id === "star-knight")!;
    knight.level = 3;
    knight.xp = 360;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "pickupItem");

    expect(command).toMatchObject({ type: "pickupItem", unitId: "star-knight", itemId: "red-flame-cloak" });
  });

  it("uses an active carried item through the same AI command path", () => {
    const scene = sketchScene("ai-active-item-use")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3000, 3000)
      .unit("v2", "contractArcher", 900, 900, { id: "rod-carrier" })
      .unit("v1", "footman", 1040, 900, { id: "chain-target-a" })
      .unit("v1", "archer", 1080, 925, { id: "chain-target-b" })
      .item("blue-lightning-rod", "lightningRod", 0, 0, { carrierId: "rod-carrier" })
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "useItem");

    expect(command).toMatchObject({ type: "useItem", unitId: "rod-carrier", itemId: "blue-lightning-rod", targetId: "chain-target-a" });
  });

  it("uses storm staff through the same AI command path", () => {
    const scene = sketchScene("ai-storm-staff-use")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3000, 3000)
      .unit("v2", "contractArcher", 900, 900, { id: "storm-carrier" })
      .unit("v1", "footman", 1050, 900, { id: "storm-target" })
      .item("blue-storm-staff", "stormStaff", 0, 0, { carrierId: "storm-carrier" })
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "useItem");

    expect(command).toMatchObject({ type: "useItem", unitId: "storm-carrier", itemId: "blue-storm-staff", x: 1050, y: 900 });
  });

  it("uses breach charge on exposed enemy production instead of wasting it on units", () => {
    const scene = sketchScene("ai-breach-charge-use")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3000, 3000)
      .unit("v2", "raider", 900, 900, { id: "breach-carrier" })
      .building("v1", "barracks", 1060, 900, { id: "exposed-barracks" })
      .unit("v1", "footman", 1010, 900, { id: "nearby-footman" })
      .item("red-breach-charge", "breachCharge", 0, 0, { carrierId: "breach-carrier" })
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "useItem");

    expect(command).toMatchObject({ type: "useItem", unitId: "breach-carrier", itemId: "red-breach-charge", targetId: "exposed-barracks" });
  });

  it("uses guardian scroll only when a real cluster fight is nearby", () => {
    const scene = sketchScene("ai-guardian-scroll-use")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .townHall("v1", 3000, 3000)
      .unit("v2", "knight", 900, 900, { id: "scroll-carrier" })
      .unit("v2", "footman", 930, 900)
      .unit("v2", "lancer", 900, 930)
      .unit("v2", "archer", 930, 930)
      .unit("v1", "footman", 1080, 900)
      .unit("v1", "raider", 1100, 930)
      .unit("v1", "archer", 1090, 960)
      .item("green-guardian-scroll", "guardianScroll", 0, 0, { carrierId: "scroll-carrier" })
      .build();
    const game = scene.createGame();

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "useItem");

    expect(command).toMatchObject({ type: "useItem", unitId: "scroll-carrier", itemId: "green-guardian-scroll" });
  });

  it("v2 pre-casts guardian scroll when a ranged burst fight is about to connect", () => {
    const game = sketchScene("ai-guardian-scroll-ranged-burst-window")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 150, 800)
      .townHall("v1", 1450, 800)
      .unit("v2", "fieldMedic", 623.5, 583.2, { id: "scroll-carrier" })
      .unit("v2", "archer", 655.4, 583.9, { id: "storm-carrier" })
      .unit("v2", "contractArcher", 665.9, 691.7, { id: "rod-carrier" })
      .unit("v2", "lancer", 631.5, 639)
      .unit("v2", "footman", 627.5, 692)
      .unit("v1", "archer", 942.2, 588.2)
      .unit("v1", "archer", 933.1, 642.4)
      .unit("v1", "contractArcher", 934, 696)
      .unit("v1", "witch", 940.6, 749.1)
      .unit("v1", "archer", 984.5, 805.7)
      .unit("v1", "contractArcher", 1006.1, 586.8)
      .item("blue-storm-staff", "stormStaff", 0, 0, { carrierId: "storm-carrier" })
      .item("blue-lightning-rod", "lightningRod", 0, 0, { carrierId: "rod-carrier" })
      .item("green-guardian-scroll", "guardianScroll", 0, 0, { carrierId: "scroll-carrier" })
      .build()
      .createGame();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.items], { version: "v2", teams: game.teams, policyMode: "combat" });

    expect(commands).toContainEqual({ type: "useItem", unitId: "scroll-carrier", itemId: "green-guardian-scroll" });
  });

  it("v2 can research early weapon training before the full production chain exists", () => {
    const scene = sketchScene("v2-early-weapon-training")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620, { id: "early-tech-barracks" })
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "lancer", 790, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 260;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "research", buildingId: "early-tech-barracks", upgradeKind: "weaponTraining" });
  });

  it("v3 ember does not spend the early two-fighter bank on weapon training", () => {
    const scene = sketchScene("v3-ember-delays-thin-weapon-training")
      .map("bareDuel")
      .replaceDefaults()
      .player("v3", { team: "north", race: "ember" })
      .player("v2-prod", { team: "south", race: "grove" })
      .townHall("v3", 500, 500)
      .building("v3", "emberForge", 620, 620, { id: "early-tech-forge" })
      .building("v3", "farm", 560, 700)
      .unit("v3", "emberRavager", 760, 620)
      .unit("v3", "cinderRunner", 790, 650)
      .townHall("v2-prod", 3300, 3300)
      .build();
    const game = scene.createGame();
    game.players.v3!.gold = 260;

    const command = planPresetAiCommands(snapshotGame(game), "v3", { version: "v3-ember", teams: game.teams })[0];

    expect(command).not.toMatchObject({ type: "research", buildingId: "early-tech-forge", upgradeKind: "weaponTraining" });
  });

  it("v3 ember can research weapon training after its first expansion is mining", () => {
    const scene = sketchScene("v3-ember-two-base-weapon-training")
      .map("bareDuel")
      .replaceDefaults()
      .player("v3", { team: "north", race: "ember" })
      .player("v2-prod", { team: "south", race: "grove" })
      .townHall("v3", 500, 500)
      .goldMine("v3-main-mine", 560, 540, 4000)
      .townHall("v3", 900, 900)
      .goldMine("v3-natural-mine", 960, 940, 4000)
      .building("v3", "emberForge", 620, 620, { id: "two-base-tech-forge" })
      .building("v3", "farm", 560, 700)
      .unit("v3", "emberRavager", 760, 620)
      .unit("v3", "cinderRunner", 790, 650)
      .townHall("v2-prod", 3300, 3300)
      .goldMine("v2-prod-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    game.players.v3!.gold = 260;

    const command = planPresetAiCommands(snapshotGame(game), "v3", { version: "v3-ember", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "research", buildingId: "two-base-tech-forge", upgradeKind: "weaponTraining" });
  });

  it("v2 delays one-base 1v2 weapon training until it can still afford the next fighter", () => {
    const scene = sketchScene("v2-one-base-1v2-delays-thin-weapon")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620, { id: "thin-tech-barracks" })
      .building("v2", "farm", 560, 700)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = UPGRADE_DEFS.weaponTraining.levels[0]!.cost;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.tech], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "research");

    expect(command).toBeUndefined();
  });

  it("v2 early weapon training is not starved by the next production building", () => {
    const scene = sketchScene("v2-tech-before-production")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620, { id: "tech-priority-barracks" })
      .building("v2", "farm", 560, 700)
      .worker("v2", 540, 560, { id: "tech-builder" })
      .unit("v2", "footman", 760, 620)
      .unit("v2", "lancer", 790, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 260;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "research", buildingId: "tech-priority-barracks", upgradeKind: "weaponTraining" });
  });

  it("v2 early weapon training can beat expansion gold reserve", () => {
    const scene = sketchScene("v2-tech-before-expansion-reserve")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620, { id: "tech-reserve-barracks" })
      .building("v2", "farm", 560, 700)
      .worker("v2", 540, 560, { id: "tech-reserve-builder" })
      .unit("v2", "footman", 760, 620)
      .unit("v2", "lancer", 790, 650)
      .unit("v2", "archer", 820, 680)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3700)
      .goldMine("v2-natural-mine", 1320, 780, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 260;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyTech], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "research");

    expect(command).toMatchObject({ type: "research", buildingId: "tech-reserve-barracks", upgradeKind: "weaponTraining" });
  });

  it("v5 researches late mobility when the core army is established", () => {
    const scene = sketchScene("v5-late-mobility-tech")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "ember" })
      .townHall("v5", 500, 500)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .townHall("v5", 900, 900)
      .goldMine("v5-natural-mine", 960, 940, 4000)
      .building("v5", "barracks", 620, 620)
      .building("v5", "archeryRange", 700, 620)
      .building("v5", "stables", 780, 620, { id: "v5-speed-stables" })
      .townHall("v3", 3300, 3300)
      .townHall("v4-tr", 3300, 3700);
    for (let index = 0; index < 10; index += 1) scene.unit("v5", index % 2 === 0 ? "footman" : "raider", 820 + index * 16, 680);
    const game = scene.build().createGame();
    game.players.v5!.gold = 2_000;
    game.players.v5!.upgrades.weaponTraining = 3;
    game.players.v5!.upgrades.reinforcedPlating = 3;
    game.players.v5!.upgrades.rangeTraining = 3;
    game.players.v5!.upgrades.leadership = 3;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.tech], { version: "v2", requestedVersion: "v5", teams: game.teams }).find((candidate) => candidate.type === "research");

    expect(command).toMatchObject({ type: "research", buildingId: "v5-speed-stables", upgradeKind: "speedTraining" });
  });

  it("v5 researches late range when it owns a mature ranged force", () => {
    const scene = sketchScene("v5-late-range-tech")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "ember" })
      .townHall("v5", 500, 500)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .townHall("v5", 900, 900)
      .goldMine("v5-natural-mine", 960, 940, 4000)
      .building("v5", "barracks", 620, 620)
      .building("v5", "archeryRange", 700, 620)
      .building("v5", "stables", 780, 620)
      .building("v5", "workshop", 860, 620, { id: "v5-range-workshop" })
      .townHall("v3", 3300, 3300)
      .townHall("v4-tr", 3300, 3700);
    for (let index = 0; index < 7; index += 1) scene.unit("v5", "archer", 820 + index * 16, 680);
    const game = scene.build().createGame();
    game.players.v5!.gold = 2_000;
    game.players.v5!.upgrades.weaponTraining = 3;
    game.players.v5!.upgrades.reinforcedPlating = 3;
    game.players.v5!.upgrades.speedTraining = 3;
    game.players.v5!.upgrades.leadership = 3;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.tech], { version: "v2", requestedVersion: "v5", teams: game.teams }).find((candidate) => candidate.type === "research");

    expect(command).toMatchObject({ type: "research", buildingId: "v5-range-workshop", upgradeKind: "rangeTraining" });
  });

  it("v5 researches leadership when it has veteran units worth preserving", () => {
    const scene = sketchScene("v5-late-leadership-tech")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "ember" })
      .townHall("v5", 500, 500)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .townHall("v5", 900, 900)
      .goldMine("v5-natural-mine", 960, 940, 4000)
      .building("v5", "barracks", 620, 620)
      .building("v5", "archeryRange", 700, 620)
      .building("v5", "stables", 780, 620)
      .building("v5", "sanctum", 860, 620, { id: "v5-leadership-sanctum" })
      .unit("v5", "knight", 820, 680, { xp: 260 })
      .unit("v5", "golem", 860, 680, { xp: 130 })
      .unit("v5", "archer", 900, 680, { xp: 60 })
      .townHall("v3", 3300, 3300)
      .townHall("v4-tr", 3300, 3700);
    const game = scene.build().createGame();
    game.players.v5!.gold = 2_000;
    game.players.v5!.upgrades.weaponTraining = 3;
    game.players.v5!.upgrades.reinforcedPlating = 3;
    game.players.v5!.upgrades.speedTraining = 3;
    game.players.v5!.upgrades.rangeTraining = 3;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.tech], { version: "v2", requestedVersion: "v5", teams: game.teams }).find((candidate) => candidate.type === "research");

    expect(command).toMatchObject({ type: "research", buildingId: "v5-leadership-sanctum", upgradeKind: "leadership" });
  });

  it("v5 does not buy leadership from excess gold before it has veteran units", () => {
    const scene = sketchScene("v5-no-empty-leadership-tech")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "ember" })
      .townHall("v5", 500, 500)
      .goldMine("v5-main-mine", 560, 540, 4000)
      .townHall("v5", 900, 900)
      .goldMine("v5-natural-mine", 960, 940, 4000)
      .building("v5", "barracks", 620, 620)
      .building("v5", "archeryRange", 700, 620)
      .building("v5", "stables", 780, 620)
      .building("v5", "sanctum", 860, 620, { id: "v5-empty-leadership-sanctum" })
      .unit("v5", "knight", 820, 680)
      .unit("v5", "archer", 860, 680)
      .townHall("v3", 3300, 3300)
      .townHall("v4-tr", 3300, 3700);
    const game = scene.build().createGame();
    game.players.v5!.gold = 2_000;
    game.players.v5!.upgrades.weaponTraining = 3;
    game.players.v5!.upgrades.reinforcedPlating = 3;
    game.players.v5!.upgrades.speedTraining = 3;
    game.players.v5!.upgrades.rangeTraining = 3;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.tech], { version: "v2", requestedVersion: "v5", teams: game.teams }).find((candidate) => candidate.type === "research");

    expect(command).toBeUndefined();
  });

  it("v4-tr does not actively research v5 late tech even when those buildings exist", () => {
    const scene = sketchScene("v4tr-no-v5-late-tech")
      .map("bareDuel")
      .replaceDefaults()
      .player("v4-tr", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .townHall("v4-tr", 500, 500)
      .goldMine("v4-main-mine", 560, 540, 4000)
      .townHall("v4-tr", 900, 900)
      .goldMine("v4-natural-mine", 960, 940, 4000)
      .building("v4-tr", "barracks", 620, 620)
      .building("v4-tr", "archeryRange", 700, 620)
      .building("v4-tr", "stables", 780, 620)
      .building("v4-tr", "sanctum", 860, 620)
      .building("v4-tr", "workshop", 940, 620)
      .unit("v4-tr", "knight", 820, 680, { xp: 260 })
      .unit("v4-tr", "archer", 860, 680)
      .townHall("v3", 3300, 3300);
    const game = scene.build().createGame();
    game.players["v4-tr"]!.gold = 2_000;
    game.players["v4-tr"]!.upgrades.weaponTraining = 3;
    game.players["v4-tr"]!.upgrades.reinforcedPlating = 3;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v4-tr", [AI_SCRIPT_LIBRARY.tech], { version: "v4-tr", teams: game.teams }).find((candidate) => candidate.type === "research");

    expect(command).toBeUndefined();
  });

  it("v3 ember prioritizes its first spire support unit after a stable forge frontline", () => {
    const scene = sketchScene("v3-ember-first-spire-support-priority")
      .map("bareDuel")
      .replaceDefaults()
      .player("v3", { team: "north", race: "ember" })
      .player("v2-prod", { team: "south", race: "grove" })
      .townHall("v3", 500, 500)
      .building("v3", "emberForge", 620, 620, { id: "forge" })
      .building("v3", "cinderSpire", 700, 620, { id: "spire" })
      .building("v3", "farm", 560, 700)
      .building("v3", "farm", 590, 700)
      .building("v3", "farm", 620, 700)
      .worker("v3", 500, 560)
      .worker("v3", 520, 560)
      .worker("v3", 540, 560)
      .worker("v3", 560, 560)
      .worker("v3", 580, 560)
      .worker("v3", 600, 560)
      .unit("v3", "emberRavager", 760, 620)
      .unit("v3", "emberRavager", 790, 650)
      .unit("v3", "emberRavager", 820, 680)
      .unit("v3", "cinderRunner", 850, 710)
      .unit("v3", "cinderRunner", 880, 740)
      .unit("v3", "sparkArcher", 910, 770)
      .townHall("v2-prod", 3300, 3300)
      .build();
    const game = scene.createGame();
    game.players.v3!.gold = 130;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v3", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "train", buildingId: "spire", unitKind: "emberAcolyte" });
  });

  it("v3 ember breaks a near-expansion bank for the first spark once melee and spire are online", () => {
    const scene = sketchScene("v3-ember-first-spark-before-late-expansion-conversion")
      .map("cobaltVale")
      .replaceDefaults()
      .player("v3", { team: "north", race: "ember" })
      .player("v2-prod", { team: "south", race: "grove" })
      .townHall("v3", 492, 2048, { id: "v3-main" })
      .building("v3", "emberForge", 578, 2176, { id: "forge" })
      .building("v3", "cinderSpire", 578, 1976, { id: "spire" })
      .building("v3", "emberShrine", 406, 2166, { id: "shrine" })
      .building("v3", "farm", 716, 1948)
      .building("v3", "farm", 716, 2176)
      .goldMine("gold-v3-main", 702, 1958, 4000)
      .goldMine("gold-west-march", 810, 2610, 4000)
      .goldMine("gold-v2-main", 3394, 1958, 4000)
      .goldMine("gold-east-march", 3286, 2610, 4000);
    for (let i = 0; i < 6; i += 1) scene.worker("v3", 560 + i * 18, 2000 + (i % 2) * 28);
    scene
      .unit("v3", "emberRavager", 716, 2104)
      .unit("v3", "emberRavager", 991, 2247)
      .unit("v3", "emberRavager", 1117, 2181)
      .unit("v3", "cinderRunner", 1025, 2215)
      .unit("v3", "cinderRunner", 1206, 2138)
      .unit("v3", "cinderRunner", 1172, 2133)
      .townHall("v2-prod", 3604, 2048, { id: "v2-main" })
      .townHall("v2-prod", 3376, 2680, { id: "v2-natural", complete: false });
    for (let i = 0; i < 6; i += 1) scene.unit("v2-prod", i % 3 === 0 ? "footman" : i % 3 === 1 ? "lancer" : "archer", 2360 + i * 30, 2270);
    const game = scene.build().createGame();
    game.players.v3!.gold = 310;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v3", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "train", buildingId: "spire", unitKind: "sparkArcher" });
  });

  it("v2 ember spends wounded 1v2 melee recovery gold on its first spark", () => {
    const scene = sketchScene("v2-ember-wounded-1v2-first-spark-recovery")
      .map("cobaltVale")
      .replaceDefaults()
      .player("v2", { team: "north", race: "ember" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 492, 2048, { id: "v2-main" })
      .building("v2", "emberForge", 578, 2176, { id: "forge" })
      .building("v2", "cinderSpire", 578, 1976, { id: "spire" })
      .building("v2", "emberShrine", 406, 2166, { id: "shrine" })
      .building("v2", "farm", 716, 1948)
      .building("v2", "farm", 716, 2176)
      .goldMine("gold-v2-main", 702, 1958, 4000)
      .goldMine("gold-west-march", 810, 2610, 4000)
      .goldMine("gold-v1a-main", 3394, 1958, 4000)
      .goldMine("gold-v1b-main", 3394, 2680, 4000)
      .unit("v2", "emberRavager", 716, 2104, { hp: 58 })
      .unit("v2", "emberRavager", 760, 2130, { hp: 62 })
      .unit("v2", "cinderRunner", 800, 2156, { hp: 44 })
      .unit("v2", "cinderRunner", 840, 2182, { hp: 48 })
      .townHall("v1a", 3604, 2048, { id: "v1a-main" })
      .townHall("v1b", 3604, 2680, { id: "v1b-main" });
    for (let i = 0; i < 6; i += 1) scene.worker("v2", 560 + i * 18, 2000 + (i % 2) * 28);
    const game = scene.build().createGame();
    game.players.v2!.gold = 160;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "train", buildingId: "spire", unitKind: "sparkArcher" });
  });

  it("v2 keeps core production training before the first expansion bank is actually close", () => {
    const scene = sketchScene("v2-training-before-distant-expansion-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-range" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 590, 700)
      .worker("v2", 520, 520)
      .worker("v2", 540, 520)
      .worker("v2", 560, 520)
      .worker("v2", 580, 520)
      .worker("v2", 600, 520)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "lancer", 790, 650)
      .unit("v2", "archer", 820, 680)
      .unit("v2", "footman", 850, 710)
      .townHall("v1a", 3300, 3300)
      .worker("v1a", 3280, 3300)
      .worker("v1a", 3300, 3320)
      .worker("v1a", 3320, 3300)
      .worker("v1a", 3340, 3300)
      .worker("v1a", 3360, 3300)
      .goldMine("v2-main-mine", 560, 520, 4000)
      .goldMine("v1-main-mine", 3300, 3240, 4000)
      .goldMine("v2-natural-mine", 1320, 780, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 190;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toContainEqual(expect.objectContaining({ type: "train" }));
  });

  it("v2 does not spend the cinderHeath first-expansion window on early stables", () => {
    const report = runAiGame({
      name: "cinderHeath catch-up expansion production timing",
      mapId: "cinderHeath",
      agents: {
        v2: {
          controller: "external-agent",
          team: "north",
          race: "grove",
          version: "v2",
          versionLabel: "v2",
          disabledBehaviors: ["workerHarassment"],
          scripts: [
            AI_SCRIPT_LIBRARY.economy,
            AI_SCRIPT_LIBRARY.constructionRecovery,
            AI_SCRIPT_LIBRARY.emergencyDefense,
            AI_SCRIPT_LIBRARY.repair,
            AI_SCRIPT_LIBRARY.supply,
            AI_SCRIPT_LIBRARY.earlyTech,
            AI_SCRIPT_LIBRARY.economicCatchUp,
            AI_SCRIPT_LIBRARY.productionBuilding,
            AI_SCRIPT_LIBRARY.expansion,
            AI_SCRIPT_LIBRARY.mercenary,
            AI_SCRIPT_LIBRARY.tech,
            AI_SCRIPT_LIBRARY.defense,
            AI_SCRIPT_LIBRARY.healingWell,
            AI_SCRIPT_LIBRARY.training,
            AI_SCRIPT_LIBRARY.attackWave,
          ],
        },
        v1a: { controller: "external-agent", team: "south", race: "grove", version: "v1", versionLabel: "v1" },
      },
      maxTicks: 14_000,
      thinkInterval: 45,
      trace: { commands: true },
    });

    const v2Builds = report.commands.filter((entry) => entry.owner === "v2" && entry.command.type === "build");
    const firstExpansionTownHallTick = v2Builds.find((entry) => entry.command.type === "build" && entry.command.buildingKind === "townHall")?.tick;
    const stablesTick = v2Builds.find((entry) => entry.command.type === "build" && entry.command.buildingKind === "stables")?.tick;

    if (stablesTick !== undefined) {
      expect(firstExpansionTownHallTick).toBeDefined();
      if (firstExpansionTownHallTick !== undefined) {
        expect(stablesTick).toBeGreaterThan(firstExpansionTownHallTick);
      }
    }
  });

  it("v2 takes weapon level two before a third town hall when its two-base army needs a timing upgrade", () => {
    const scene = sketchScene("v2-weapon-two-before-third-base")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1380, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 500, 540)
      .worker("v2", 540, 500)
      .unit("v2", "footman", 850, 680)
      .unit("v2", "footman", 885, 710)
      .unit("v2", "lancer", 920, 680)
      .unit("v2", "lancer", 955, 710)
      .unit("v2", "archer", 990, 680)
      .unit("v2", "archer", 1025, 710)
      .unit("v2", "raider", 1060, 680)
      .unit("v2", "footman", 1095, 710)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .townHall("v1a", 2920, 3060, { id: "v1a-natural" })
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .townHall("v1b", 2920, 3800, { id: "v1b-natural" })
      .goldMine("v2-main-mine", 560, 540, 6000)
      .goldMine("v2-natural-mine", 1420, 650, 6000)
      .goldMine("v2-third-mine", 2040, 980, 6000)
      .goldMine("v1a-main-mine", 3340, 3300, 6000)
      .goldMine("v1a-natural-mine", 2920, 3060, 6000)
      .goldMine("v1b-main-mine", 3340, 3800, 6000)
      .goldMine("v1b-natural-mine", 2920, 3800, 6000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 300;
    game.players.v2!.upgrades.weaponTraining = 1;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyTech, AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "research",
    );

    expect(command).toMatchObject({ type: "research", buildingId: "v2-barracks", upgradeKind: "weaponTraining" });
  });

  it("v2 holds two-base training gold before a basic unit resets the weapon level two bank", () => {
    const scene = sketchScene("v2-two-base-weapon-two-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "south", race: "grove" })
      .player("v1", { team: "north", race: "grove" })
      .townHall("v2", 500, 2048)
      .townHall("v2", 1380, 2050)
      .building("v2", "barracks", 620, 2140)
      .building("v2", "archeryRange", 700, 2060)
      .building("v2", "stables", 740, 2220)
      .building("v2", "sanctum", 820, 2140)
      .building("v2", "farm", 560, 2320)
      .building("v2", "farm", 610, 2360)
      .unit("v2", "footman", 900, 2050)
      .unit("v2", "footman", 930, 2080)
      .unit("v2", "footman", 960, 2050)
      .unit("v2", "lancer", 990, 2080)
      .unit("v2", "lancer", 1020, 2050)
      .unit("v2", "archer", 1050, 2080)
      .unit("v2", "footman", 1080, 2050)
      .unit("v2", "lancer", 1110, 2080)
      .worker("v2", 540, 2050)
      .worker("v2", 570, 2050)
      .worker("v2", 600, 2050)
      .worker("v2", 630, 2050)
      .worker("v2", 660, 2050)
      .worker("v2", 1380, 2050)
      .worker("v2", 1410, 2050)
      .worker("v2", 1440, 2050)
      .worker("v2", 1470, 2050)
      .worker("v2", 1500, 2050)
      .townHall("v1", 3400, 2048)
      .goldMine("v2-main-mine", 560, 2048, 4000)
      .goldMine("v2-natural-mine", 1420, 2050, 4000)
      .goldMine("v1-main-mine", 3340, 2048, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 105;
    game.players.v2!.upgrades.weaponTraining = 1;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands.find((candidate) => candidate.type === "train")).toBeUndefined();
  });

  it("prioritizes a third mining base over duplicate production when two enemy economies are far ahead", () => {
    const scene = sketchScene("v2-third-base-before-duplicate-production")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1380, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "sanctum", 820, 620, { id: "v2-sanctum" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .building("v2", "farm", 710, 805)
      .townHall("v1a", 3300, 3300, { id: "v1a-main" })
      .townHall("v1a", 2920, 3060, { id: "v1a-natural" })
      .townHall("v1b", 3300, 3800, { id: "v1b-main" })
      .townHall("v1b", 2920, 3800, { id: "v1b-natural" })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1420, 650, 4000)
      .goldMine("v2-third-mine", 2040, 980, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1a-natural-mine", 2920, 3060, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .goldMine("v1b-natural-mine", 2920, 3800, 4000);
    for (let i = 0; i < 10; i += 1) scene.worker("v2", 520 + i * 10, 540 + i * 5);
    for (let i = 0; i < 8; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 650 + i * 22, 720);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 520;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) worker.order = { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 };
    const telemetry = createAiTelemetry();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp, AI_SCRIPT_LIBRARY.productionBuilding], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
    expect(command?.type === "build" ? command.x : 0).toBeCloseTo(1950, -2);
    expect(telemetry.behaviors.economicCatchUp.catchUpExpansions).toBe(1);
  });

  it("reserves routine training gold for a third mining base when two enemy economies are far ahead", () => {
    const scene = sketchScene("v2-reserve-third-base")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1380, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .building("v2", "farm", 710, 805)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1420, 650, 4000)
      .goldMine("v2-third-mine", 2040, 980, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1a-natural-mine", 2920, 3060, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .goldMine("v1b-natural-mine", 2920, 3800, 4000);
    for (let i = 0; i < 10; i += 1) scene.worker("v2", 520 + i * 10, 540 + i * 5);
    for (let i = 0; i < 8; i += 1) scene.unit("v2", i % 2 === 0 ? "footman" : "archer", 650 + i * 22, 720);
    const game = scene.build().createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 260;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });
    const training = commands.find((candidate) => candidate.type === "train");
    const nonTownHallBuild = commands.find((candidate) => candidate.type === "build" && candidate.buildingKind !== "townHall");

    expect(training).toBeUndefined();
    expect(nonTownHallBuild).toBeUndefined();
  });

  it("v2 saves for a cleared nearby expansion instead of dribbling the money into one more soldier", () => {
    const scene = sketchScene("v2-cleared-natural-reserve")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 760, 720)
      .unit("v2", "lancer", 800, 740)
      .unit("v2", "archer", 840, 720)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 260;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands.find((candidate) => candidate.type === "train")).toBeUndefined();
    expect(commands.find((candidate) => candidate.type === "research")).toBeUndefined();
    expect(commands.find((candidate) => candidate.type === "build" && candidate.buildingKind !== "townHall")).toBeUndefined();
  });

  it("v2 stops spending a cleared first-natural bank once five combat units can hold the route", () => {
    const scene = sketchScene("v2-cleared-natural-five-unit-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 760, 720)
      .unit("v2", "footman", 800, 740)
      .unit("v2", "lancer", 840, 720)
      .unit("v2", "archer", 880, 740)
      .unit("v2", "contractArcher", 920, 720)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800)
      .unit("v1a", "footman", 500, 1600)
      .unit("v1a", "footman", 3000, 3300)
      .unit("v1a", "lancer", 3040, 3340)
      .unit("v1a", "archer", 3080, 3300)
      .unit("v1a", "footman", 3120, 3340)
      .unit("v1b", "footman", 3000, 3800)
      .unit("v1b", "lancer", 3040, 3840)
      .unit("v1b", "archer", 3080, 3800)
      .unit("v1b", "footman", 3120, 3840)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 110;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands.find((candidate) => candidate.type === "train")).toBeUndefined();
  });

  it("v2 retries a cleared first-natural town hall before completing the production chain", () => {
    const scene = sketchScene("v2-cleared-natural-build-before-stables")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540, { id: "builder-a" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 760, 720)
      .unit("v2", "footman", 800, 740)
      .unit("v2", "lancer", 840, 720)
      .unit("v2", "archer", 880, 740)
      .unit("v2", "contractArcher", 920, 720)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800)
      .building("v1a", "barracks", 3200, 3300)
      .building("v1b", "barracks", 3200, 3800)
      .unit("v1a", "footman", 3000, 3300)
      .unit("v1a", "lancer", 3040, 3340)
      .unit("v1b", "footman", 3000, 3800)
      .unit("v1b", "lancer", 3040, 3840)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 330;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionAttemptTick: 3600 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams, memory }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("v2 does not build on a forward mine occupied by an enemy town hall", () => {
    const scene = sketchScene("v2-forward-trade-expansion")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620)
      .worker("v2", 520, 540, { id: "builder-a" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .unit("v2", "footman", 2100, 2040)
      .unit("v2", "footman", 2140, 2080)
      .unit("v2", "lancer", 2180, 2040)
      .unit("v2", "lancer", 2220, 2080)
      .unit("v2", "contractArcher", 2260, 2040)
      .unit("v2", "footman", 2300, 2080)
      .townHall("v1a", 3400, 1400)
      .building("v1a", "townHall", 2180, 2080, { id: "v1a-forward-hall", complete: false })
      .townHall("v1b", 3400, 2700)
      .goldMine("v2-main-mine", 700, 500, 4000)
      .goldMine("v2-natural", 1300, 760, 4000)
      .goldMine("controlled-forward", 2180, 2080, 6000)
      .goldMine("v1a-main-mine", 3400, 1400, 4000)
      .goldMine("v1b-main-mine", 3400, 2700, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 360;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toBeUndefined();
  });

  it("v2 delays a third expansion while a larger 1v2 opponent army is still live", () => {
    const scene = sketchScene("v2-delay-third-expansion-vs-live-army")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1120, 820, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 780, 620)
      .building("v2", "sanctum", 860, 560)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .unit("v2", "footman", 1600, 1400)
      .unit("v2", "footman", 1640, 1420)
      .unit("v2", "lancer", 1680, 1440)
      .unit("v2", "lancer", 1720, 1460)
      .unit("v2", "archer", 1760, 1480)
      .unit("v2", "contractArcher", 1800, 1500)
      .townHall("v1a", 3500, 1450)
      .worker("v1a", 3480, 1450)
      .townHall("v1b", 3500, 2850)
      .unit("v1b", "footman", 2360, 2280)
      .unit("v1b", "footman", 2400, 2320)
      .unit("v1b", "lancer", 2440, 2280)
      .unit("v1b", "lancer", 2480, 2320)
      .unit("v1b", "archer", 2520, 2280)
      .unit("v1b", "archer", 2560, 2320)
      .unit("v1b", "contractArcher", 2600, 2280)
      .unit("v1b", "footman", 2640, 2320)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1120, 820, 4000)
      .goldMine("v2-third-mine", 1900, 3000, 4000)
      .goldMine("v1a-main-mine", 3500, 1450, 4000)
      .goldMine("v1b-main-mine", 3500, 2850, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build",
    );

    expect(command).toBeUndefined();
  });

  it("v2 preserves routine spending gold while its army is finishing a nearly cleared expansion camp", () => {
    const scene = sketchScene("v2-nearly-cleared-natural-reserve")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "lancer", 1080, 680, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "archer", 1010, 620, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("v2", "archer", 1000, 700, { order: { type: "attackMove", x: 1120, y: 650 } })
      .unit("neutral", "mossGnawer", 1130, 655, { hp: 8 })
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-nearly-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 260;

    const economyCommand = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(economyCommand).toBeUndefined();
  });

  it("v2 reserves first-natural gold while its army is clearing a guarded expansion", () => {
    const scene = sketchScene("v2-guarded-natural-reserve")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650)
      .unit("v2", "footman", 1080, 680)
      .unit("v2", "lancer", 1010, 620)
      .unit("v2", "archer", 1000, 700)
      .unit("v2", "archer", 960, 660)
      .unit("neutral", "mossGnawer", 1130, 655)
      .unit("neutral", "wildling", 1170, 690)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-guarded-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 250;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });
    const economyCommand = commands.find((candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire");

    expect(economyCommand).toBeUndefined();
    expect(commands.find((command) => command.type === "attackMove")).toBeDefined();
  });

  it("v2 does not spend a cleared first-expansion bank on a pressure moon well", () => {
    const scene = sketchScene("v2-cleared-natural-bank-vs-moon-well")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650, { id: "v2-claim-footman", hp: 58 })
      .unit("v2", "footman", 1080, 680)
      .unit("v2", "lancer", 1010, 620, { hp: 62 })
      .unit("v2", "archer", 1000, 700)
      .unit("v2", "archer", 960, 660)
      .unit("v2", "footman", 1010, 735)
      .unit("v1a", "footman", 120, 500)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost - 70;
    const memory = createAiPolicyMemory();
    memory.unitClaims["v2-claim-footman"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 0, expiresTick: 3600 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", teams: game.teams, memory }).find(
      (candidate) => candidate.type === "build",
    );

    expect(command).toBeUndefined();
  });

  it("v2 keeps the cleared first-expansion bank after the army claim has released", () => {
    const scene = sketchScene("v2-cleared-natural-strategic-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650, { id: "v2-free-footman", hp: 58 })
      .unit("v2", "footman", 1080, 680)
      .unit("v2", "lancer", 1010, 620, { hp: 62 })
      .unit("v2", "archer", 1000, 700)
      .unit("v2", "archer", 960, 660)
      .unit("v2", "footman", 1010, 735)
      .unit("v1a", "footman", 120, 500)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.tick = 6300;
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost - 70;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 4800 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", teams: game.teams, memory }).find(
      (candidate) => candidate.type === "build",
    );

    expect(command).toBeUndefined();
  });

  it("v2 finishes a remembered cleared first expansion even after the clearing squad was thinned", () => {
    const scene = sketchScene("v2-remembered-cleared-natural-builds-after-attrition")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 980, 760)
      .unit("v2", "footman", 1010, 790)
      .unit("v2", "lancer", 1040, 820)
      .unit("v2", "archer", 1070, 850)
      .unit("v2", "archer", 1100, 880)
      .townHall("v1a", 3400, 3400)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 820, 4000)
      .goldMine("v1a-main-mine", 3340, 3400, 4000)
      .build();
    const game = scene.createGame();
    game.tick = 8400;
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 4800 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams, memory }).find(
      (candidate) => candidate.type === "build",
    );

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("v2 still waits for the first-expansion army size while the clearing claim is active", () => {
    const scene = sketchScene("v2-active-natural-claim-still-waits-for-army-size")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 980, 760, { id: "v2-claim-footman" })
      .unit("v2", "footman", 1010, 790)
      .unit("v2", "lancer", 1040, 820)
      .unit("v2", "archer", 1070, 850)
      .unit("v2", "archer", 1100, 880)
      .townHall("v1a", 3400, 3400)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 820, 4000)
      .goldMine("v1a-main-mine", 3340, 3400, 4000)
      .build();
    const game = scene.createGame();
    game.tick = 5100;
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-cleared-natural", expansionClaimTick: 4800 };
    memory.unitClaims["v2-claim-footman"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 820, sinceTick: 4800, expiresTick: 8400 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams, memory }).find(
      (candidate) => candidate.type === "build",
    );

    expect(command).toBeUndefined();
  });

  it("v2 does not spend a cleared first-expansion bank on an edge-pressure main tower", () => {
    const scene = sketchScene("v2-cleared-natural-bank-vs-edge-tower")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .worker("v2", 520, 540)
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 620, 560)
      .unit("v2", "footman", 1040, 650, { id: "v2-claim-footman" })
      .unit("v2", "footman", 1080, 680)
      .unit("v2", "lancer", 1010, 620)
      .unit("v2", "archer", 1000, 700)
      .unit("v2", "archer", 960, 660)
      .unit("v2", "footman", 1010, 735)
      .unit("v1a", "footman", 120, 500)
      .unit("v1a", "lancer", 160, 540)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost - 70;
    const memory = createAiPolicyMemory();
    memory.unitClaims["v2-claim-footman"] = { kind: "expansion", targetId: "v2-cleared-natural", x: 1120, y: 650, sinceTick: 0, expiresTick: 3600 };

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, memory }).find(
      (candidate) => candidate.type === "build" && candidate.buildingKind === "defenseTower",
    );

    expect(command).toBeUndefined();
  });

  it("v2 redirects an attack-moving army to clear its guarded natural expansion", () => {
    const scene = sketchScene("v2-attackmove-army-clears-guarded-natural")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 980, 760, { order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "footman", 1010, 790, { order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "lancer", 1040, 820, { order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "archer", 1070, 850, { order: { type: "attackMove", x: 2600, y: 2600 } })
      .townHall("v1a", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1200, 900, 4000)
      .goldMine("v1a-main-mine", 3340, 3400, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .unit("neutral", "stonebackBrute", 1190, 890)
      .unit("neutral", "thornSlinger", 1230, 930)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove", x: 1200, y: 900 });
    expect(command?.type === "attackMove" ? command.unitIds.length : 0).toBe(4);
  });

  it("records an expansion claim when assigning a squad to clear a guarded natural", () => {
    const scene = sketchScene("v2-guarded-natural-expansion-claim")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 980, 760, { id: "natural-footman", order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "footman", 1010, 790, { id: "natural-footman-b", order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "lancer", 1040, 820, { id: "natural-lancer", order: { type: "attackMove", x: 2600, y: 2600 } })
      .unit("v2", "archer", 1070, 850, { id: "natural-archer", order: { type: "attackMove", x: 2600, y: 2600 } })
      .townHall("v1a", 3400, 3400)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1200, 900, 4000)
      .goldMine("v1a-main-mine", 3340, 3400, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .unit("neutral", "stonebackBrute", 1190, 890)
      .unit("neutral", "thornSlinger", 1230, 930)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams, memory });
    const command = entries.find((entry) => entry.scriptId === "expansion" && entry.command.type === "attackMove")?.command;

    if (!command || command.type !== "attackMove") throw new Error("missing guarded natural assignment");
    expect(Object.keys(memory.unitClaims).sort()).toEqual([...command.unitIds].sort());
    expect(memory.unitClaims["natural-footman"]).toMatchObject({ kind: "expansion", targetId: "v2-natural-mine", x: 1200, y: 900, sinceTick: 0 });
  });

  it("v2 waits before clearing a guarded natural that outpowers its current squad", () => {
    const scene = sketchScene("v2-waits-on-overpowered-natural")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 1040, 650)
      .unit("v2", "lancer", 1080, 680)
      .unit("v2", "archer", 1010, 620)
      .unit("v2", "archer", 1000, 700)
      .unit("neutral", "stonebackBrute", 1130, 655)
      .unit("neutral", "thornSlinger", 1170, 690)
      .unit("neutral", "gladeWitch", 1120, 610)
      .unit("neutral", "mossGnawer", 1080, 720)
      .unit("neutral", "wildling", 1200, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-hard-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 waits before clearing a guarded natural with a badly wounded squad", () => {
    const scene = sketchScene("v2-waits-on-wounded-natural-squad")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 1040, 650, { hp: 50 })
      .unit("v2", "lancer", 1080, 680, { hp: 45 })
      .unit("v2", "archer", 1010, 620, { hp: 35 })
      .unit("v2", "archer", 1000, 700, { hp: 35 })
      .unit("neutral", "stonebackBrute", 1130, 655)
      .unit("neutral", "thornSlinger", 1170, 690)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-wounded-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toBeUndefined();
  });

  it("v2 can take its first clear expansion with two production buildings before stables", () => {
    const scene = sketchScene("v2-two-production-first-expansion")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .unit("v2", "footman", 900, 720)
      .unit("v2", "lancer", 940, 760)
      .unit("v2", "archer", 980, 800)
      .townHall("v1a", 3400, 3400)
      .townHall("v1a", 3000, 3000)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-clear-natural", 1200, 900, 4000)
      .goldMine("v1a-main-mine", 3340, 3400, 4000)
      .goldMine("v1a-natural-mine", 3040, 3000, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 340;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", unitId: "v2-builder", buildingKind: "townHall" });
  });

  it("v2 waits for a real first combat group before taking a clear one-on-one expansion", () => {
    const scene = sketchScene("v2-1v1-clear-expansion-after-first-group")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .unit("v2", "footman", 900, 720)
      .unit("v2", "lancer", 940, 760)
      .unit("v2", "archer", 980, 800)
      .unit("v2", "footman", 1020, 820)
      .unit("v2", "lancer", 1060, 840)
      .unit("v2", "archer", 1100, 860)
      .townHall("v1a", 3400, 3400)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-clear-natural", 1200, 900, 4000)
      .goldMine("v1a-main-mine", 3340, 3400, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 340;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansion], { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toBeUndefined();
  });

  it("v2 does not treat neutral guards at its natural as a main-base attack wave", () => {
    const scene = sketchScene("v2-natural-guards-are-objectives-not-main-pressure")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .unit("v2", "footman", 640, 640, { order: { type: "attackMove", x: 930, y: 930 } })
      .unit("v2", "footman", 670, 650, { order: { type: "attackMove", x: 930, y: 930 } })
      .unit("v2", "lancer", 700, 670, { order: { type: "attackMove", x: 930, y: 930 } })
      .unit("v2", "archer", 720, 620, { order: { type: "move", x: 650, y: 650 } })
      .unit("neutral", "stonebackBrute", 930, 930)
      .unit("neutral", "gladeWitch", 970, 960)
      .unit("neutral", "barkMender", 900, 970)
      .unit("neutral", "thornSlinger", 965, 900)
      .unit("neutral", "mossGnawer", 900, 900)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-guarded-natural", 930, 930, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attackMove", x: 930, y: 930 });
  });

  it("v2 keeps moving toward its guarded natural on sundial reach instead of bouncing home from neutral pressure", () => {
    const players = ["v2", "v1a", "v1b"] as const;
    const teams = { v2: "north", v1a: "south", v1b: "south" };
    const game = createGame("sundialReach", {
      players: [...players],
      aiPlayers: [...players],
      teams,
      races: { v2: "grove", v1a: "grove", v1b: "grove" },
    });
    const runtime = createAiRuntime([...players], { versions: { v2: "v2", v1a: "v1", v1b: "v1" } });
    let v2Commands: ReturnType<typeof runPresetAiRuntimeForTest>["commands"] = [];
    while (game.tick <= 3060) {
      if (game.tick % 45 === 0) v2Commands = runPresetAiRuntimeForTest(game, runtime).commands.filter((entry) => entry.playerId === "v2");
      stepGame(game);
    }

    const attackWave = v2Commands.find((entry) => entry.scriptId === "attackWave")?.command;

    if (attackWave) {
      expect(attackWave.type).toBe("attackMove");
      if (attackWave.type === "attackMove") expect(attackWave.y).toBeGreaterThan(2400);
    }
  });

  it("v2 pauses distant objective control while a fresh expansion is under pressure", () => {
    const scene = sketchScene("v2-expansion-pressure-pauses-objectives")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 2300, 620, { id: "v2-far-natural" })
      .unit("v2", "footman", 2210, 640)
      .unit("v2", "lancer", 2250, 660)
      .unit("v2", "archer", 2290, 640)
      .unit("v2", "archer", 2330, 660)
      .unit("v2", "contractArcher", 2370, 640)
      .unit("v2", "mercenary", 2410, 660)
      .unit("v1a", "footman", 2470, 650)
      .unit("v1a", "lancer", 2510, 680)
      .unit("v1b", "footman", 2450, 720)
      .unit("neutral", "mossGnawer", 3180, 940)
      .townHall("v1a", 3300, 3300)
      .townHall("v1b", 3300, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 2370, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 keeps objective armies home while an under-saturated expansion has approaching enemies", () => {
    const scene = sketchScene("v2-fragile-expansion-pauses-objectives")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 2300, 620, { id: "v2-far-natural" })
      .worker("v2", 2330, 650, { order: { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 } })
      .unit("v2", "footman", 620, 560)
      .unit("v2", "lancer", 660, 580)
      .unit("v2", "archer", 700, 560)
      .unit("v2", "archer", 740, 580)
      .unit("v2", "contractArcher", 780, 560)
      .unit("v2", "mercenary", 820, 580)
      .unit("v1a", "archer", 3450, 640)
      .unit("v1a", "contractArcher", 3490, 680)
      .unit("v1b", "footman", 3340, 900)
      .unit("neutral", "mossGnawer", 1020, 940)
      .townHall("v1a", 3600, 620)
      .townHall("v1b", 3600, 1100)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 2370, 650, 4000)
      .goldMine("v1a-main-mine", 3600, 680, 4000)
      .goldMine("v1b-main-mine", 3600, 1160, 4000)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.objectiveControl], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "attackMove",
    );

    expect(command).toBeUndefined();
  });

  it("v2 converts a cleared nearby expansion into a town hall as soon as it can afford one", () => {
    const scene = sketchScene("v2-cleared-natural-build")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620)
      .building("v2", "archeryRange", 700, 560)
      .building("v2", "stables", 740, 660)
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .unit("v2", "footman", 760, 720)
      .unit("v2", "lancer", 800, 740)
      .unit("v2", "archer", 840, 720)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2920, 3060)
      .townHall("v1b", 3300, 3800)
      .townHall("v1b", 2920, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-cleared-natural", 1120, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 340;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "townHall" });
  });

  it("v2 adds duplicate core production on two bases when fighting two economies", () => {
    const scene = sketchScene("v2-duplicate-core-production")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1400, 650, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "sanctum", 820, 620, { id: "v2-sanctum" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 540)
      .worker("v2", 580, 560)
      .worker("v2", 600, 540)
      .worker("v2", 1420, 660)
      .worker("v2", 1440, 680)
      .worker("v2", 1460, 660)
      .worker("v2", 1480, 680)
      .unit("v2", "footman", 800, 620)
      .unit("v2", "footman", 830, 650)
      .unit("v2", "lancer", 860, 620)
      .unit("v2", "archer", 890, 650)
      .unit("v2", "archer", 920, 620)
      .unit("v2", "raider", 950, 650)
      .townHall("v1a", 3300, 3300)
      .townHall("v1a", 2850, 3050)
      .townHall("v1b", 3300, 3700)
      .townHall("v1b", 2850, 3700)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural-mine", 1420, 650, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3700, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 360;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "barracks" });
  });

  it("v3 ember waits for a full two-base combat group before duplicate core production in one-on-one", () => {
    const scene = sketchScene("v3-ember-one-on-one-duplicate-production")
      .map("openClaims")
      .replaceDefaults()
      .player("v3", { team: "north", race: "ember" })
      .player("v2-prod", { team: "south", race: "grove" })
      .townHall("v3", 500, 500, { id: "v3-main" })
      .townHall("v3", 1400, 650, { id: "v3-natural" })
      .building("v3", "emberForge", 620, 620, { id: "v3-forge" })
      .building("v3", "cinderSpire", 700, 560, { id: "v3-spire" })
      .building("v3", "defenseTower", 754, 620)
      .building("v3", "defenseTower", 1350, 610)
      .building("v3", "farm", 560, 700)
      .building("v3", "farm", 610, 735)
      .building("v3", "farm", 660, 770)
      .building("v3", "farm", 710, 805)
      .building("v3", "farm", 560, 850)
      .building("v3", "farm", 610, 885)
      .building("v3", "farm", 660, 920)
      .building("v3", "farm", 710, 955)
      .worker("v3", 520, 540, { id: "v3-builder" })
      .worker("v3", 540, 560)
      .worker("v3", 560, 540)
      .worker("v3", 580, 560)
      .worker("v3", 600, 540)
      .worker("v3", 1420, 660)
      .worker("v3", 1440, 680)
      .worker("v3", 1460, 660)
      .worker("v3", 1480, 680)
      .townHall("v2-prod", 3300, 3300)
      .goldMine("v3-main-mine", 560, 540, 4000)
      .goldMine("v3-natural-mine", 1420, 650, 4000)
      .goldMine("v2-prod-main-mine", 3340, 3300, 4000);
    for (let index = 0; index < 12; index += 1) scene.unit("v3", index % 2 === 0 ? "emberRavager" : "cinderRunner", 800 + index * 24, 620 + index * 12);
    const game = scene.build().createGame();
    game.players.v3!.gold = 500;

    const command = planPresetAiCommands(snapshotGame(game), "v3", { version: "v3-ember", teams: game.teams }).find((candidate) => candidate.type === "build" && candidate.buildingKind === "emberForge");

    expect(command).toBeUndefined();
  });

  it("v3 ember adds duplicate core production at fifteen combat units in two-base one-on-one", () => {
    const scene = sketchScene("v3-ember-one-on-one-duplicate-production-ready")
      .map("openClaims")
      .replaceDefaults()
      .player("v3", { team: "north", race: "ember" })
      .player("v2-prod", { team: "south", race: "grove" })
      .townHall("v3", 500, 500, { id: "v3-main" })
      .townHall("v3", 1400, 650, { id: "v3-natural" })
      .building("v3", "emberForge", 620, 620, { id: "v3-forge" })
      .building("v3", "cinderSpire", 700, 560, { id: "v3-spire" })
      .building("v3", "defenseTower", 754, 620)
      .building("v3", "defenseTower", 1350, 610)
      .building("v3", "farm", 560, 700)
      .building("v3", "farm", 610, 735)
      .building("v3", "farm", 660, 770)
      .building("v3", "farm", 710, 805)
      .building("v3", "farm", 560, 850)
      .building("v3", "farm", 610, 885)
      .building("v3", "farm", 660, 920)
      .building("v3", "farm", 710, 955)
      .worker("v3", 520, 540, { id: "v3-builder" })
      .worker("v3", 540, 560)
      .worker("v3", 560, 540)
      .worker("v3", 580, 560)
      .worker("v3", 600, 540)
      .worker("v3", 1420, 660)
      .worker("v3", 1440, 680)
      .worker("v3", 1460, 660)
      .worker("v3", 1480, 680)
      .townHall("v2-prod", 3300, 3300)
      .goldMine("v3-main-mine", 560, 540, 4000)
      .goldMine("v3-natural-mine", 1420, 650, 4000)
      .goldMine("v2-prod-main-mine", 3340, 3300, 4000);
    for (let index = 0; index < 15; index += 1) scene.unit("v3", index % 2 === 0 ? "emberRavager" : "cinderRunner", 800 + index * 24, 620 + index * 12);
    const game = scene.build().createGame();
    game.players.v3!.gold = 500;

    const command = planPresetAiCommands(snapshotGame(game), "v3", { version: "v3-ember", teams: game.teams }).find((candidate) => candidate.type === "build" && candidate.buildingKind === "emberForge");

    expect(command).toMatchObject({ type: "build", buildingKind: "emberForge" });
  });

  it("v2 trains its first squad before buying static defense or extra production when outnumbered", () => {
    const scene = sketchScene("v2-first-squad-before-shell")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .worker("v1a", 3400, 3360)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .worker("v1b", 3400, 3860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 500;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(command).toMatchObject({ type: "train", unitKind: "footman" });
  });

  it("v2 builds an emergency main tower before a routine farm when two enemy groups are already approaching", () => {
    const scene = sketchScene("v2-emergency-tower-before-routine-farm")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-farm" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .unit("v2", "footman", 720, 620)
      .unit("v2", "footman", 750, 650)
      .unit("v2", "lancer", 780, 680)
      .unit("v2", "archer", 810, 710)
      .unit("v2", "lancer", 840, 740)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1280, 560)
      .unit("v1a", "lancer", 1320, 600)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1280, 820)
      .unit("v1b", "footman", 1320, 860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;
    game.players.v2!.supplyUsed = 12;
    game.players.v2!.supplyCap = 16;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
  });

  it("v2 does not wait for a five-unit army before buying an emergency main tower under two-sided pressure", () => {
    const scene = sketchScene("v2-early-emergency-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 700, 620)
      .unit("v2", "lancer", 740, 650)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1280, 560)
      .unit("v1a", "lancer", 1320, 600)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1280, 820)
      .unit("v1b", "footman", 1320, 860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;
    game.players.v2!.supplyUsed = 10;
    game.players.v2!.supplyCap = 16;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
  });

  it("v2 buys an emergency main tower against a close single-army hit in 1v2", () => {
    const scene = sketchScene("v2-early-single-army-emergency-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 700, 620)
      .unit("v2", "lancer", 740, 650)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1260, 560)
      .unit("v1a", "lancer", 1300, 600)
      .townHall("v1b", 3400, 3800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 170;
    game.players.v2!.supplyUsed = 10;
    game.players.v2!.supplyCap = 16;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
  });

  it("v2 starts a main guard tower before third production when an enemy army is approaching", () => {
    const scene = sketchScene("v2-main-guard-before-third-production")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 492, 2048, { id: "v2-main" })
      .building("v2", "barracks", 612, 2148, { id: "v2-barracks" })
      .building("v2", "archeryRange", 612, 1976, { id: "v2-archery" })
      .building("v2", "farm", 716, 1948)
      .building("v2", "farm", 856, 1816)
      .townHall("v2", 720, 2540, { id: "v2-natural" })
      .building("v2", "farm", 646, 2308)
      .worker("v2", 520, 2080, { id: "v2-builder" })
      .worker("v2", 555, 2080)
      .worker("v2", 590, 2080)
      .worker("v2", 625, 2080)
      .worker("v2", 700, 2540)
      .worker("v2", 735, 2540)
      .worker("v2", 770, 2540)
      .unit("v2", "lancer", 620, 1930)
      .unit("v2", "footman", 660, 1960)
      .unit("v2", "lancer", 700, 1900)
      .unit("v2", "archer", 740, 1940)
      .unit("v2", "footman", 780, 1980)
      .unit("v2", "contractArcher", 820, 1920)
      .unit("v2", "footman", 860, 1960)
      .townHall("v1a", 3604, 2048)
      .unit("v1a", "footman", 1820, 1960)
      .unit("v1a", "lancer", 1860, 2000)
      .unit("v1a", "lancer", 1900, 2040)
      .unit("v1a", "archer", 1940, 2080)
      .unit("v1a", "archer", 1980, 2120)
      .unit("v1a", "contractArcher", 2020, 2160)
      .goldMine("v2-main-mine", 440, 2048, 4000)
      .goldMine("v2-natural-mine", 720, 2640, 4000)
      .goldMine("v1a-main-mine", 3680, 2048, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 180;
    game.players.v2!.supplyUsed = 21;
    game.players.v2!.supplyCap = 38;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.defense, AI_SCRIPT_LIBRARY.productionBuilding], {
      version: "v2",
      teams: game.teams,
    });

    expect(entries.find((entry) => entry.scriptId === "defense")?.command).toMatchObject({ type: "build", buildingKind: "defenseTower" });
    expect(entries.find((entry) => entry.scriptId === "productionBuilding")).toBeUndefined();
  });

  it("v2 does not spend its one-base expansion bank on a distant main guard tower", () => {
    const scene = sketchScene("v2-one-base-expansion-bank-before-distant-main-guard")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 492, 2048, { id: "v2-main" })
      .building("v2", "barracks", 612, 2148, { id: "v2-barracks" })
      .building("v2", "archeryRange", 612, 1976, { id: "v2-archery" })
      .building("v2", "farm", 716, 1948)
      .building("v2", "farm", 856, 1816)
      .worker("v2", 520, 2080, { id: "v2-builder" })
      .worker("v2", 555, 2080)
      .worker("v2", 590, 2080)
      .worker("v2", 625, 2080)
      .unit("v2", "lancer", 620, 1930)
      .unit("v2", "footman", 660, 1960)
      .unit("v2", "lancer", 700, 1900)
      .unit("v2", "archer", 740, 1940)
      .unit("v2", "footman", 780, 1980)
      .unit("v2", "contractArcher", 820, 1920)
      .unit("v2", "footman", 860, 1960)
      .townHall("v1a", 3604, 2048)
      .unit("v1a", "footman", 1820, 1960)
      .unit("v1a", "lancer", 1860, 2000)
      .unit("v1a", "lancer", 1900, 2040)
      .unit("v1a", "archer", 1940, 2080)
      .unit("v1a", "archer", 1980, 2120)
      .unit("v1a", "contractArcher", 2020, 2160)
      .goldMine("v2-main-mine", 440, 2048, 4000)
      .goldMine("v2-natural-mine", 720, 2640, 4000)
      .goldMine("v1a-main-mine", 3680, 2048, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 230;
    game.players.v2!.supplyUsed = 20;
    game.players.v2!.supplyCap = 22;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.defense], { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("v2 preserves near-tower gold instead of routine training while two enemy groups approach the main", () => {
    const scene = sketchScene("v2-emergency-tower-reserve")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .worker("v2", 520, 560)
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 700, 620)
      .unit("v2", "lancer", 740, 650)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1300, 560)
      .unit("v1a", "lancer", 1340, 600)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1300, 820)
      .unit("v1b", "footman", 1340, 860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 120;
    game.players.v2!.supplyUsed = 10;
    game.players.v2!.supplyCap = 16;

    const economyCommand = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(economyCommand).toBeUndefined();
  });

  it("v2 builds a moon well after the emergency tower when early pressure leaves defenders wounded", () => {
    const scene = sketchScene("v2-wounded-defense-moon-well")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .building("v2", "defenseTower", 360, 360, { id: "v2-emergency-tower" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 700, 620, { hp: 48 })
      .unit("v2", "lancer", 740, 650, { hp: 54 })
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1880, 560)
      .unit("v1a", "lancer", 1920, 600)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1880, 820)
      .unit("v1b", "footman", 1920, 860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 140;
    game.players.v2!.supplyUsed = 10;
    game.players.v2!.supplyCap = 16;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "moonWell" });
  });

  it("v2 does not spend the first expansion bank on a moon well for non-critical wounded defenders", () => {
    const scene = sketchScene("v2-no-first-moon-well-before-expansion-bank")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 492, 2048, { id: "v2-main" })
      .building("v2", "barracks", 612, 2148, { id: "v2-barracks" })
      .building("v2", "archeryRange", 612, 1976, { id: "v2-archery" })
      .building("v2", "farm", 716, 1948)
      .building("v2", "farm", 856, 1816)
      .worker("v2", 520, 2080, { id: "v2-builder" })
      .worker("v2", 555, 2080)
      .unit("v2", "footman", 1040, 2033, { hp: 90 })
      .unit("v2", "lancer", 1080, 2061, { hp: 59 })
      .unit("v2", "footman", 1010, 2075, { hp: 103 })
      .unit("v2", "archer", 990, 2100)
      .unit("v2", "archer", 960, 2070)
      .unit("v2", "footman", 930, 2040)
      .townHall("v1a", 3604, 2048)
      .goldMine("v2-main-mine", 440, 2048, 4000)
      .goldMine("v2-natural-mine", 720, 2640, 4000)
      .goldMine("v1a-main-mine", 3680, 2048, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 120;
    game.players.v2!.supplyUsed = 18;
    game.players.v2!.supplyCap = 22;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("v5 builds the first moon well for wounded Grove survivors after clearing the first natural", () => {
    const scene = sketchScene("v5-first-natural-wounded-survivors-moon-well")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 492, 2048, { id: "v5-main" })
      .building("v5", "barracks", 612, 2148, { id: "v5-barracks" })
      .building("v5", "archeryRange", 612, 1976, { id: "v5-archery" })
      .building("v5", "farm", 716, 1948)
      .building("v5", "farm", 856, 1816)
      .worker("v5", 520, 2080, { id: "v5-builder" })
      .worker("v5", 555, 2080)
      .unit("v5", "footman", 798, 2630, { hp: 72 })
      .unit("v5", "lancer", 830, 2609, { hp: 82 })
      .unit("v5", "footman", 760, 2580, { hp: 96 })
      .unit("v5", "archer", 720, 2550)
      .townHall("v3", 3604, 1500)
      .townHall("v4", 3604, 2600)
      .goldMine("v5-main-mine", 440, 2048, 4000)
      .goldMine("v5-natural-mine", 720, 2640, 4000)
      .goldMine("v3-main-mine", 3680, 1500, 4000)
      .goldMine("v4-main-mine", 3680, 2600, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = BUILDING_DEFS.moonWell.cost;
    game.players.v5!.supplyUsed = 18;
    game.players.v5!.supplyCap = 22;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v5-natural-mine", expansionClaimTick: 4800 };

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.healingWell], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
      memory,
    })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "moonWell" });
  });

  it("v2 does not build the first healing well for routine creep wounds before the natural is cleared", () => {
    const scene = sketchScene("v2-no-early-creep-wound-healing-well")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "ember" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 492, 2048, { id: "v2-main" })
      .building("v2", "emberForge", 612, 2148, { id: "v2-forge" })
      .building("v2", "farm", 716, 1948)
      .worker("v2", 520, 2080, { id: "v2-builder" })
      .worker("v2", 555, 2080)
      .unit("v2", "emberRavager", 720, 2520, { hp: 66 })
      .unit("v2", "emberRavager", 760, 2540, { hp: 70 })
      .unit("v2", "sparkArcher", 700, 2480)
      .unit("neutral", "wildling", 820, 2600)
      .unit("neutral", "thornSlinger", 860, 2640)
      .townHall("v1a", 3604, 2048)
      .goldMine("v2-main-mine", 440, 2048, 4000)
      .goldMine("v2-natural-mine", 720, 2640, 4000)
      .goldMine("v1a-main-mine", 3680, 2048, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 140;
    game.players.v2!.supplyUsed = 12;
    game.players.v2!.supplyCap = 16;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", teams: game.teams })[0];

    expect(command).toBeUndefined();
  });

  it("v2 builds its first moon well for a critically wounded defender before the first expansion starts", () => {
    const scene = sketchScene("v2-first-moon-well-for-critical-defender")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 492, 2048, { id: "v2-main" })
      .building("v2", "barracks", 612, 2148, { id: "v2-barracks" })
      .building("v2", "archeryRange", 612, 1976, { id: "v2-archery" })
      .building("v2", "farm", 716, 1948)
      .building("v2", "farm", 856, 1816)
      .building("v2", "farm", 646, 2308)
      .worker("v2", 520, 2080, { id: "v2-builder" })
      .worker("v2", 555, 2080)
      .unit("v2", "footman", 248, 2136, { hp: 18 })
      .unit("v2", "footman", 798, 2630)
      .unit("v2", "lancer", 830, 2609, { hp: 88 })
      .unit("v2", "archer", 1138, 2014)
      .unit("v2", "footman", 1142, 2048)
      .townHall("v1a", 3604, 2048)
      .goldMine("v2-main-mine", 440, 2048, 4000)
      .goldMine("v2-natural-mine", 720, 2640, 4000)
      .goldMine("v1a-main-mine", 3680, 2048, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = BUILDING_DEFS.townHall.cost - 5;
    game.players.v2!.supplyUsed = 22;
    game.players.v2!.supplyCap = 28;
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { expansionClaimTargetId: "v2-natural-mine", expansionClaimTick: 4800 };
    for (const unitId of ["scene-v2-first-moon-well-for-critical-defender-v2-footman-1", "scene-v2-first-moon-well-for-critical-defender-v2-lancer-1"]) {
      memory.unitClaims[unitId] = { kind: "expansion", targetId: "v2-natural-mine", x: 720, y: 2640, sinceTick: 4800, expiresTick: 8400 };
    }

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", teams: game.teams, memory })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "moonWell" });
  });

  it("v5 builds the first moon well before a catch-up third when two-base defenders are wounded", () => {
    const scene = sketchScene("v5-two-base-wounded-first-moon-well")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 500, 500, { id: "v5-main" })
      .townHall("v5", 900, 900, { id: "v5-natural" })
      .building("v5", "barracks", 620, 620, { id: "v5-barracks" })
      .building("v5", "archeryRange", 700, 620, { id: "v5-archery" })
      .building("v5", "farm", 560, 700)
      .building("v5", "farm", 620, 740)
      .worker("v5", 520, 560, { id: "v5-builder" })
      .worker("v5", 540, 560)
      .worker("v5", 560, 560)
      .worker("v5", 900, 940)
      .worker("v5", 930, 940)
      .unit("v5", "footman", 660, 620, { hp: 76 })
      .unit("v5", "lancer", 700, 650, { hp: 70 })
      .unit("v5", "footman", 740, 680, { hp: 101 })
      .unit("v5", "archer", 780, 700)
      .unit("v5", "archer", 820, 720)
      .unit("v5", "footman", 860, 740)
      .townHall("v3", 3_300, 1_500)
      .townHall("v3", 3_000, 1_900)
      .townHall("v4", 3_300, 2_700)
      .townHall("v4", 3_000, 3_100)
      .goldMine("v5-main-mine", 560, 540, 4_000)
      .goldMine("v5-natural-mine", 900, 900, 4_000)
      .goldMine("v5-third-mine", 1_500, 1_500, 4_000)
      .goldMine("v3-main-mine", 3_300, 1_500, 4_000)
      .goldMine("v3-natural-mine", 3_000, 1_900, 4_000)
      .goldMine("v4-main-mine", 3_300, 2_700, 4_000)
      .goldMine("v4-natural-mine", 3_000, 3_100, 4_000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = BUILDING_DEFS.moonWell.cost;
    game.players.v5!.supplyUsed = 22;
    game.players.v5!.supplyCap = 30;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.healingWell], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    })[0];

    expect(command).toMatchObject({ type: "build", buildingKind: "moonWell" });
  });

  it("v5 builds the first moon well before a second tower when two-base defenders are wounded", () => {
    const scene = sketchScene("v5-two-base-wounded-first-moon-well-before-second-tower")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4", { team: "south", race: "grove" })
      .townHall("v5", 492, 2048, { id: "v5-main" })
      .townHall("v5", 720, 2540, { id: "v5-natural" })
      .building("v5", "barracks", 612, 2148, { id: "v5-barracks" })
      .building("v5", "archeryRange", 612, 1976, { id: "v5-archery" })
      .building("v5", "farm", 716, 1948)
      .building("v5", "farm", 856, 1816)
      .building("v5", "farm", 786, 2148)
      .building("v5", "defenseTower", 577, 2585, { id: "v5-natural-tower" })
      .worker("v5", 520, 2080, { id: "v5-builder" })
      .worker("v5", 555, 2080)
      .worker("v5", 720, 2580)
      .worker("v5", 750, 2580)
      .unit("v5", "footman", 497, 2050, { hp: 54, id: "wounded-footman" })
      .unit("v5", "lancer", 489, 2014, { hp: 88, id: "wounded-lancer" })
      .unit("v5", "footman", 461, 2049, { hp: 139, id: "bruised-footman" })
      .unit("v5", "archer", 455, 2011)
      .unit("v5", "footman", 701, 2206)
      .townHall("v3", 3604, 2621)
      .unit("v3", "footman", 1026, 2354)
      .unit("v3", "lancer", 1061, 2343)
      .unit("v3", "footman", 1094, 2357)
      .townHall("v4", 3604, 1475)
      .unit("v4", "contractArcher", 1180, 2040)
      .goldMine("v5-main-mine", 440, 2048, 4000)
      .goldMine("v5-natural-mine", 720, 2540, 4000)
      .goldMine("v3-main-mine", 3680, 2621, 4000)
      .goldMine("v4-main-mine", 3680, 1475, 4000)
      .build();
    const game = scene.createGame();
    game.players.v5!.gold = BUILDING_DEFS.moonWell.cost + 10;
    game.players.v5!.supplyUsed = 21;
    game.players.v5!.supplyCap = 38;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.healingWell, AI_SCRIPT_LIBRARY.defense], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    });

    expect(entries[0]).toMatchObject({ scriptId: "healingWell", command: { type: "build", buildingKind: "moonWell" } });
  });

  it("v2 adds a recovery moon well when settled wounded defenders are outside existing well range", () => {
    const scene = sketchScene("v2-uncovered-wounded-recovery-moon-well")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 620, { id: "v2-archery" })
      .building("v2", "stables", 780, 620, { id: "v2-stables" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .building("v2", "moonWell", 340, 680, { id: "v2-existing-moon-well" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .unit("v2", "footman", 450, 235, { hp: 42, order: { type: "idle" } })
      .unit("v2", "lancer", 500, 250, { hp: 35, order: { type: "move", x: 500, y: 250 } })
      .unit("v2", "footman", 540, 245, { hp: 46, order: { type: "idle" } })
      .unit("v2", "archer", 530, 280)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 700;
    game.players.v2!.supplyUsed = 11;
    game.players.v2!.supplyCap = 40;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "build");

    expect(command).toMatchObject({ type: "build", buildingKind: "moonWell" });
    if (command?.type === "build") expect(distance(command, { x: 500, y: 245 })).toBeLessThanOrEqual(BUILDING_DEFS.moonWell.attackRange);
  });

  it("v2 does not add a third moon well for uncovered wounded recovery", () => {
    const scene = sketchScene("v2-caps-uncovered-wounded-recovery-moon-wells")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 620, { id: "v2-archery" })
      .building("v2", "stables", 780, 620, { id: "v2-stables" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .building("v2", "moonWell", 300, 680, { id: "v2-existing-moon-well-a" })
      .building("v2", "moonWell", 850, 680, { id: "v2-existing-moon-well-b" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .unit("v2", "footman", 500, 250, { hp: 42, order: { type: "idle" } })
      .unit("v2", "lancer", 540, 250, { hp: 35, order: { type: "move", x: 540, y: 250 } })
      .unit("v2", "archer", 520, 285)
      .townHall("v1a", 3300, 3300)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 700;
    game.players.v2!.supplyUsed = 9;
    game.players.v2!.supplyCap = 40;

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell], { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build",
    );

    expect(command).toBeUndefined();
  });

  it("v2 rebuilds a fighting unit before spending scarce gold on a thin moon well", () => {
    const scene = sketchScene("v2-rebuilds-combat-before-thin-moon-well")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .unit("v2", "footman", 700, 620, { hp: 48 })
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 920, 620)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1880, 820)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 140;
    game.players.v2!.supplyUsed = 7;
    game.players.v2!.supplyCap = 16;

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.healingWell, AI_SCRIPT_LIBRARY.training], {
      version: "v2",
      teams: game.teams,
    });

    expect(entries).toEqual([{ scriptId: "training", command: { type: "train", buildingId: "v2-barracks", unitKind: "footman" } }]);
  });

  it("v2 banks scarce one-base gold for combat recovery instead of a sixth worker", () => {
    const scene = sketchScene("v2-one-base-thin-combat-bank")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .worker("v2", 520, 560)
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .unit("v2", "footman", 700, 620)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 920, 620)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 75;
    game.players.v2!.supplyUsed = 7;
    game.players.v2!.supplyCap = 16;

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.training], { version: "v2", teams: game.teams });

    expect(commands).toEqual([]);
  });

  it("v2 preserves near-moon-well gold instead of routine training when wounded defenders are under pressure", () => {
    const scene = sketchScene("v2-moon-well-reserve")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "farm", 560, 700, { id: "v2-first-farm" })
      .building("v2", "defenseTower", 360, 360, { id: "v2-emergency-tower" })
      .worker("v2", 520, 560, { id: "v2-builder" })
      .worker("v2", 540, 560)
      .worker("v2", 560, 560)
      .worker("v2", 580, 560)
      .worker("v2", 600, 560)
      .unit("v2", "footman", 700, 620, { hp: 48 })
      .unit("v2", "lancer", 740, 650)
      .townHall("v1a", 3300, 3300)
      .unit("v1a", "footman", 1880, 560)
      .unit("v1a", "lancer", 1920, 600)
      .townHall("v1b", 3400, 3800)
      .unit("v1b", "lancer", 1880, 820)
      .unit("v1b", "footman", 1920, 860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 110;
    game.players.v2!.supplyUsed = 9;
    game.players.v2!.supplyCap = 16;

    const economyCommand = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find(
      (candidate) => candidate.type === "build" || candidate.type === "train" || candidate.type === "research" || candidate.type === "hire",
    );

    expect(economyCommand).toBeUndefined();
  });

  it("researches combat upgrades through ordinary SDK policy commands once the economy can afford tech", () => {
    const scene = sketchScene("ai-tech-research")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .unit("v2", "footman", 820, 660)
      .unit("v2", "archer", 850, 680)
      .townHall("target", 1800, 1800, { id: "target-main" })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 900;

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams }).find((candidate) => candidate.type === "research");

    expect(command).toMatchObject({ type: "research", upgradeKind: "weaponTraining" });
    if (command?.type !== "research") throw new Error("expected research command");
    issuePlayerCommand(game, "v2", command);
    expect(game.players.v2.gold).toBe(760);
  });

  it("can start cheap combat tech while v2 is economically outnumbered", () => {
    const scene = sketchScene("ai-tech-delay-when-outnumbered")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .unit("v2", "footman", 820, 660)
      .unit("v2", "archer", 850, 680)
      .worker("v2", 520, 560)
      .townHall("v1a", 3400, 3300, { id: "v1a-main" })
      .worker("v1a", 3360, 3300)
      .worker("v1a", 3380, 3340)
      .worker("v1a", 3400, 3360)
      .townHall("v1b", 3400, 3800, { id: "v1b-main" })
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3380, 3840)
      .worker("v1b", 3400, 3860)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 900;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands.some((candidate) => candidate.type === "research")).toBe(false);
    expect(commands.some((candidate) => candidate.type === "train" || candidate.type === "build")).toBe(true);
  });

  it("v2 builds a main guard tower before early weapon tech when fighting two economies", () => {
    const scene = sketchScene("ai-main-tower-before-early-tech")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .unit("v2", "footman", 780, 640)
      .unit("v2", "footman", 810, 670)
      .unit("v2", "lancer", 840, 700)
      .unit("v2", "archer", 870, 730)
      .unit("v2", "archer", 900, 760)
      .worker("v2", 520, 560, { id: "v2-builder" })
      .townHall("v1a", 3300, 3300)
      .worker("v1a", 3260, 3300)
      .worker("v1a", 3300, 3340)
      .worker("v1a", 3340, 3380)
      .townHall("v1b", 3400, 3800)
      .worker("v1b", 3360, 3800)
      .worker("v1b", 3400, 3840)
      .worker("v1b", 3440, 3880)
      .unit("v1b", "footman", 1320, 720)
      .unit("v1b", "lancer", 1360, 760)
      .unit("v1b", "archer", 1400, 800)
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v1a-main-mine", 3340, 3300, 4000)
      .goldMine("v1b-main-mine", 3340, 3800, 4000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 320;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands.some((command) => command.type === "research")).toBe(false);
    expect(commands.find((command) => command.type === "build" && command.buildingKind === "defenseTower")).toMatchObject({ type: "build", buildingKind: "defenseTower" });
  });

  it("recalls attacking armies when owned buildings are under pressure", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const base = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    const enemyBase = game.buildings.find((building) => building.owner === "enemy" && building.kind === "townHall")!;
    const soldiers = Array.from({ length: 7 }, (_, index) => game.spawnUnit("player", "footman", 3200 + index * 16, 3200));
    for (const soldier of soldiers) soldier.order = { type: "attack", targetId: enemyBase.id };
    base.hp = Math.floor(base.maxHp * 0.7);
    game.spawnUnit("enemy", "raider", base.x + 120, base.y);
    game.spawnUnit("enemy", "archer", base.x + 140, base.y + 40);

    const command = planPresetAiCommands(snapshotGame(game), "player").find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    expect(command?.type === "attackMove" ? command.x : 0).toBeCloseTo(base.x, -2);
    expect(command?.type === "attackMove" ? command.unitIds.length : 0).toBeGreaterThanOrEqual(7);
  });

  it("recalls armies to defend pressured allied buildings in team games", () => {
    const game = createGame("bareDuel", { players: ["player", "ally", "enemy"], aiPlayers: [], teams: { player: "north", ally: "north", enemy: "south" } });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const alliedBase = game.buildings.find((building) => building.owner === "ally" && building.kind === "townHall")!;
    const enemyBase = game.buildings.find((building) => building.owner === "enemy" && building.kind === "townHall")!;
    const soldiers = Array.from({ length: 6 }, (_, index) => game.spawnUnit("player", "footman", 3200 + index * 16, 3200));
    for (const soldier of soldiers) soldier.order = { type: "attack", targetId: enemyBase.id };
    alliedBase.hp = Math.floor(alliedBase.maxHp * 0.65);
    game.spawnUnit("enemy", "raider", alliedBase.x + 120, alliedBase.y);
    game.spawnUnit("enemy", "archer", alliedBase.x + 140, alliedBase.y + 40);

    const command = planPresetAiCommands(snapshotGame(game), "player", { teams: game.teams }).find((candidate) => candidate.type === "attackMove");

    expect(command).toMatchObject({ type: "attackMove" });
    expect(command?.type === "attackMove" ? command.x : 0).toBeCloseTo(alliedBase.x, -2);
  });

  it("v2 does not split base defenders away from an active local unit fight", () => {
    const scene = sketchScene("v2-no-base-fight-split")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .townHall("v2", 492, 2048, { id: "v2-main" })
      .tower("v2", 373, 1957)
      .unit("v2", "footman", 680, 1896, { id: "v2-a", order: { type: "attackMove", x: 856, y: 1816, targetId: "enemy-merc-b" } })
      .unit("v2", "lancer", 773, 1880, { id: "v2-b", hp: 79, order: { type: "attackMove", x: 856, y: 1816, targetId: "enemy-merc-a" } })
      .unit("v2", "footman", 745, 1960, { id: "v2-c", order: { type: "attackMove", x: 856, y: 1816, targetId: "enemy-merc-b" } })
      .unit("v2", "footman", 723, 1892, { id: "v2-d", order: { type: "attackMove", x: 856, y: 1816, targetId: "enemy-merc-b" } })
      .unit("v2", "lancer", 690, 1931, { id: "v2-e", order: { type: "attackMove", x: 856, y: 1816, targetId: "enemy-merc-b" } })
      .unit("v2", "footman", 744, 1859, { id: "v2-f", hp: 98, order: { type: "attackMove", x: 856, y: 1816, targetId: "enemy-merc-b" } })
      .unit("v2", "contractArcher", 621, 1927, { id: "v2-g", order: { type: "attackMove", x: 856, y: 1816 } })
      .unit("v2", "fieldMedic", 669, 1865, { id: "v2-h", hp: 66, order: { type: "attackMove", x: 856, y: 1816, targetId: "enemy-merc-b" } })
      .unit("v2", "fieldMedic", 727, 1931, { id: "v2-i", order: { type: "attackMove", x: 856, y: 1816, targetId: "enemy-merc-a" } })
      .townHall("v1a", 3604, 2048)
      .unit("v1a", "footman", 985, 1805, { order: { type: "attackMove", x: 856, y: 1816 } })
      .unit("v1a", "lancer", 889, 1863, { hp: 76, order: { type: "attackMove", x: 856, y: 1816, targetId: "v2-b" } })
      .unit("v1a", "lancer", 863, 1798, { hp: 64, order: { type: "attackMove", x: 856, y: 1816, targetId: "v2-b" } })
      .unit("v1a", "archer", 1003, 1885, { order: { type: "attackMove", x: 856, y: 1816, targetId: "v2-b" } })
      .unit("v1a", "contractArcher", 978, 1838, { order: { type: "attackMove", x: 856, y: 1816, targetId: "v2-b" } })
      .unit("v1a", "contractArcher", 1009, 1845, { order: { type: "attackMove", x: 856, y: 1816 } })
      .unit("v1a", "mercenary", 881, 1828, { id: "enemy-merc-a", hp: 80, order: { type: "attackMove", x: 856, y: 1816, targetId: "v2-b" } })
      .unit("v1a", "mercenary", 845, 1847, { id: "enemy-merc-b", order: { type: "attackMove", x: 856, y: 1816, targetId: "v2-b" } })
      .unit("v1a", "contractArcher", 1044, 1857, { order: { type: "attackMove", x: 856, y: 1816 } })
      .build();
    const game = scene.createGame();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.focusFire, AI_SCRIPT_LIBRARY.attackWave], { version: "v2", teams: game.teams });
    const attackWave = entries.find((entry) => entry.scriptId === "attackWave")?.command;

    expect(entries.find((entry) => entry.scriptId === "focusFire")).toBeDefined();
    expect(attackWave).not.toMatchObject({ type: "move" });
  });

  it("v2 counts early harassment worker raids and the behavior can be disabled for A/B tests", () => {
    const scene = sketchScene("v2-harass-workers")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "ember" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .worker("v2", 450, 500)
      .unit("v2", "raider", 760, 520)
      .unit("v2", "archer", 790, 550)
      .townHall("v1", 1350, 520)
      .worker("v1", 1290, 520)
      .worker("v1", 1320, 560)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1-main", 1260, 520, 3000)
      .build();
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const enabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams, telemetry }).find((command) => command.type === "attack");
    const disabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams, disabledBehaviors: ["earlyHarassment"], telemetry: createAiTelemetry() }).find((command) => command.type === "attack");

    expect(enabled).toMatchObject({ type: "attack" });
    expect(enabled?.type === "attack" ? enabled.targetId : "").toMatch(/worker/);
    expect(enabled?.type === "attack" ? enabled.unitIds.length : 0).toBe(2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.earlyHarassment.attempts).toBe(1);
    expect(telemetry.behaviors.earlyHarassment.workerRaidCommands).toBe(1);
  });

  it("v2 does not restart early harassment after its first expansion is established", () => {
    const scene = sketchScene("v2-no-post-expansion-early-harass")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 1040, 760)
      .worker("v2", 520, 540)
      .unit("v2", "footman", 900, 640)
      .unit("v2", "archer", 930, 670)
      .unit("v2", "lancer", 960, 700)
      .townHall("v1", 1350, 520)
      .worker("v1", 1290, 520)
      .worker("v1", 1320, 560)
      .goldMine("v2-main", 560, 540, 3000)
      .goldMine("v2-natural", 1080, 760, 3000)
      .goldMine("v1-main", 1260, 520, 3000)
      .build();
    const game = scene.createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams })[0];

    expect(entry).toBeUndefined();
  });

  it("v2 can disable the whole worker harassment strategy family", () => {
    const scene = sketchScene("v2-worker-harassment-family-off")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 900, 500)
      .unit("v2", "footman", 760, 520)
      .unit("v2", "footman", 790, 550)
      .unit("v2", "lancer", 820, 580)
      .unit("v2", "archer", 850, 610)
      .unit("v2", "footman", 880, 640)
      .unit("v2", "lancer", 910, 670)
      .townHall("v1a", 1350, 520)
      .worker("v1a", 1290, 520)
      .worker("v1a", 1320, 560)
      .townHall("v1b", 3350, 3300)
      .worker("v1b", 3300, 3300)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v2-natural", 900, 520, 3000)
      .goldMine("v1a-main", 1260, 520, 3000)
      .goldMine("v1b-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const entries = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure, AI_SCRIPT_LIBRARY.earlyHarassment], {
      version: "v2",
      teams: game.teams,
      telemetry,
      disabledBehaviors: ["workerHarassment"],
    });

    expect(entries.filter((entry) => entry.scriptId === "workerPressure" || entry.scriptId === "earlyHarassment")).toEqual([]);
    expect(telemetry.behaviors.workerHarassment.disabledSkips).toBe(2);
  });

  it("v2 commits a three-unit 1v2 worker-pressure job into memory", () => {
    const scene = sketchScene("v2-worker-pressure-job")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 760, 520, { id: "pressure-1" })
      .unit("v2", "footman", 790, 550, { id: "pressure-2" })
      .unit("v2", "lancer", 820, 580, { id: "pressure-3" })
      .townHall("v1a", 1350, 520)
      .worker("v1a", 1290, 520, { id: "v1a-target-worker" })
      .worker("v1a", 1320, 560)
      .townHall("v1b", 3350, 3300)
      .worker("v1b", 3300, 3300)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 1260, 520, 3000)
      .goldMine("v1b-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "v1a-target-worker" } });
    expect(entry?.command.type === "attack" ? entry.command.unitIds : []).toEqual(["pressure-1", "pressure-2", "pressure-3"]);
    expect(memory.strategicPlan?.focusTargetOwner).toBe("v1a");
    expect(Object.values(memory.unitClaims).map((claim) => claim.kind)).toEqual(["harass", "harass", "harass"]);
  });

  it("v5 worker pressure does not overwrite the main 1v2 focus target", () => {
    const scene = sketchScene("v5-worker-pressure-keeps-main-focus")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .unit("v5", "footman", 760, 520, { id: "pressure-1" })
      .unit("v5", "footman", 790, 550, { id: "pressure-2" })
      .unit("v5", "lancer", 820, 580, { id: "pressure-3" })
      .townHall("v3", 1350, 520)
      .worker("v3", 1290, 520, { id: "v3-target-worker" })
      .worker("v3", 1320, 560)
      .townHall("v4-tr", 3350, 3300)
      .worker("v4-tr", 3300, 3300)
      .goldMine("v5-main", 420, 520, 3000)
      .goldMine("v3-main", 1260, 520, 3000)
      .goldMine("v4-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v4-tr", focusTargetSinceTick: 0, focusTargetUpdatedTick: 0 };

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.workerPressure], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
      memory,
    })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "v3-target-worker" } });
    expect(memory.strategicPlan?.focusTargetOwner).toBe("v4-tr");
  });

  it("v5 grove worker pressure leaves a wounded recovery body out of a mature two-base raid", () => {
    const scene = sketchScene("v5-grove-worker-pressure-preserves-wounded-body")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 700)
      .building("v5", "moonWell", 460, 560)
      .unit("v5", "lancer", 1120, 760, { id: "wounded-lancer", hp: 68 })
      .unit("v5", "footman", 980, 720, { id: "healthy-a" })
      .unit("v5", "footman", 1010, 760, { id: "healthy-b" })
      .unit("v5", "footman", 1040, 800, { id: "healthy-c" })
      .unit("v5", "archer", 1070, 720, { id: "healthy-d" })
      .unit("v5", "lancer", 1100, 800, { id: "healthy-e" })
      .unit("v5", "footman", 1130, 720)
      .unit("v5", "footman", 1160, 760)
      .unit("v5", "archer", 1190, 800)
      .unit("v5", "lancer", 1220, 720)
      .unit("v5", "footman", 1250, 760)
      .townHall("v3", 2100, 820)
      .worker("v3", 1850, 780, { id: "v3-target-worker" })
      .worker("v3", 1900, 820)
      .townHall("v4-tr", 3300, 3300)
      .worker("v4-tr", 3260, 3300)
      .goldMine("v5-main", 560, 540, 3000)
      .goldMine("v5-natural", 900, 700, 3000)
      .goldMine("v3-main", 2100, 820, 3000)
      .goldMine("v4-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.workerPressure], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    })[0];
    if (entry?.command.type !== "attack") throw new Error("expected workerPressure attack");

    expect(entry.command.targetId).toBe("v3-target-worker");
    expect(entry.command.unitIds).toHaveLength(3);
    expect(entry.command.unitIds).not.toContain("wounded-lancer");
  });

  it("v5 grove keeps full worker pressure after its third base is active", () => {
    const scene = sketchScene("v5-grove-three-base-worker-pressure-full")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 700)
      .townHall("v5", 1250, 900)
      .building("v5", "moonWell", 460, 560)
      .unit("v5", "lancer", 1120, 760, { id: "wounded-lancer", hp: 68 })
      .unit("v5", "footman", 980, 720, { id: "healthy-a" })
      .unit("v5", "footman", 1010, 760, { id: "healthy-b" })
      .unit("v5", "footman", 1040, 800, { id: "healthy-c" })
      .unit("v5", "archer", 1070, 720, { id: "healthy-d" })
      .unit("v5", "lancer", 1100, 800, { id: "healthy-e" })
      .unit("v5", "footman", 1130, 720)
      .unit("v5", "footman", 1160, 760)
      .unit("v5", "archer", 1190, 800)
      .unit("v5", "lancer", 1220, 720)
      .unit("v5", "footman", 1250, 760)
      .townHall("v3", 2100, 820)
      .worker("v3", 1850, 780, { id: "v3-target-worker" })
      .worker("v3", 1900, 820)
      .townHall("v4-tr", 3300, 3300)
      .worker("v4-tr", 3260, 3300)
      .goldMine("v5-main", 560, 540, 3000)
      .goldMine("v5-natural", 900, 700, 3000)
      .goldMine("v5-third", 1250, 900, 3000)
      .goldMine("v3-main", 2100, 820, 3000)
      .goldMine("v4-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.workerPressure], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    })[0];
    if (entry?.command.type !== "attack") throw new Error("expected workerPressure attack");

    expect(entry.command.targetId).toBe("v3-target-worker");
    expect(entry.command.unitIds).toHaveLength(11);
    expect(entry.command.unitIds).toContain("wounded-lancer");
  });

  it("v5 uses safe stopped retreaters to punish a stolen first natural town hall", () => {
    const scene = sketchScene("v5-stolen-natural-retreaters-rejoin")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .building("v5", "barracks", 600, 560)
      .building("v5", "archeryRange", 700, 560)
      .building("v5", "stables", 800, 560)
      .unit("v5", "footman", 760, 520, { id: "retreat-1", hp: 105, order: { type: "idle" } })
      .unit("v5", "footman", 790, 550, { id: "retreat-2", hp: 110, order: { type: "idle" } })
      .unit("v5", "lancer", 820, 580, { id: "retreat-3", hp: 96, order: { type: "idle" } })
      .unit("v5", "footman", 850, 610, { id: "ready-1" })
      .unit("v5", "lancer", 880, 640, { id: "ready-2" })
      .townHall("v3", 3300, 3000)
      .townHall("v4-tr", 3300, 3400, { id: "v4-main" })
      .townHall("v4-tr", 1_100, 540, { id: "stolen-natural" })
      .goldMine("v5-main", 420, 520, 3000)
      .goldMine("v5-natural", 1_100, 520, 3000)
      .goldMine("v3-main", 3300, 3000, 3000)
      .goldMine("v4-main-mine", 3300, 3400, 3000)
      .goldMine("extra-route-mine", 2_100, 2_100, 3000)
      .build();
    const game = scene.createGame();
    game.tick = 4_800;
    const memory = createAiPolicyMemory();
    for (const unitId of ["retreat-1", "retreat-2", "retreat-3"]) {
      memory.unitClaims[unitId] = { kind: "retreat", targetId: "retreat", x: 780, y: 560, sinceTick: 4_100, expiresTick: 5_100 };
    }

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.expansion], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
      memory,
    })[0];

    expect(entry).toMatchObject({ scriptId: "expansion", command: { type: "attack", targetId: "stolen-natural" } });
    expect(entry?.command.type === "attack" ? entry.command.unitIds.sort() : []).toEqual(["ready-1", "ready-2", "retreat-1", "retreat-2", "retreat-3"]);
  });

  it("v2 chooses one pressure side by enemy base shape instead of chasing the nearest worker across owners", () => {
    const scene = sketchScene("v2-worker-pressure-base-shape")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .townHall("v2", 900, 500)
      .unit("v2", "footman", 760, 520)
      .unit("v2", "footman", 790, 550)
      .unit("v2", "lancer", 820, 580)
      .unit("v2", "archer", 850, 610)
      .unit("v2", "footman", 880, 640)
      .unit("v2", "lancer", 910, 670)
      .townHall("v1a", 3300, 3300)
      .worker("v1a", 3000, 3180, { id: "nearer-cross-owner-worker" })
      .unit("v1a", "footman", 3160, 3300)
      .unit("v1a", "lancer", 3200, 3340)
      .townHall("v1b", 3280, 3320)
      .worker("v1b", 3220, 3320, { id: "chosen-base-worker" })
      .unit("v1b", "footman", 3150, 3320)
      .unit("v1b", "archer", 3190, 3360)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v2-natural", 900, 520, 3000)
      .goldMine("v1a-main", 3300, 3300, 3000)
      .goldMine("v1b-main", 3280, 3320, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1a" };

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "chosen-base-worker" } });
  });

  it("v2 stops worker pressure when a stronger local army answers the raid", () => {
    const scene = sketchScene("v2-worker-pressure-local-answer")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 2205, 2397, { id: "pressure-footman-a" })
      .unit("v2", "footman", 2155, 2388, { id: "pressure-footman-b" })
      .unit("v2", "lancer", 2215, 2432, { id: "pressure-lancer", hp: 84 })
      .unit("v2", "contractArcher", 2056, 2303, { id: "pressure-archer" })
      .townHall("v1a", 3600, 1480)
      .worker("v1a", 3420, 1410)
      .townHall("v1b", 3600, 2620)
      .worker("v1b", 3400, 2667, { id: "answered-worker" })
      .unit("v1b", "mercenary", 2813, 2012)
      .unit("v1b", "lancer", 2711, 2054)
      .unit("v1b", "footman", 2666, 2057)
      .unit("v1b", "contractArcher", 2965, 1940)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 3300, 1480, 3000)
      .goldMine("v1b-main", 3300, 2620, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1b" };
    for (const unitId of ["pressure-footman-a", "pressure-footman-b", "pressure-lancer", "pressure-archer"]) {
      memory.unitClaims[unitId] = { kind: "harass", targetId: "answered-worker", x: 3400, y: 2667, sinceTick: 0, expiresTick: 900 };
    }

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toBeUndefined();
  });

  it("v5 does not split worker pressure while the target army is fighting its main group", () => {
    const scene = sketchScene("v5-worker-pressure-yields-to-target-army-fight")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 520)
      .unit("v5", "footman", 1480, 2300)
      .unit("v5", "footman", 1520, 2340)
      .unit("v5", "lancer", 1560, 2300)
      .unit("v5", "archer", 1600, 2340)
      .unit("v5", "contractArcher", 1640, 2300)
      .unit("v5", "footman", 1680, 2340)
      .unit("v5", "lancer", 2760, 1120, { id: "pressure-lancer-a" })
      .unit("v5", "lancer", 2800, 1160, { id: "pressure-lancer-b" })
      .unit("v5", "fieldMedic", 2840, 1120, { id: "pressure-medic" })
      .unit("v3", "cinderRunner", 1740, 2300, { order: { type: "attack", targetId: "scene-v5-worker-pressure-yields-to-target-army-fight-v5-footman-1" } })
      .unit("v3", "emberRavager", 1780, 2340)
      .unit("v3", "sparkArcher", 1820, 2300)
      .unit("v3", "emberAcolyte", 1860, 2340)
      .unit("v3", "contractArcher", 1900, 2300)
      .townHall("v3", 3400, 1000)
      .worker("v3", 3260, 980, { id: "v3-target-worker" })
      .worker("v3", 3300, 1020)
      .townHall("v4-tr", 3400, 3800)
      .worker("v4-tr", 3340, 3800)
      .goldMine("v5-main", 420, 520, 3000)
      .goldMine("v5-natural", 900, 520, 3000)
      .goldMine("v3-main", 3300, 1000, 3000)
      .goldMine("v4-main", 3300, 3800, 3000)
      .build();
    const game = scene.createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.workerPressure], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    })[0];

    expect(entry).toBeUndefined();
  });

  it("v5 retreats worker pressure from a tower-covered worker pocket", () => {
    const scene = sketchScene("v5-worker-pressure-tower-pocket")
      .map("bareDuel")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "ember" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .townHall("v5", 900, 520)
      .unit("v5", "footman", 1560, 1520)
      .unit("v5", "footman", 1600, 1560)
      .unit("v5", "lancer", 1640, 1520)
      .unit("v5", "archer", 1680, 1560)
      .unit("v5", "footman", 1720, 1520)
      .unit("v5", "lancer", 1760, 1560)
      .townHall("v3", 3400, 900)
      .unit("v3", "emberRavager", 2100, 1600)
      .unit("v3", "sparkArcher", 2140, 1640)
      .townHall("v4-tr", 2450, 1600)
      .tower("v4-tr", 2230, 1600)
      .worker("v4-tr", 2200, 1600, { id: "covered-worker" })
      .unit("v4-tr", "footman", 2140, 1560)
      .unit("v4-tr", "lancer", 2180, 1640)
      .unit("v4-tr", "contractArcher", 2260, 1640)
      .goldMine("v5-main", 420, 520, 3000)
      .goldMine("v5-natural", 900, 520, 3000)
      .goldMine("v3-main", 3400, 900, 3000)
      .goldMine("v4-main", 2450, 1600, 3000)
      .build();
    const game = scene.createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.workerPressure], {
      version: "v2",
      requestedVersion: "v5",
      teams: game.teams,
    })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "move" } });
  });

  it("v2 stops worker pressure when the other opponent is already threatening its main", () => {
    const scene = sketchScene("v2-worker-pressure-cross-main-threat")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 1500, 500, { id: "pressure-footman-a" })
      .unit("v2", "footman", 1540, 520, { id: "pressure-footman-b" })
      .unit("v2", "lancer", 1580, 500, { id: "pressure-lancer" })
      .unit("v2", "contractArcher", 1620, 520, { id: "pressure-archer" })
      .townHall("v1a", 1800, 500)
      .worker("v1a", 1700, 500, { id: "v1a-target-worker" })
      .townHall("v1b", 3300, 3300)
      .unit("v1b", "footman", 980, 860)
      .unit("v1b", "lancer", 1020, 890)
      .unit("v1b", "footman", 1060, 860)
      .unit("v1b", "contractArcher", 1100, 890)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 1900, 500, 3000)
      .goldMine("v1b-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1a" };
    for (const unitId of ["pressure-footman-a", "pressure-footman-b", "pressure-lancer", "pressure-archer"]) {
      memory.unitClaims[unitId] = { kind: "harass", targetId: "v1a-target-worker", x: 1700, y: 500, sinceTick: 0, expiresTick: 900 };
    }

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams, memory })[0];

    expect(entry).toBeUndefined();
  });

  it("v2 retreats worker pressure when another opponent covers the target worker base", () => {
    const scene = sketchScene("v2-worker-pressure-cross-opponent-base-cover")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 2048)
      .townHall("v2", 720, 2540)
      .unit("v2", "footman", 1660, 2050, { id: "pressure-footman-a" })
      .unit("v2", "footman", 1700, 2080, { id: "pressure-footman-b" })
      .unit("v2", "lancer", 1720, 2020, { id: "pressure-lancer" })
      .unit("v2", "contractArcher", 1640, 2090, { id: "pressure-archer" })
      .townHall("v1a", 3600, 1480)
      .unit("v1a", "footman", 2060, 2150)
      .unit("v1a", "footman", 2100, 2180)
      .unit("v1a", "lancer", 2140, 2120)
      .unit("v1a", "archer", 2180, 2160)
      .townHall("v1b", 2138, 2170, { id: "v1b-natural" })
      .worker("v1b", 2088, 2112, { id: "v1b-covered-worker" })
      .goldMine("v2-main", 420, 2048, 3000)
      .goldMine("v2-natural", 720, 2540, 3000)
      .goldMine("v1a-main", 3600, 1480, 3000)
      .goldMine("v1b-natural-mine", 2138, 2170, 3000)
      .build();
    const game = scene.createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "move" } });
  });

  it("v2 keeps worker pressure available when the pressure squad is already near its main", () => {
    const scene = sketchScene("v2-worker-pressure-main-local")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 560, 520, { id: "pressure-footman-a" })
      .unit("v2", "footman", 600, 540, { id: "pressure-footman-b" })
      .unit("v2", "lancer", 640, 520, { id: "pressure-lancer" })
      .townHall("v1a", 1800, 500)
      .worker("v1a", 760, 520, { id: "v1a-forward-worker" })
      .townHall("v1b", 3300, 3300)
      .unit("v1b", "footman", 880, 760)
      .unit("v1b", "lancer", 920, 790)
      .unit("v1b", "footman", 960, 760)
      .goldMine("v2-main", 420, 520, 3000)
      .goldMine("v1a-main", 1900, 500, 3000)
      .goldMine("v1b-main", 3300, 3300, 3000)
      .build();
    const game = scene.createGame();

    const entry = planAiCommandEntriesFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.workerPressure], { version: "v2", teams: game.teams })[0];

    expect(entry).toMatchObject({ scriptId: "workerPressure", command: { type: "attack", targetId: "v1a-forward-worker" } });
  });

  it("v2 counts early harassment retreats when a larger defending force answers", () => {
    const scene = sketchScene("v2-harass-retreat")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "ember" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .worker("v2", 450, 500)
      .unit("v2", "raider", 1220, 520)
      .unit("v2", "archer", 1240, 550)
      .townHall("v1", 1350, 520)
      .worker("v1", 1290, 520)
      .worker("v1", 1320, 560)
      .unit("v1", "footman", 1260, 500)
      .unit("v1", "footman", 1260, 560)
      .unit("v1", "lancer", 1300, 590)
      .unit("v1", "archer", 1300, 460)
      .build();
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.earlyHarassment], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move" });
    expect(command?.type === "move" ? command.x : 0).toBeCloseTo(500, -2);
    expect(telemetry.behaviors.earlyHarassment.retreatCommands).toBe(1);
  });

  it("v2 retreats disadvantaged open-field skirmish groups toward home and can disable the behavior", () => {
    const scene = sketchScene("v2-skirmish-retreat")
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
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const enabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "attackMove");
    const disabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, disabledBehaviors: ["earlyHarassment", "skirmishPreservation"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "move" && candidate.unitIds.some((id) => id.includes("footman") || id.includes("archer")),
    );

    expect(enabled).toMatchObject({ type: "attackMove" });
    expect(enabled?.type === "attackMove" ? enabled.x : 0).toBeCloseTo(500, -2);
    expect(enabled?.type === "attackMove" ? enabled.unitIds.length : 0).toBe(2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.skirmishPreservation.disadvantagedRetreats).toBe(1);
  });

  it("v5 skirmish preservation does not reserve healthy rear reinforcements during a forward retreat", () => {
    const scene = sketchScene("v5-skirmish-retreat-keeps-rear-reinforcements-free")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "ember" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .worker("v5", 450, 500)
      .unit("v5", "sparkArcher", 1180, 1000, { id: "front-archer", hp: 45 })
      .unit("v5", "emberAcolyte", 1200, 1040, { id: "front-acolyte", hp: 48 })
      .unit("v5", "ashHexer", 1220, 1080, { id: "front-hexer", hp: 50 })
      .unit("v5", "emberRavager", 760, 980, { id: "rear-ravager-a" })
      .unit("v5", "cinderRunner", 780, 1040, { id: "rear-runner-b" })
      .townHall("v3", 3400, 3400)
      .unit("v3", "footman", 1320, 1000)
      .unit("v3", "footman", 1360, 1040)
      .unit("v3", "lancer", 1400, 1080)
      .unit("v3", "archer", 1440, 1120)
      .unit("v3", "raider", 1480, 1160)
      .unit("v3", "footman", 1420, 980)
      .unit("v3", "lancer", 1460, 1020)
      .unit("v3", "archer", 1500, 1060)
      .townHall("v4-tr", 3400, 3800)
      .worker("v4-tr", 3380, 3800)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attackMove", unitIds: expect.arrayContaining(["front-archer", "front-acolyte", "front-hexer"]) });
    expect(command && "unitIds" in command ? command.unitIds : []).not.toEqual(expect.arrayContaining(["rear-ravager-a", "rear-runner-b"]));
  });

  it("v5 grove keeps the existing full local retreat group", () => {
    const scene = sketchScene("v5-grove-skirmish-keeps-full-retreat-group")
      .map("openClaims")
      .replaceDefaults()
      .player("v5", { team: "north", race: "grove" })
      .player("v3", { team: "south", race: "grove" })
      .player("v4-tr", { team: "south", race: "grove" })
      .townHall("v5", 500, 500)
      .worker("v5", 450, 500)
      .unit("v5", "archer", 1180, 1000, { id: "front-archer", hp: 70 })
      .unit("v5", "footman", 1200, 1040, { id: "front-footman", hp: 90 })
      .unit("v5", "lancer", 1220, 1080, { id: "front-lancer", hp: 90 })
      .unit("v5", "raider", 760, 980, { id: "rear-raider-a" })
      .unit("v5", "footman", 780, 1040, { id: "rear-footman-b" })
      .townHall("v3", 3400, 3400)
      .unit("v3", "footman", 1320, 1000)
      .unit("v3", "footman", 1360, 1040)
      .unit("v3", "lancer", 1400, 1080)
      .unit("v3", "archer", 1440, 1120)
      .unit("v3", "raider", 1480, 1160)
      .unit("v3", "footman", 1420, 980)
      .unit("v3", "lancer", 1460, 1020)
      .unit("v3", "archer", 1500, 1060)
      .townHall("v4-tr", 3400, 3800)
      .worker("v4-tr", 3380, 3800)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v5", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", requestedVersion: "v5", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "attackMove", unitIds: expect.arrayContaining(["rear-raider-a", "rear-footman-b"]) });
  });

  it("v2 move-retreats out of a dead opponent base when another opponent controls the field", () => {
    const scene = sketchScene("v2-dead-base-skirmish-move-retreat")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1a", { team: "south", race: "grove" })
      .player("v1b", { team: "south", race: "grove" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 620)
      .townHall("v1a", 1500, 500, { id: "v1a-cleared-natural" })
      .building("v1a", "farm", 3080, 1120)
      .building("v1a", "barracks", 3140, 1180)
      .townHall("v1b", 3400, 3400)
      .unit("v2", "footman", 3000, 1120, { id: "v2-a", order: { type: "attackMove", x: 500, y: 500 } })
      .unit("v2", "lancer", 3040, 1160, { id: "v2-b", order: { type: "attackMove", x: 500, y: 500 } })
      .unit("v2", "archer", 2960, 1160, { id: "v2-c", order: { type: "attackMove", x: 500, y: 500 } })
      .unit("v1b", "footman", 2860, 1160)
      .unit("v1b", "footman", 2900, 1200)
      .unit("v1b", "lancer", 2940, 1240)
      .unit("v1b", "archer", 2980, 1280)
      .unit("v1b", "contractArcher", 3020, 1320)
      .build();
    const game = scene.createGame();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams })[0];

    expect(command).toMatchObject({ type: "move", unitIds: ["v2-a", "v2-b", "v2-c"] });
  });

  it("v2 kites low-health ranged units away from melee units that have closed the distance", () => {
    const scene = sketchScene("v2-ranged-kite-melee")
      .map("bareDuel")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 450, 500)
      .unit("v2", "archer", 1000, 1000, { id: "kiting-archer", hp: 52 })
      .townHall("v1", 3300, 3300)
      .worker("v1", 3350, 3300)
      .unit("v1", "footman", 1030, 1000, { id: "closing-footman", hp: 92 })
      .build();
    const game = scene.createGame();
    const archer = game.units.find((unit) => unit.id === "kiting-archer")!;
    const footman = game.units.find((unit) => unit.id === "closing-footman")!;
    const telemetry = createAiTelemetry();

    const command = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "move");

    expect(command).toMatchObject({ type: "move", unitIds: ["kiting-archer"] });
    if (command?.type !== "move") throw new Error("expected ranged kite move");
    expect(command.x).toBeLessThan(archer.x);
    expect(distance(command, footman)).toBeGreaterThan(distance(archer, footman));
    expect(telemetry.behaviors.skirmishPreservation.rangedKites).toBe(1);
  });

  it("v2 pulls wounded ranged units behind the line and wounded melee units home", () => {
    const scene = sketchScene("v2-wounded-preserve")
      .map("bareDuel")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 450, 500)
      .unit("v2", "footman", 1660, 1500, { hp: 18 })
      .unit("v2", "archer", 1700, 1540, { hp: 16 })
      .unit("v2", "lancer", 1620, 1540)
      .unit("v2", "priest", 1580, 1580)
      .townHall("v1", 3300, 3300)
      .worker("v1", 3350, 3300)
      .unit("v1", "raider", 1800, 1520)
      .unit("v1", "archer", 1840, 1560)
      .build();
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const commands = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, telemetry }).filter((candidate) => candidate.type === "move");

    expect(commands).toHaveLength(2);
    const meleeRetreat = commands.find((command) => command.type === "move" && command.unitIds.some((id) => id.includes("footman")));
    const rangedPullback = commands.find((command) => command.type === "move" && command.unitIds.some((id) => id.includes("archer")));
    expect(meleeRetreat?.type === "move" ? meleeRetreat.x : 0).toBeCloseTo(500, -2);
    expect(rangedPullback?.type === "move" ? rangedPullback.x : 0).toBeLessThan(1700);
    expect(rangedPullback?.type === "move" ? rangedPullback.x : 0).toBeGreaterThan(500);
    expect(telemetry.behaviors.skirmishPreservation.woundedMeleeSaves).toBe(1);
    expect(telemetry.behaviors.skirmishPreservation.woundedRangedPullbacks).toBe(1);
  });

  it("v2 combat pullback preserves ranged units without pulling bruised melee out of the line", () => {
    const scene = sketchScene("v2-combat-pullback-ranged-not-bruised-melee")
      .map("combatArena")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 150, 800)
      .unit("v2", "footman", 800, 800, { id: "bruised-frontliner", hp: 58 })
      .unit("v2", "archer", 760, 760, { id: "wounded-archer", hp: 35 })
      .townHall("v1", 1450, 800)
      .unit("v1", "footman", 850, 800)
      .unit("v1", "raider", 875, 760)
      .build();
    const game = scene.createGame();

    const moves = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.skirmishPreservation], { version: "v2", teams: game.teams, policyMode: "combat" }).filter((command) => command.type === "move");

    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ type: "move", unitIds: ["wounded-archer"] });
  });

  it("v2 regroups to a friendly expansion when losing a fight near an owned mine", () => {
    const scene = sketchScene("v2-expansion-regroup")
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
    const game = scene.createGame();
    const telemetry = createAiTelemetry();

    const enabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionRegroup], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "move");
    const disabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.expansionRegroup], { version: "v2", teams: game.teams, disabledBehaviors: ["expansionRegroup"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "move" && Math.abs(candidate.x - 1450) < 120,
    );

    expect(enabled).toMatchObject({ type: "move" });
    expect(enabled?.type === "move" ? enabled.x : 0).toBeCloseTo(1450, -2);
    expect(enabled?.type === "move" ? enabled.unitIds.length : 0).toBe(2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.expansionRegroup.expansionRegroupRetreats).toBe(1);
  });

  it("v2 opens an extra expansion when the opponent economy is ahead", () => {
    const scene = sketchScene("v2-economic-extra-expand")
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
    const game = scene.createGame();
    keepOnlyIds(game, {
      buildings: ["v2-main", "v2-natural", "v2-natural-tower", "v2-barracks", "v2-archery", "v2-stables", "v1-main", "v1-natural", "v1-third"],
      resources: ["v2-main-mine", "v2-natural-mine", "v2-third-mine", "v1-main-mine", "v1-natural-mine", "v1-third-mine"],
    });
    if (!game.players["v2"]) throw new Error("missing v2 player");
    game.players["v2"].gold = 1200;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    const telemetry = createAiTelemetry();

    const enabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "build");
    const disabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams, disabledBehaviors: ["economicCatchUp"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "build" && candidate.buildingKind === "townHall",
    );

    expect(enabled).toMatchObject({ type: "build", buildingKind: "townHall" });
    expect(enabled?.type === "build" ? enabled.x : 0).toBeCloseTo(1960, -2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.economicCatchUp.catchUpExpansions).toBe(1);
  });

  it("v2 spends a two-base bank on army before a third base when the army is still thin", () => {
    const scene = sketchScene("v2-two-base-army-before-third")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 520, 540, { id: "v2-main-worker-1", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 0 } })
      .worker("v2", 550, 540, { id: "v2-main-worker-2", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 0 } })
      .worker("v2", 580, 540, { id: "v2-main-worker-3", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 0 } })
      .worker("v2", 610, 540, { id: "v2-main-worker-4", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 0 } })
      .worker("v2", 640, 540, { id: "v2-main-worker-5", order: { type: "mine", resourceId: "v2-main-mine", phase: "gather", timer: 0 } })
      .worker("v2", 1360, 650, { id: "v2-natural-worker-1", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .worker("v2", 1390, 650, { id: "v2-natural-worker-2", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .worker("v2", 1420, 650, { id: "v2-natural-worker-3", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .worker("v2", 1450, 650, { id: "v2-natural-worker-4", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .worker("v2", 1480, 650, { id: "v2-natural-worker-5", order: { type: "mine", resourceId: "v2-natural-mine", phase: "gather", timer: 0 } })
      .unit("v2", "footman", 780, 640)
      .unit("v2", "lancer", 820, 680)
      .unit("v2", "archer", 860, 720)
      .townHall("v1", 3300, 3300, { id: "v1-main" })
      .townHall("v1", 2800, 3000, { id: "v1-natural" })
      .worker("v1", 3350, 3300)
      .goldMine("v2-main-mine", 560, 540, 3000)
      .goldMine("v2-natural-mine", 1420, 650, 3000)
      .goldMine("v2-third-mine", 2050, 980, 3000)
      .goldMine("v1-main-mine", 3340, 3300, 3000)
      .goldMine("v1-natural-mine", 2820, 3040, 3000)
      .build();
    const game = scene.createGame();
    game.players.v2!.gold = 340;
    game.players.v2!.supplyUsed = 16;
    game.players.v2!.supplyCap = 28;

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams });

    expect(commands.find((candidate) => candidate.type === "build" && candidate.buildingKind === "townHall")).toBeUndefined();
    expect(commands.find((candidate) => candidate.type === "research")).toMatchObject({ type: "research", upgradeKind: "weaponTraining" });
  });

  it("v2 protects catch-up expansions with towers after core army plans exist", () => {
    const scene = sketchScene("v2-economic-tower")
      .map("openClaims")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .worker("v2", 1320, 620)
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
    const game = scene.createGame();
    keepOnlyIds(game, {
      buildings: ["v2-main", "v2-natural", "v2-barracks", "v2-archery", "v2-stables", "v1-main", "v1-natural", "v1-third"],
      resources: ["v2-main-mine", "v2-natural-mine", "v2-third-mine", "v1-main-mine", "v1-natural-mine", "v1-third-mine"],
    });
    if (!game.players["v2"]) throw new Error("missing v2 player");
    game.players["v2"].gold = 1200;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) worker.order = { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 };
    const telemetry = createAiTelemetry();

    const enabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "build");
    const disabled = planAiCommandsFromScripts(snapshotGame(game), "v2", [AI_SCRIPT_LIBRARY.economicCatchUp], { version: "v2", teams: game.teams, disabledBehaviors: ["economicCatchUp"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "build" && candidate.buildingKind === "defenseTower" && candidate.x > 1200,
    );

    expect(enabled).toMatchObject({ type: "build", buildingKind: "defenseTower" });
    expect(enabled?.type === "build" ? enabled.x : 0).toBeGreaterThan(1200);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.economicCatchUp.catchUpTowers).toBe(1);
  });

  it("keeps expanding across third and fourth mines instead of stopping after the first expansion", () => {
    const scene = sketchScene("v2-multi-mine-economy")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .building("v2", "farm", 560, 700)
      .building("v2", "farm", 610, 735)
      .building("v2", "farm", 660, 770)
      .worker("v2", 470, 500)
      .worker("v2", 500, 540)
      .worker("v2", 540, 500)
      .worker("v2", 560, 540)
      .worker("v2", 580, 500)
      .worker("v2", 600, 540)
      .worker("v2", 620, 500)
      .worker("v2", 640, 540)
      .unit("v2", "footman", 760, 620)
      .unit("v2", "footman", 790, 650)
      .unit("v2", "lancer", 820, 680)
      .unit("v2", "archer", 850, 710)
      .unit("v2", "archer", 880, 740)
      .townHall("target", 3800, 3800, { id: "target-main" })
      .goldMine("v2-main-mine", 560, 540, 4000)
      .goldMine("v2-natural", 1120, 620, 4000)
      .goldMine("v2-third", 1690, 760, 4000)
      .goldMine("v2-fourth", 2260, 920, 4000)
      .goldMine("v2-fifth", 2860, 1100, 4000)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 1800;
    const scripts = [AI_SCRIPT_LIBRARY.economy, AI_SCRIPT_LIBRARY.expansion, AI_SCRIPT_LIBRARY.productionBuilding, AI_SCRIPT_LIBRARY.training];

    runSdkPolicyLoop(game, "v2", scripts, 12_000);

    const minedBases = ownedMiningBases(game, "v2");
    expect(minedBases.length).toBeGreaterThanOrEqual(4);
    expect(minedBases.map((entry) => entry.mineId)).toEqual(expect.arrayContaining(["v2-natural", "v2-third", "v2-fourth"]));
  });

  it("moves on to fresh mines after several owned mines are exhausted", () => {
    const scene = sketchScene("v2-exhausted-mine-repath")
      .map("openClaims")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("target", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1120, 620, { id: "v2-natural-hall" })
      .townHall("v2", 1690, 760, { id: "v2-third-hall" })
      .building("v2", "barracks", 620, 620, { id: "v2-barracks" })
      .building("v2", "archeryRange", 700, 560, { id: "v2-archery" })
      .building("v2", "stables", 740, 660, { id: "v2-stables" })
      .worker("v2", 500, 540)
      .worker("v2", 540, 500)
      .worker("v2", 1120, 670)
      .worker("v2", 1150, 650)
      .worker("v2", 1690, 810)
      .worker("v2", 1720, 790)
      .townHall("target", 3800, 3800, { id: "target-main" })
      .goldMine("v2-main-mine", 560, 540, 0)
      .goldMine("v2-natural", 1120, 620, 0)
      .goldMine("v2-third", 1690, 760, 0)
      .goldMine("v2-fourth", 2260, 920, 1200)
      .goldMine("v2-fifth", 2860, 1100, 1200)
      .build();
    const game = scene.createGame();
    if (!game.players.v2) throw new Error("missing v2 player");
    game.players.v2.gold = 900;
    const scripts = [AI_SCRIPT_LIBRARY.economy, AI_SCRIPT_LIBRARY.expansion, AI_SCRIPT_LIBRARY.productionBuilding, AI_SCRIPT_LIBRARY.training];

    runSdkPolicyLoop(game, "v2", scripts, 4_000);

    const freshBases = ownedMiningBases(game, "v2").filter((entry) => entry.mineId === "v2-fourth" || entry.mineId === "v2-fifth");
    expect(freshBases.length).toBeGreaterThan(0);
  });
});

function keepOnlyIds(game: ReturnType<typeof createGame>, ids: { buildings: string[]; resources: string[] }) {
  const buildings = new Set(ids.buildings);
  const resources = new Set(ids.resources);
  game.buildings = game.buildings.filter((building) => buildings.has(building.id));
  game.resources = game.resources.filter((resource) => resources.has(resource.id));
  game.units = game.units.filter((unit) => unit.id.startsWith("scene-"));
}

function runSdkPolicyLoop(game: ReturnType<typeof createGame>, owner: string, scripts: typeof AI_SCRIPT_VERSIONS.v2, maxTicks: number) {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (tick % 30 === 0) {
      for (const command of planAiCommandsFromScripts(snapshotGame(game), owner, scripts, { version: "v2", teams: game.teams })) {
        issuePlayerCommand(game, owner, command);
      }
    }
    stepGame(game);
  }
}

function ownedMiningBases(game: ReturnType<typeof createGame>, owner: string) {
  return game.buildings
    .filter((building) => building.owner === owner && building.kind === "townHall" && building.complete)
    .flatMap((townHall) => {
      const mine = game.resources.find((resource) => resource.amount > 0 && distance(resource, townHall) < 260);
      if (!mine) return [];
      const miners = game.units.filter((unit) => unit.owner === owner && unit.kind === "worker" && unit.order.type === "mine" && unit.order.resourceId === mine.id);
      return miners.length > 0 ? [{ townHallId: townHall.id, mineId: mine.id, miners: miners.length }] : [];
    });
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
