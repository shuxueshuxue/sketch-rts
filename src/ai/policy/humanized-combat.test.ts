import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { ABILITY_DEFS, BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import { issuePlayerCommand, snapshotGame, stepGame } from "../../shared/sim";
import { createAiPolicyMemory } from "../memory";
import { planPresetAiCommandEntries } from "./core";
import { planBattlefieldCommands } from "./battlefield";
import { planAbilityCommands, planFocusFireCommand } from "./spell-tactics";
import { planV6General } from "./v6/general";
import { runAiCommandEntriesFromScripts } from "./script-runner";
import { planAllySupport, supportUnitIds } from "./ally-support";
import type { AiScriptVersion } from "../../shared/types";

const versions = ["v5", "v7", "v8"] as const;
function field(name: string) {
  return sketchScene(name).map("openClaims").replaceDefaults()
    .player("us", { team: "north", race: "grove" })
    .player("ally", { team: "north", race: "ember" })
    .player("enemy", { team: "south", race: "grove" })
    .townHall("us", 500, 500, { id: "home" })
    .townHall("enemy", 3_400, 3_400, { id: "enemy-home" });
}
function context(version: AiScriptVersion) {
  const memory = createAiPolicyMemory();
  memory.v6 = { doctrine: { profileId: "steady", strategyId: "grove-cavalry-line", decidedTick: 0 } };
  return { version: "v2" as const, requestedVersion: version, memory };
}

describe("natural combat decisions", () => {
  it("keeps the mainland army from marching at an island just because a colony stands there", () => {
    let scene = field("colonial-front-ownership").townHall("us", 3_000, 2_500);
    for (let i = 0; i < 6; i++) scene = scene.unit("us", "footman", 800 + i * 20, 800);
    for (let i = 0; i < 8; i++) scene = scene.unit("us", "footman", 3_000 + i * 20, 2_700);
    const game = scene.build().createGame();
    const cols = Math.ceil(game.map.width / 32), rows = Math.ceil(game.map.height / 32);
    game.map = { ...game.map, terrain: { cell: 32, cols, rows, cells: Array.from({ length: cols * rows }, (_, i) => i % cols >= 48 && i % cols <= 62 ? "~" : ".").join("") } };
    const options = context("v8");
    planV6General(snapshotGame(game), "us", { ...options, teams: game.teams });
    expect(options.memory.v6?.general?.mode).toBe("hold");
  });
  it.each(["v7", "v8"] as const)("%s finishes a base trade when returning would be too late and another own base is safe", (version) => {
    let scene = field(`base-trade-${version}`).townHall("us", 500, 2_000, { id: "fallback" });
    for (let i = 0; i < 8; i++) scene = scene.unit("us", "footman", 3_200 + i * 20, 3_200, { id: `attacker-${i}` });
    for (let i = 0; i < 4; i++) scene = scene.unit("enemy", "footman", 600 + i * 20, 600);
    const game = scene.build().createGame();
    game.buildings.find(base => base.id === "enemy-home")!.hp = 200;
    const options = context(version);
    options.memory.v6!.general = { mode: "attack", targetHallId: "enemy-home", group: game.units.filter(unit => unit.owner === "us").map(unit => unit.id), groupStart: 8, stage: "strike" };
    planV6General(snapshotGame(game), "us", { ...options, teams: game.teams });
    expect(options.memory.v6?.general?.baseTrade).toBe(true);
    expect(options.memory.v6?.general?.mode).toBe("attack");
    game.buildings = game.buildings.filter(base => base.id !== "fallback");
    planV6General(snapshotGame(game), "us", { ...options, teams: game.teams });
    expect(options.memory.v6?.general?.baseTrade).not.toBe(true);
    expect(options.memory.v6?.general?.mode).toBe("defend");
  });
  it.each(versions)("%s assigns a reachable rescue and returns control when the danger is over", (version) => {
    let scene = field(`rescue-${version}`).townHall("ally", 2_000, 1_500, { id: "ally-home" });
    for (let i = 0; i < 6; i++) scene = scene.unit("us", "footman", 1_700 + i * 20, 1_100, { id: `guard-${i}` });
    for (let i = 0; i < 3; i++) scene = scene.unit("enemy", "footman", 2_300 + i * 20, 1_500, { id: `raider-${i}`, order: { type: "attack", targetId: "ally-home" } });
    const game = scene.build().createGame();
    const options = { ...context(version), teams: game.teams };
    const commands = planPresetAiCommandEntries(snapshotGame(game), "us", { ...options, version }).filter(entry => entry.scriptId === "allySupport");
    expect(commands.some(entry => entry.command.type === "attackMove" && entry.command.unitIds.length >= 4)).toBe(true);
    expect(options.memory.support?.baseId).toBe("ally-home");
    for (let tick = 0; tick < 900 && !game.match.winner; tick++) {
      if (tick % 15 === 0) {
        supportUnitIds(snapshotGame(game), "us", options);
        for (const command of planAllySupport(snapshotGame(game), "us", options)) issuePlayerCommand(game, "us", command);
      }
      stepGame(game);
    }
    expect(game.buildings.some(base => base.id === "ally-home")).toBe(true);
    expect(game.units.filter(unit => unit.owner === "enemy")).toHaveLength(0);
    supportUnitIds(snapshotGame(game), "us", options);
    expect(options.memory.support).toBeUndefined();
  });

  it("recalls a rescue when its own home comes under attack", () => {
    const game = field("home-before-rescue").townHall("ally", 2_000, 1_500, { id: "ally-home" })
      .unit("us", "knight", 1_700, 1_200, { id: "guard" })
      .unit("enemy", "footman", 2_100, 1_500).unit("enemy", "footman", 650, 550).build().createGame();
    const options = context("v8");
    options.memory.support = { baseId: "ally-home", unitIds: ["guard"], sinceTick: 0 };
    expect(supportUnitIds(snapshotGame(game), "us", { ...options, teams: game.teams }).size).toBe(0);
    expect(options.memory.support).toBeUndefined();
  });

  it("does not send a lone soldier to a rescue it and the ally cannot win", () => {
    let scene = field("unwinnable-rescue").townHall("ally", 2_000, 1_500).unit("us", "footman", 1_700, 1_200);
    for (let i = 0; i < 6; i++) scene = scene.unit("enemy", "knight", 2_200 + i * 25, 1_500);
    const game = scene.build().createGame();
    expect(supportUnitIds(snapshotGame(game), "us", { ...context("v7"), teams: game.teams }).size).toBe(0);
  });

  it.each(versions)("%s heals wounded allied soldiers", (version) => {
    const game = field(`allied-heal-${version}`).unit("us", "priest", 1_500, 1_500, { id: "medic" })
      .unit("ally", "emberRavager", 1_600, 1_500, { id: "patient", hp: 40 }).build().createGame();
    const commands = planAbilityCommands(snapshotGame(game), "us", { ...context(version), teams: game.teams });
    expect(commands).toContainEqual({ type: "cast", unitId: "medic", ability: "heal", targetId: "patient" });
    for (const command of commands) issuePlayerCommand(game, "us", command);
    expect(game.units.find(unit => unit.id === "patient")!.hp).toBe(95);
  });

  it("sends knights after an exposed siege gun ahead of an archer", () => {
    const game = field("knights-hunt-gun").unit("us", "knight", 1_500, 1_500, { id: "knight" })
      .unit("us", "knight", 1_520, 1_540).unit("us", "knight", 1_540, 1_580)
      .unit("enemy", "archer", 1_650, 1_500, { id: "archer" })
      .unit("enemy", "catapult", 1_900, 1_500, { id: "gun" }).build().createGame();
    expect(planBattlefieldCommands(snapshotGame(game), "us", context("v8"))).toContainEqual({ type: "attack", unitIds: ["knight"], targetId: "gun" });
  });

  it("keeps knights from diving through a stronger melee screen to reach a gun", () => {
    let scene = field("screened-gun").unit("us", "knight", 1_500, 1_500, { id: "knight" }).unit("enemy", "catapult", 1_900, 1_500, { id: "gun" });
    for (let i = 0; i < 5; i++) scene = scene.unit("enemy", "footman", 1_730 + i * 25, 1_500);
    const game = scene.build().createGame();
    expect(planBattlefieldCommands(snapshotGame(game), "us", context("v8"))).not.toContainEqual({ type: "attack", unitIds: ["knight"], targetId: "gun" });
  });

  it.each(versions)("%s lets infantry fight their own frontage instead of chasing the same archer", (version) => {
    const game = field(`frontage-${version}`).unit("us", "footman", 1_500, 1_500, { id: "left" })
      .unit("us", "footman", 1_500, 1_700, { id: "right" })
      .unit("enemy", "footman", 1_575, 1_500, { id: "left-foe" })
      .unit("enemy", "footman", 1_575, 1_700, { id: "right-foe" })
      .unit("enemy", "archer", 1_850, 1_600, { id: "archer" }).build().createGame();
    const options = { ...context(version), teams: game.teams };
    const commands = planBattlefieldCommands(snapshotGame(game), "us", options);
    expect(commands).toContainEqual({ type: "attack", unitIds: ["left"], targetId: "left-foe" });
    expect(commands).toContainEqual({ type: "attack", unitIds: ["right"], targetId: "right-foe" });
    const focus = planFocusFireCommand(snapshotGame(game), "us", options);
    expect(focus?.type === "attack" ? focus.targetId : undefined).not.toBe("archer");
  });

  it("interrupts the builder of a tower rush before the tower starts firing", () => {
    const game = field("tower-rush-builder").unit("us", "footman", 650, 600, { id: "guard" })
      .worker("enemy", 900, 600, { id: "builder", order: { type: "build", buildingKind: "defenseTower", x: 920, y: 600 } }).build().createGame();
    expect(planBattlefieldCommands(snapshotGame(game), "us", context("v7"))).toContainEqual({ type: "attack", unitIds: ["guard"], targetId: "builder" });
  });

  it("preserves a charge chosen in the same full V8 planning frame as a general movement", () => {
    const game = field("full-stack-charge").unit("us", "knight", 1_500, 1_500, { id: "rider" })
      .unit("enemy", "catapult", 1_740, 1_500, { id: "gun" }).build().createGame();
    const options = context("v8");
    const entries = planPresetAiCommandEntries(snapshotGame(game), "us", { ...options, version: "v8", teams: game.teams });
    expect(entries).toContainEqual({ scriptId: "v8Charge", command: { type: "cast", unitId: "rider", ability: "charge", targetId: "gun" } });
    for (const { command } of entries) issuePlayerCommand(game, "us", command);
    expect(game.units.find(unit => unit.id === "rider")!.order.type).toBe("charge");
    expect(entries.filter(entry => "unitIds" in entry.command && entry.command.unitIds.includes("rider") && ["move", "attack", "attackMove"].includes(entry.command.type))).toHaveLength(0);
  });

  it.each(["v7", "v8"] as const)("%s punishes a collapsed opponent with a smaller army", (version) => {
    let scene = field(`exposed-base-${version}`);
    for (let i = 0; i < 8; i++) scene = scene.unit("us", "footman", 1_300 + i * 25, 1_300);
    const game = scene.build().createGame();
    const options = { ...context(version), teams: game.teams };
    planV6General(snapshotGame(game), "us", options);
    expect(options.memory.v6?.general?.mode).toBe("attack");
  });

  it("does not cancel V7's march when a stationary enemy only gets nearer because V7 advances", () => {
    let scene = field("v7-approach-observation");
    for (let i = 0; i < 8; i++) scene = scene.unit("us", "footman", 1_900 + i * 20, 1_800, { id: `front-${i}` });
    for (let i = 0; i < 12; i++) scene = scene.unit("enemy", "footman", 3_060 + i * 15, 1_800);
    const game = scene.build().createGame();
    const options = context("v7");
    options.memory.v6!.general = { mode: "attack", targetHallId: "enemy-home", group: game.units.filter(unit => unit.owner === "us").map(unit => unit.id), groupStart: 8, enemyGaps: { enemy: 1_400 }, enemyCenters: { enemy: { x: 3_142.5, y: 1_800 } } };
    planV6General(snapshotGame(game), "us", { ...options, teams: game.teams });
    expect(options.memory.v6?.general?.mode).toBe("attack");
    expect(options.memory.v6?.plays?.["general:retreat:incoming"]).toBeUndefined();
  });

  it("protects walk-to-cast orders but lets an instant heal share a frame with movement", () => {
    const game = field("cast-order-ownership").unit("us", "priest", 1_500, 1_500, { id: "healer" })
      .unit("us", "footman", 1_900, 1_500, { id: "patient", hp: 50 }).build().createGame();
    const scripts = [
      { id: "spell", phase: "tactics" as const, run: () => ({ type: "cast" as const, unitId: "healer", ability: "heal" as const, targetId: "patient" }) },
      { id: "move", phase: "tactics" as const, run: () => ({ type: "move" as const, unitIds: ["healer"], x: 500, y: 500 }) },
    ];
    let entries = runAiCommandEntriesFromScripts(snapshotGame(game), "us", scripts);
    expect(entries.map(entry => entry.scriptId)).toEqual(["spell"]);
    for (const { command } of entries) issuePlayerCommand(game, "us", command);
    expect(game.units.find(unit => unit.id === "healer")!.order.type).toBe("cast");
    game.units.find(unit => unit.id === "patient")!.x = 1_650;
    entries = runAiCommandEntriesFromScripts(snapshotGame(game), "us", scripts);
    expect(entries.map(entry => entry.scriptId)).toEqual(["spell", "move"]);
  });
});

describe("shorter ranged weapons", () => {
  it("keeps a lancer's upgraded reach a melee attack", () => {
    const game = field("upgraded-melee-reach").unit("us", "lancer", 1_500, 1_500, { id: "lancer" })
      .unit("enemy", "footman", 1_570, 1_500, { id: "target" }).build().createGame();
    game.players.us!.upgrades.rangeTraining = 3;
    issuePlayerCommand(game, "us", { type: "attack", unitIds: ["lancer"], targetId: "target" });
    stepGame(game);
    expect(game.projectiles.some(shot => shot.attackerId === "lancer")).toBe(false);
    expect(game.units.find(unit => unit.id === "target")!.hp).toBeLessThan(UNIT_DEFS.footman.hp);
  });
  it("keeps the shortened 88-range creep attack a projectile against heavy armor", () => {
    const game = field("short-ranged-creep").unit("us", "barkMender", 1_500, 1_500, { id: "shooter" })
      .unit("enemy", "knight", 1_575, 1_500, { id: "target" }).build().createGame();
    issuePlayerCommand(game, "us", { type: "attack", unitIds: ["shooter"], targetId: "target" });
    for (let i = 0; i < 4; i++) stepGame(game);
    expect(game.projectiles.some(shot => shot.attackerId === "shooter")).toBe(true);
    for (let i = 0; i < 10; i++) stepGame(game);
    expect(game.units.find(unit => unit.id === "target")!.hp).toBe(UNIT_DEFS.knight.hp - Math.round(UNIT_DEFS.barkMender.attackDamage * 0.5));
  });
  it.each([
    ["archer", 399], ["sparkArcher", 360], ["priest", 252], ["summoner", 273], ["witch", 315],
    ["contractArcher", 441], ["fieldMedic", 263], ["warship", 390], ["bombardShip", 720],
    ["ballista", 590], ["catapult", 760], ["organGun", 380], ["murlocHunter", 150],
    ["emberAcolyte", 240], ["ashHexer", 300], ["pyreCaller", 260], ["cutter", 330], ["fireShip", 180],
    ["thornSlinger", 165], ["barkMender", 110], ["gladeWitch", 150], ["tidePriest", 200],
    ["ogreMage", 200], ["dragonWhelp", 180], ["redDragon", 220],
  ] as const)("%s has 80%% of its old basic range", (kind, previous) => {
    expect(UNIT_DEFS[kind].attackRange).toBeCloseTo(previous * 0.8, 8);
  });
  it("shortens ranged weapon skills while keeping melee, support spells and towers intact", () => {
    expect(ABILITY_DEFS.siegeBarrage.range).toBe(608);
    expect(ABILITY_DEFS.pinningBolt.range).toBe(472);
    expect(ABILITY_DEFS.heal.range).toBe(240);
    expect(UNIT_DEFS.knight.attackRange).toBe(72);
    expect(BUILDING_DEFS.defenseTower.attackRange).toBe(480);
  });
});
