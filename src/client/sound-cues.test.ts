import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../shared/sim";
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
  it("hears a blow new in the later snapshot, once, and no spell", () => {
    const struck = later((next) => next.effects.push(effect("e1", "melee"), effect("e2", "heal"), effect("e3", "chargeTrail"), effect("e4", "curse")));
    expect(ids(start, struck)).toEqual(["melee"]);
    const same = structuredClone(struck);
    same.tick += 1;
    expect(ids(struck, same)).toEqual([]);
    expect(ids(struck, struck)).toEqual([]);
  });

  it("hears an arrow loosed where its archer stands, and any shot where it lands", () => {
    const shots = later((next) =>
      next.effects.push(
        effect("a", "projectile", { sourceKind: "archer", fromX: 10, fromY: 20 }),
        effect("b", "projectile", { sourceKind: "warship" }),
        effect("c", "projectile", { sourceKind: "priest" }),
        effect("d", "projectile"),
      ),
    );
    expect(soundCues(start, shots, "player")).toEqual([
      { id: "arrowShot", x: 10, y: 20 },
      { id: "arrowHit", x: 100, y: 200 },
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

  it("hears the listener's own buildings finished and any building fall, and no recruit", () => {
    const own = start.units.find((unit) => unit.owner === "player")!;
    const trained = later((next) => next.units.push({ ...own, id: "new-own" }));
    expect(ids(start, trained)).toEqual([]);
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
