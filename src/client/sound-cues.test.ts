import { describe, expect, it } from "vitest";
import { createGame, issueCommand, snapshotGame, stepGame } from "../shared/sim";
import type { GameSnapshot, WorldEffect } from "../shared/types";
import { soundCues } from "./sound-cues";

const start = snapshotGame(createGame("bareDuel"));
const later = (change: (next: GameSnapshot) => void) => {
  const next = structuredClone(start);
  next.tick += 1;
  change(next);
  return next;
};
const effect = (id: string, type: WorldEffect["type"], extra: Partial<WorldEffect> = {}): WorldEffect => ({ id, type, x: 100, y: 200, remaining: 10, duration: 10, ...extra });
const ids = (before: GameSnapshot, after: GameSnapshot) => soundCues(before, after, "player").map((cue) => cue.id);

describe("sound cues", () => {
  it("hears a melee blow by its striker's kind, once, and no spell or swipe", () => {
    const struck = later((next) =>
      next.effects.push(
        effect("e1", "hit", { sourceKind: "footman", unitId: "u" }),
        effect("e2", "melee"),
        effect("e3", "hit", { unitId: "u" }),
        effect("e4", "heal"),
        effect("e5", "chargeTrail", { sourceKind: "knight" }),
        effect("e6", "curse"),
      ),
    );
    expect(soundCues(start, struck, "player")).toEqual([{ id: "melee", x: 100, y: 200, kind: "footman" }]);
    const same = structuredClone(struck);
    same.tick += 1;
    expect(ids(struck, same)).toEqual([]);
    expect(ids(struck, struck)).toEqual([]);
  });

  it("hears a real game's blows by their strikers: a footman's swing and an archer's arrow loosed and landing", () => {
    const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
    game.units = [];
    const knight = game.spawnUnit("enemy", "knight", 1200, 1200);
    const footman = game.spawnUnit("player", "footman", 1240, 1200);
    const archer = game.spawnUnit("player", "archer", 1500, 1200);
    issueCommand(game, { type: "attack", unitIds: [footman.id, archer.id], targetId: knight.id });
    const heard: string[] = [];
    let before = snapshotGame(game);
    for (let tick = 0; tick < 80 && heard.filter((cue) => cue.startsWith("arrowHit")).length === 0; tick += 1) {
      stepGame(game);
      const after = snapshotGame(game);
      heard.push(...soundCues(before, after, "player").map((cue) => `${cue.id}${cue.kind ? `:${cue.kind}` : ""}`));
      before = after;
    }
    expect(heard).toContain("melee:footman");
    expect(heard).toContain("arrowShot");
    expect(heard).toContain("arrowHit");
  });

  it("hears an arrow loosed where its bowman or tower stands and where it lands, and also hears non-arrow impacts", () => {
    const shots = later((next) =>
      next.effects.push(
        effect("a", "projectile", { sourceKind: "archer", fromX: 10, fromY: 20 }),
        effect("b", "projectile", { sourceKind: "defenseTower", fromX: 30, fromY: 40 }),
        effect("c", "projectile", { sourceKind: "warship" }),
        effect("d", "projectile", { sourceKind: "priest" }),
        effect("e", "projectile"),
        effect("f", "hit", { sourceKind: "thornSlinger", unitId: "u" }),
        effect("g", "hit", { sourceKind: "redDragon", unitId: "u" }),
        effect("h", "hit", { sourceKind: "witch", unitId: "u" }),
      ),
    );
    expect(soundCues(start, shots, "player")).toEqual([
      { id: "arrowShot", x: 10, y: 20 },
      { id: "arrowShot", x: 30, y: 40 },
      { id: "arrowHit", x: 100, y: 200 },
      { id: "impact", x: 100, y: 200 },
      { id: "impact", x: 100, y: 200 },
    ]);
  });

  it("hears the fallen and ships sunk, but not soldiers going aboard a transport or coming ashore", () => {
    const [first, second] = start.units.filter((unit) => unit.owner === "player");
    const fallen = later((next) => {
      next.units = next.units.filter((unit) => unit.id !== first!.id);
    });
    expect(ids(start, fallen)).toEqual(["death"]);
    const afloat = later((next) => {
      next.units.push({ ...structuredClone(first!), id: "ship", kind: "warship" });
    });
    const sunk = structuredClone(afloat);
    sunk.tick += 1;
    sunk.units = sunk.units.filter((unit) => unit.id !== "ship");
    expect(ids(afloat, sunk)).toEqual(["buildingDown"]);
    const aboard = later((next) => {
      next.units = next.units.filter((unit) => unit.id !== first!.id);
      next.units.find((unit) => unit.id === second!.id)!.cargo = [structuredClone(first!)];
    });
    expect(ids(start, aboard)).toEqual([]);
    const ashore = structuredClone(start);
    ashore.tick = aboard.tick + 1;
    expect(ids(aboard, ashore)).toEqual([]);
  });

  it("hears any building raised, the listener's own finished and any fall, and no recruit", () => {
    const own = start.units.find((unit) => unit.owner === "player")!;
    const trained = later((next) => next.units.push({ ...own, id: "new-own" }));
    expect(ids(start, trained)).toEqual([]);
    const placed = later((next) => next.buildings.push({ ...structuredClone(start.buildings[0]!), id: "new-farm", complete: false }));
    expect(ids(start, placed)).toEqual(["construction"]);
    const raising = later((next) => {
      next.buildings[0]!.complete = false;
    });
    const raised = structuredClone(start);
    raised.tick = raising.tick + 1;
    expect(ids(raising, raised)).toEqual(start.buildings[0]!.owner === "player" ? ["built"] : []);
    const razed = later((next) => {
      next.buildings = next.buildings.slice(1);
    });
    expect(ids(start, razed)).toEqual(["buildingDown"]);
  });
});
