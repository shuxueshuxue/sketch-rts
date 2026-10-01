import { describe, expect, it } from "vitest";
import { isGameCommand } from "./command-schema";
import { BRACE_DAMAGE_SHARE, LUNGE_PACE, PUSH_FRICTION, SHOCK_DAMAGE_TAKEN, STAND_SPEED, blowStrength, isStaggered, lungeStrength, pushSpeed, pushedSpeed, shove, slide } from "./push";
import { createGame, issueCommand, issuePlayerCommand, snapshotGame, stepGame } from "./sim";
import { checkCommandLegality } from "./sim/command-validation";
import type { Terrain } from "./terrain";
import type { Unit } from "./types";

function field() {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  return game;
}

type Field = ReturnType<typeof field>;

function steps(game: Field, ticks: number) {
  for (let tick = 0; tick < ticks; tick += 1) stepGame(game);
}

// Steps until the unit stops sliding; the ticks it took.
function slideOut(game: Field, unit: Unit, limit = 200) {
  let ticks = 0;
  while (unit.pushX !== undefined && ticks < limit) {
    stepGame(game);
    ticks += 1;
  }
  return ticks;
}

// Steps until the target has been hit once; the damage of that blow.
function firstBlow(game: Field, target: Unit, limit = 80) {
  const before = target.hp;
  for (let tick = 0; tick < limit && target.hp === before; tick += 1) stepGame(game);
  return before - target.hp;
}

describe("push", () => {
  it("slides a shoved unit exactly the shove's strength in a straight line, then stops it", () => {
    for (const strength of [6, 44, 100, 250, 900]) {
      const game = field();
      const unit = game.spawnUnit("player", "footman", 1000, 1000);
      shove(unit, 1, 0, strength);
      expect(pushedSpeed(unit)).toBeCloseTo(Math.sqrt(2 * PUSH_FRICTION * strength), 9);
      let ticks = 0;
      while (unit.pushX !== undefined) {
        const x = unit.x;
        stepGame(game);
        ticks += 1;
        // No tick carries it further than a small body is wide.
        expect(unit.x - x).toBeLessThanOrEqual(24 + 1e-9);
      }
      expect(unit.x - 1000).toBeCloseTo(strength, 6);
      expect(unit.y).toBe(1000);
      if (pushSpeed(strength) <= 24 + PUSH_FRICTION / 2) expect(ticks).toBe(Math.ceil(pushSpeed(strength) / PUSH_FRICTION));
      expect(unit.pushY).toBeUndefined();
    }
  });

  it("keeps a unit off its feet only while it is carried faster than it can stand, then lets it walk on its order", () => {
    const game = field();
    const footman = game.spawnUnit("player", "footman", 1000, 1000);
    issueCommand(game, { type: "move", unitIds: [footman.id], x: 1400, y: 1000 });
    shove(footman, -1, 0, 100);
    let staggered = 0;
    while (isStaggered(footman)) {
      const x = footman.x;
      const speed = pushedSpeed(footman);
      stepGame(game);
      // Only the slide moves it, back the way it was shoved.
      expect(x - footman.x).toBeCloseTo(speed - PUSH_FRICTION / 2, 9);
      staggered += 1;
    }
    expect(staggered).toBe(Math.ceil((pushSpeed(100) - STAND_SPEED) / PUSH_FRICTION));
    expect(footman.order.type).toBe("move");
    const x = footman.x;
    slideOut(game, footman);
    steps(game, 20);
    expect(footman.x).toBeGreaterThan(x);
  });

  it("lets blows from opposite sides cancel, so a unit beaten from both sides keeps its feet", () => {
    const game = field();
    const unit = game.spawnUnit("player", "footman", 1000, 1000);
    shove(unit, 1, 0, 100);
    shove(unit, -1, 0, 100);
    expect(isStaggered(unit)).toBe(false);
    stepGame(game);
    expect(unit.x).toBe(1000);
    expect(unit.pushX).toBeUndefined();
  });

  it("carries the unit a slide runs into, momentum kept, and stops the slider sooner", () => {
    const game = field();
    const slider = game.spawnUnit("player", "footman", 1000, 1000);
    const standing = game.spawnUnit("player", "footman", 1040, 1000);
    shove(slider, 1, 0, 200);
    for (let tick = 0; tick < 200 && (slider.pushX !== undefined || standing.pushX !== undefined); tick += 1) stepGame(game);
    const slid = slider.x - 1000;
    const carried = standing.x - 1040;
    // Two equal bodies leave the contact at half the speed: each slides a quarter of what was left.
    expect(slid).toBeLessThan(100);
    expect(carried).toBeGreaterThan(30);
    expect(carried).toBeLessThan(100);
    expect(standing.x - slider.x).toBeGreaterThanOrEqual(slider.radius + standing.radius - 1);
  });

  it("hardly moves a heavy body with a light one", () => {
    const moved = (kind: "spirit" | "golem") => {
      const game = field();
      const slider = game.spawnUnit("player", kind, 1000, 1000);
      const golem = game.spawnUnit("player", "golem", 1000 + slider.radius + 28 + 4, 1000);
      const start = golem.x;
      shove(slider, 1, 0, 150);
      for (let tick = 0; tick < 200 && (slider.pushX !== undefined || golem.pushX !== undefined); tick += 1) stepGame(game);
      return golem.x - start;
    };
    expect(moved("spirit")).toBeLessThan(moved("golem") / 2);
  });

  it("stops a slide at ground a unit cannot stand on", () => {
    const rows: string[] = [];
    for (let row = 0; row < 20; row += 1) rows.push(Array.from({ length: 20 }, (_, col) => (col === 10 ? "T" : ".")).join(""));
    const terrain: Terrain = { cell: 32, cols: 20, rows: 20, cells: rows.join("") };
    const game = field();
    game.map = { ...game.map, terrain, width: 640, height: 640 };
    const unit = game.spawnUnit("player", "footman", 250, 100);
    shove(unit, 1, 0, 300);
    slideOut(game, unit);
    expect(unit.x).toBeLessThan(320);
    expect(unit.x).toBeGreaterThan(280);
    expect(unit.pushX).toBeUndefined();
  });
});

describe("melee stances", () => {
  function duel(stance: "pursue" | "brace" | "shock") {
    const game = field();
    const lancer = game.spawnUnit("player", "lancer", 1000, 1000);
    const footman = game.spawnUnit("enemy", "footman", 1060, 1000);
    issueCommand(game, { type: "setStance", unitIds: [lancer.id], stance });
    issueCommand(game, { type: "attack", unitIds: [lancer.id], targetId: footman.id });
    return { game, lancer, footman };
  }

  it("pursue strikes as before: full damage, no shove", () => {
    const { game, lancer, footman } = duel("pursue");
    expect(lancer.stance).toBeUndefined();
    expect(firstBlow(game, footman)).toBe(lancer.attackDamage);
    expect(footman.pushX).toBeUndefined();
    expect(lancer.pushX).toBeUndefined();
  });

  it("brace shoves the target straight back for a fifth less damage, the striker standing", () => {
    const { game, lancer, footman } = duel("brace");
    expect(lancer.stance).toBe("brace");
    const dealt = firstBlow(game, footman);
    expect(dealt).toBe(Math.round(lancer.attackDamage * BRACE_DAMAGE_SHARE));
    expect(footman.pushX).toBeGreaterThan(0);
    expect(Math.abs(footman.pushY ?? 0)).toBeLessThan(1e-9);
    // One tick of the slide is already spent: the speed left is that of the rest of the shove.
    const fresh = { ...footman, pushX: pushSpeed(blowStrength(dealt, footman)), pushY: 0 };
    slide(fresh, game.map);
    expect(pushedSpeed(footman)).toBeCloseTo(pushedSpeed(fresh), 6);
    expect(lancer.pushX).toBeUndefined();
  });

  it("shock drives the striker in after the target, and takes a fifth more damage", () => {
    const { game, lancer, footman } = duel("shock");
    const dealt = firstBlow(game, footman);
    expect(dealt).toBe(lancer.attackDamage);
    expect(footman.pushX).toBeGreaterThan(0);
    // The lunge is its own, shorter than the shove, one tick of it spent.
    const lunge = { ...lancer, pushX: pushSpeed(lungeStrength(lancer, blowStrength(dealt, footman))), pushY: 0 };
    slide(lunge, game.map);
    expect(lancer.pushX).toBeCloseTo(lunge.pushX!, 6);
    expect(lancer.pushX!).toBeLessThan(footman.pushX!);
    const before = lancer.hp;
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [footman.id], targetId: lancer.id });
    slideOut(game, footman);
    expect(firstBlow(game, lancer)).toBe(Math.round(footman.attackDamage * SHOCK_DAMAGE_TAKEN));
    expect(lancer.hp).toBeLessThan(before);
  });

  it("lunges no further than the shove and no faster on average than twice its own walk", () => {
    for (const [kind, foe] of [["golem", "spirit"], ["lancer", "footman"], ["footman", "golem"], ["knight", "worker"]] as const) {
      const game = field();
      const striker = game.spawnUnit("player", kind, 1000, 1000);
      const shoved = blowStrength(striker.attackDamage, game.spawnUnit("enemy", foe, 1100, 1000));
      const lunge = lungeStrength(striker, shoved);
      expect(lunge).toBeLessThanOrEqual(shoved);
      const time = Math.sqrt((2 * lunge) / PUSH_FRICTION);
      expect(lunge / time).toBeLessThanOrEqual(LUNGE_PACE * striker.speed + 1e-9);
    }
    // A golem's blow throws a spirit 171; the golem, at 2.1 a tick, lunges 11 after it.
    const game = field();
    const golem = game.spawnUnit("player", "golem", 1000, 1000);
    const spirit = game.spawnUnit("enemy", "spirit", 1050, 1000);
    expect(blowStrength(golem.attackDamage, spirit)).toBeCloseTo(171, 0);
    expect(lungeStrength(golem, blowStrength(golem.attackDamage, spirit))).toBeCloseTo(11.3, 1);
  });

  it("shoves by the damage over the target's full health, however hurt the target is", () => {
    const shoved = (hp: number) => {
      const { game, footman } = duel("brace");
      footman.hp = hp;
      firstBlow(game, footman);
      return footman.pushX;
    };
    expect(shoved(40)).toBeCloseTo(shoved(145)!, 9);
  });

  it("marks each hit with what was struck and what it took, for the client's shake", () => {
    const { game, lancer, footman } = duel("pursue");
    const dealt = firstBlow(game, footman);
    expect(game.effects.find((effect) => effect.type === "hit" && effect.unitId === footman.id)).toMatchObject({ damage: dealt });
    expect(dealt).toBe(lancer.attackDamage);
  });

  it("is taken only by melee fighters", () => {
    const game = field();
    const lancer = game.spawnUnit("player", "lancer", 1000, 1000);
    const archer = game.spawnUnit("player", "archer", 1100, 1000);
    const worker = game.spawnUnit("player", "worker", 1200, 1000);
    issueCommand(game, { type: "setStance", unitIds: [lancer.id, archer.id, worker.id], stance: "shock" });
    expect(lancer.stance).toBe("shock");
    expect(archer.stance).toBeUndefined();
    expect(worker.stance).toBeUndefined();
    expect(checkCommandLegality(snapshotGame(game), "player", { type: "setStance", unitIds: [archer.id, worker.id], stance: "brace" })).toMatchObject({ message: expect.stringContaining("melee") });
    expect(checkCommandLegality(snapshotGame(game), "player", { type: "setStance", unitIds: [lancer.id], stance: "pursue" })).toBeUndefined();
    issueCommand(game, { type: "setStance", unitIds: [lancer.id], stance: "pursue" });
    expect(lancer.stance).toBeUndefined();
    expect(isGameCommand({ type: "setStance", unitIds: [lancer.id], stance: "brace" })).toBe(true);
    expect(isGameCommand({ type: "setStance", unitIds: [lancer.id], stance: "charge" })).toBe(false);
  });

  it("leaves a unit that was never shoved or set its plain shape on the wire", () => {
    const game = field();
    const unit = game.spawnUnit("player", "lancer", 1000, 1000);
    const wire = JSON.parse(JSON.stringify(snapshotGame(game).units.find((candidate) => candidate.id === unit.id)));
    expect("stance" in wire || "pushX" in wire || "pushY" in wire).toBe(false);
  });
});
