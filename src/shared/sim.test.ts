import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, RACE_DEFS, TRAINABLE_UNIT_KINDS, UNIT_DEFS } from "./catalog";
import { AI_SCRIPT_LIBRARY } from "./ai-policy";
import { createAiRuntime, runPresetAiRuntime, type AiRuntimeState } from "./ai-runtime";
import { createBuilding } from "./map";
import { createGame, issueCommand, stepGame } from "./sim";
import type { MapId, PlayerId, PlayerNumberMap } from "./types";

function stepMany(game: ReturnType<typeof createGame>, count: number, runtime?: AiRuntimeState) {
  for (let i = 0; i < count; i += 1) {
    if (runtime) runPresetAiRuntime(game, runtime);
    stepGame(game);
  }
}

function runTwoAiDuel(mapId: MapId) {
  const game = createGame(mapId, { aiPlayers: ["player", "enemy"] });
  const runtime = createAiRuntime(["player", "enemy"]);
  const started = performance.now();
  stepMany(game, 36_000, runtime);
  return { game, elapsedMs: performance.now() - started };
}

function expectTwoAiDuelBaseline({ game, elapsedMs }: ReturnType<typeof runTwoAiDuel>) {
  const totalNonBaseBuildingsDestroyed = sumPlayerStats(game.match.stats.nonBaseBuildingsDestroyed);
  const losingArmies = game.activePlayers
    .filter((owner) => owner !== game.match.winner)
    .map((owner) => game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length);

  expect(game.match.winner).not.toBeNull();
  expect(game.match.endedAtTick).toBeLessThanOrEqual(36_000);
  expect(elapsedMs).toBeLessThan(1_500);
  expect(game.match.stats.goldSpent.player).toBeGreaterThan(1_500);
  expect(game.match.stats.goldSpent.enemy).toBeGreaterThan(1_500);
  expect(game.match.stats.unitsKilled.player).toBeGreaterThan(0);
  expect(game.match.stats.unitsKilled.enemy).toBeGreaterThan(0);
  expect(game.match.stats.unitsLost.player).toBeGreaterThan(0);
  expect(game.match.stats.unitsLost.enemy).toBeGreaterThan(0);
  expect(totalNonBaseBuildingsDestroyed).toBeGreaterThan(0);
  expect(Math.max(...losingArmies)).toBeLessThanOrEqual(3);
}

function expectActivePlayersSpent(game: ReturnType<typeof createGame>, minimum: number) {
  for (const owner of game.activePlayers) {
    expect(game.match.stats.goldSpent[owner]).toBeGreaterThan(minimum);
  }
}

function sumPlayerStats(record: PlayerNumberMap) {
  return record.player + record.enemy + record.enemy2;
}

describe("sketch RTS simulation", () => {
  it("defines a production roster with at least 10 distinct unit kinds and 5 building kinds including a tower", () => {
    expect(TRAINABLE_UNIT_KINDS.length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(UNIT_DEFS)).toEqual(expect.arrayContaining(["priest", "summoner", "witch", "golem"]));
    expect(Object.keys(BUILDING_DEFS).length).toBeGreaterThanOrEqual(5);
    expect(BUILDING_DEFS.defenseTower.attackDamage).toBeGreaterThan(0);
    expect(Object.keys(RACE_DEFS)).toEqual(expect.arrayContaining(["grove", "ember"]));
  });

  it("stores race as player state and lets race scripts change AI production choices", () => {
    const grove = createGame("bareDuel", { aiPlayers: ["enemy"], races: { enemy: "grove" } });
    const ember = createGame("bareDuel", { aiPlayers: ["enemy"], races: { enemy: "ember" } });
    grove.players.enemy.gold = 5000;
    ember.players.enemy.gold = 5000;
    grove.buildings.push(createBuilding("building-enemy-grove-sanctum-proof", "enemy", "sanctum", 3100, 3100, true));
    ember.buildings.push(createBuilding("building-enemy-ember-sanctum-proof", "enemy", "sanctum", 3100, 3100, true));
    const groveRuntime = createAiRuntime(["enemy"], { scripts: [AI_SCRIPT_LIBRARY.training] });
    const emberRuntime = createAiRuntime(["enemy"], { scripts: [AI_SCRIPT_LIBRARY.training] });

    stepMany(grove, 50, groveRuntime);
    stepMany(ember, 50, emberRuntime);

    const groveSanctum = grove.buildings.find((building) => building.id === "building-enemy-grove-sanctum-proof")!;
    const emberSanctum = ember.buildings.find((building) => building.id === "building-enemy-ember-sanctum-proof")!;
    expect(grove.players.enemy.race).toBe("grove");
    expect(ember.players.enemy.race).toBe("ember");
    expect(groveSanctum.queue[0]?.unitKind).toBe("priest");
    expect(emberSanctum.queue[0]?.unitKind).toBe("witch");
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
        addMercenaryCamps: [{ id: "merc-agent-pocket", x: 1580, y: 1400, radius: 30, hireKind: "mercenary", cost: 185, stock: 2, cooldown: 90, cooldownRemaining: 0 }],
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

    issueCommand(game, { type: "build", unitId: worker.id, buildingKind: "farm", x: worker.x + 90, y: worker.y });
    stepMany(game, 220);

    expect(game.players.player.supplyCap).toBeGreaterThan(game.players.player.supplyUsed);
    expect(() => issueCommand(game, { type: "train", buildingId: townHall.id, unitKind: "worker" })).not.toThrow();
  });

  it("builds a defense tower that automatically attacks enemies in range", () => {
    const game = createGame();
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    game.players.player.gold = 1000;

    issueCommand(game, { type: "build", unitId: worker.id, buildingKind: "defenseTower", x: worker.x + 90, y: worker.y });
    stepMany(game, 260);
    const tower = game.buildings.find((building) => building.owner === "player" && building.kind === "defenseTower")!;
    const target = game.spawnUnit("enemy", "raider", tower.x + 120, tower.y);
    stepMany(game, 120);

    expect(tower.complete).toBe(true);
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it("lets AI build a defensive tower near a pressured base through normal construction", () => {
    const game = createGame("bareDuel", { aiPlayers: ["enemy"] });
    const runtime = createAiRuntime(["enemy"]);
    const enemyBase = game.buildings.find((building) => building.owner === "enemy" && building.kind === "townHall")!;
    const attacker = game.spawnUnit("player", "raider", enemyBase.x - 230, enemyBase.y - 40);
    game.players.enemy.gold = 1000;

    stepMany(game, 520, runtime);

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
    const hit = game.effects.find((effect) => effect.type === "hit");
    expect(projectile).toMatchObject({ fromX: archer.x, fromY: archer.y, toX: target.x, toY: target.y });
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

  it("awards XP and modest level stats only to the unit that lands the killing blow", () => {
    const game = createGame();
    const finisher = game.spawnUnit("player", "footman", 2500, 2500);
    const nearbyAlly = game.spawnUnit("player", "archer", 2490, 2520);
    const target = game.spawnUnit("enemy", "worker", 2538, 2500);
    target.hp = 1;

    issueCommand(game, { type: "attack", unitIds: [finisher.id], targetId: target.id });
    stepMany(game, 1);

    expect(finisher.kills).toBe(1);
    expect(finisher.xp).toBeGreaterThan(0);
    expect(finisher.level).toBe(2);
    expect(finisher.maxHp).toBeLessThanOrEqual(UNIT_DEFS.footman.hp + 12);
    expect(finisher.attackDamage).toBeLessThanOrEqual(UNIT_DEFS.footman.attackDamage + 2);
    expect(nearbyAlly.xp).toBe(0);
    expect(nearbyAlly.level).toBe(1);
  });

  it("emits tower projectile feedback when a defense tower fires", () => {
    const game = createGame();
    const worker = game.units.find((unit) => unit.owner === "player" && unit.kind === "worker")!;
    game.players.player.gold = 1000;

    issueCommand(game, { type: "build", unitId: worker.id, buildingKind: "defenseTower", x: worker.x + 90, y: worker.y });
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
    const game = createGame();
    const priest = game.spawnUnit("player", "priest", 2000, 2000);
    const summoner = game.spawnUnit("player", "summoner", 2050, 2000);
    const witch = game.spawnUnit("player", "witch", 2100, 2000);
    const hurt = game.spawnUnit("player", "footman", 2030, 2040);
    const enemy = game.spawnUnit("enemy", "raider", 2140, 2000);
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
    game.players.enemy.gold = 1000;
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

  it("resolves soldier combat against neutral wildlings", () => {
    const game = createGame();
    const wildling = game.units.find((unit) => unit.owner === "neutral" && unit.kind === "wildling")!;
    const soldier = game.spawnUnit("player", "footman", wildling.x - 70, wildling.y);

    issueCommand(game, { type: "attack", unitIds: [soldier.id], targetId: wildling.id });
    stepMany(game, 240);

    expect(game.units.some((unit) => unit.id === wildling.id)).toBe(false);
    expect(game.units.some((unit) => unit.id === soldier.id)).toBe(true);
  });

  it("lets attack-move soldiers acquire and clear neutral camp units", () => {
    const game = createGame();
    const wildling = game.units.find((unit) => unit.owner === "neutral" && unit.kind === "wildling")!;
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
    stepMany(game, 1);

    expect(farm.hp).toBeLessThan(farm.maxHp);
    expect(townHall.hp).toBe(townHall.maxHp);
  });

  it("pushes enemy AI toward an attack after building an army", () => {
    const game = createGame();
    const runtime = createAiRuntime(["enemy"]);
    stepMany(game, 1800, runtime);

    const enemySoldiers = game.units.filter((unit) => unit.owner === "enemy" && unit.kind !== "worker");
    const attackOrders = enemySoldiers.filter((unit) => unit.order?.type === "attack" || unit.order?.type === "move" || unit.order?.type === "attackMove");

    expect(enemySoldiers.length).toBeGreaterThanOrEqual(3);
    expect(attackOrders.length).toBeGreaterThan(0);
  });

  it("commands AI armies as a clustered attack-move wave instead of direct single-unit base dives", () => {
    const game = createGame();
    const runtime = createAiRuntime(["enemy"]);
    stepMany(game, 1800, runtime);

    const army = game.units.filter((unit) => unit.owner === "enemy" && unit.kind !== "worker");
    const attackMoveOrders = army.map((unit) => unit.order).filter((order): order is Extract<typeof order, { type: "attackMove" }> => order.type === "attackMove");
    const playerTownHall = game.buildings.find((building) => building.owner === "player" && building.kind === "townHall")!;

    expect(attackMoveOrders.length).toBeGreaterThanOrEqual(3);
    for (const order of attackMoveOrders) {
      expect(Math.hypot(order.x - playerTownHall.x, order.y - playerTownHall.y)).toBeGreaterThan(700);
    }
    const xs = attackMoveOrders.map((order) => order.x);
    const ys = attackMoveOrders.map((order) => order.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(180);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(180);
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

  it("expands AI economies to contested gold mines when expansions exist", () => {
    const game = createGame("verdantCrossroads", { aiPlayers: ["player", "enemy"] });
    const runtime = createAiRuntime(["player", "enemy"]);

    for (let i = 0; i < 12_000 && !ownersHaveMiningExpansions(game, ["player", "enemy"]); i += 1) {
      runPresetAiRuntime(game, runtime);
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

    expectTwoAiDuelBaseline(result);
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
    const started = performance.now();

    stepMany(game, 36_000, runtime);

    const elapsedMs = performance.now() - started;
    const totalNeutralKills = sumPlayerStats(game.match.stats.neutralUnitsKilled);
    const totalNonBaseBuildingsDestroyed = sumPlayerStats(game.match.stats.nonBaseBuildingsDestroyed);
    const survivingTownHallOwners = game.activePlayers.filter((owner) => game.buildings.some((building) => building.owner === owner && building.kind === "townHall"));
    const survivingContenders = game.activePlayers.filter(
      (owner) =>
        game.buildings.some((building) => building.owner === owner && building.kind === "townHall") ||
        game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length > 3,
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
    expect(Math.max(...loserArmies)).toBeLessThanOrEqual(3);
    expect(game.match.endedAtTick).toBeLessThanOrEqual(36_000);
    expect(elapsedMs).toBeLessThan(2_000);
    expectActivePlayersSpent(game, 1_500);
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
    const started = performance.now();
    const enemyFootman = game.spawnUnit("enemy", "footman", 3000, 520);
    const enemy2Footman = game.spawnUnit("enemy2", "footman", 3038, 520);

    stepMany(game, 20, runtime);

    expect(enemyFootman.order.type === "attack" ? enemyFootman.order.targetId : "").not.toBe(enemy2Footman.id);
    expect(enemy2Footman.order.type === "attack" ? enemy2Footman.order.targetId : "").not.toBe(enemyFootman.id);

    while (!game.match.winner && game.tick < 36_000) {
      runPresetAiRuntime(game, runtime);
      stepGame(game);
    }
    const elapsedMs = performance.now() - started;
    const survivingTeams = new Set(
      game.activePlayers
        .filter((owner) => game.buildings.some((building) => building.owner === owner && building.kind === "townHall") || game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length > 3)
        .map((owner) => (owner === "player" ? "north" : "south")),
    );
    const losingArmies = game.activePlayers
      .filter((owner) => owner !== game.match.winner && (owner === "player" ? "north" : "south") !== "south")
      .map((owner) => game.units.filter((unit) => unit.owner === owner && unit.kind !== "worker").length);

    expect(game.match.winner).not.toBeNull();
    expect(game.match.endedAtTick).toBeLessThanOrEqual(36_000);
    expect(elapsedMs).toBeLessThan(2_000);
    expect(survivingTeams.size).toBe(1);
    expect(Math.max(...losingArmies)).toBeLessThanOrEqual(3);
    expectActivePlayersSpent(game, 1_000);
    expect(sumPlayerStats(game.match.stats.unitsLost)).toBeGreaterThan(20);
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

    stepGame(game);

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

    stepGame(game);

    expect(soldier.hp).toBeLessThan(soldier.maxHp);
    expect(worker.hp).toBe(worker.maxHp);
    expect(tower.hp).toBe(tower.maxHp);
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
