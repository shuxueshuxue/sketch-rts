import { describe, expect, it } from "vitest";
import { aimAt, aimingProfile, invalidateMovedAim, markAimShot } from "./aiming";
import { BUILDING_DEFS, RACE_DEFS, UNIT_DEFS } from "./catalog";
import { isGameCommand } from "./command-schema";
import { createUnit } from "./map";
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from "./sim";
import { checkCommandLegality } from "./sim/command-validation";
import { checksumGame } from "./sim/checksum";
import type { UnitKind } from "./types";

const at = { x: 1_288, y: 1_000 };
const run = (game: ReturnType<typeof createGame>, ticks: number) => { for (let i = 0; i < ticks; i++) stepGame(game); };
function battle(kind: UnitKind = "archer") {
  const game = createGame("bareDuel", { players: ["p1", "p2"], scenario: { replaceDefaultUnits: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, addUnits: [
    { id: "shooter", owner: "p1", kind, x: 1_000, y: 1_000, order: { type: "hold", x: 1_000, y: 1_000 } },
    { id: "foe", owner: "p2", kind: "knight", ...at, order: { type: "hold", ...at } },
  ] } });
  game.scriptedVictory = true;
  game.units[1]!.cooldown = 99_999;
  return game;
}
function shooter(kind: UnitKind = "archer") { return createUnit("shooter", "p1", kind, 1_000, 1_000); }

describe("reticle aiming", () => {
  it("spends distance / reticle speed before the first shot, then keeps stationary firing cadence", () => {
    const game = battle(), unit = game.units[0]!;
    run(game, 11);
    expect(game.projectiles).toHaveLength(0);
    expect(unit.cooldown).toBe(0);
    run(game, 1);
    expect(game.projectiles).toHaveLength(1);
    expect(unit.cooldown).toBe(unit.attackCooldown);
    expect(unit.aim).toMatchObject({ ...at, tracking: false, anchorX: 1_000 });
    run(game, unit.attackCooldown - 1);
    expect(unit.cooldown).toBe(1);
    run(game, 1);
    expect(unit.cooldown).toBe(unit.attackCooldown);
  });

  it("aims only after basic weapon cooldown is ready", () => {
    const game = battle(), unit = game.units[0]!;
    unit.cooldown = 5;
    run(game, 4);
    expect(unit.aim).toBeUndefined();
    run(game, 1);
    expect(unit.aim?.x).toBe(1_024);
  });

  it("continues toward a moving target instead of completing a fixed timer", () => {
    const unit = shooter();
    aimAt(unit, UNIT_DEFS.archer, at, 1);
    expect(unit.aim?.x).toBe(1_024);
    expect(aimAt(unit, UNIT_DEFS.archer, { x: 1_048, y: 1_048 }, 2)).toBe(false);
    expect(unit.aim?.y).toBeGreaterThan(1_000);
    expect(unit.aim?.y).toBeLessThan(1_048);
  });

  it("reuses a nearby reticle across target changes and starts at the shooter when that is nearer", () => {
    const unit = shooter();
    for (let tick = 1; tick <= 12; tick++) aimAt(unit, UNIT_DEFS.archer, at, tick);
    markAimShot(unit);
    expect(aimAt(unit, UNIT_DEFS.archer, { x: 1_300, y: 1_000 }, 13)).toBe(true);
    markAimShot(unit);
    expect(aimAt(unit, UNIT_DEFS.archer, { x: 800, y: 1_000 }, 14)).toBe(false);
    expect(unit.aim?.x).toBe(976);
    expect(unit.facing).toBe(Math.PI);
  });

  it("does not advance twice when the same point is ordered twice within a tick", () => {
    const unit = shooter();
    aimAt(unit, UNIT_DEFS.archer, at, 1);
    aimAt(unit, UNIT_DEFS.archer, at, 1);
    expect(unit.aim?.x).toBe(1_024);
  });

  it("keeps tiny moves, renews the anchor after each shot, and invalidates accumulated displacement", () => {
    const unit = shooter();
    aimAt(unit, UNIT_DEFS.archer, at, 1);
    unit.x += 6;
    invalidateMovedAim(unit, UNIT_DEFS.archer);
    expect(unit.aim).toBeDefined();
    markAimShot(unit);
    expect(unit.aim?.anchorX).toBe(1_006);
    unit.x += 6;
    invalidateMovedAim(unit, UNIT_DEFS.archer);
    expect(unit.aim).toBeDefined();
    unit.x += .01;
    invalidateMovedAim(unit, UNIT_DEFS.archer);
    expect(unit.aim).toBeUndefined();
  });

  it("gives horse archers enough displacement for kiting and measures diagonal movement radially", () => {
    const unit = shooter("horseArcher");
    aimAt(unit, UNIT_DEFS.horseArcher, at, 1);
    unit.x += 48; unit.y += 48;
    invalidateMovedAim(unit, UNIT_DEFS.horseArcher);
    expect(unit.aim).toBeDefined();
    unit.x += 8;
    invalidateMovedAim(unit, UNIT_DEFS.horseArcher);
    expect(unit.aim).toBeUndefined();
    expect(UNIT_DEFS.horseArcher.speed).toBeGreaterThan(UNIT_DEFS.raider.speed);
    expect(UNIT_DEFS.horseArcher.attackDamage / UNIT_DEFS.horseArcher.cost).toBeLessThan(UNIT_DEFS.archer.attackDamage / UNIT_DEFS.archer.cost);
  });

  it("restarts after real walking and keeps repeated attack orders from resetting progress", () => {
    const game = battle(), unit = game.units[0]!;
    issuePlayerCommand(game, "p1", { type: "attack", unitIds: [unit.id], targetId: "foe" });
    run(game, 2);
    issuePlayerCommand(game, "p1", { type: "attack", unitIds: [unit.id], targetId: "foe" });
    run(game, 1);
    expect(unit.aim?.x).toBe(1_072);
    issuePlayerCommand(game, "p1", { type: "move", unitIds: [unit.id], x: 1_000, y: 1_060 });
    run(game, 3);
    expect(unit.aim).toBeUndefined();
    issuePlayerCommand(game, "p1", { type: "attack", unitIds: [unit.id], targetId: "foe" });
    run(game, 1);
    expect(unit.aim?.anchorY).toBe(unit.y);
    expect(unit.cooldown).toBe(0);
  });

  it("lets mounted shooters kite within their budget while ordinary archers pay another startup", () => {
    for (const kind of ["archer", "horseArcher"] as const) {
      const game = battle(kind), unit = game.units[0]!;
      game.units[1]!.x = 1_180;
      run(game, 8);
      expect(unit.cooldown).toBe(unit.attackCooldown);
      issuePlayerCommand(game, "p1", { type: "move", unitIds: [unit.id], x: 946, y: 1_000 });
      run(game, 20);
      issuePlayerCommand(game, "p1", { type: "attack", unitIds: [unit.id], targetId: "foe" });
      run(game, 10);
      expect(unit.cooldown).toBe(kind === "horseArcher" ? unit.attackCooldown : 0);
      expect(unit.aim?.tracking).toBe(kind !== "horseArcher");
    }
  });

  it("prepares an empty point while reloading, then engages an arriving enemy without walking", () => {
    const game = battle(), unit = game.units[0]!, foe = game.units[1]!;
    foe.x = 1_800;
    unit.cooldown = 20;
    const command = { type: "aim", unitIds: [unit.id], ...at } satisfies import("./types").GameCommand;
    expect(isGameCommand(command)).toBe(true);
    expect(checkCommandLegality(snapshotGame(game), "p1", command)).toBeUndefined();
    issuePlayerCommand(game, "p1", command);
    run(game, 20);
    expect(unit.aim).toMatchObject({ ...at, tracking: false });
    expect(game.projectiles).toHaveLength(0);
    foe.x = at.x;
    run(game, 1);
    expect(game.projectiles).toHaveLength(1);
    expect(unit.x).toBe(1_000);
    expect(unit.order.type).toBe("aim");
    expect(checkCommandLegality(snapshotGame(game), "p2", { ...command, unitIds: [foe.id] })?.message).toMatch(/ranged/);
    expect(isGameCommand({ ...command, x: Infinity })).toBe(false);
  });

  it("requires aiming for ranged weapon skills as well as basic attacks", () => {
    const game = battle("ballista"), unit = game.units[0]!;
    issuePlayerCommand(game, "p1", { type: "cast", unitId: unit.id, ability: "pinningBolt", targetId: "foe" });
    run(game, 11);
    expect(game.projectiles).toHaveLength(0);
    expect(unit.abilityCooldowns).toBeUndefined();
    run(game, 1);
    expect(game.projectiles).toHaveLength(1);
    expect(unit.abilityCooldowns?.pinningBolt).toBeGreaterThan(0);
  });

  it("keeps reticle state isolated in snapshots and resumes it deterministically after loading", () => {
    const game = battle(); run(game, 5);
    const snapshot = snapshotGame(game), copy = createGame("bareDuel");
    restoreSnapshotIntoGame(copy, snapshot, game.nextId); copy.scriptedVictory = true;
    const retainedX = snapshot.units[0]!.aim!.x;
    run(game, 50); run(copy, 50);
    expect(snapshot.units[0]!.aim!.x).toBe(retainedX);
    expect(checksumGame(copy)).toBe(checksumGame(game));
  });

  it("includes short-range ranged creeps while keeping melee and unarmed transports unchanged", () => {
    expect(aimingProfile(UNIT_DEFS.barkMender)).toBeDefined();
    expect(aimingProfile(UNIT_DEFS.knight)).toBeUndefined();
    expect(aimingProfile(UNIT_DEFS.siegeRam)).toBeUndefined();
    expect(aimingProfile(UNIT_DEFS.transport)).toBeUndefined();
  });
});

describe("faction roster roles", () => {
  it("moves the guard to Ember and puts the mounted shooter in Grove stables", () => {
    expect(RACE_DEFS.ember.trainableUnits).toContain("ashWarden");
    expect(RACE_DEFS.grove.trainableUnits).not.toContain("ashWarden");
    expect(BUILDING_DEFS.emberForge.trains).toContain("ashWarden");
    expect(BUILDING_DEFS.barracks.trains).not.toContain("ashWarden");
    expect(BUILDING_DEFS.stables.trains).toContain("horseArcher");
  });
  it("separates engineering rosters, with one extra workshop choice for Ember", () => {
    const workshop = (race: "grove" | "ember") => RACE_DEFS[race].trainableUnits.filter(kind => UNIT_DEFS[kind].trainedAt === "workshop").sort();
    expect(workshop("grove")).toEqual(["ballista", "golem"]);
    expect(workshop("ember")).toEqual(["catapult", "organGun", "siegeRam"]);
  });
});
