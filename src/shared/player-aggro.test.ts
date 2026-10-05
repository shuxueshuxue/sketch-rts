import { describe, expect, it } from "vitest";
import { sketchScene } from "../sdk/scene";
import { createGame, issuePlayerCommand, stepGame } from "./sim";

type Game = ReturnType<typeof createGame>;

function duel(name: string) {
  return sketchScene(name)
    .map("bareDuel")
    .replaceDefaults()
    .player("v2", { team: "north", race: "grove" })
    .player("v1", { team: "south", race: "grove" })
    .townHall("v2", 180, 3_600)
    .townHall("v1", 3_900, 3_600);
}

function unit(game: Game, id: string) {
  return game.units.find((candidate) => candidate.id === id);
}

function stepUntil(game: Game, maxTicks: number, done: () => boolean) {
  for (let tick = 0; tick < maxTicks && !done(); tick += 1) stepGame(game);
  return done();
}

describe("player unit aggro", () => {
  it.each(["attack", "attackMove"] as const)("reconsiders an automatic %s during a strike and answers a live threat", (type) => {
    const game = duel(`automatic-threat-${type}`)
      .building("v1", "farm", 1_050, 1_000, { id: "old-target" })
      .unit("v2", "footman", 1_000, 1_000, { id: "guard", order: type === "attack"
        ? { type: "attack", targetId: "old-target", leashX: 1_000, leashY: 1_000 }
        : { type: "attackMove", targetId: "old-target", x: 1_800, y: 1_000 } })
      .unit("v1", "footman", 1_000, 1_090, { id: "reinforcement", order: { type: "attack", targetId: "guard" } })
      .build().createGame();
    stepGame(game);
    expect(unit(game, "guard")!.order).toMatchObject({ type, targetId: "reinforcement" });
    if (type === "attackMove") expect(unit(game, "guard")!.order).toMatchObject({ x: 1_800, y: 1_000 });
  });

  it("keeps a human's explicit target even while it and its neighbours are hit", () => {
    const game = duel("explicit-target-wins")
      .building("v1", "farm", 1_050, 1_000, { id: "farm" })
      .unit("v2", "footman", 1_000, 1_000, { id: "soldier" })
      .unit("v1", "footman", 1_000, 1_042, { id: "attacker", order: { type: "attack", targetId: "soldier" } })
      .build().createGame();
    issuePlayerCommand(game, "v2", { type: "attack", unitIds: ["soldier"], targetId: "farm" });
    const soldier = unit(game, "soldier")!;
    expect(stepUntil(game, 30, () => soldier.hp < soldier.maxHp)).toBe(true);
    expect(soldier.order).toEqual({ type: "attack", targetId: "farm" });
  });

  it("keeps its combat target when two comparable attackers alternate hits", () => {
    const game = duel("stable-threat")
      .unit("v2", "footman", 1_000, 1_000, { id: "guard", order: { type: "attack", targetId: "first", leashX: 1_000, leashY: 1_000 } })
      .unit("v1", "footman", 1_040, 1_000, { id: "first", order: { type: "attack", targetId: "guard" } })
      .unit("v1", "footman", 1_000, 1_040, { id: "second", order: { type: "attack", targetId: "guard" } })
      .build().createGame();
    for (let tick = 0; tick < 30; tick++) stepGame(game);
    expect(unit(game, "guard")!.order).toMatchObject({ targetId: "first" });
  });

  it("lets a neutral change from a harmless quarry to a reachable attacker, while respecting its camp leash", () => {
    const game = duel("neutral-threat")
      .unit("neutral", "stonebackBrute", 1_000, 1_000, { id: "beast", order: { type: "attack", targetId: "decoy", leashX: 1_000, leashY: 1_000 } })
      .worker("v1", 1_040, 1_000, { id: "decoy", order: { type: "hold", x: 1_040, y: 1_000 } })
      .unit("v2", "footman", 1_000, 1_045, { id: "hunter", order: { type: "attack", targetId: "beast" } })
      .build().createGame();
    unit(game, "beast")!.homeX = 1_000;
    unit(game, "beast")!.homeY = 1_000;
    stepGame(game);
    expect(unit(game, "beast")!.order).toMatchObject({ targetId: "hunter", leashX: 1_000, leashY: 1_000 });
    unit(game, "hunter")!.x = 2_000;
    unit(game, "hunter")!.order = { type: "hold", x: 2_000, y: 1_045 };
    stepGame(game);
    expect(unit(game, "beast")!.order.type).not.toBe("attack");
  });
  it("turns a soldier shot from outside acquisition range on the shooter, and its idle neighbours come to help", () => {
    const game = duel("aggro-shot-from-range")
      .unit("v1", "archer", 1_000, 1_000, { id: "shooter" })
      .unit("v2", "footman", 1_380, 1_000, { id: "victim" })
      .unit("v2", "footman", 1_380, 1_200, { id: "neighbour" })
      .unit("v2", "footman", 1_380, 1_400, { id: "out-of-call" })
      .build()
      .createGame();
    issuePlayerCommand(game, "v1", { type: "attack", unitIds: ["shooter"], targetId: "victim" });

    const victim = unit(game, "victim")!;
    expect(stepUntil(game, 60, () => victim.hp < victim.maxHp)).toBe(true);
    expect(victim.order).toMatchObject({ type: "attack", targetId: "shooter", leashX: 1_380, leashY: 1_000 });
    expect(unit(game, "neighbour")!.order).toMatchObject({ type: "attack", targetId: "shooter" });
    expect(unit(game, "out-of-call")!.order).toEqual({ type: "idle" });

    expect(stepUntil(game, 20 * 20, () => !unit(game, "shooter"))).toBe(true);
  });

  it("never overrides a command: a marching soldier keeps walking, and a worker cries for help instead of fighting", () => {
    const game = duel("aggro-commands-win")
      .unit("v1", "archer", 1_100, 600, { id: "marcher-shooter" })
      .unit("v2", "footman", 1_380, 600, { id: "marcher" })
      .unit("v1", "archer", 1_100, 1_600, { id: "worker-shooter" })
      .worker("v2", 1_380, 1_600, { id: "peasant" })
      .unit("v2", "footman", 1_380, 1_800, { id: "guard" })
      .build()
      .createGame();
    issuePlayerCommand(game, "v2", { type: "move", unitIds: ["marcher"], x: 1_380, y: 200 });
    issuePlayerCommand(game, "v1", { type: "attack", unitIds: ["marcher-shooter"], targetId: "marcher" });
    issuePlayerCommand(game, "v1", { type: "attack", unitIds: ["worker-shooter"], targetId: "peasant" });

    const marcher = unit(game, "marcher")!;
    const peasant = unit(game, "peasant")!;
    expect(stepUntil(game, 60, () => marcher.hp < marcher.maxHp && peasant.hp < peasant.maxHp)).toBe(true);
    expect(marcher.order).toEqual({ type: "move", x: 1_380, y: 200 });
    expect(peasant.order).toEqual({ type: "idle" });
    expect(unit(game, "guard")!.order).toMatchObject({ type: "attack", targetId: "worker-shooter" });
  });

  it("answers a building under fire with the idle soldiers standing by it", () => {
    const game = duel("aggro-building-call")
      .building("v2", "farm", 1_380, 1_000, { id: "farm" })
      .unit("v2", "footman", 1_380, 1_280, { id: "guard" })
      .unit("v1", "archer", 1_000, 1_000, { id: "shooter" })
      .build()
      .createGame();
    issuePlayerCommand(game, "v1", { type: "attack", unitIds: ["shooter"], targetId: "farm" });

    const farm = game.buildings.find((building) => building.id === "farm")!;
    expect(stepUntil(game, 60, () => farm.hp < farm.maxHp)).toBe(true);
    expect(unit(game, "guard")!.order).toMatchObject({ type: "attack", targetId: "shooter" });
  });

  it("turns an attack-move onto a shooter that hits it from outside acquisition range, and keeps the destination", () => {
    const game = duel("aggro-attack-move")
      .unit("v1", "archer", 1_100, 1_000, { id: "shooter" })
      .unit("v2", "footman", 1_380, 1_000, { id: "column" })
      .build()
      .createGame();
    issuePlayerCommand(game, "v2", { type: "attackMove", unitIds: ["column"], x: 1_380, y: 400 });
    issuePlayerCommand(game, "v1", { type: "attack", unitIds: ["shooter"], targetId: "column" });

    const column = unit(game, "column")!;
    expect(stepUntil(game, 60, () => column.hp < column.maxHp)).toBe(true);
    expect(column.order).toEqual({ type: "attackMove", x: 1_380, y: 400, targetId: "shooter" });
  });

  it("leashes a self-directed chase to where the soldier stood, but lets a commanded chase run", () => {
    const game = duel("aggro-leash")
      .unit("v2", "footman", 1_000, 1_000, { id: "sentry" })
      .unit("v1", "raider", 1_100, 1_000, { id: "bait" })
      .unit("v2", "footman", 1_000, 1_500, { id: "hunter" })
      .unit("v1", "raider", 1_100, 1_500, { id: "hunted" })
      .build()
      .createGame();
    issuePlayerCommand(game, "v1", { type: "move", unitIds: ["bait"], x: 3_000, y: 1_000 });
    issuePlayerCommand(game, "v1", { type: "move", unitIds: ["hunted"], x: 3_000, y: 1_500 });
    issuePlayerCommand(game, "v2", { type: "attack", unitIds: ["hunter"], targetId: "hunted" });

    const sentry = unit(game, "sentry")!;
    const hunter = unit(game, "hunter")!;
    stepGame(game);
    expect(sentry.order).toMatchObject({ type: "attack", targetId: "bait", leashX: 1_000, leashY: 1_000 });

    expect(stepUntil(game, 20 * 20, () => sentry.order.type === "move")).toBe(true);
    expect(sentry.order).toEqual({ type: "move", x: 1_000, y: 1_000 });
    expect(sentry.x).toBeGreaterThan(1_550);
    expect(hunter.order).toMatchObject({ type: "attack", targetId: "hunted" });

    expect(stepUntil(game, 20 * 20, () => sentry.order.type === "idle")).toBe(true);
    expect(Math.hypot(sentry.x - 1_000, sentry.y - 1_000)).toBeLessThan(8);
    expect(hunter.x).toBeGreaterThan(2_000);
  });

  it("scores an enemy attacking our side above a nearer bystander", () => {
    const game = duel("aggro-threat")
      .building("v2", "defenseTower", 1_000, 1_000, { id: "tower" })
      .building("v2", "farm", 1_000, 1_300, { id: "farm" })
      .unit("v1", "footman", 1_000, 1_360, { id: "aggressor" })
      .unit("v1", "footman", 1_300, 1_000, { id: "bystander" })
      .build()
      .createGame();
    issuePlayerCommand(game, "v1", { type: "attack", unitIds: ["aggressor"], targetId: "farm" });

    stepGame(game);
    expect(game.projectiles.map((projectile) => [projectile.attackerId, projectile.targetId])).toEqual([["tower", "aggressor"]]);
  });
});
