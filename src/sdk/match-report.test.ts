import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "../shared/catalog";
import { createBuilding } from "../shared/map";
import type { PlayerId } from "../shared/types";
import { summarizeMatchState, summarizeTimelineSample } from "./match-report";
import { sketchScene } from "./scene";

describe("SDK match report summaries", () => {
  it("summarizes remaining army, army value, buildings, and team totals from a real game", () => {
    const scene = sketchScene("report-army-state")
      .map("bareDuel")
      .replaceDefaults()
      .player("alpha", { team: "north", race: "grove" })
      .player("beta", { team: "south", race: "ember" })
      .townHall("alpha", 500, 500, { id: "alpha-main" })
      .building("alpha", "barracks", 620, 620, { id: "alpha-barracks" })
      .worker("alpha", 520, 520)
      .unit("alpha", "footman", 700, 700)
      .unit("alpha", "archer", 740, 700, { hp: 40 })
      .townHall("beta", 3300, 3300, { id: "beta-main" })
      .worker("beta", 3320, 3300)
      .unit("beta", "raider", 3220, 3300)
      .build();
    const game = scene.createGame();
    game.buildings.push(createBuilding("beta-farm", "beta", "farm", 3240, 3360, true));
    const teams: Record<PlayerId, string> = { alpha: "north", beta: "south" };

    const report = summarizeMatchState(game, teams);

    expect(report.players.alpha).toMatchObject({
      team: "north",
      remainingWorkers: 1,
      remainingCombatUnits: 2,
      remainingBuildings: 2,
      remainingTownHalls: 1,
      remainingNonBaseBuildings: 1,
    });
    expect(report.players.alpha!.remainingArmyValue).toBeCloseTo(UNIT_DEFS.footman.cost + UNIT_DEFS.archer.cost * (40 / UNIT_DEFS.archer.hp), 5);
    expect(report.players.beta!.remainingCombatUnits).toBe(1);
    expect(report.teams.north!.remainingCombatUnits).toBe(2);
    expect(report.teams.south!.remainingBuildings).toBe(2);
    expect(Object.keys(report.players).sort()).toEqual(["alpha", "beta"]);
  });

  it("samples economy, production, tech, queues, and army state for gauntlet time-series debugging", () => {
    const scene = sketchScene("report-timeline")
      .map("bareDuel")
      .replaceDefaults()
      .player("alpha", { team: "north", race: "grove" })
      .player("beta", { team: "south", race: "ember" })
      .townHall("alpha", 500, 500, { id: "alpha-main" })
      .building("alpha", "barracks", 620, 620, { id: "alpha-barracks" })
      .building("alpha", "archeryRange", 700, 620, { id: "alpha-archery" })
      .worker("alpha", 520, 520)
      .unit("alpha", "footman", 700, 700)
      .unit("alpha", "archer", 740, 700)
      .townHall("beta", 3300, 3300, { id: "beta-main" })
      .worker("beta", 3320, 3300)
      .build();
    const game = scene.createGame();
    const alpha = game.players.alpha;
    if (!alpha) throw new Error("missing alpha player");
    alpha.gold = 275;
    alpha.supplyUsed = 5;
    alpha.supplyCap = 16;
    alpha.upgrades.weaponTraining = 1;
    game.buildings.find((building) => building.id === "alpha-barracks")!.queue.push({ unitKind: "footman", remaining: 50 });
    game.tick = 1234;

    const sample = summarizeTimelineSample(game, { alpha: "north", beta: "south" });

    expect(sample.tick).toBe(1234);
    expect(sample.players.alpha).toMatchObject({
      team: "north",
      gold: 275,
      supplyUsed: 5,
      supplyCap: 16,
      workers: 1,
      combatUnits: 2,
      bases: 1,
      productionBuildings: 2,
      queuedUnits: 1,
      upgrades: ["weaponTraining:1"],
    });
    expect(sample.players.alpha!.armyPower).toBeGreaterThan(sample.players.beta!.armyPower);
    expect(sample.teams.north!.productionBuildings).toBe(2);
  });
});
