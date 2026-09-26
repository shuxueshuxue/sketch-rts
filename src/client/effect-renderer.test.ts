import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, RACE_DEFS, UNIT_DEFS } from "../shared/catalog";
import type { UnitKind } from "../shared/types";
import { arrowFrame, hammerEffectFrame, launchPoint, projectileLook, spellOrbPalette } from "./effect-renderer";

describe("hammer effect frames", () => {
  it("describes build and repair as the same animated hammer action with different site colors", () => {
    const build = hammerEffectFrame("build", 1, 60);
    const repair = hammerEffectFrame("repair", 1, 60);
    const later = hammerEffectFrame("repair", 0.5, 52);
    const oldClockwiseAngle = 0.64 + ((Math.sin(60 * 0.76) + 1) / 2) * 0.82;

    expect(build.handle.from).not.toEqual(build.handle.to);
    expect(build.head.from).not.toEqual(build.head.to);
    expect(build.impact.x).toBeGreaterThan(build.handle.from.x);
    expect(repair.siteStroke).not.toBe(build.siteStroke);
    expect(later.angle).not.toBe(repair.angle);
    expect(repair.angle).toBeCloseTo(oldClockwiseAngle - Math.PI / 2);
    expect(later.handle.from).toEqual(repair.handle.from);
    expect(later.handle.to).not.toEqual(repair.handle.to);
    expect(later.impact).not.toEqual(repair.impact);
  });
});

describe("projectile looks", () => {
  const shooters = (Object.keys(UNIT_DEFS) as UnitKind[]).filter((kind) => projectileLook(kind) !== "streak");

  it("gives casters a spell orb and every other shooter an arrow, from the catalog's abilities", () => {
    for (const kind of shooters) expect(projectileLook(kind), kind).toBe(UNIT_DEFS[kind].abilities.length > 0 ? "orb" : "arrow");
    expect(projectileLook("archer")).toBe("arrow");
    expect(projectileLook("summoner")).toBe("orb");
    expect(projectileLook("defenseTower")).toBe("arrow");
    expect(projectileLook(undefined)).toBe("streak");
  });

  it("lets each race field both archers and orb casters, with its own orb color", () => {
    for (const race of Object.values(RACE_DEFS)) {
      const looks = new Set(race.trainableUnits.map((kind) => projectileLook(kind)));
      expect(looks.has("arrow"), race.id).toBe(true);
      expect(looks.has("orb"), race.id).toBe(true);
    }
    const [grove, ember] = (["grove", "ember"] as const).map((race) =>
      spellOrbPalette(RACE_DEFS[race].trainableUnits.find((kind) => projectileLook(kind) === "orb")!),
    );
    expect(grove).not.toEqual(ember);
  });

  it("flies an arrow tip from shooter to target along an arc above the straight line, pointing along its path", () => {
    const from = { x: 0, y: 100 };
    const to = { x: 300, y: 100 };
    const start = arrowFrame(from, to, 0);
    const middle = arrowFrame(from, to, 0.5);
    const end = arrowFrame(from, to, 1);
    expect(start.tip).toEqual(from);
    expect(end.tip.x).toBeCloseTo(to.x);
    expect(end.tip.y).toBeCloseTo(to.y);
    expect(middle.tip.y).toBeLessThan(from.y);
    expect(Math.sin(start.angle)).toBeLessThan(0);
    expect(Math.sin(end.angle)).toBeGreaterThan(0);
    expect(middle.angle).toBeCloseTo(0);
    for (const frame of [start, middle, end]) {
      expect(Math.hypot(frame.tip.x - frame.tail.x, frame.tip.y - frame.tail.y)).toBeCloseTo(frame.length);
      expect(frame.tip.x).toBeGreaterThan(frame.tail.x);
    }
    const leftward = arrowFrame(to, from, 0.5);
    expect(leftward.tip.x).toBeLessThan(leftward.tail.x);
  });

  it("launches a missile from the shooter's edge toward the target, farther out for a bigger shooter", () => {
    const from = { x: 100, y: 100 };
    const to = { x: 500, y: 100 };
    const archer = launchPoint(from, to, "archer");
    const tower = launchPoint(from, to, "defenseTower");
    expect(archer.y).toBe(from.y);
    expect(archer.x).toBeGreaterThan(from.x);
    expect(archer.x - from.x).toBeLessThan(UNIT_DEFS.archer.radius);
    expect(tower.x - from.x).toBeGreaterThan(archer.x - from.x);
    expect(tower.x - from.x).toBeLessThan(BUILDING_DEFS.defenseTower.radius);
    const pointBlank = launchPoint(from, { x: 104, y: 100 }, "defenseTower");
    expect(pointBlank.x).toBeLessThanOrEqual(102);
  });
});
