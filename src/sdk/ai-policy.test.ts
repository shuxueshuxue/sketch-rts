import { describe, expect, it } from "vitest";
import { createBuilding } from "../shared/map";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../shared/sim";
import { AI_SCRIPT_VERSIONS, createAiTelemetry, planPresetAiCommands } from "./ai-policy";
import { sketchScene } from "./scene";

describe("SDK preset AI policy", () => {
  it("exposes named AI script versions for SDK and room adapters", () => {
    expect(Object.keys(AI_SCRIPT_VERSIONS)).toEqual(["v1", "v2"]);
    expect(AI_SCRIPT_VERSIONS.v1.length).toBeGreaterThan(0);
    expect(AI_SCRIPT_VERSIONS.v2.length).toBeGreaterThan(AI_SCRIPT_VERSIONS.v1.length - 1);

    const game = createGame("bareDuel", { aiPlayers: [] });
    const v1 = planPresetAiCommands(snapshotGame(game), "player", { version: "v1" });
    const v2 = planPresetAiCommands(snapshotGame(game), "player", { version: "v2" });

    expect(v1[0]).toMatchObject({ type: "mine" });
    expect(v2[0]).toMatchObject({ type: "mine" });
  });

  it("turns idle workers into ordinary player mine commands", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const command = planPresetAiCommands(snapshotGame(game), "player")[0];

    expect(command).toMatchObject({ type: "mine" });
    if (command?.type === "mine") {
      issuePlayerCommand(game, "player", command);
      expect(game.units.filter((unit) => unit.owner === "player" && unit.kind === "worker").every((unit) => unit.order.type === "mine")).toBe(true);
    }
  });

  it("uses local scripts without internal AI ownership to build train and attack", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });

    for (let i = 0; i < 900; i += 1) {
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
    expect(game.buildings.some((building) => building.owner === "enemy" && building.kind === "barracks")).toBe(true);
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

  it("v2 counts early harassment worker raids and the behavior can be disabled for A/B tests", () => {
    const scene = sketchScene("v2-harass-workers")
      .map("bareDuel")
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

    const enabled = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, telemetry }).find((command) => command.type === "attack");
    const disabled = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, disabledBehaviors: ["earlyHarassment"], telemetry: createAiTelemetry() }).find((command) => command.type === "attack");

    expect(enabled).toMatchObject({ type: "attack" });
    expect(enabled?.type === "attack" ? enabled.targetId : "").toMatch(/worker/);
    expect(enabled?.type === "attack" ? enabled.unitIds.length : 0).toBe(2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.earlyHarassment.attempts).toBe(1);
    expect(telemetry.behaviors.earlyHarassment.workerRaidCommands).toBe(1);
  });

  it("v2 counts early harassment retreats when a larger defending force answers", () => {
    const scene = sketchScene("v2-harass-retreat")
      .map("bareDuel")
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

    const command = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "move");

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

    const enabled = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "move");
    const disabled = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, disabledBehaviors: ["earlyHarassment", "skirmishPreservation"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "move" && candidate.unitIds.some((id) => id.includes("footman") || id.includes("archer")),
    );

    expect(enabled).toMatchObject({ type: "move" });
    expect(enabled?.type === "move" ? enabled.x : 0).toBeCloseTo(500, -2);
    expect(enabled?.type === "move" ? enabled.unitIds.length : 0).toBe(2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.skirmishPreservation.disadvantagedRetreats).toBe(1);
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

    const commands = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, telemetry }).filter((candidate) => candidate.type === "move");

    expect(commands).toHaveLength(2);
    const meleeRetreat = commands.find((command) => command.type === "move" && command.unitIds.some((id) => id.includes("footman")));
    const rangedPullback = commands.find((command) => command.type === "move" && command.unitIds.some((id) => id.includes("archer")));
    expect(meleeRetreat?.type === "move" ? meleeRetreat.x : 0).toBeCloseTo(500, -2);
    expect(rangedPullback?.type === "move" ? rangedPullback.x : 0).toBeLessThan(1700);
    expect(rangedPullback?.type === "move" ? rangedPullback.x : 0).toBeGreaterThan(500);
    expect(telemetry.behaviors.skirmishPreservation.woundedMeleeSaves).toBe(1);
    expect(telemetry.behaviors.skirmishPreservation.woundedRangedPullbacks).toBe(1);
  });

  it("v2 falls back to a friendly expansion when losing a fight near an owned mine", () => {
    const scene = sketchScene("v2-expansion-fallback")
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

    const enabled = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "move");
    const disabled = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, disabledBehaviors: ["expansionFallback"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "move" && Math.abs(candidate.x - 1450) < 120,
    );

    expect(enabled).toMatchObject({ type: "move" });
    expect(enabled?.type === "move" ? enabled.x : 0).toBeCloseTo(1450, -2);
    expect(enabled?.type === "move" ? enabled.unitIds.length : 0).toBe(2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.expansionFallback.expansionFallbackRetreats).toBe(1);
  });

  it("v2 opens an extra expansion when the opponent economy is ahead", () => {
    const scene = sketchScene("v2-economic-extra-expand")
      .map("openClaims")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
      .tower("v2", 1370, 760, { id: "v2-natural-tower" })
      .worker("v2", 450, 500)
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
      buildings: ["v2-main", "v2-natural", "v2-natural-tower", "v1-main", "v1-natural", "v1-third"],
      resources: ["v2-main-mine", "v2-natural-mine", "v2-third-mine", "v1-main-mine", "v1-natural-mine", "v1-third-mine"],
    });
    if (!game.players["v2"]) throw new Error("missing v2 player");
    game.players["v2"].gold = 1200;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) worker.order = { type: "mine", resourceId: "v2-main-mine", phase: "toMine", timer: 0 };
    const telemetry = createAiTelemetry();

    const enabled = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "build");
    const disabled = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, disabledBehaviors: ["economicCatchUp"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "build" && candidate.buildingKind === "townHall",
    );

    expect(enabled).toMatchObject({ type: "build", buildingKind: "townHall" });
    expect(enabled?.type === "build" ? enabled.x : 0).toBeCloseTo(1960, -2);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.economicCatchUp.catchUpExpansions).toBe(1);
  });

  it("v2 protects catch-up expansions with towers before matching army plans", () => {
    const scene = sketchScene("v2-economic-tower")
      .map("openClaims")
      .player("v2", { team: "north", race: "grove" })
      .player("v1", { team: "south", race: "ember" })
      .townHall("v2", 500, 500, { id: "v2-main" })
      .townHall("v2", 1350, 620, { id: "v2-natural" })
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
      buildings: ["v2-main", "v2-natural", "v1-main", "v1-natural", "v1-third"],
      resources: ["v2-main-mine", "v2-natural-mine", "v2-third-mine", "v1-main-mine", "v1-natural-mine", "v1-third-mine"],
    });
    if (!game.players["v2"]) throw new Error("missing v2 player");
    game.players["v2"].gold = 1200;
    for (const worker of game.units.filter((unit) => unit.owner === "v2" && unit.kind === "worker")) worker.order = { type: "mine", resourceId: "v2-natural-mine", phase: "toMine", timer: 0 };
    const telemetry = createAiTelemetry();

    const enabled = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, telemetry }).find((candidate) => candidate.type === "build");
    const disabled = planPresetAiCommands(snapshotGame(game), "v2", { version: "v2", teams: game.teams, disabledBehaviors: ["economicCatchUp"], telemetry: createAiTelemetry() }).find(
      (candidate) => candidate.type === "build" && candidate.buildingKind === "defenseTower",
    );

    expect(enabled).toMatchObject({ type: "build", buildingKind: "defenseTower" });
    expect(enabled?.type === "build" ? enabled.x : 0).toBeGreaterThan(1200);
    expect(disabled).toBeUndefined();
    expect(telemetry.behaviors.economicCatchUp.catchUpTowers).toBe(1);
  });
});

function keepOnlyIds(game: ReturnType<typeof createGame>, ids: { buildings: string[]; resources: string[] }) {
  const buildings = new Set(ids.buildings);
  const resources = new Set(ids.resources);
  game.buildings = game.buildings.filter((building) => buildings.has(building.id));
  game.resources = game.resources.filter((resource) => resources.has(resource.id));
  game.units = game.units.filter((unit) => unit.id.startsWith("scene-"));
}
