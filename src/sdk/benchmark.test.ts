import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, UNIT_DEFS } from "../shared/catalog";
import { issuePlayerCommand } from "../shared/sim";
import { runBenchmark, runBenchmarkParallel } from "./benchmark";
import type { SdkGameCommandPlannerContext } from "./game-runner";
import { sketchScene } from "./scene";

describe("SDK benchmark", () => {
  it("returns a nested evaluation and match report with setup details and player result metrics in game seconds", () => {
    const scene = sketchScene("sdk-benchmark-nested-report")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1400, 700, { id: "v2-natural" })
      .building("v2", "defenseTower", 620, 560, { id: "v2-tower" })
      .building("v2", "moonWell", 580, 620, { id: "v2-well" })
      .unit("v2", "footman", 700, 700, { id: "v2-star-footman" })
      .worker("v2", 520, 520, { id: "v2-main-worker" })
      .worker("v2", 1420, 720, { id: "v2-natural-worker" })
      .goldMine("v2-main-mine", 580, 520, 4000)
      .goldMine("v2-natural-mine", 1480, 720, 4000)
      .townHall("v1", 3400, 3400, { id: "v1-main" })
      .worker("v1", 3380, 3380)
      .goldMine("v1-main-mine", 3320, 3380, 4000)
      .build();
    const game = scene.createGame();
    game.units.find((unit) => unit.id === "v2-star-footman")!.level = 2;
    issuePlayerCommand(game, "v2", { type: "mine", unitIds: ["v2-main-worker"], resourceId: "v2-main-mine" });
    issuePlayerCommand(game, "v2", { type: "mine", unitIds: ["v2-natural-worker"], resourceId: "v2-natural-mine" });

    const report = runBenchmark({
      name: "sdk-benchmark-smoke",
      evaluations: [
        {
          name: "shape smoke",
          matches: [
            {
              name: "prebuilt expansion",
              game,
              agents: {
                v2: { adapter: "external", team: "north", race: "grove", versionLabel: "v2" },
                v1: { adapter: "external", team: "south", race: "ember", versionLabel: "v1" },
              },
              maxTicks: 0,
              thinkInterval: 45,
            },
          ],
        },
      ],
    });

    expect(report.evaluations).toHaveLength(1);
    expect(Date.parse(report.startedAt)).not.toBeNaN();
    expect(report.cpuMs).toBeGreaterThanOrEqual(0);
    expect(report.evaluations[0]).toMatchObject({ name: "shape smoke", matchCount: 1 });
    expect(Date.parse(report.evaluations[0]!.startedAt)).not.toBeNaN();
    expect(report.evaluations[0]!.cpuMs).toBeGreaterThanOrEqual(0);
    const match = report.evaluations[0]!.matches[0]!;
    expect(match.cpuMs).toBeGreaterThanOrEqual(0);
    expect(match.setup.map).toMatchObject({ id: "bareDuel", width: 4096, height: 4096, goldMineCount: 3 });
    expect(match.setup.map.neutralCamps.bands).toEqual({ green: 0, orange: 0, red: 0 });
    expect(match.setup.players.v2).toMatchObject({ aiVersion: "v2", race: "grove", team: "north" });
    expect(match.result.players.v2).toMatchObject({
      aiVersion: "v2",
      race: "grove",
      firstExpansionMiningSecond: 0,
      baseBuildCount: 2,
      defenseTowerBuildCount: 1,
      moonWellBuildCount: 1,
      goldMineIncome: 0,
      creepBountyIncome: 0,
      unitTrainingGoldSpent: 0,
      buildingGoldSpent: 0,
      finalBuildingCount: 4,
      finalSupply: 4,
    });
    expect(match.result.players.v2!.starUnitCounts).toMatchObject({ "2": 1 });
  });

  it("supports composable trackers and records combat-contact and expansion-attack timings", () => {
    const scene = sketchScene("sdk-benchmark-composable-trackers")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 760, 500, { id: "v2-natural" })
      .unit("v2", "footman", 778, 500, { id: "v2-defender", order: { type: "attack", targetId: "v1-natural" } })
      .townHall("v1", 3400, 3400, { id: "v1-main" })
      .townHall("v1", 820, 500, { id: "v1-natural" })
      .unit("v1", "raider", 748, 500, { id: "v1-raider", order: { type: "attack", targetId: "v2-natural" } })
      .build();
    const game = scene.createGame();

    const report = runBenchmark({
      name: "sdk-benchmark-trackers",
      trackers: [
        {
          id: "customConstant",
          create: () => ({ seen: true }),
          finish: (state) => state,
        },
      ],
      evaluations: [
        {
          name: "tracker smoke",
          matches: [
            {
              name: "contact and expansion pressure",
              game,
              agents: {
                v2: { adapter: "external", team: "north", race: "grove", versionLabel: "v2" },
                v1: { adapter: "external", team: "south", race: "ember", versionLabel: "v1" },
              },
              maxTicks: 12,
              thinkInterval: 45,
            },
          ],
        },
      ],
    });

    const match = report.evaluations[0]!.matches[0]!;
    expect(match.result.trackers.customConstant).toEqual({ seen: true });
    expect(match.result.players.v2!.firstEnemyEngagementSecond).toBe(0);
    expect(match.result.players.v2!.firstEnemyExpansionAttackSecond).not.toBeNull();
    expect(match.result.players.v2!.firstOwnExpansionAttackedSecond).not.toBeNull();
  });

  it("records building damage as first enemy engagement instead of reporting no fight", () => {
    const scene = sketchScene("sdk-benchmark-building-damage-engagement")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "archer", 650, 500, { id: "v2-archer", order: { type: "attack", targetId: "v1-main" } })
      .townHall("v1", 760, 500, { id: "v1-main" })
      .build();

    const report = runBenchmark({
      name: "sdk-benchmark-building-engagement",
      evaluations: [
        {
          name: "building engagement",
          matches: [
            {
              name: "base hit",
              game: scene.createGame(),
              agents: {
                v2: { adapter: "external", team: "north", race: "grove", versionLabel: "v2" },
                v1: { adapter: "external", team: "south", race: "ember", versionLabel: "v1" },
              },
              maxTicks: 1,
              thinkInterval: 45,
            },
          ],
        },
      ],
    });

    const match = report.evaluations[0]!.matches[0]!;
    expect(match.result.players.v2!.firstEnemyEngagementSecond).toBe(0.05);
    expect(match.result.players.v1!.firstEnemyEngagementSecond).toBe(0.05);
  });

  it("splits gold income into mine income and creep bounty income", () => {
    const scene = sketchScene("sdk-benchmark-income-split")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .worker("v2", 520, 500, { id: "returning-worker", order: { type: "mine", resourceId: "v2-main-mine", phase: "return", timer: 0 } })
      .unit("v2", "footman", 700, 500, { id: "creep-killer", order: { type: "attack", targetId: "low-creep" } })
      .unit("neutral", "mossGnawer", 730, 500, { id: "low-creep", hp: 1 })
      .goldMine("v2-main-mine", 580, 520, 4000)
      .townHall("v1", 3400, 3400)
      .goldMine("v1-main-mine", 3320, 3380, 4000)
      .build();
    const game = scene.createGame();
    game.units.find((unit) => unit.id === "returning-worker")!.carryingGold = 10;

    const report = runBenchmark({
      name: "sdk-benchmark-income",
      evaluations: [
        {
          name: "income split",
          matches: [
            {
              name: "mine and bounty",
              game,
              agents: {
                v2: { adapter: "external", team: "north", race: "grove", versionLabel: "v2" },
                v1: { adapter: "external", team: "south", race: "ember", versionLabel: "v1" },
              },
              maxTicks: 1,
              thinkInterval: 45,
            },
          ],
        },
      ],
    });

    const player = report.evaluations[0]!.matches[0]!.result.players.v2!;
    expect(player.goldMineIncome).toBe(10);
    expect(player.creepBountyIncome).toBe(20);
    expect(player.totalGoldIncome).toBe(30);
  });

  it("reports player units killed by neutral creeps", () => {
    const scene = sketchScene("sdk-benchmark-killed-by-neutral")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 700, 500, { id: "doomed-footman", hp: 1 })
      .unit("neutral", "mossGnawer", 728, 500, { id: "neutral-killer", order: { type: "attack", targetId: "doomed-footman" } })
      .townHall("v1", 3400, 3400)
      .build();

    const report = runBenchmark({
      name: "sdk-benchmark-killed-by-neutral",
      evaluations: [
        {
          name: "neutral deaths",
          matches: [
            {
              name: "creep kill",
              game: scene.createGame(),
              agents: {
                v2: { adapter: "external", team: "north", race: "grove", versionLabel: "v2" },
                v1: { adapter: "external", team: "south", race: "ember", versionLabel: "v1" },
              },
              maxTicks: 1,
              thinkInterval: 45,
            },
          ],
        },
      ],
    });

    const player = report.evaluations[0]!.matches[0]!.result.players.v2!;
    expect(player).toMatchObject({ unitsKilledByNeutral: 1, unitsLost: 1 });
  });

  it("counts actual item pickups and uses instead of failed item commands", () => {
    const scene = sketchScene("sdk-benchmark-actual-item-events")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 500, 500, { id: "carrier" })
      .item("near-book", "experienceBook", 505, 500)
      .item("far-book", "experienceBook", 1200, 500)
      .townHall("v1", 3400, 3400)
      .build();
    const commandPlanner = ({ snapshot, owner, source }: SdkGameCommandPlannerContext) => {
      if (owner !== "v2") return [];
      const nearBook = snapshot.items.find((item) => item.id === "near-book");
      const farBook = snapshot.items.find((item) => item.id === "far-book");
      const command =
        nearBook?.carrierId === "carrier"
          ? { type: "useItem" as const, unitId: "carrier", itemId: "near-book" }
          : nearBook && !nearBook.carrierId
            ? { type: "pickupItem" as const, unitId: "carrier", itemId: "near-book" }
            : farBook && !farBook.carrierId
              ? { type: "pickupItem" as const, unitId: "carrier", itemId: "far-book" }
              : undefined;
      return command ? [{ playerId: owner, source, scriptId: "pickup-and-use", command }] : [];
    };

    const report = runBenchmark({
      name: "sdk-benchmark-item-events",
      evaluations: [
        {
          name: "items",
          matches: [
            {
              name: "actual item transitions",
              game: scene.createGame(),
              agents: {
                v2: { adapter: "external", team: "north", race: "grove", versionLabel: "v2" },
                v1: { adapter: "external", team: "south", race: "ember", versionLabel: "v1" },
              },
              commandPlanner,
              maxTicks: 3,
              thinkInterval: 1,
            },
          ],
        },
      ],
    });

    const player = report.evaluations[0]!.matches[0]!.result.players.v2!;
    expect(player.itemPickupCount).toBe(1);
    expect(player.itemUseCount).toBe(1);
  });

  it("splits gold spending into unit training and building construction", () => {
    const scene = sketchScene("sdk-benchmark-spending-split")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500)
      .building("v2", "barracks", 620, 500, { id: "v2-barracks" })
      .worker("v2", 520, 500, { id: "builder" })
      .townHall("v1", 3400, 3400)
      .build();
    const commandPlanner = ({ owner, source }: SdkGameCommandPlannerContext) => {
      if (owner !== "v2") return [];
      return [
        { playerId: owner, source, scriptId: "build-and-train", command: { type: "build" as const, unitId: "builder", buildingKind: "farm" as const, x: 560, y: 560 } },
        { playerId: owner, source, scriptId: "build-and-train", command: { type: "train" as const, buildingId: "v2-barracks", unitKind: "footman" as const } },
      ];
    };

    const report = runBenchmark({
      name: "sdk-benchmark-spending",
      evaluations: [
        {
          name: "spending split",
          matches: [
            {
              name: "train and build",
              game: scene.createGame(),
              agents: {
                v2: { adapter: "external", team: "north", race: "grove", versionLabel: "v2" },
                v1: { adapter: "external", team: "south", race: "ember", versionLabel: "v1" },
              },
              commandPlanner,
              maxTicks: 1,
              thinkInterval: 1,
            },
          ],
        },
      ],
    });

    const player = report.evaluations[0]!.matches[0]!.result.players.v2!;
    expect(player.buildingGoldSpent).toBe(BUILDING_DEFS.farm.cost);
    expect(player.unitTrainingGoldSpent).toBe(UNIT_DEFS.footman.cost);
    expect(player.totalGoldSpent).toBe(BUILDING_DEFS.farm.cost + UNIT_DEFS.footman.cost);
  });

  it("can report combat elimination winners while base anchors remain alive", () => {
    const scene = sketchScene("sdk-benchmark-combat-elimination-winner")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 150, 800)
      .townHall("v1", 1450, 800)
      .unit("v2", "footman", 760, 800, { id: "v2-footman", order: { type: "attack", targetId: "v1-footman" } })
      .unit("v1", "footman", 790, 800, { id: "v1-footman", hp: 1 })
      .build();

    const report = runBenchmark({
      name: "sdk-benchmark-combat-elimination",
      evaluations: [
        {
          name: "combat elimination",
          tag: "combat",
          matches: [
            {
              name: "anchors stay alive",
              game: scene.createGame(),
              winnerMode: "combatElimination",
              agents: {
                v2: { adapter: "external", team: "north", race: "grove", versionLabel: "v2" },
                v1: { adapter: "external", team: "south", race: "ember", versionLabel: "v1" },
              },
              maxTicks: 1,
              thinkInterval: 45,
            },
          ],
        },
      ],
    });

    const match = report.evaluations[0]!.matches[0]!;
    expect(match.result).toMatchObject({ winner: "v2", winnerTeam: "north", timeout: false });
    expect(match.result.players.v1!.finalSupply).toBe(0);
    expect(match.result.players.v1!.finalBuildingCount).toBe(1);
  });

  it("runs serializable benchmark matches in parallel workers while preserving report order", async () => {
    const input = {
      name: "sdk-parallel-benchmark",
      evaluations: [
        {
          name: "first lane",
          matches: [
            {
              name: "first match",
              mapId: "bareDuel" as const,
              agents: {
                v2: { adapter: "external" as const, team: "north", race: "grove" as const, versionLabel: "v2" },
                v1: { adapter: "external" as const, team: "south", race: "ember" as const, versionLabel: "v1" },
              },
              maxTicks: 0,
              thinkInterval: 45,
            },
          ],
        },
        {
          name: "second lane",
          matches: [
            {
              name: "second match",
              mapId: "openClaims" as const,
              agents: {
                v2: { adapter: "external" as const, team: "north", race: "grove" as const, versionLabel: "v2" },
                v1: { adapter: "external" as const, team: "south", race: "ember" as const, versionLabel: "v1" },
              },
              maxTicks: 0,
              thinkInterval: 45,
            },
          ],
        },
      ],
    };

    const report = await runBenchmarkParallel(input, { workers: 2, workerModule: new URL("./benchmark/core-worker.ts", import.meta.url).href });

    expect(report).toMatchObject({
      name: "sdk-parallel-benchmark",
      evaluationCount: 2,
      matchCount: 2,
      evaluations: [{ name: "first lane", matches: [{ name: "first match" }] }, { name: "second lane", matches: [{ name: "second match" }] }],
    });
    expect(report.cpuMs).toBeCloseTo(report.evaluations.reduce((total, evaluation) => total + evaluation.cpuMs, 0), 3);
  });

  it("keeps benchmark workers alive across multiple tasks instead of spawning one process per match", async () => {
    const input = {
      name: "sdk-parallel-worker-pool",
      evaluations: [
        {
          name: "pool lane",
          matches: [
            {
              name: "first pooled task",
              mapId: "bareDuel" as const,
              agents: {},
              maxTicks: 0,
              thinkInterval: 45,
            },
            {
              name: "second pooled task",
              mapId: "openClaims" as const,
              agents: {},
              maxTicks: 0,
              thinkInterval: 45,
            },
          ],
        },
      ],
    };

    const report = await runBenchmarkParallel(input, { workers: 1, workerModule: new URL("./benchmark/persistent-worker-fixture.ts", import.meta.url).href });

    expect(report.evaluations[0]!.matches.map((match) => match.result.trackers.callIndex)).toEqual([1, 2]);
  });
});
