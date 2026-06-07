import { describe, expect, it } from "vitest";
import { ABILITY_DEFS, BUILDING_DEFS, MERCENARY_UNIT_KINDS, RACE_DEFS, TRAINABLE_UNIT_KINDS, UNIT_DEFS, UPGRADE_DEFS } from "./catalog";
import { AI_SCRIPT_LIBRARY } from "../ai/policy";
import { createAiRuntime, type AiRuntimeState } from "../ai/runtime";
import { runPresetAiRuntimeForTest } from "../ai/runtime-test-helpers";
import { createBuilding, createInitialResources } from "./map";
import { createGame, issueCommand, issuePlayerCommand, stepGame } from "./sim";
import { seconds } from "./time";
import { sketchScene } from "../sdk/scene";
import type { MapId, PlayerId, PlayerNumberMap, Unit, UnitKind } from "./types";

const AI_DUEL_CPU_BUDGET_MS = 4_500;

function elapsedCpuMs(started: NodeJS.CpuUsage) {
  const elapsed = process.cpuUsage(started);
  return (elapsed.user + elapsed.system) / 1_000;
}

function stepMany(game: ReturnType<typeof createGame>, count: number, runtime?: AiRuntimeState) {
  for (let i = 0; i < count; i += 1) {
    if (runtime) runPresetAiRuntimeForTest(game, runtime);
    stepGame(game);
  }
}

function stepUntil(game: ReturnType<typeof createGame>, maxTicks: number, predicate: () => boolean, runtime?: AiRuntimeState) {
  for (let i = 0; i < maxTicks && !predicate(); i += 1) {
    if (runtime) runPresetAiRuntimeForTest(game, runtime);
    stepGame(game);
  }
  return predicate();
}

function runTwoAiDuel(mapId: MapId) {
  const game = createGame(mapId, { aiPlayers: ["player", "enemy"] });
  const runtime = createAiRuntime(["player", "enemy"]);
  const started = process.cpuUsage();
  stepMany(game, 36_000, runtime);
  return { game, elapsedMs: elapsedCpuMs(started) };
}

function expectTwoAiDuelBaseline({ game, elapsedMs }: ReturnType<typeof runTwoAiDuel>) {
  const totalNonBaseBuildingsDestroyed = sumPlayerStats(game.match.stats.nonBaseBuildingsDestroyed);
  const losingOwners = game.activePlayers
    .filter((owner) => owner !== game.match.winner)
    .map((owner) => ({
      buildings: game.buildings.filter((building) => building.owner === owner).length,
      workers: game.units.filter((unit) => unit.owner === owner && unit.kind === "worker").length,
    }));

  expect(game.match.winner).not.toBeNull();
  expect(game.match.endedAtTick).toBeLessThanOrEqual(36_000);
  expect(elapsedMs).toBeLessThan(AI_DUEL_CPU_BUDGET_MS);
  expect(game.match.stats.goldSpent.player).toBeGreaterThan(1_500);
  expect(game.match.stats.goldSpent.enemy).toBeGreaterThan(1_500);
  expect(game.match.stats.unitsKilled.player).toBeGreaterThan(0);
  expect(game.match.stats.unitsKilled.enemy).toBeGreaterThan(0);
  expect(game.match.stats.unitsLost.player).toBeGreaterThan(0);
  expect(game.match.stats.unitsLost.enemy).toBeGreaterThan(0);
  expect(totalNonBaseBuildingsDestroyed).toBeGreaterThan(0);
  expect(losingOwners).toEqual(expect.arrayContaining([expect.objectContaining({ buildings: 0, workers: 0 })]));
}

function expectActivePlayersSpent(game: ReturnType<typeof createGame>, minimum: number) {
  for (const owner of game.activePlayers) {
    expect(game.match.stats.goldSpent[owner]).toBeGreaterThan(minimum);
  }
}

function expectWinnerSpentAndLosersDiedCleanly(game: ReturnType<typeof createGame>, winnerMinimum: number, loserMinimum: number, maxLoserCombat = 4) {
  for (const owner of game.activePlayers) {
    if (owner === game.match.winner) {
      expect(game.match.stats.goldSpent[owner]).toBeGreaterThan(winnerMinimum);
      continue;
    }
    const remainingCombat = game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length;
    const remainingBuildings = game.buildings.filter((building) => building.owner === owner).length;
    expect(game.match.stats.goldSpent[owner]).toBeGreaterThan(loserMinimum);
    expect((game.match.stats.unitsKilled[owner] ?? 0) + (game.match.stats.unitsLost[owner] ?? 0)).toBeGreaterThan(0);
    expect(remainingCombat).toBeLessThanOrEqual(maxLoserCombat);
    expect(remainingBuildings).toBe(0);
  }
}

function sumPlayerStats(record: PlayerNumberMap) {
  return record.player + record.enemy + record.enemy2;
}

describe("sketch RTS simulation", () => {
  it("defines a production roster with at least 10 distinct unit kinds and 5 building kinds including a tower", () => {
    expect(TRAINABLE_UNIT_KINDS.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(UNIT_DEFS)).toEqual(expect.arrayContaining(["priest", "summoner", "witch", "golem", "groveWarden", "emberRavager", "cinderRunner", "sparkArcher", "emberAcolyte", "ashHexer", "pyreCaller"]));
    expect(MERCENARY_UNIT_KINDS).toEqual(expect.arrayContaining(["mercenary", "contractArcher", "fieldMedic"]));
    expect(MERCENARY_UNIT_KINDS).toHaveLength(3);
    expect(Object.keys(BUILDING_DEFS).length).toBeGreaterThanOrEqual(5);
    expect(BUILDING_DEFS.defenseTower.attackDamage).toBeGreaterThan(0);
    expect(Object.keys(RACE_DEFS)).toEqual(expect.arrayContaining(["grove", "ember"]));
    expect(RACE_DEFS.grove.trainableUnits).toEqual(expect.arrayContaining(["worker", "footman", "archer", "priest", "groveWarden"]));
    expect(RACE_DEFS.grove.trainableUnits).not.toEqual(expect.arrayContaining(["emberRavager", "cinderRunner", "sparkArcher", "emberAcolyte", "ashHexer", "pyreCaller"]));
    expect(RACE_DEFS.grove.buildableBuildings).toEqual(expect.arrayContaining(["townHall", "barracks", "archeryRange", "sanctum", "defenseTower", "moonWell", "farm"]));
    expect(RACE_DEFS.grove.buildableBuildings).not.toEqual(expect.arrayContaining(["emberForge", "cinderSpire", "emberShrine"]));
    expect(RACE_DEFS.ember.trainableUnits).toEqual(expect.arrayContaining(["worker", "emberRavager", "cinderRunner", "sparkArcher", "emberAcolyte", "ashHexer", "pyreCaller"]));
    expect(RACE_DEFS.ember.trainableUnits).not.toEqual(expect.arrayContaining(["footman", "archer", "raider", "lancer", "groveWarden", "knight", "priest", "summoner", "witch", "golem"]));
    expect(RACE_DEFS.ember.buildableBuildings).toEqual(expect.arrayContaining(["townHall", "emberForge", "cinderSpire", "emberShrine", "defenseTower", "farm"]));
    expect(RACE_DEFS.ember.buildableBuildings).not.toEqual(expect.arrayContaining(["barracks", "archeryRange", "stables", "sanctum", "workshop", "moonWell"]));
  });

  it("keeps ember exclusive unit raw value no stronger than grove analogues", () => {
    const rawValue = (kind: keyof typeof UNIT_DEFS) => (UNIT_DEFS[kind].hp * UNIT_DEFS[kind].attackDamage) / UNIT_DEFS[kind].cost;

    expect(rawValue("emberRavager")).toBeLessThanOrEqual(rawValue("groveWarden"));
    expect(rawValue("cinderRunner")).toBeLessThanOrEqual(rawValue("raider"));
    expect(rawValue("sparkArcher")).toBeLessThanOrEqual(rawValue("archer"));
    expect(rawValue("emberAcolyte")).toBeLessThanOrEqual(rawValue("priest"));
    expect(rawValue("ashHexer")).toBeLessThanOrEqual(rawValue("witch"));
    expect(rawValue("pyreCaller")).toBeLessThanOrEqual(rawValue("summoner"));
  });

  it("gives ember support units their own abilities through shared ability primitives", () => {
    expect(UNIT_DEFS.emberAcolyte.abilities).toEqual(["emberMend"]);
    expect(UNIT_DEFS.ashHexer.abilities).toEqual(["ashCurse"]);
    expect(UNIT_DEFS.pyreCaller.abilities).toEqual(["cinderSoul"]);
    expect(ABILITY_DEFS.emberMend).toMatchObject({ behavior: "heal", range: 240, plannerRange: 220, healAmount: 55, cooldown: seconds(6) });
    expect(ABILITY_DEFS.ashCurse).toMatchObject({ behavior: "curse", range: 280, plannerRange: 260, damageMultiplier: 0.4, effectDuration: seconds(18), cooldown: seconds(7.5) });
    expect(ABILITY_DEFS.cinderSoul).toMatchObject({ behavior: "summon", range: 260, plannerRange: 240, summonDuration: seconds(45), cooldown: seconds(11) });
  });

  it("keeps starts fair and prices paced for the slower five-worker mine economy", () => {
    const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: ["player", "enemy"] });

    expect(game.players.player.gold).toBe(game.players.enemy.gold);
    expect(BUILDING_DEFS.barracks.cost + BUILDING_DEFS.farm.cost + UNIT_DEFS.footman.cost + UNIT_DEFS.lancer.cost).toBeLessThanOrEqual(game.players.player.gold);
    expect(UNIT_DEFS.worker.cost).toBeLessThanOrEqual(75);
    expect(UNIT_DEFS.footman.cost).toBeLessThanOrEqual(105);
    expect(UNIT_DEFS.archer.cost).toBeLessThanOrEqual(115);
    expect(BUILDING_DEFS.defenseTower.cost).toBeLessThan(BUILDING_DEFS.barracks.cost);
    expect(BUILDING_DEFS.townHall.cost).toBeGreaterThan(BUILDING_DEFS.barracks.cost + UNIT_DEFS.worker.cost);
    expect(BUILDING_DEFS.townHall.buildTime).toBeGreaterThanOrEqual(BUILDING_DEFS.barracks.buildTime * 2);
  });

  it("applies the ranged nerf and curse-support balance slice without changing melee prices", () => {
    expect(UNIT_DEFS.footman).toMatchObject({ attackDamage: 16, attackRange: 48, cost: 100 });
    expect(UNIT_DEFS.mercenary).toMatchObject({ attackDamage: 28, attackRange: 62, cost: 160 });
    expect(UNIT_DEFS.archer).toMatchObject({ attackDamage: 13, attackRange: 399, cost: 115 });
    expect(UNIT_DEFS.contractArcher).toMatchObject({ attackDamage: 19, attackRange: 441, cost: 145 });
    expect(UNIT_DEFS.priest).toMatchObject({ attackDamage: 7, attackRange: 252, cost: 135 });
    expect(UNIT_DEFS.summoner).toMatchObject({ attackDamage: 8, attackRange: 273, cost: 150 });
    expect(UNIT_DEFS.witch).toMatchObject({ attackDamage: 8, attackRange: 315, cost: 145 });
    expect(UNIT_DEFS.fieldMedic).toMatchObject({ attackDamage: 8, attackRange: 263, cost: 155 });
    expect(BUILDING_DEFS.defenseTower).toMatchObject({ hp: 200, attackDamage: 16, attackRange: 480, cost: 125 });
    expect(BUILDING_DEFS.moonWell).toMatchObject({ attackDamage: 0, attackRange: 210, cost: 115 });

    expect((UNIT_DEFS.archer.attackDamage * UNIT_DEFS.archer.hp) / UNIT_DEFS.archer.cost).toBeLessThan((UNIT_DEFS.footman.attackDamage * UNIT_DEFS.footman.hp) / UNIT_DEFS.footman.cost);
    expect((UNIT_DEFS.contractArcher.attackDamage * UNIT_DEFS.contractArcher.hp) / UNIT_DEFS.contractArcher.cost).toBeLessThan((UNIT_DEFS.mercenary.attackDamage * UNIT_DEFS.mercenary.hp) / UNIT_DEFS.mercenary.cost);
  });

  it("keeps tech cheaper to start but slower to complete", () => {
    expect(UPGRADE_DEFS.weaponTraining.levels).toEqual([
      { cost: 140, researchTime: seconds(34.5), attackBonus: 2, maxHpBonus: 0 },
      { cost: 215, researchTime: seconds(46.5), attackBonus: 3, maxHpBonus: 0 },
      { cost: 320, researchTime: seconds(60), attackBonus: 3, maxHpBonus: 0 },
    ]);
    expect(UPGRADE_DEFS.reinforcedPlating.levels).toEqual([
      { cost: 165, researchTime: seconds(40.5), attackBonus: 0, maxHpBonus: 10 },
      { cost: 250, researchTime: seconds(52.5), attackBonus: 0, maxHpBonus: 15 },
      { cost: 360, researchTime: seconds(66), attackBonus: 0, maxHpBonus: 20 },
    ]);
    expect(UPGRADE_DEFS.buildingDurability.levels).toEqual([{ cost: 260, researchTime: seconds(54), attackBonus: 0, maxHpBonus: 0, buildingMaxHpMultiplier: 1.2 }]);
  });

  it("tracks which player lost units to neutral creeps", () => {
    const game = sketchScene("neutral-killed-player-unit")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north", race: "grove" })
      .player("enemy", { team: "south", race: "ember" })
      .townHall("player", 500, 500)
      .unit("player", "footman", 700, 500, { id: "doomed-footman", hp: 1 })
      .unit("neutral", "mossGnawer", 728, 500, { id: "neutral-killer", order: { type: "attack", targetId: "doomed-footman" } })
      .townHall("enemy", 3400, 3400)
      .build()
      .createGame();

    stepGame(game);

    expect(game.match.stats.unitsKilled.neutral).toBe(1);
    expect(game.match.stats.unitsKilledByNeutral.player).toBe(1);
    expect(game.match.stats.unitsKilledByNeutral.enemy).toBe(0);
  });

  it("leashes neutral units back to their authored camp instead of chasing into worker lines", () => {
    const game = sketchScene("neutral-leash")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 180, 1000)
      .worker("v2", 220, 1000, { id: "worker-line" })
      .unit("v2", "raider", 820, 1000, { id: "puller" })
      .unit("neutral", "stonebackBrute", 900, 1000, { id: "camp-brute" })
      .townHall("v1", 3500, 3500)
      .build()
      .createGame();

    issuePlayerCommand(game, "v2", { type: "attack", unitIds: ["puller"], targetId: "camp-brute" });
    stepMany(game, 80);
    issuePlayerCommand(game, "v2", { type: "move", unitIds: ["puller"], x: 180, y: 1000 });
    stepMany(game, 360);

    const brute = game.units.find((unit) => unit.id === "camp-brute");
    const worker = game.units.find((unit) => unit.id === "worker-line");
    expect(brute).toBeDefined();
    expect(worker).toBeDefined();
    expect(Math.hypot(brute!.x - 900, brute!.y - 1000)).toBeLessThan(40);
    expect(worker!.hp).toBe(worker!.maxHp);
  });

  it("keeps neutral camp homes at their initialized map coordinates", () => {
    const game = createGame("verdantCrossroads", { aiPlayers: [] });
    const neutralUnits = game.units.filter((unit) => unit.owner === "neutral");

    expect(neutralUnits.length).toBeGreaterThan(0);
    for (const unit of neutralUnits) {
      expect(unit.homeX, unit.id).toBeCloseTo(unit.x, 5);
      expect(unit.homeY, unit.id).toBeCloseTo(unit.y, 5);
    }

    stepGame(game);

    expect(game.units.filter((unit) => unit.owner === "neutral" && unit.order.type === "move")).toEqual([]);
  });

  it("calls nearby neutral allies when a camp unit is damaged outside ordinary aggro range", () => {
    const game = sketchScene("neutral-assist-on-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 180, 1000)
      .unit("v2", "archer", 1000, 1000, { id: "pulling-archer" })
      .unit("neutral", "mossGnawer", 1188, 1000, { id: "damaged-creep" })
      .unit("neutral", "mossGnawer", 1220, 1070, { id: "called-creep" })
      .townHall("v1", 3500, 3500)
      .build()
      .createGame();

    issuePlayerCommand(game, "v2", { type: "attack", unitIds: ["pulling-archer"], targetId: "damaged-creep" });
    stepMany(game, 24);

    const damaged = game.units.find((unit) => unit.id === "damaged-creep");
    const called = game.units.find((unit) => unit.id === "called-creep");
    expect(damaged?.hp).toBeLessThan(damaged?.maxHp ?? 0);
    expect(damaged?.order).toMatchObject({ type: "attack", targetId: "pulling-archer" });
    expect(called?.order).toMatchObject({ type: "attack", targetId: "pulling-archer" });
  });

  it("keeps long-range neutral damage aggro from being erased by the camp leash", () => {
    const game = sketchScene("neutral-long-range-assist-on-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 180, 1000)
      .unit("v2", "archer", 800, 1000, { id: "pulling-archer" })
      .unit("neutral", "mossGnawer", 1188, 1000, { id: "damaged-creep" })
      .unit("neutral", "mossGnawer", 1220, 1070, { id: "called-creep" })
      .townHall("v1", 3500, 3500)
      .build()
      .createGame();

    issuePlayerCommand(game, "v2", { type: "attack", unitIds: ["pulling-archer"], targetId: "damaged-creep" });
    stepMany(game, 24);

    const damaged = game.units.find((unit) => unit.id === "damaged-creep");
    const called = game.units.find((unit) => unit.id === "called-creep");
    expect(damaged?.hp).toBeLessThan(damaged?.maxHp ?? 0);
    expect(damaged?.order).toMatchObject({ type: "attack", targetId: "pulling-archer" });
    expect(called?.order).toMatchObject({ type: "attack", targetId: "pulling-archer" });
  });

  it("keeps maximum-range neutral damage response from being erased by the camp leash", () => {
    const game = sketchScene("neutral-tower-range-assist-on-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 180, 1000)
      .building("v2", "defenseTower", 720, 1000, { id: "pulling-tower" })
      .unit("neutral", "mossGnawer", 1188, 1000, { id: "damaged-creep" })
      .unit("neutral", "mossGnawer", 1220, 1070, { id: "called-creep" })
      .townHall("v1", 3500, 3500)
      .build()
      .createGame();

    stepMany(game, 24);

    const damaged = game.units.find((unit) => unit.id === "damaged-creep");
    const called = game.units.find((unit) => unit.id === "called-creep");
    expect(damaged?.hp).toBeLessThan(damaged?.maxHp ?? 0);
    expect(damaged?.order).toMatchObject({ type: "attack", targetId: "pulling-tower" });
    expect(called?.order).toMatchObject({ type: "attack", targetId: "pulling-tower" });
  });

  it("keeps wide-camp neutral assist aggro anchored to the damaged camp member", () => {
    const game = sketchScene("neutral-wide-camp-assist-on-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "grove" })
      .townHall("v2", 180, 1000)
      .unit("v2", "archer", 789, 1000, { id: "pulling-archer" })
      .unit("neutral", "mossGnawer", 1188, 1000, { id: "damaged-creep" })
      .unit("neutral", "mossGnawer", 1268, 1070, { id: "called-wide-creep" })
      .townHall("v1", 3500, 3500)
      .build()
      .createGame();

    issuePlayerCommand(game, "v2", { type: "attack", unitIds: ["pulling-archer"], targetId: "damaged-creep" });
    stepMany(game, 24);

    const damaged = game.units.find((unit) => unit.id === "damaged-creep");
    const called = game.units.find((unit) => unit.id === "called-wide-creep");
    expect(damaged?.hp).toBeLessThan(damaged?.maxHp ?? 0);
    expect(damaged?.order).toMatchObject({ type: "attack", targetId: "pulling-archer" });
    expect(called?.order).toMatchObject({ type: "attack", targetId: "pulling-archer" });
  });

  it("keeps map gold mines lean enough that expansions and harassment matter", () => {
    const regularMaps = ["verdantCrossroads", "bareDuel", "openClaims", "campRush", "wildMarches"] as const;

    for (const mapId of regularMaps) {
      const mines = createInitialResources(mapId, ["player", "enemy"]);
      expect(Math.max(...mines.filter((mine) => mine.id.includes("-main")).map((mine) => mine.amount))).toBe(6_000);
      expect(Math.max(...mines.map((mine) => mine.amount))).toBe(6_000);
      expect(Math.min(...mines.map((mine) => mine.amount))).toBe(6_000);
    }

    const grandMines = createInitialResources("grandThirty", Array.from({ length: 30 }, (_, index) => `p${index + 1}`));
    expect(Math.max(...grandMines.map((mine) => mine.amount))).toBe(6_000);
    expect(Math.min(...grandMines.map((mine) => mine.amount))).toBe(6_000);
  });

  it("balances defense towers as durable static control with the release tower damage", () => {
    const tower = BUILDING_DEFS.defenseTower;
    const contractArcher = UNIT_DEFS.contractArcher;

    expect(tower.hp).toBe(200);
    expect(tower.attackDamage).toBe(16);
    expect(tower.attackDamage).toBeLessThan(contractArcher.attackDamage);
    expect(tower.attackRange).toBe(480);
    expect(tower.attackRange).toBeGreaterThan(contractArcher.attackRange);
    expect(tower.attackCooldown).toBeGreaterThan(contractArcher.attackCooldown);
    expect(tower.cost).toBeGreaterThanOrEqual(120);
  });

  it("stores race as player state and lets preset AI use race-specific production choices", () => {
    const grove = createGame("bareDuel", { aiPlayers: ["enemy"], races: { enemy: "grove" } });
    const ember = createGame("bareDuel", { aiPlayers: ["enemy"], races: { enemy: "ember" } });
    grove.players.enemy.gold = 5000;
    ember.players.enemy.gold = 5000;
    grove.buildings.push(createBuilding("building-enemy-grove-sanctum-proof", "enemy", "sanctum", 3100, 3100, true));
    ember.buildings.push(createBuilding("building-enemy-ember-spire-proof", "enemy", "cinderSpire", 3100, 3100, true));
    const groveRuntime = createAiRuntime(["enemy"], { scripts: [AI_SCRIPT_LIBRARY.training] });
    const emberRuntime = createAiRuntime(["enemy"], { scripts: [AI_SCRIPT_LIBRARY.training] });

    stepMany(grove, 50, groveRuntime);
    stepMany(ember, 50, emberRuntime);

    const groveSanctum = grove.buildings.find((building) => building.id === "building-enemy-grove-sanctum-proof")!;
    const emberSpire = ember.buildings.find((building) => building.id === "building-enemy-ember-spire-proof")!;
    expect(grove.players.enemy.race).toBe("grove");
    expect(ember.players.enemy.race).toBe("ember");
    expect(groveSanctum.queue[0]?.unitKind).toBe("priest");
    expect(emberSpire.queue[0]?.unitKind).toBe("sparkArcher");
  });

  it("creates a compact 4096 square sample map with authored content inside bounds", () => {
    const game = createGame();

    expect(game.map.width).toBe(4096);
    expect(game.map.height).toBe(4096);
    expect(game.map.landmarks.length).toBeGreaterThanOrEqual(20);
    expect(new Set(game.map.landmarks.map((landmark) => landmark.kind)).size).toBeGreaterThanOrEqual(5);
    for (const point of [...game.units, ...game.buildings, ...game.resources, ...game.mercenaryCamps]) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(game.map.width);
      expect(point.y).toBeLessThanOrEqual(game.map.height);
    }
    expect(game.resources.some((resource) => resource.kind === "goldMine")).toBe(true);
    expect(game.units.some((unit) => unit.owner === "neutral")).toBe(true);
  });

  it("defines map variants for every expansion and neutral-camp layout class", () => {
    const cases = [
      { mapId: "bareDuel", hasExpansion: false, hasNeutral: false },
      { mapId: "openClaims", hasExpansion: true, hasNeutral: false },
      { mapId: "campRush", hasExpansion: false, hasNeutral: true },
      { mapId: "verdantCrossroads", hasExpansion: true, hasNeutral: true },
    ] as const;

    for (const scenario of cases) {
      const game = createGame(scenario.mapId);
      const expansionMines = game.resources.filter((resource) => resource.id !== "gold-player-main" && resource.id !== "gold-enemy-main");
      const neutralUnits = game.units.filter((unit) => unit.owner === "neutral");

      expect(expansionMines.length > 0).toBe(scenario.hasExpansion);
      expect(neutralUnits.length > 0).toBe(scenario.hasNeutral);
    }
  });

  it("places allied players on their team side instead of splitting starts by raw slot index", () => {
    const game = createGame("bareDuel", {
      players: ["v2", "v1a", "v1b"],
      aiPlayers: [],
      teams: { v2: "north", v1a: "south", v1b: "south" },
    });

    const townHallX = (owner: string) => game.buildings.find((building) => building.owner === owner && building.kind === "townHall")!.x;

    expect(townHallX("v2")).toBeLessThan(game.map.width / 2);
    expect(townHallX("v1a")).toBeGreaterThan(game.map.width / 2);
    expect(townHallX("v1b")).toBeGreaterThan(game.map.width / 2);
  });

  it("keeps each dynamic player start paired with a nearby main mine", () => {
    const game = createGame("bareDuel", {
      players: ["v2", "v1a", "v1b"],
      aiPlayers: [],
      teams: { v2: "north", v1a: "south", v1b: "south" },
    });

    for (const owner of ["v2", "v1a", "v1b"]) {
      const townHall = game.buildings.find((building) => building.owner === owner && building.kind === "townHall")!;
      const nearestMine = game.resources
        .filter((resource) => resource.amount > 0)
        .sort((a, b) => Math.hypot(a.x - townHall.x, a.y - townHall.y) - Math.hypot(b.x - townHall.x, b.y - townHall.y))[0]!;

      expect(Math.hypot(nearestMine.x - townHall.x, nearestMine.y - townHall.y)).toBeLessThan(320);
    }
  });

  it("keeps runtime-spawned entity ids distinct from map-authored ids", () => {
    const game = createGame();
    const existingIds = new Set([...game.units.map((unit) => unit.id), ...game.buildings.map((building) => building.id)]);

    const spawned = game.spawnUnit("player", "worker", 1300, 1300);

    expect(existingIds.has(spawned.id)).toBe(false);
  });

  it("creates real dynamic player state for 30-slot 15v15 stress matches", () => {
    const humans = Array.from({ length: 15 }, (_, index) => `human-${index + 1}`);
    const ais = Array.from({ length: 15 }, (_, index) => `ai-${index + 1}`);
    const players = [...humans, ...ais];
    const game = createGame("grandThirty", {
      players,
      aiPlayers: ais,
      teams: Object.fromEntries([...humans.map((owner) => [owner, "north"]), ...ais.map((owner) => [owner, "south"])]),
    });

    expect(game.activePlayers).toHaveLength(30);
    for (const owner of players) {
      expect(game.players[owner]).toBeDefined();
      expect(game.teams[owner]).toBe(humans.includes(owner) ? "north" : "south");
      expect(game.match.stats.goldSpent[owner]).toBe(0);
      expect(game.match.stats.unitsKilled[owner]).toBe(0);
      expect(game.buildings.some((building) => building.owner === owner && building.kind === "townHall")).toBe(true);
      expect(game.units.filter((unit) => unit.owner === owner && unit.kind === "worker")).toHaveLength(3);
      expect(game.resources.some((resource) => resource.id === `gold-${owner}-main`)).toBe(true);
    }
    expect(game.map.width).toBeGreaterThan(4096);
    expect(game.map.height).toBeGreaterThan(4096);
  });

  it("applies API-agent scenario overrides through normal entity constructors", () => {
    const woundedSeed = { id: "unit-agent-wounded", owner: "enemy", kind: "footman", x: 1660, y: 1460, hp: 37 } as const;
    const game = createGame("bareDuel", {
      scenario: {
        addResources: [{ id: "gold-agent-pocket", kind: "goldMine", x: 1500, y: 1380, amount: 1234 }],
        addMercenaryCamps: [{ id: "merc-agent-pocket", x: 1580, y: 1400, radius: 30, hireKind: "mercenary", cost: 185, stock: 2, cooldown: seconds(4.5), cooldownRemaining: 0 }],
        addUnits: [{ id: "unit-agent-wildling", owner: "neutral", kind: "wildling", x: 1600, y: 1460 }, woundedSeed],
        addBuildings: [{ id: "building-agent-farm", owner: "player", kind: "farm", x: 620, y: 640, complete: true }],
        addLandmarks: [{ id: "landmark-agent-banner", kind: "bannerStone", x: 1500, y: 1500, size: 96, rotation: 0.25 }],
      },
    });

    const farm = game.buildings.find((building) => building.id === "building-agent-farm");
    const wildling = game.units.find((unit) => unit.id === "unit-agent-wildling");

    expect(game.resources.find((resource) => resource.id === "gold-agent-pocket")?.amount).toBe(1234);
    expect(game.mercenaryCamps.find((camp) => camp.id === "merc-agent-pocket")?.stock).toBe(2);
    expect(wildling?.hp).toBe(UNIT_DEFS.wildling.hp);
    expect(game.units.find((unit) => unit.id === "unit-agent-wounded")?.hp).toBe(37);
    expect(farm?.hp).toBe(BUILDING_DEFS.farm.hp);
    expect(farm?.buildProgress).toBe(BUILDING_DEFS.farm.buildTime);
    expect(game.map.landmarks.find((landmark) => landmark.id === "landmark-agent-banner")?.kind).toBe("bannerStone");
    expect(game.players.player.supplyCap).toBe(16);
  });

  it("lets workers mine gold into their town hall", () => {
    const game = createGame();
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker");
    const mine = game.resources.find((resource) => resource.kind === "goldMine");

    expect(worker).toBeDefined();
    expect(mine).toBeDefined();

    issueCommand(game, { type: "mine", unitIds: [worker!.id], resourceId: mine!.id });
    expect(game.effects.some((effect) => effect.type === "mine" && effect.x === mine!.x && effect.y === mine!.y)).toBe(true);
    stepMany(game, 700);

    expect(game.players.player.gold).toBeGreaterThan(500);
    expect(mine!.amount).toBeLessThan(8000);
  });

  it("saturates a gold mine at five workers instead of scaling with extra miners", () => {
    const incomeWithFour = mineGoldIncomeWithWorkers(4, 1400);
    const incomeWithFive = mineGoldIncomeWithWorkers(5, 1400);
    const incomeWithEight = mineGoldIncomeWithWorkers(8, 1400);

    expect(incomeWithFive).toBeGreaterThan(incomeWithFour);
    expect(incomeWithEight).toBeLessThanOrEqual(incomeWithFive);
  });

  it("taxes delivered mine gold through Warcraft-like upkeep brackets", () => {
    const game = createGame();
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    const mine = game.resources.find((resource) => resource.kind === "goldMine")!;
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    game.players.player.gold = 0;

    const deliverAtSupply = (supplyUsed: number) => {
      game.players.player.supplyUsed = supplyUsed;
      worker.x = townHall.x;
      worker.y = townHall.y;
      worker.carryingGold = 10;
      worker.order = { type: "mine", resourceId: mine.id, phase: "return", timer: 0 };
      stepGame(game);
    };

    deliverAtSupply(50);
    expect(game.players.player.gold).toBe(10);
    deliverAtSupply(51);
    expect(game.players.player.gold).toBe(17);
    deliverAtSupply(81);
    expect(game.players.player.gold).toBe(21);
  });

  it("builds a barracks and trains soldiers", () => {
    const game = createGame();
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    game.players.player.gold = 1000;

    issueCommand(game, { type: "build", unitId: worker.id, buildingKind: "barracks", x: townHall.x + 260, y: townHall.y + 80 });
    expect(game.match.stats.goldSpent.player).toBe(BUILDING_DEFS.barracks.cost);
    stepMany(game, 360);
    const barracks = game.buildings.find((building) => building.owner === "player" && building.kind === "barracks");

    expect(barracks?.complete).toBe(true);

    issueCommand(game, { type: "train", buildingId: barracks!.id, unitKind: "footman" });
    expect(game.match.stats.goldSpent.player).toBe(BUILDING_DEFS.barracks.cost + UNIT_DEFS.footman.cost);
    stepMany(game, 260);

    expect(game.units.filter((unit) => unit.owner === "player" && unit.kind === "footman").length).toBe(1);
  });

  it("rejects building placement that overlaps an existing building without spending gold", () => {
    const game = createGame();
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    game.players.player.gold = 1000;
    const goldBefore = game.players.player.gold;
    const spentBefore = game.match.stats.goldSpent.player;
    const buildingCountBefore = game.buildings.length;

    expect(() => issueCommand(game, { type: "build", unitId: worker.id, buildingKind: "farm", x: townHall.x + 10, y: townHall.y })).toThrow(/placement|too close|overlap/i);

    expect(game.players.player.gold).toBe(goldBefore);
    expect(game.match.stats.goldSpent.player).toBe(spentBefore);
    expect(game.buildings).toHaveLength(buildingCountBefore);
  });

  it("enforces race-specific trainable units through the ordinary train command", () => {
    const game = createGame("bareDuel", { aiPlayers: [], races: { player: "grove", enemy: "ember" } });
    const groveBarracks = createBuilding("grove-barracks", "player", "barracks", 620, 620, true);
    const emberForge = createBuilding("ember-forge", "enemy", "emberForge", 3300, 3300, true);
    game.buildings.push(groveBarracks, emberForge);
    game.players.player.gold = 500;
    game.players.enemy.gold = 500;

    expect(() => issuePlayerCommand(game, "player", { type: "train", buildingId: groveBarracks.id, unitKind: "groveWarden" })).not.toThrow();
    expect(() => issuePlayerCommand(game, "player", { type: "train", buildingId: groveBarracks.id, unitKind: "emberRavager" })).toThrow(/cannot train/i);
    expect(() => issuePlayerCommand(game, "enemy", { type: "train", buildingId: emberForge.id, unitKind: "emberRavager" })).not.toThrow();
    expect(() => issuePlayerCommand(game, "enemy", { type: "train", buildingId: emberForge.id, unitKind: "groveWarden" })).toThrow(/cannot train/i);
  });

  it("stacks repeated training commands on one building but produces units serially", () => {
    const game = createGame();
    const barracks = createBuilding("building-player-stack-barracks", "player", "barracks", 900, 900, true);
    game.buildings.push(barracks);
    for (let i = 0; i < 4; i += 1) {
      game.buildings.push(createBuilding(`building-player-stack-farm-${i}`, "player", "farm", 820 + i * 45, 1040, true));
    }
    game.players.player.gold = 5000;
    game.players.player.supplyCap = 30;

    for (let i = 0; i < 5; i += 1) {
      issueCommand(game, { type: "train", buildingId: barracks.id, unitKind: "footman" });
    }

    expect(barracks.queue.map((job) => job.unitKind)).toEqual(["footman", "footman", "footman", "footman", "footman"]);
    expect(game.units.filter((unit) => unit.owner === "player" && unit.kind === "footman")).toHaveLength(0);

    stepMany(game, UNIT_DEFS.footman.trainTime);

    expect(game.units.filter((unit) => unit.owner === "player" && unit.kind === "footman")).toHaveLength(1);
    expect(barracks.queue).toHaveLength(4);

    stepMany(game, UNIT_DEFS.footman.trainTime * 4);

    expect(game.units.filter((unit) => unit.owner === "player" && unit.kind === "footman")).toHaveLength(5);
    expect(barracks.queue).toHaveLength(0);
  });

  it("orders newly trained units to the building rally point", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const barracks = createBuilding("building-player-rally-barracks", "player", "barracks", 900, 900, true);
    game.buildings.push(barracks);
    game.players.player.gold = 5000;

    issueCommand(game, { type: "setRally", buildingIds: [barracks.id], x: 1280, y: 1040 });
    issueCommand(game, { type: "train", buildingId: barracks.id, unitKind: "footman" });
    stepMany(game, UNIT_DEFS.footman.trainTime);

    const footman = game.units.find((unit) => unit.owner === "player" && unit.kind === "footman");
    expect(footman?.order).toEqual({ type: "move", x: 1280, y: 1040 });
  });

  it("orders workers trained from a mine rally to start mining", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    const mine = game.resources.find((resource) => resource.id === "gold-player-main")!;
    const existingWorkerIds = new Set(game.units.filter((unit) => unit.owner === "player" && unit.kind === "worker").map((unit) => unit.id));
    game.players.player.gold = 5000;

    issueCommand(game, { type: "setRally", buildingIds: [townHall.id], x: mine.x, y: mine.y, target: { type: "resource", resourceId: mine.id } });
    issueCommand(game, { type: "train", buildingId: townHall.id, unitKind: "worker" });
    stepMany(game, UNIT_DEFS.worker.trainTime);

    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker" && !existingWorkerIds.has(unit.id));
    expect(worker?.order).toEqual({ type: "mine", resourceId: mine.id, phase: "toMine", timer: 0 });
  });

  it("orders units trained from a unit rally to follow that friendly unit", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const barracks = createBuilding("building-player-follow-barracks", "player", "barracks", 900, 900, true);
    const target = game.spawnUnit("player", "footman", 1220, 920);
    game.buildings.push(barracks);
    game.players.player.gold = 5000;

    issueCommand(game, { type: "setRally", buildingIds: [barracks.id], x: target.x, y: target.y, target: { type: "unit", unitId: target.id } });
    issueCommand(game, { type: "train", buildingId: barracks.id, unitKind: "footman" });
    stepMany(game, UNIT_DEFS.footman.trainTime);
    const follower = game.units.find((unit) => unit.owner === "player" && unit.kind === "footman" && unit.id !== target.id)!;
    const before = distance(follower, target);

    target.x += 160;
    stepMany(game, 12);

    expect(follower.order).toEqual({ type: "follow", targetId: target.id });
    expect(distance(follower, target)).toBeLessThan(before + 160);
  });

  it("counts queued training jobs against the supply cap", () => {
    const game = createGame();
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    for (let i = 0; i < 6; i += 1) {
      game.spawnUnit("player", "worker", townHall.x + 90 + i * 8, townHall.y + 90);
    }
    game.players.player.gold = 5000;

    issueCommand(game, { type: "train", buildingId: townHall.id, unitKind: "worker" });

    expect(townHall.queue).toHaveLength(1);
    expect(() => issueCommand(game, { type: "train", buildingId: townHall.id, unitKind: "worker" })).toThrow(/supply/i);
  });

  it("reassigns AI workers to resume stalled construction", () => {
    const game = createGame("bareDuel", { aiPlayers: ["enemy"] });
    const runtime = createAiRuntime(["enemy"]);
    const worker = game.units.find((unit) => unit.owner === "enemy" && unit.kind === "worker")!;
    const stalledFarm = createBuilding("building-enemy-stalled-farm", "enemy", "farm", worker.x - 190, worker.y, false);
    stalledFarm.buildProgress = 12;
    game.buildings.push(stalledFarm);

    stepMany(game, 120, runtime);

    expect(stalledFarm.buildProgress).toBeGreaterThan(12);
    expect(game.units.some((unit) => unit.owner === "enemy" && unit.kind === "worker" && distance(unit, stalledFarm) <= 66)).toBe(true);
  });

  it("blocks training at the population cap until a farm raises supply", () => {
    const game = createGame();
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    game.players.player.gold = 5000;
    game.players.player.supplyCap = game.players.player.supplyUsed;

    expect(() => issueCommand(game, { type: "train", buildingId: townHall.id, unitKind: "worker" })).toThrow(/supply/i);

    issueCommand(game, { type: "build", unitId: worker.id, buildingKind: "farm", x: townHall.x + 130, y: townHall.y });
    stepMany(game, 220);

    expect(game.players.player.supplyCap).toBeGreaterThan(game.players.player.supplyUsed);
    expect(() => issueCommand(game, { type: "train", buildingId: townHall.id, unitKind: "worker" })).not.toThrow();
  });

  it("builds a defense tower that automatically attacks enemies in range", () => {
    const game = createGame();
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    game.players.player.gold = 1000;

    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;

    issueCommand(game, { type: "build", unitId: worker.id, buildingKind: "defenseTower", x: townHall.x + 130, y: townHall.y });
    stepMany(game, 260);
    const tower = game.buildings.find((building) => building.owner === "player" && building.kind === "defenseTower")!;
    const target = game.spawnUnit("enemy", "raider", tower.x + 120, tower.y);
    stepMany(game, 120);

    expect(tower.complete).toBe(true);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("delays ranged unit damage until its projectile lands", () => {
    const game = sketchScene("delayed-ranged-unit-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north" })
      .player("enemy", { team: "south" })
      .townHall("player", 500, 500)
      .townHall("enemy", 3400, 3400)
      .unit("player", "archer", 900, 900, { id: "projectile-archer", order: { type: "attack", targetId: "projectile-target" } })
      .unit("enemy", "footman", 1110, 900, { id: "projectile-target" })
      .build()
      .createGame();
    const target = game.units.find((unit) => unit.id === "projectile-target")!;

    stepGame(game);

    expect(target.hp).toBe(target.maxHp);
    expect(game.effects.some((effect) => effect.type === "projectile")).toBe(true);

    stepMany(game, 24);

    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("does not spend a second ranged projectile on a target already killed by pending projectile damage", () => {
    const game = sketchScene("ranged-projectile-pending-damage-targeting")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north" })
      .player("enemy", { team: "south" })
      .townHall("player", 500, 500)
      .townHall("enemy", 3400, 3400)
      .unit("player", "archer", 900, 900, { id: "archer-a", order: { type: "attackMove", x: 1200, y: 900 } })
      .unit("player", "archer", 900, 930, { id: "archer-b", order: { type: "attackMove", x: 1200, y: 900 } })
      .unit("enemy", "raider", 1000, 900, { id: "doomed-raider", hp: UNIT_DEFS.archer.attackDamage })
      .unit("enemy", "footman", 1020, 930, { id: "fresh-footman" })
      .build()
      .createGame();

    stepGame(game);

    expect(game.projectiles.map((projectile) => projectile.targetId).sort()).toEqual(["doomed-raider", "fresh-footman"]);
  });

  it("retargets explicit ranged attack orders when pending projectile damage already kills the target", () => {
    const game = sketchScene("ranged-projectile-pending-damage-explicit-attack")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north" })
      .player("enemy", { team: "south" })
      .townHall("player", 500, 500)
      .townHall("enemy", 3400, 3400)
      .unit("player", "archer", 900, 900, { id: "archer-a", order: { type: "attack", targetId: "doomed-raider" } })
      .unit("player", "archer", 900, 930, { id: "archer-b", order: { type: "attack", targetId: "doomed-raider" } })
      .unit("enemy", "raider", 1000, 900, { id: "doomed-raider", hp: UNIT_DEFS.archer.attackDamage })
      .unit("enemy", "footman", 1020, 930, { id: "fresh-footman" })
      .build()
      .createGame();

    stepGame(game);

    expect(game.projectiles.map((projectile) => projectile.targetId).sort()).toEqual(["doomed-raider", "fresh-footman"]);
  });

  it("keeps melee unit damage immediate", () => {
    const game = sketchScene("immediate-melee-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north" })
      .player("enemy", { team: "south" })
      .townHall("player", 500, 500)
      .townHall("enemy", 3400, 3400)
      .unit("player", "footman", 900, 900, { id: "melee-footman", order: { type: "attack", targetId: "melee-target" } })
      .unit("enemy", "footman", 940, 900, { id: "melee-target" })
      .build()
      .createGame();
    const target = game.units.find((unit) => unit.id === "melee-target")!;

    stepGame(game);

    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("delays defense tower damage until its projectile lands", () => {
    const game = sketchScene("delayed-tower-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north" })
      .player("enemy", { team: "south" })
      .townHall("player", 500, 500)
      .townHall("enemy", 3400, 3400)
      .tower("player", 900, 900, { id: "projectile-tower" })
      .unit("enemy", "raider", 1100, 900, { id: "tower-target" })
      .build()
      .createGame();
    const target = game.units.find((unit) => unit.id === "tower-target")!;

    stepGame(game);

    expect(target.hp).toBe(target.maxHp);

    stepMany(game, 24);

    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("lets defense towers focus wounded high-threat units instead of only the nearest enemy", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const tower = createBuilding("building-player-smart-tower", "player", "defenseTower", 500, 500, true);
    game.buildings.push(tower);
    const healthyFront = game.spawnUnit("enemy", "footman", 585, 500);
    const woundedRaider = game.spawnUnit("enemy", "raider", 620, 500);
    woundedRaider.hp = 20;

    stepMany(game, 24);

    expect(woundedRaider.hp).toBeLessThan(20);
    expect(healthyFront.hp).toBe(healthyFront.maxHp);
  });

  it("lets moon wells slowly heal nearby wounded soldiers without repairing workers", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const well = createBuilding("building-player-moon-well", "player", "moonWell", 500, 500, true);
    game.buildings.push(well);
    const woundedFootman = game.spawnUnit("player", "footman", 620, 500);
    const distantLancer = game.spawnUnit("player", "lancer", 850, 500);
    const woundedWorker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    woundedFootman.hp = 80;
    distantLancer.hp = 70;
    woundedWorker.x = 560;
    woundedWorker.y = 500;
    woundedWorker.hp = 20;

    stepMany(game, 92);

    expect(woundedFootman.hp).toBe(100);
    expect(woundedFootman.hp).toBeLessThan(120);
    expect(distantLancer.hp).toBe(70);
    expect(woundedWorker.hp).toBe(20);
    expect(game.effects.some((effect) => effect.type === "heal" && effect.fromX === well.x && effect.toX === woundedFootman.x)).toBe(true);
  });

  it("lets AI build a defensive tower near a pressured base through normal construction", () => {
    const game = createGame("bareDuel", { aiPlayers: ["enemy"] });
    const runtime = createAiRuntime(["enemy"]);
    const enemyBase = game.buildings.find((building) => building.owner === "enemy" && building.kind === "townHall")!;
    const attacker = game.spawnUnit("player", "raider", enemyBase.x - 230, enemyBase.y - 40);
    game.players.enemy.gold = 1000;

    stepMany(game, 650, runtime);

    const tower = game.buildings.find((building) => building.owner === "enemy" && building.kind === "defenseTower");
    expect(tower).toBeDefined();
    expect(tower?.complete).toBe(true);
    expect(distance(tower!, enemyBase)).toBeLessThan(430);
    expect(attacker.hp).toBeLessThan(attacker.maxHp);
  });

  it("emits projectile and hit feedback effects for ranged attacks", () => {
    const game = createGame();
    const archer = game.spawnUnit("player", "archer", 2500, 2500);
    const target = game.spawnUnit("enemy", "raider", 2620, 2500);

    issueCommand(game, { type: "attack", unitIds: [archer.id], targetId: target.id });
    stepMany(game, 1);

    const projectile = game.effects.find((effect) => effect.type === "projectile");
    expect(projectile).toMatchObject({ fromX: archer.x, fromY: archer.y, toX: target.x, toY: target.y });

    stepMany(game, 24);

    const hit = game.effects.find((effect) => effect.type === "hit" && distance(effect, target) < 1);
    expect(hit).toMatchObject({ x: target.x, y: target.y });
  });

  it("emits melee lunge and hit feedback effects for close attacks", () => {
    const game = createGame();
    const footman = game.spawnUnit("player", "footman", 2500, 2500);
    const target = game.spawnUnit("enemy", "raider", 2538, 2500);

    issueCommand(game, { type: "attack", unitIds: [footman.id], targetId: target.id });
    stepMany(game, 1);

    const melee = game.effects.find((effect) => effect.type === "melee");
    const hit = game.effects.find((effect) => effect.type === "hit");
    expect(melee).toMatchObject({ fromX: footman.x, fromY: footman.y, toX: target.x, toY: target.y });
    expect(hit).toMatchObject({ x: target.x, y: target.y });
  });

  it("awards XP-threshold stars only to the unit that lands the killing blow, capped at 3 stars", () => {
    const game = createGame();
    const finisher = game.spawnUnit("player", "footman", 2500, 2500);
    const nearbyAlly = game.spawnUnit("player", "archer", 2490, 2520);

    killWith(game, finisher, "worker");
    expect(finisher.xp).toBe(UNIT_DEFS.worker.xpReward);
    expect(finisher.level).toBe(0);

    killWith(game, finisher, "ancientStag");
    expect(finisher.xp).toBe(UNIT_DEFS.worker.xpReward + UNIT_DEFS.ancientStag.xpReward);
    expect(finisher.level).toBe(1);
    expect(game.effects.map((effect) => effect.type as string)).not.toContain("levelUp");
    expect(finisher.maxHp).toBe(Math.round(UNIT_DEFS.footman.hp * 1.25));
    expect(finisher.attackDamage).toBe(Math.round(UNIT_DEFS.footman.attackDamage * 1.25));

    killWith(game, finisher, "stonebackBrute");
    expect(finisher.level).toBe(2);
    expect(finisher.maxHp).toBe(Math.round(UNIT_DEFS.footman.hp * 1.5));
    expect(finisher.attackDamage).toBe(Math.round(UNIT_DEFS.footman.attackDamage * 1.5));

    for (let i = 0; i < 6; i += 1) killWith(game, finisher, "ancientStag");

    expect(finisher.kills).toBe(9);
    expect(finisher.level).toBe(3);
    expect(finisher.maxHp).toBe(Math.round(UNIT_DEFS.footman.hp * 1.75));
    expect(finisher.attackDamage).toBe(Math.round(UNIT_DEFS.footman.attackDamage * 1.75));
    expect(nearbyAlly.xp).toBe(0);
    expect(nearbyAlly.level).toBe(0);
  });

  it("applies veterancy after tech bonuses with a linear non-compounding multiplier", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.players.player.gold = 5_000;
    const barracks = createBuilding("building-player-veterancy-tech-barracks", "player", "barracks", 760, 680, true);
    game.buildings.push(barracks);
    const knight = game.spawnUnit("player", "knight", 900, 900);

    for (const upgradeKind of ["weaponTraining", "reinforcedPlating"] as const) {
      for (let level = 0; level < 3; level += 1) {
        issueCommand(game, { type: "research", buildingId: barracks.id, upgradeKind });
        stepMany(game, UPGRADE_DEFS[upgradeKind].levels[level]!.researchTime + 1);
      }
    }
    for (let i = 0; i < 4; i += 1) killWith(game, knight, "ancientStag", "neutral");

    const techAttack = UNIT_DEFS.knight.attackDamage + UPGRADE_DEFS.weaponTraining.levels.reduce((sum, level) => sum + level.attackBonus, 0);
    const techHp = UNIT_DEFS.knight.hp + UPGRADE_DEFS.reinforcedPlating.levels.reduce((sum, level) => sum + level.maxHpBonus, 0);
    expect(knight.level).toBe(3);
    expect(knight.attackDamage).toBe(Math.round(techAttack * 1.75));
    expect(knight.maxHp).toBe(Math.round(techHp * 1.75));
  });

  it("experience books level the consuming unit through the same veterancy scaling", () => {
    const game = createGame("bareDuel", {
      aiPlayers: [],
      scenario: {
        addItems: [{ id: "book-same-scaling", kind: "experienceBook", x: 0, y: 0, carrierId: "book-carrier", cooldownRemaining: 0 }],
        addUnits: [{ id: "book-carrier", owner: "player", kind: "mercenary", x: 900, y: 900 }],
      },
    });
    const carrier = game.units.find((unit) => unit.id === "book-carrier")!;

    issueCommand(game, { type: "useItem", unitId: carrier.id, itemId: "book-same-scaling" });

    expect(carrier.level).toBe(2);
    expect(carrier.maxHp).toBe(Math.round(UNIT_DEFS.mercenary.hp * 1.5));
    expect(carrier.attackDamage).toBe(Math.round(UNIT_DEFS.mercenary.attackDamage * 1.5));
    expect(game.items.some((item) => item.id === "book-same-scaling")).toBe(false);
  });

  it("awards scaled gold bounty for neutral wildling last hits even when the camp has no item", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.players.player.gold = 0;
    const finisher = game.spawnUnit("player", "footman", 2500, 2500);
    finisher.attackDamage = 500;
    const wildlingKinds: UnitKind[] = ["wildling", "mossGnawer", "thornSlinger", "barkMender", "stonebackBrute", "gladeWitch", "ancientStag"];

    killWith(game, finisher, "mossGnawer", "neutral");
    killWith(game, finisher, "ancientStag", "neutral");

    expect(wildlingKinds.every((kind) => (UNIT_DEFS[kind].goldBounty ?? 0) > 0)).toBe(true);
    expect(game.players.player.gold).toBe(105);
    expect(UNIT_DEFS.ancientStag.goldBounty).toBeGreaterThan(UNIT_DEFS.mossGnawer.goldBounty ?? 0);
  });

  it("emits tower projectile feedback when a defense tower fires", () => {
    const game = createGame();
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    game.players.player.gold = 1000;

    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;

    issueCommand(game, { type: "build", unitId: worker.id, buildingKind: "defenseTower", x: townHall.x + 130, y: townHall.y });
    stepMany(game, 260);
    const tower = game.buildings.find((building) => building.owner === "player" && building.kind === "defenseTower")!;
    const target = game.spawnUnit("enemy", "raider", tower.x + 120, tower.y);
    stepMany(game, 1);

    const projectile = game.effects.find((effect) => effect.type === "projectile");
    expect(projectile).toMatchObject({ fromX: tower.x, fromY: tower.y, toX: target.x, toY: target.y });
  });

  it("keeps mobile units separated instead of allowing perfect stacking", () => {
    const game = createGame();
    const a = game.spawnUnit("player", "footman", 2200, 2200);
    const b = game.spawnUnit("player", "footman", 2200, 2200);
    const c = game.spawnUnit("player", "footman", 2200, 2200);

    issueCommand(game, { type: "move", unitIds: [a.id, b.id, c.id], x: 2400, y: 2200 });
    stepMany(game, 80);

    const distances = [
      Math.hypot(a.x - b.x, a.y - b.y),
      Math.hypot(a.x - c.x, a.y - c.y),
      Math.hypot(b.x - c.x, b.y - c.y),
    ];
    expect(Math.min(...distances)).toBeGreaterThan(12);
  });

  it("supports healing, summoning, and curse abilities with visible effect records", () => {
    const game = sketchScene("ability-effects")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .townHall("player", 500, 500)
      .townHall("enemy", 3500, 3500)
      .unit("player", "priest", 2000, 2000, { id: "ability-priest" })
      .unit("player", "summoner", 2050, 2000, { id: "ability-summoner" })
      .unit("player", "witch", 2100, 2000, { id: "ability-witch" })
      .unit("player", "footman", 2030, 2040, { id: "hurt-footman" })
      .unit("enemy", "raider", 2240, 2000, { id: "curse-target" })
      .build()
      .createGame();
    const priest = game.units.find((unit) => unit.id === "ability-priest")!;
    const summoner = game.units.find((unit) => unit.id === "ability-summoner")!;
    const witch = game.units.find((unit) => unit.id === "ability-witch")!;
    const hurt = game.units.find((unit) => unit.id === "hurt-footman")!;
    const enemy = game.units.find((unit) => unit.id === "curse-target")!;
    hurt.hp = 30;

    issueCommand(game, { type: "cast", unitId: priest.id, ability: "heal", targetId: hurt.id });
    issueCommand(game, { type: "cast", unitId: summoner.id, ability: "summon", x: 2090, y: 2040 });
    issueCommand(game, { type: "cast", unitId: witch.id, ability: "curse", targetId: enemy.id });
    stepMany(game, 5);

    expect(hurt.hp).toBeGreaterThan(30);
    expect(game.units.some((unit) => unit.owner === "player" && unit.kind === "spirit")).toBe(true);
    expect(enemy.effects.some((effect) => effect.type === "curse")).toBe(true);
    expect(game.effects.map((effect) => effect.type)).toEqual(expect.arrayContaining(["heal", "summon", "curse"]));
  });

  it("supports ember-only heal, summon, and curse parameters through the same cast command", () => {
    const game = sketchScene("ember-ability-effects")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { race: "ember" })
      .player("enemy", { race: "grove" })
      .townHall("player", 500, 500)
      .townHall("enemy", 3500, 3500)
      .unit("player", "emberAcolyte", 2000, 2000, { id: "ember-acolyte" })
      .unit("player", "pyreCaller", 2050, 2000, { id: "pyre-caller" })
      .unit("player", "ashHexer", 2100, 2000, { id: "ash-hexer" })
      .unit("player", "emberRavager", 2030, 2040, { id: "hurt-ravager", hp: 30 })
      .unit("enemy", "raider", 2240, 2000, { id: "ash-target" })
      .build()
      .createGame();
    const acolyte = game.units.find((unit) => unit.id === "ember-acolyte")!;
    const caller = game.units.find((unit) => unit.id === "pyre-caller")!;
    const hexer = game.units.find((unit) => unit.id === "ash-hexer")!;
    const hurt = game.units.find((unit) => unit.id === "hurt-ravager")!;
    const enemy = game.units.find((unit) => unit.id === "ash-target")!;

    issueCommand(game, { type: "cast", unitId: acolyte.id, ability: "emberMend", targetId: hurt.id });
    issueCommand(game, { type: "cast", unitId: caller.id, ability: "cinderSoul", x: 2090, y: 2040 });
    issueCommand(game, { type: "cast", unitId: hexer.id, ability: "ashCurse", targetId: enemy.id });
    stepMany(game, 5);

    expect(hurt.hp).toBe(85);
    const spirit = game.units.find((unit) => unit.owner === "player" && unit.kind === "spirit");
    expect(spirit?.expiresTick).toBe(game.tick - 5 + seconds(45));
    expect(enemy.effects).toContainEqual({ type: "curse", remaining: seconds(18) - 5 });
  });

  it("curse directly cuts outgoing attack damage to forty percent for attack and attack-move orders", () => {
    const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
    game.units = [];
    const attackOrderFootman = game.spawnUnit("player", "footman", 500, 500);
    const attackOrderTarget = game.spawnUnit("enemy", "worker", 540, 500);
    const attackMoveFootman = game.spawnUnit("player", "footman", 500, 620);
    const attackMoveTarget = game.spawnUnit("enemy", "worker", 540, 620);
    attackOrderFootman.effects.push({ type: "curse", remaining: 60 });
    attackMoveFootman.effects.push({ type: "curse", remaining: 60 });

    issueCommand(game, { type: "attack", unitIds: [attackOrderFootman.id], targetId: attackOrderTarget.id });
    issueCommand(game, { type: "attackMove", unitIds: [attackMoveFootman.id], x: attackMoveTarget.x, y: attackMoveTarget.y });
    stepMany(game, 1);

    expect(attackOrderTarget.hp).toBe(UNIT_DEFS.worker.hp - Math.round(UNIT_DEFS.footman.attackDamage * 0.4));
    expect(attackMoveTarget.hp).toBe(UNIT_DEFS.worker.hp - Math.round(UNIT_DEFS.footman.attackDamage * 0.4));
  });

  it("expires summoned spirits without counting them as combat losses", () => {
    const game = sketchScene("summoned-spirit-lifetime")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .townHall("player", 500, 500)
      .townHall("enemy", 3500, 3500)
      .unit("player", "summoner", 2050, 2000, { id: "lifetime-summoner" })
      .build()
      .createGame();

    issueCommand(game, { type: "cast", unitId: "lifetime-summoner", ability: "summon", x: 2090, y: 2040 });
    const spirit = game.units.find((unit) => unit.owner === "player" && unit.kind === "spirit");
    if (!spirit) throw new Error("missing summoned spirit");

    stepMany(game, seconds(44.9));
    expect(game.units.some((unit) => unit.id === spirit.id)).toBe(true);

    stepMany(game, seconds(0.2));
    expect(game.units.some((unit) => unit.id === spirit.id)).toBe(false);
    expect(game.match.stats.unitsLost.player).toBe(0);
  });

  it("does not let non-AI player casters spend manual spell cooldowns automatically", () => {
    const game = createGame();
    const witch = game.spawnUnit("player", "witch", 2000, 2000);
    const enemy = game.spawnUnit("enemy", "raider", 2240, 2000);

    stepMany(game, 1);

    expect(witch.cooldown).toBe(0);
    expect(enemy.effects.some((effect) => effect.type === "curse")).toBe(false);
    expect(game.effects.some((effect) => effect.type === "curse")).toBe(false);
  });

  it("lets caster AI automatically heal, summon, and curse during combat", () => {
    const game = createGame();
    const runtime = createAiRuntime(["enemy"]);
    const priest = game.spawnUnit("enemy", "priest", 2600, 2600);
    const summoner = game.spawnUnit("enemy", "summoner", 2640, 2600);
    const witch = game.spawnUnit("enemy", "witch", 2680, 2600);
    const ally = game.spawnUnit("enemy", "footman", 2620, 2660);
    const player = game.spawnUnit("player", "raider", 2720, 2600);
    ally.hp = 35;

    stepMany(game, 80, runtime);

    expect(ally.hp).toBeGreaterThan(35);
    expect(game.units.some((unit) => unit.owner === "enemy" && unit.kind === "spirit")).toBe(true);
    expect(player.effects.some((effect) => effect.type === "curse")).toBe(true);
    expect([priest, summoner, witch].some((caster) => caster.cooldown > 0)).toBe(true);
  });

  it("lets enemy AI hire mercenaries from a camp and proves they join combat by scoring a kill", () => {
    const game = createGame();
    const runtime = createAiRuntime(["enemy"]);
    const camp = game.mercenaryCamps[0];
    expect(camp).toBeDefined();
    game.units = game.units.filter((unit) => unit.owner !== "neutral" || distance(unit, camp!) > 300);
    game.players.enemy.gold = 1000;
    game.spawnUnit("enemy", "footman", camp!.x, camp!.y);
    const victim = game.spawnUnit("player", "worker", camp!.x + 70, camp!.y);
    victim.hp = 22;

    stepMany(game, 500, runtime);

    const enemyMercenaries = game.units.filter((unit) => unit.owner === "enemy" && unit.kind === "mercenary");
    expect(enemyMercenaries.length).toBeGreaterThan(0);
    expect(enemyMercenaries.some((unit) => unit.kills > 0)).toBe(true);
    expect(game.match.stats.mercenaryKills.enemy).toBeGreaterThan(0);
    expect(game.units.some((unit) => unit.id === victim.id)).toBe(false);
    expect(game.players.enemy.gold).toBeLessThan(1000);
  });

  it("records non-base building destruction and resolves victory when a town hall falls", () => {
    const game = createGame("bareDuel");
    const farm = createBuilding("building-player-farm-proof", "player", "farm", 3000, 3000, true);
    farm.hp = 1;
    game.buildings.push(farm);
    const enemyMercenary = game.spawnUnit("enemy", "mercenary", farm.x + 30, farm.y);

    stepMany(game, 2);

    expect(game.match.stats.nonBaseBuildingsDestroyed.enemy).toBe(1);
    expect(game.buildings.some((building) => building.id === farm.id)).toBe(false);

    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    for (const unit of game.units.filter((candidate) => candidate.owner === "player")) {
      unit.x = 120;
      unit.y = 3600;
    }
    enemyMercenary.x = townHall.x + 40;
    enemyMercenary.y = townHall.y;
    enemyMercenary.cooldown = 0;
    enemyMercenary.order = { type: "idle" };
    townHall.hp = 1;

    stepMany(game, 2);

    expect(game.match.winner).toBe("enemy");
    expect(game.match.endedAtTick).toBe(game.tick);
    expect(game.match.stats.buildingsDestroyed.enemy).toBeGreaterThanOrEqual(2);
  });

  it("records neutral camp clearing as a match proof signal", () => {
    const game = createGame();
    const wildling = game.units.find((unit) => unit.owner === "neutral" && unit.kind === "wildling")!;
    const mercenary = game.spawnUnit("player", "mercenary", wildling.x - 55, wildling.y);
    wildling.hp = 1;

    issueCommand(game, { type: "attack", unitIds: [mercenary.id], targetId: wildling.id });
    stepMany(game, 1);

    expect(game.match.stats.neutralUnitsKilled.player).toBe(1);
    expect(game.match.stats.mercenaryKills.player).toBe(1);
  });

  it("hires distinct mercenary kinds and lets hired mercenaries gain stars like ordinary units", () => {
    const game = createGame("bareDuel", {
      aiPlayers: [],
      scenario: {
        addMercenaryCamps: [
          { id: "camp-blade", x: 800, y: 800, radius: 54, hireKind: "mercenary", cost: UNIT_DEFS.mercenary.cost, stock: 1, cooldown: seconds(4.5), cooldownRemaining: 0 },
          { id: "camp-bow", x: 900, y: 800, radius: 54, hireKind: "contractArcher", cost: UNIT_DEFS.contractArcher.cost, stock: 1, cooldown: seconds(4.5), cooldownRemaining: 0 },
          { id: "camp-medic", x: 1000, y: 800, radius: 54, hireKind: "fieldMedic", cost: UNIT_DEFS.fieldMedic.cost, stock: 1, cooldown: seconds(4.5), cooldownRemaining: 0 },
        ],
        addBuildings: [
          { id: "building-player-hire-proof-farm", owner: "player", kind: "farm", x: 720, y: 720, complete: true },
          { id: "building-player-hire-proof-farm-2", owner: "player", kind: "farm", x: 760, y: 720, complete: true },
        ],
      },
    });
    game.players.player.gold = 1000;
    game.spawnUnit("player", "footman", 800, 800);
    game.spawnUnit("player", "footman", 900, 800);
    game.spawnUnit("player", "footman", 1000, 800);

    issueCommand(game, { type: "hire", campId: "camp-blade" });
    issueCommand(game, { type: "hire", campId: "camp-bow" });
    issueCommand(game, { type: "hire", campId: "camp-medic" });

    expect(game.units.some((unit) => unit.owner === "player" && unit.kind === "mercenary" && unit.level === 0)).toBe(true);
    expect(game.units.some((unit) => unit.owner === "player" && unit.kind === "contractArcher" && unit.level === 0)).toBe(true);
    expect(game.units.some((unit) => unit.owner === "player" && unit.kind === "fieldMedic" && unit.level === 0)).toBe(true);

    const hired = game.units.find((unit) => unit.owner === "player" && unit.kind === "contractArcher")!;
    expect(hired.level).toBe(0);
    killWith(game, hired, "worker");
    expect(hired.level).toBe(0);
    for (let i = 0; i < 4; i += 1) killWith(game, hired, "ancientStag");

    expect(hired.level).toBe(3);
    expect(hired.attackDamage).toBeGreaterThan(UNIT_DEFS.contractArcher.attackDamage);
  });

  it("requires a friendly unit at a mercenary camp before hiring", () => {
    const game = createGame("bareDuel", {
      aiPlayers: [],
      scenario: {
        addMercenaryCamps: [{ id: "camp-local-only", x: 1600, y: 1600, radius: 54, hireKind: "mercenary", cost: UNIT_DEFS.mercenary.cost, stock: 1, cooldown: seconds(4.5), cooldownRemaining: 0 }],
      },
    });
    game.players.player.gold = 1000;

    expect(() => issueCommand(game, { type: "hire", campId: "camp-local-only" })).toThrow(/friendly unit/i);

    game.spawnUnit("player", "footman", 1600, 1600);
    issueCommand(game, { type: "hire", campId: "camp-local-only" });

    expect(game.mercenaryCamps.find((camp) => camp.id === "camp-local-only")?.stock).toBe(0);
    expect(game.units.some((unit) => unit.owner === "player" && unit.kind === "mercenary")).toBe(true);
  });

  it("researches three expensive levels of shared tech through ordinary commands", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.players.player.gold = 3_000;
    const barracks = createBuilding("building-player-tech-barracks", "player", "barracks", 760, 680, true);
    game.buildings.push(barracks);
    const veteran = game.spawnUnit("player", "footman", 900, 900);
    const baseDamage = veteran.attackDamage;
    const baseHp = veteran.maxHp;

    issueCommand(game, { type: "research", buildingId: barracks.id, upgradeKind: "weaponTraining" });
    expect(game.players.player.gold).toBe(3_000 - UPGRADE_DEFS.weaponTraining.levels[0]!.cost);
    expect(barracks.researchQueue[0]).toMatchObject({ upgradeKind: "weaponTraining", targetLevel: 1 });
    stepMany(game, UPGRADE_DEFS.weaponTraining.levels[0]!.researchTime + 1);

    expect(game.players.player.upgrades.weaponTraining).toBe(1);
    expect(veteran.attackDamage).toBe(baseDamage + UPGRADE_DEFS.weaponTraining.levels[0]!.attackBonus);

    issueCommand(game, { type: "research", buildingId: barracks.id, upgradeKind: "weaponTraining" });
    stepMany(game, UPGRADE_DEFS.weaponTraining.levels[1]!.researchTime + 1);
    issueCommand(game, { type: "research", buildingId: barracks.id, upgradeKind: "weaponTraining" });
    stepMany(game, UPGRADE_DEFS.weaponTraining.levels[2]!.researchTime + 1);

    expect(game.players.player.upgrades.weaponTraining).toBe(3);
    expect(veteran.attackDamage).toBe(baseDamage + UPGRADE_DEFS.weaponTraining.levels.reduce((sum, level) => sum + level.attackBonus, 0));

    issueCommand(game, { type: "research", buildingId: barracks.id, upgradeKind: "reinforcedPlating" });
    stepMany(game, UPGRADE_DEFS.reinforcedPlating.levels[0]!.researchTime + 1);
    expect(game.players.player.upgrades.reinforcedPlating).toBe(1);
    expect(veteran.maxHp).toBe(baseHp + UPGRADE_DEFS.reinforcedPlating.levels[0]!.maxHpBonus);

    issueCommand(game, { type: "train", buildingId: barracks.id, unitKind: "footman" });
    stepMany(game, 180);

    const future = game.units.find((unit) => unit.owner === "player" && unit.kind === "footman" && unit.id !== veteran.id)!;
    expect(future.attackDamage).toBe(veteran.attackDamage);
    expect(() => issueCommand(game, { type: "research", buildingId: barracks.id, upgradeKind: "weaponTraining" })).toThrow(/already at max level/);
  });

  it("researches building durability from the town hall for existing and future buildings", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.players.player.gold = 2_000;
    const townHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    const tower = createBuilding("building-player-durability-tower", "player", "defenseTower", 760, 680, true);
    game.buildings.push(tower);
    tower.hp = 50;
    const baseTowerHp = tower.maxHp;

    issueCommand(game, { type: "research", buildingId: townHall.id, upgradeKind: "buildingDurability" });
    stepMany(game, UPGRADE_DEFS.buildingDurability.levels[0]!.researchTime + 1);

    expect(game.players.player.upgrades.buildingDurability).toBe(1);
    expect(tower.maxHp).toBe(Math.round(baseTowerHp * 1.2));
    expect(tower.hp).toBe(50 + tower.maxHp - baseTowerHp);

    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    issueCommand(game, { type: "build", unitId: worker.id, buildingKind: "farm", x: townHall.x + 90, y: townHall.y });
    const farm = game.buildings.find((building) => building.owner === "player" && building.kind === "farm" && !building.complete)!;
    stepMany(game, BUILDING_DEFS.farm.buildTime + 80);

    expect(farm.complete).toBe(true);
    expect(farm.maxHp).toBe(Math.round(BUILDING_DEFS.farm.hp * 1.2));
    expect(farm.hp).toBe(farm.maxHp);
  });

  it("keeps mercenaries and buildings out of barracks combat upgrades", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.players.player.gold = 2_000;
    const barracks = createBuilding("building-player-merc-tech-barracks", "player", "barracks", 760, 680, true);
    const tower = createBuilding("building-player-merc-tech-tower", "player", "defenseTower", 820, 680, true);
    game.buildings.push(barracks, tower);
    const mercenary = game.spawnUnit("player", "contractArcher", 900, 900);
    const mercenaryDamage = mercenary.attackDamage;
    const towerDamage = tower.attackDamage;
    const towerHp = tower.maxHp;

    issueCommand(game, { type: "research", buildingId: barracks.id, upgradeKind: "weaponTraining" });
    stepMany(game, UPGRADE_DEFS.weaponTraining.levels[0]!.researchTime + 1);

    expect(mercenary.attackDamage).toBe(mercenaryDamage);
    expect(tower.attackDamage).toBe(towerDamage);
    expect(tower.maxHp).toBe(towerHp);
  });

  it("lets workers repair damaged friendly buildings by spending gold", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.players.player.gold = 100;
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    const barracks = createBuilding("building-player-repair-barracks", "player", "barracks", worker.x + 40, worker.y, true);
    game.buildings.push(barracks);
    barracks.hp = barracks.maxHp - 90;

    issueCommand(game, { type: "repair", unitIds: [worker.id], buildingId: barracks.id });
    stepMany(game, 20);

    expect(barracks.hp).toBeGreaterThan(barracks.maxHp - 90);
    expect(game.players.player.gold).toBeLessThan(100);
    expect(game.effects.some((effect) => effect.type === "repair" && effect.x === barracks.x && effect.y === barracks.y)).toBe(true);
    stepUntil(game, 900, () => barracks.hp === barracks.maxHp);
    stepGame(game);

    expect(barracks.hp).toBe(barracks.maxHp);
    expect(worker.order.type).toBe("idle");
  });

  it("queues movement commands behind the current unit order when requested", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    game.units = game.units.filter((unit) => unit === worker || unit.owner !== "player");
    const first = { x: worker.x + 120, y: worker.y };
    const second = { x: worker.x + 240, y: worker.y };

    issueCommand(game, { type: "move", unitIds: [worker.id], x: first.x, y: first.y });
    issueCommand(game, { type: "move", unitIds: [worker.id], x: second.x, y: second.y, queued: true });

    expect(worker.order).toEqual({ type: "move", x: first.x, y: first.y });
    expect(worker.orderQueue).toEqual([{ type: "move", x: second.x, y: second.y }]);
    expect(game.effects.some((effect) => effect.type === "queuedMove" && effect.x === second.x && effect.y === second.y)).toBe(true);

    stepUntil(game, 120, () => worker.order.type === "move" && worker.order.x === second.x);
    expect(worker.order).toEqual({ type: "move", x: second.x, y: second.y });

    stepUntil(game, 120, () => worker.order.type === "idle");
    expect(worker.orderQueue).toEqual([]);
  });

  it("repairs and spends gold on a fixed worker cadence instead of every tick", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.players.player.gold = 100;
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    game.units = game.units.filter((unit) => unit === worker || unit.owner !== "player");
    const barracks = createBuilding("building-player-cadence-barracks", "player", "barracks", worker.x + 40, worker.y, true);
    game.buildings.push(barracks);
    barracks.hp = barracks.maxHp - 120;

    issueCommand(game, { type: "repair", unitIds: [worker.id], buildingId: barracks.id });
    stepMany(game, 20);

    expect(game.players.player.gold).toBe(99);
    expect(barracks.hp).toBeGreaterThan(barracks.maxHp - 120);
    expect(barracks.hp).toBeLessThan(barracks.maxHp - 30);
  });

  it("uses build-length hammer effects for repair instead of per-tick repair flashes", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.players.player.gold = 100;
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    const barracks = createBuilding("building-player-repair-effect-barracks", "player", "barracks", worker.x + 40, worker.y, true);
    game.buildings.push(barracks);
    barracks.hp = barracks.maxHp - 160;

    issueCommand(game, { type: "repair", unitIds: [worker.id], buildingId: barracks.id });
    expect(game.effects.find((effect) => effect.type === "repair" && effect.x === barracks.x && effect.y === barracks.y)?.duration).toBe(60);
    stepMany(game, 40);

    const repairEffects = game.effects.filter((effect) => effect.type === "repair" && effect.x === barracks.x && effect.y === barracks.y);
    expect(repairEffects.length).toBeLessThanOrEqual(2);
    expect(repairEffects.every((effect) => effect.duration === 60)).toBe(true);
  });

  it("keeps neutral treasure on camp carriers, lets monsters use permitted items, and drops items on death", () => {
    const game = sketchScene("neutral-carried-treasure")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .unit("neutral", "gladeWitch", 1600, 1600, { id: "neutral-lightning-carrier" })
      .unit("neutral", "gladeWitch", 1720, 1600, { id: "neutral-scroll-carrier" })
      .unit("player", "footman", 1640, 1600, { id: "player-challenger" })
      .item("item-red-lightning", "lightningRod", 0, 0, { carrierId: "neutral-lightning-carrier" })
      .item("item-red-scroll", "guardianScroll", 0, 0, { carrierId: "neutral-scroll-carrier" })
      .build()
      .createGame();
    const lightningCarrier = game.units.find((unit) => unit.id === "neutral-lightning-carrier")!;
    const challenger = game.units.find((unit) => unit.id === "player-challenger")!;

    stepMany(game, 3);

    expect(challenger.hp).toBeLessThan(challenger.maxHp);
    expect(game.effects.some((effect) => effect.type === "chainLightning")).toBe(true);
    expect(game.effects.some((effect) => effect.type === "guardianField")).toBe(false);

    lightningCarrier.hp = 1;
    challenger.cooldown = 0;
    issueCommand(game, { type: "attack", unitIds: [challenger.id], targetId: lightningCarrier.id });
    stepMany(game, 24);

    const dropped = game.items.find((item) => item.id === "item-red-lightning");
    expect(dropped?.carrierId).toBeUndefined();
    expect(dropped?.x).toBeCloseTo(lightningCarrier.x);
    expect(dropped?.y).toBeCloseTo(lightningCarrier.y);
  });

  it("lets ordinary units pick up, drop, and activate carried treasure through commands", () => {
    const game = sketchScene("player-item-commands")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .unit("player", "footman", 1500, 1500, { id: "item-caster" })
      .worker("enemy", 1560, 1500, { id: "first-target" })
      .worker("enemy", 1600, 1515, { id: "second-target" })
      .item("item-ground-lightning", "lightningRod", 1508, 1500)
      .build()
      .createGame();
    const caster = game.units.find((unit) => unit.id === "item-caster")!;
    const firstTarget = game.units.find((unit) => unit.id === "first-target")!;
    const secondTarget = game.units.find((unit) => unit.id === "second-target")!;

    issueCommand(game, { type: "pickupItem", unitId: caster.id, itemId: "item-ground-lightning" });
    expect(game.items.find((item) => item.id === "item-ground-lightning")?.carrierId).toBe(caster.id);

    issueCommand(game, { type: "useItem", unitId: caster.id, itemId: "item-ground-lightning", targetId: firstTarget.id });

    expect(firstTarget.hp).toBeLessThan(firstTarget.maxHp);
    expect(secondTarget.hp).toBeLessThan(secondTarget.maxHp);
    expect(game.effects.some((effect) => effect.type === "chainLightning")).toBe(true);

    issueCommand(game, { type: "dropItem", unitId: caster.id, itemId: "item-ground-lightning", x: caster.x + 24, y: caster.y + 10 });

    const dropped = game.items.find((item) => item.id === "item-ground-lightning");
    expect(dropped?.carrierId).toBeUndefined();
    expect(dropped?.x).toBeCloseTo(caster.x + 24);
  });

  it("lets player lightning rods target neutral wildlings", () => {
    const game = sketchScene("player-lightning-neutral-target")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .unit("player", "footman", 1500, 1500, { id: "neutral-rod-caster" })
      .unit("neutral", "wildling", 1600, 1500, { id: "neutral-rod-target" })
      .item("neutral-target-lightning", "lightningRod", 0, 0, { carrierId: "neutral-rod-caster" })
      .build()
      .createGame();
    const wildling = game.units.find((unit) => unit.id === "neutral-rod-target")!;

    issueCommand(game, { type: "useItem", unitId: "neutral-rod-caster", itemId: "neutral-target-lightning", targetId: wildling.id });

    expect(wildling.hp).toBeLessThan(wildling.maxHp);
    expect(game.effects.some((effect) => effect.type === "chainLightning" && effect.toX === wildling.x && effect.toY === wildling.y)).toBe(true);
  });

  it("breach charge is a consumed building-only item for converting camp rewards into structure damage", () => {
    const game = sketchScene("breach-charge-building-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .unit("player", "raider", 1500, 1500, { id: "breach-carrier" })
      .building("enemy", "barracks", 1700, 1500, { id: "breach-target-barracks" })
      .unit("enemy", "footman", 1640, 1500, { id: "breach-invalid-unit-target" })
      .item("breach-charge", "breachCharge", 0, 0, { carrierId: "breach-carrier" })
      .build()
      .createGame();
    const barracks = game.buildings.find((building) => building.id === "breach-target-barracks")!;
    const unit = game.units.find((candidate) => candidate.id === "breach-invalid-unit-target")!;

    issueCommand(game, { type: "useItem", unitId: "breach-carrier", itemId: "breach-charge", targetId: unit.id });
    expect(unit.hp).toBe(unit.maxHp);
    expect(game.items.some((item) => item.id === "breach-charge")).toBe(true);

    issueCommand(game, { type: "useItem", unitId: "breach-carrier", itemId: "breach-charge", targetId: barracks.id });

    expect(barracks.hp).toBeLessThanOrEqual(barracks.maxHp - 240);
    expect(game.items.some((item) => item.id === "breach-charge")).toBe(false);
  });

  it("guardian scroll protects nearby friendly units from incoming damage for its duration", () => {
    const game = sketchScene("guardian-scroll-protection")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .unit("player", "footman", 1500, 1500, { id: "guarded-footman" })
      .unit("player", "worker", 1540, 1500, { id: "scroll-carrier" })
      .unit("enemy", "archer", 1900, 1500, { id: "enemy-archer" })
      .item("guardian-scroll", "guardianScroll", 0, 0, { carrierId: "scroll-carrier" })
      .build()
      .createGame();
    const guarded = game.units.find((unit) => unit.id === "guarded-footman")!;
    const attacker = game.units.find((unit) => unit.id === "enemy-archer")!;

    issueCommand(game, { type: "useItem", unitId: "scroll-carrier", itemId: "guardian-scroll" });
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [attacker.id], targetId: guarded.id });
    stepMany(game, 2);

    expect(guarded.hp).toBe(guarded.maxHp);
    expect(guarded.effects.some((effect) => effect.type === "guardian")).toBe(true);
    expect(game.effects.some((effect) => effect.type === "guardianField" && effect.radius === 280)).toBe(true);
    expect(game.items.some((item) => item.id === "guardian-scroll")).toBe(false);

    stepMany(game, seconds(8.5));
    attacker.cooldown = 0;
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [attacker.id], targetId: guarded.id });
    stepMany(game, 2);

    expect(guarded.hp).toBeLessThan(guarded.maxHp);
  });

  it("shows an experience burst when a carried experience book is used", () => {
    const game = sketchScene("experience-book-visual")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .unit("player", "footman", 1500, 1500, { id: "book-carrier" })
      .item("experience-book", "experienceBook", 0, 0, { carrierId: "book-carrier" })
      .build()
      .createGame();

    issueCommand(game, { type: "useItem", unitId: "book-carrier", itemId: "experience-book" });

    expect(game.effects.some((effect) => effect.type === "experienceBurst" && effect.x === 1500 && effect.y === 1500)).toBe(true);
    expect(game.effects.map((effect) => effect.type as string)).not.toContain("levelUp");
  });

  it("storm staff creates sustained area damage instead of only a single burst", () => {
    const game = sketchScene("storm-staff-sustained-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .unit("player", "archer", 1500, 1500, { id: "storm-caster" })
      .unit("enemy", "footman", 1600, 1500, { id: "storm-target-a" })
      .unit("enemy", "archer", 1630, 1530, { id: "storm-target-b" })
      .item("storm-staff", "stormStaff", 0, 0, { carrierId: "storm-caster" })
      .build()
      .createGame();
    const firstTarget = game.units.find((unit) => unit.id === "storm-target-a")!;
    const secondTarget = game.units.find((unit) => unit.id === "storm-target-b")!;

    issueCommand(game, { type: "useItem", unitId: "storm-caster", itemId: "storm-staff", x: 1610, y: 1510 });
    const firstAfterCast = firstTarget.hp;
    const secondAfterCast = secondTarget.hp;
    stepMany(game, 50);

    expect(firstTarget.hp).toBeLessThan(firstAfterCast);
    expect(secondTarget.hp).toBeLessThan(secondAfterCast);
    expect(game.effects.some((effect) => effect.type === "storm")).toBe(true);
  });

  it("balances lightning rod around two-times the original chained burst", () => {
    const game = sketchScene("lightning-rod-total-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .unit("player", "contractArcher", 900, 900, { id: "rod-caster" })
      .unit("enemy", "golem", 1160, 900, { id: "chain-a" })
      .unit("enemy", "golem", 1200, 925, { id: "chain-b" })
      .unit("enemy", "golem", 1240, 950, { id: "chain-c" })
      .item("lightning-rod", "lightningRod", 0, 0, { carrierId: "rod-caster" })
      .build()
      .createGame();
    const targets = ["chain-a", "chain-b", "chain-c"].map((id) => game.units.find((unit) => unit.id === id)!);
    const hpBefore = targets.reduce((sum, unit) => sum + unit.hp, 0);

    issueCommand(game, { type: "useItem", unitId: "rod-caster", itemId: "lightning-rod", targetId: "chain-a" });

    const damage = hpBefore - targets.reduce((sum, unit) => sum + unit.hp, 0);
    expect(damage).toBeGreaterThanOrEqual(175);
    expect(damage).toBeLessThanOrEqual(185);
  });

  it("balances storm staff as a two-times sustained area item", () => {
    const game = sketchScene("storm-staff-total-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .unit("player", "contractArcher", 900, 900, { id: "storm-caster" })
      .unit("enemy", "golem", 1210, 900, { id: "storm-a" })
      .unit("enemy", "golem", 1230, 930, { id: "storm-b" })
      .item("storm-staff", "stormStaff", 0, 0, { carrierId: "storm-caster" })
      .build()
      .createGame();
    const targets = ["storm-a", "storm-b"].map((id) => game.units.find((unit) => unit.id === id)!);
    const hpBefore = targets.reduce((sum, unit) => sum + unit.hp, 0);

    issueCommand(game, { type: "useItem", unitId: "storm-caster", itemId: "storm-staff", x: 1210, y: 900 });
    stepMany(game, seconds(5));

    const damagePerTarget = (hpBefore - targets.reduce((sum, unit) => sum + unit.hp, 0)) / targets.length;
    expect(damagePerTarget).toBeGreaterThanOrEqual(45);
    expect(damagePerTarget).toBeLessThanOrEqual(51);
  });

  it("balances flame cloak as repeated close-range pressure, not a one-frame nuke", () => {
    const game = sketchScene("flame-cloak-total-damage")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .worker("player", 1000, 1000, { id: "cloak-carrier" })
      .worker("enemy", 1080, 1000, { id: "burn-target" })
      .item("flame-cloak", "flameCloak", 0, 0, { carrierId: "cloak-carrier" })
      .build()
      .createGame();
    const target = game.units.find((unit) => unit.id === "burn-target")!;
    const hpBefore = target.hp;

    stepMany(game, seconds(6.1));

    const damage = hpBefore - target.hp;
    expect(damage).toBeGreaterThanOrEqual(48);
    expect(damage).toBeLessThanOrEqual(60);
    expect(game.effects.some((effect) => effect.type === "flameBurn" && effect.x === target.x && effect.y === target.y)).toBe(true);
    expect(game.effects.some((effect) => effect.type === "flameBurn" && effect.x === 1000 && effect.y === 1000)).toBe(false);
  });

  it("lets a wildling use a carried storm staff against challengers", () => {
    const game = sketchScene("neutral-storm-staff-use")
      .map("bareDuel")
      .replaceDefaults()
      .player("player")
      .player("enemy")
      .unit("neutral", "gladeWitch", 1000, 1000, { id: "neutral-storm-carrier" })
      .unit("player", "golem", 1250, 1000, { id: "player-challenger" })
      .item("neutral-storm-staff", "stormStaff", 0, 0, { carrierId: "neutral-storm-carrier" })
      .build()
      .createGame();
    const challenger = game.units.find((unit) => unit.id === "player-challenger")!;

    stepMany(game, 1);

    expect(challenger.hp).toBeLessThan(challenger.maxHp);
    expect(game.effects.some((effect) => effect.type === "storm")).toBe(true);
  });

  it("seeds normal neutral maps with real treasure carried by wildlings", () => {
    const game = createGame("wildMarches", { aiPlayers: [] });
    const carriedItems = game.items.filter((item) => item.carrierId);

    expect(carriedItems.length).toBeGreaterThanOrEqual(3);
    expect(carriedItems.map((item) => item.kind)).toEqual(expect.arrayContaining(["flameCloak", "lightningRod", "experienceBook", "breachCharge"]));
    for (const item of carriedItems) {
      const carrier = game.units.find((unit) => unit.id === item.carrierId);
      expect(carrier?.owner).toBe("neutral");
    }
  });

  it("guards normal mercenary camps with nearby wildlings", () => {
    for (const mapId of ["verdantCrossroads", "campRush", "wildMarches"] as const) {
      const game = createGame(mapId, { aiPlayers: [] });
      for (const camp of game.mercenaryCamps) {
        const nearestGuardDistance = Math.min(...game.units.filter((unit) => unit.owner === "neutral").map((unit) => distance(unit, camp)));
        expect(nearestGuardDistance, `${mapId}:${camp.id}`).toBeLessThanOrEqual(280);
      }
    }
  });

  it("resolves soldier combat against neutral wildlings", () => {
    const game = createGame("bareDuel");
    const wildling = game.spawnUnit("neutral", "wildling", 1200, 1200);
    const soldier = game.spawnUnit("player", "footman", wildling.x - 70, wildling.y);

    issueCommand(game, { type: "attack", unitIds: [soldier.id], targetId: wildling.id });
    stepMany(game, 240);

    expect(game.units.some((unit) => unit.id === wildling.id)).toBe(false);
    expect(game.units.some((unit) => unit.id === soldier.id)).toBe(true);
  });

  it("lets attack-move soldiers acquire and clear neutral camp units", () => {
    const game = createGame("bareDuel");
    const wildling = game.spawnUnit("neutral", "wildling", 1200, 1200);
    const soldier = game.spawnUnit("player", "footman", wildling.x - 90, wildling.y);
    wildling.hp = 10;

    issueCommand(game, { type: "attackMove", unitIds: [soldier.id], x: wildling.x + 80, y: wildling.y });
    stepMany(game, 80);

    expect(game.units.some((unit) => unit.id === wildling.id)).toBe(false);
    expect(game.match.stats.neutralUnitsKilled.player).toBe(1);
  });

  it("makes attack-move pressure non-base buildings before town halls in local target acquisition", () => {
    const game = createGame("bareDuel");
    game.buildings = game.buildings.filter((building) => building.owner === "player");
    const archer = game.spawnUnit("player", "archer", 2500, 2500);
    const townHall = createBuilding("building-enemy-townhall-priority", "enemy", "townHall", 2560, 2500, true);
    const farm = createBuilding("building-enemy-farm-priority", "enemy", "farm", 2600, 2500, true);
    game.buildings.push(townHall, farm);

    issueCommand(game, { type: "attackMove", unitIds: [archer.id], x: 2650, y: 2500 });
    stepMany(game, 24);

    expect(farm.hp).toBeLessThan(farm.maxHp);
    expect(townHall.hp).toBe(townHall.maxHp);
  });

  it("pushes enemy AI toward an attack after building an army", () => {
    const game = createGame();
    const runtime = createAiRuntime(["enemy"]);
    stepUntil(game, 3_600, () => game.units.filter((unit) => unit.owner === "enemy" && unit.kind !== "worker").length >= 3, runtime);

    const enemySoldiers = game.units.filter((unit) => unit.owner === "enemy" && unit.kind !== "worker");
    const attackOrders = enemySoldiers.filter((unit) => unit.order?.type === "attack" || unit.order?.type === "move" || unit.order?.type === "attackMove");

    expect(enemySoldiers.length).toBeGreaterThanOrEqual(3);
    expect(attackOrders.length).toBeGreaterThan(0);
  });

  it("only sends AI attack waves into the enemy base after the enemy army and economy collapse", () => {
    const game = createGame();
    const runtime = createAiRuntime(["enemy"]);
    const playerTownHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;
    let baseCloseout: { unitIds: string[]; playerUnits: number } | undefined;

    for (let i = 0; i < 5_400 && !baseCloseout; i += 1) {
      const result = runPresetAiRuntimeForTest(game, runtime);
      const command = result.commands.map((entry) => entry.command).find((candidate) => candidate.type === "attackMove" && Math.hypot(candidate.x - playerTownHall.x, candidate.y - playerTownHall.y) <= 700);
      if (command?.type === "attackMove") {
        baseCloseout = {
          unitIds: command.unitIds,
          playerUnits: game.units.filter((unit) => unit.owner === "player").length,
        };
      }
      stepGame(game);
    }

    expect(baseCloseout).toBeDefined();
    expect(baseCloseout?.unitIds.length).toBeGreaterThanOrEqual(2);
    expect(baseCloseout?.playerUnits).toBe(0);
  });

  it("does not spam unfinished supply buildings while one farm is already pending", () => {
    const game = createGame();
    const runtime = createAiRuntime(["enemy"]);
    stepMany(game, 2800, runtime);

    const enemyFarms = game.buildings.filter((building) => building.owner === "enemy" && building.kind === "farm");
    const unfinishedFarms = enemyFarms.filter((building) => !building.complete);

    expect(enemyFarms.length).toBeLessThanOrEqual(7);
    expect(unfinishedFarms.length).toBeLessThanOrEqual(1);
  });

  it("expands AI economies to open gold mines when expansions exist", () => {
    const game = createGame("openClaims", { aiPlayers: ["player", "enemy"] });
    const runtime = createAiRuntime(["player", "enemy"], {
      scripts: [AI_SCRIPT_LIBRARY.economy, AI_SCRIPT_LIBRARY.supply, AI_SCRIPT_LIBRARY.productionBuilding, AI_SCRIPT_LIBRARY.training, AI_SCRIPT_LIBRARY.expansion],
    });

    for (let i = 0; i < 36_000 && !ownersHaveMiningExpansions(game, ["player", "enemy"]); i += 1) {
      runPresetAiRuntimeForTest(game, runtime);
      stepGame(game);
    }

    for (const owner of ["player", "enemy"] as PlayerId[]) {
      const townHalls = game.buildings.filter((building) => building.owner === owner && building.kind === "townHall" && building.complete);
      const expansionTownHall = townHalls.find((townHall) => distanceToClosestMainMine(game, townHall) > 650);
      const expansionMine = expansionTownHall ? game.resources.find((resource) => distance(resource, expansionTownHall) < 260) : undefined;
      const miners = expansionMine
        ? game.units.filter((unit) => unit.owner === owner && unit.kind === "worker" && unit.order.type === "mine" && unit.order.resourceId === expansionMine.id)
        : [];

      expect(townHalls.length).toBeGreaterThanOrEqual(2);
      expect(expansionTownHall).toBeDefined();
      expect(expansionMine).toBeDefined();
      expect(miners.length).toBeGreaterThan(0);
    }
  });

  it("runs a fast two-AI duel with no neutral camps or mercenary camps", () => {
    const result = runTwoAiDuel("bareDuel");
    const totalMercenaryKills = sumPlayerStats(result.game.match.stats.mercenaryKills);
    const totalNeutralKills = sumPlayerStats(result.game.match.stats.neutralUnitsKilled);

    expect(result.elapsedMs).toBeLessThan(AI_DUEL_CPU_BUDGET_MS);
    expect(result.game.match.stats.goldSpent.player).toBeGreaterThan(1_500);
    expect(result.game.match.stats.goldSpent.enemy).toBeGreaterThan(1_500);
    expect(result.game.match.stats.unitsKilled.player + result.game.match.stats.unitsKilled.enemy).toBeGreaterThan(20);
    expect(sumPlayerStats(result.game.match.stats.nonBaseBuildingsDestroyed)).toBeGreaterThan(0);
    expect(result.game.mercenaryCamps.length).toBe(0);
    expect(result.game.units.some((unit) => unit.owner === "neutral")).toBe(false);
    expect(totalMercenaryKills).toBe(0);
    expect(totalNeutralKills).toBe(0);
  });

  it("runs a fast two-AI duel with neutral camp clearing and mercenary combat", () => {
    const result = runTwoAiDuel("verdantCrossroads");
    const totalMercenaryKills = sumPlayerStats(result.game.match.stats.mercenaryKills);
    const totalNeutralKills = sumPlayerStats(result.game.match.stats.neutralUnitsKilled);

    expectTwoAiDuelBaseline(result);
    expect(result.game.mercenaryCamps.length).toBeGreaterThan(0);
    expect(totalMercenaryKills).toBeGreaterThan(0);
    expect(totalNeutralKills).toBeGreaterThan(0);
  });

  it("runs a fast two-AI duel on a neutral-heavy map variant", () => {
    const result = runTwoAiDuel("wildMarches");
    const totalMercenaryKills = sumPlayerStats(result.game.match.stats.mercenaryKills);
    const totalNeutralKills = sumPlayerStats(result.game.match.stats.neutralUnitsKilled);

    expectTwoAiDuelBaseline(result);
    expect(result.game.mercenaryCamps.length).toBeGreaterThan(1);
    expect(totalMercenaryKills).toBeGreaterThan(0);
    expect(totalNeutralKills).toBeGreaterThan(0);
  });

  it("runs a fast three-AI free-for-all with a real third faction economy and winner", () => {
    const game = createGame("wildMarches", { players: ["player", "enemy", "enemy2"], aiPlayers: ["player", "enemy", "enemy2"] });
    const runtime = createAiRuntime(["player", "enemy", "enemy2"]);
    const started = process.cpuUsage();

    stepMany(game, 36_000, runtime);

    const elapsedMs = elapsedCpuMs(started);
    const totalNeutralKills = sumPlayerStats(game.match.stats.neutralUnitsKilled);
    const totalNonBaseBuildingsDestroyed = sumPlayerStats(game.match.stats.nonBaseBuildingsDestroyed);
    const survivingTownHallOwners = game.activePlayers.filter((owner) => game.buildings.some((building) => building.owner === owner && building.kind === "townHall"));
    const maxAcceptableLoserCombat = 12;
    const survivingContenders = game.activePlayers.filter(
      (owner) =>
        game.buildings.some((building) => building.owner === owner && building.kind === "townHall") ||
        game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length > maxAcceptableLoserCombat,
    );
    const loserArmies = game.activePlayers
      .filter((owner) => owner !== game.match.winner)
      .map((owner) => game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length);

    expect(game.activePlayers).toEqual(["player", "enemy", "enemy2"]);
    expect(game.match.stats.goldSpent.enemy2).toBeGreaterThan(1_500);
    expect(game.match.stats.unitsKilled.enemy2 + game.match.stats.unitsLost.enemy2).toBeGreaterThan(0);
    expect(game.match.winner).not.toBeNull();
    expect(survivingTownHallOwners.every((owner) => owner === game.match.winner)).toBe(true);
    expect(survivingContenders).toEqual([game.match.winner]);
    expect(Math.max(...loserArmies)).toBeLessThanOrEqual(maxAcceptableLoserCombat);
    expect(game.match.endedAtTick).toBeLessThanOrEqual(36_000);
    expect(elapsedMs).toBeLessThan(AI_DUEL_CPU_BUDGET_MS);
    expectWinnerSpentAndLosersDiedCleanly(game, 1_500, 600, maxAcceptableLoserCombat);
    expect(game.match.stats.unitsKilled.player + game.match.stats.unitsKilled.enemy + game.match.stats.unitsKilled.enemy2).toBeGreaterThan(20);
    expect(game.match.stats.unitsLost.player + game.match.stats.unitsLost.enemy + game.match.stats.unitsLost.enemy2).toBeGreaterThan(20);
    expect(totalNeutralKills).toBeGreaterThan(0);
    expect(totalNonBaseBuildingsDestroyed).toBeGreaterThan(0);
  });

  it("runs a fast 1v2 allied-AI match without allied target acquisition", () => {
    const game = createGame("wildMarches", {
      players: ["player", "enemy", "enemy2"],
      aiPlayers: ["player", "enemy", "enemy2"],
      teams: { player: "north", enemy: "south", enemy2: "south" },
    });
    const runtime = createAiRuntime(["player", "enemy", "enemy2"]);
    const started = process.cpuUsage();
    const enemyBase = game.buildings.find((building) => building.owner === "enemy" && building.kind === "townHall")!;
    const enemy2Base = game.buildings.find((building) => building.owner === "enemy2" && building.kind === "townHall")!;
    const enemyFootman = game.spawnUnit("enemy", "footman", enemyBase.x - 60, enemyBase.y - 20);
    const enemy2Footman = game.spawnUnit("enemy2", "footman", enemy2Base.x - 60, enemy2Base.y - 20);

    stepMany(game, 20, runtime);

    expect(enemyFootman.order.type === "attack" ? enemyFootman.order.targetId : "").not.toBe(enemy2Footman.id);
    expect(enemy2Footman.order.type === "attack" ? enemy2Footman.order.targetId : "").not.toBe(enemyFootman.id);

    while (!game.match.winner && game.tick < 48_000) {
      runPresetAiRuntimeForTest(game, runtime);
      stepGame(game);
    }
    const elapsedMs = elapsedCpuMs(started);
    const survivingTeams = new Set(
      game.activePlayers
        .filter((owner) => game.buildings.some((building) => building.owner === owner && building.kind === "townHall") || game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length > 3)
        .map((owner) => (owner === "player" ? "north" : "south")),
    );
    const losingArmies = game.activePlayers
      .filter((owner) => owner !== game.match.winner && (owner === "player" ? "north" : "south") !== "south")
      .map((owner) => game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length);

    expect(game.match.winner).not.toBeNull();
    expect(game.match.endedAtTick).toBeLessThanOrEqual(48_000);
    expect(elapsedMs).toBeLessThan(AI_DUEL_CPU_BUDGET_MS);
    expect(survivingTeams.size).toBe(1);
    expect(Math.max(...losingArmies)).toBeLessThanOrEqual(3);
    expect(game.match.stats.goldSpent.player).toBeGreaterThan(1_000);
    expect(game.match.stats.goldSpent.enemy + game.match.stats.goldSpent.enemy2).toBeGreaterThan(1_000);
    expect(sumPlayerStats(game.match.stats.unitsLost)).toBeGreaterThanOrEqual(19);
    expect(sumPlayerStats(game.match.stats.nonBaseBuildingsDestroyed)).toBeGreaterThan(0);
  });

  it("ends team games only when the defeated side has no buildings left", () => {
    const game = createGame("grandThirty", {
      players: ["human-1", "ai-1", "ai-2"],
      aiPlayers: [],
      teams: { "human-1": "north", "ai-1": "south", "ai-2": "south" },
    });
    game.buildings = game.buildings.filter((building) => game.teams[building.owner] === "south");
    game.units = game.units.filter((unit) => unit.owner === "neutral" || game.teams[unit.owner] === "south");
    for (let i = 0; i < 4; i += 1) game.spawnUnit("human-1", "footman", 1200 + i * 30, 1200);

    stepMany(game, 24);

    expect(game.match.winner).toBe("ai-1");
  });

  it("attack-move prioritizes soldiers before workers and buildings", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const attacker = game.spawnUnit("player", "footman", 900, 900);
    const worker = game.spawnUnit("enemy", "worker", 940, 900);
    const soldier = game.spawnUnit("enemy", "footman", 945, 900);
    const tower = createBuilding("building-enemy-target-priority-tower", "enemy", "defenseTower", 920, 940, true);
    game.buildings.push(tower);
    attacker.order = { type: "attackMove", x: 1000, y: 900 };

    stepMany(game, 24);

    expect(soldier.hp).toBeLessThan(soldier.maxHp);
    expect(worker.hp).toBe(worker.maxHp);
    expect(tower.hp).toBe(tower.maxHp);
  });

  it("attack-move target selection weights low hp and high-threat soldiers", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = game.units.filter((unit) => unit.kind === "worker");
    const attacker = game.spawnUnit("player", "archer", 900, 900);
    const healthyFootman = game.spawnUnit("enemy", "footman", 960, 900);
    const weakRaider = game.spawnUnit("enemy", "raider", 1005, 900);
    weakRaider.hp = 20;
    attacker.order = { type: "attackMove", x: 1040, y: 900 };

    stepMany(game, 24);

    expect(weakRaider.hp).toBeLessThan(20);
    expect(healthyFootman.hp).toBe(healthyFootman.maxHp);
  });

  it("keeps defense towers as static control instead of army-melting artillery", () => {
    expect(BUILDING_DEFS.defenseTower.attackDamage).toBe(16);
    expect(BUILDING_DEFS.defenseTower.attackDamage).toBeLessThan(UNIT_DEFS.contractArcher.attackDamage);
    expect(BUILDING_DEFS.defenseTower.attackRange).toBe(480);
    expect(BUILDING_DEFS.defenseTower.attackRange).toBeGreaterThan(UNIT_DEFS.contractArcher.attackRange);
    expect(BUILDING_DEFS.defenseTower.attackCooldown).toBeGreaterThan(UNIT_DEFS.contractArcher.attackCooldown);

    const scene = sketchScene("soft-static-tower")
      .map("bareDuel")
      .replaceDefaults()
      .player("player", { team: "north" })
      .player("enemy", { team: "south" })
      .townHall("player", 520, 520)
      .townHall("enemy", 1220, 520)
      .tower("enemy", 1010, 520, { id: "defender-soft-tower" })
      .unit("player", "footman", 760, 500, { id: "tower-test-footman-1" })
      .unit("player", "footman", 760, 540, { id: "tower-test-footman-2" })
      .build();
    const game = scene.createGame();
    issueCommand(game, { type: "attackMove", unitIds: game.units.filter((unit) => unit.owner === "player").map((unit) => unit.id), x: 1030, y: 520 });

    stepUntil(game, 260, () => !game.buildings.some((building) => building.id === "defender-soft-tower"));

    expect(game.buildings.some((building) => building.id === "defender-soft-tower")).toBe(false);
    expect(game.units.filter((unit) => unit.owner === "player").length).toBeGreaterThanOrEqual(1);
  });
});

function ownersHaveMiningExpansions(game: ReturnType<typeof createGame>, owners: PlayerId[]) {
  return owners.every((owner) => {
    const expansionTownHall = game.buildings.find((building) => building.owner === owner && building.kind === "townHall" && building.complete && distanceToClosestMainMine(game, building) > 650);
    const expansionMine = expansionTownHall ? game.resources.find((resource) => distance(resource, expansionTownHall) < 260) : undefined;
    return Boolean(expansionMine && game.units.some((unit) => unit.owner === owner && unit.kind === "worker" && unit.order.type === "mine" && unit.order.resourceId === expansionMine.id));
  });
}

function distanceToClosestMainMine(game: ReturnType<typeof createGame>, point: { x: number; y: number }) {
  return Math.min(
    ...game.resources.filter((resource) => resource.id === "gold-player-main" || resource.id === "gold-enemy-main" || resource.id === "gold-enemy2-main").map((resource) => distance(resource, point)),
  );
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function killWith(game: ReturnType<typeof createGame>, attacker: Unit, targetKind: UnitKind, owner: Unit["owner"] = "enemy") {
  const targetDistance = attacker.attackRange > 90 ? attacker.attackRange - 4 : Math.min(80, Math.max(38, attacker.attackRange - 4));
  const target = game.spawnUnit(owner, targetKind, attacker.x + targetDistance, attacker.y);
  target.hp = 1;
  issueCommand(game, { type: "attack", unitIds: [attacker.id], targetId: target.id });
  stepUntil(game, 40, () => !game.units.some((unit) => unit.id === target.id));
  attacker.cooldown = 0;
}

function mineGoldIncomeWithWorkers(workerCount: number, ticks: number) {
  const game = createGame("bareDuel", { aiPlayers: [] });
  const mine = game.resources.find((resource) => resource.id === "gold-player-main")!;
  mine.amount = 100_000;
  game.players.player.gold = 0;
  game.units = game.units.filter((unit) => !(unit.owner === "player" && unit.kind === "worker"));
  const workers = Array.from({ length: workerCount }, (_, index) => game.spawnUnit("player", "worker", mine.x + index * 3, mine.y + index * 3));

  issueCommand(game, { type: "mine", unitIds: workers.map((worker) => worker.id), resourceId: mine.id });
  stepMany(game, ticks);

  return game.players.player.gold;
}
