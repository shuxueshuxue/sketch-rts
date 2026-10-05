import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, RACE_DEFS, UNIT_DEFS, hasSpell } from "../shared/catalog";
import type { UnitKind, WorldEffect } from "../shared/types";
import { arrowFrame, chargeImpactFrame, chargeTrailFrame, hammerEffectFrame, launchPoint, projectileLook, renderWorldEffects, spellOrbPalette } from "./effect-renderer";

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

  it("gives casters a spell orb and every other shooter an arrow, from the catalog's spells", () => {
    for (const kind of shooters) expect(projectileLook(kind), kind).toBe(hasSpell(kind) ? "orb" : "arrow");
    // A rider's charge is no spell.
    expect(projectileLook("knight")).toBe("arrow");
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

const dot = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.x + a.y * b.y;

describe("charge effects", () => {
  const start = { x: 100, y: 300 };
  const target = { x: 520, y: 300 };
  const radius = UNIT_DEFS.raider.radius;

  it("streams speed lines off the rider's back and leaves dust only on the ground it has covered", () => {
    const rider = { x: 280, y: 300 };
    const frame = chargeTrailFrame(start, rider, target, 0.6, radius);
    expect(frame.streaks.length).toBeGreaterThan(2);
    for (const streak of frame.streaks) {
      expect(streak.from.x).toBeLessThan(rider.x);
      expect(streak.to.x).toBeLessThan(streak.from.x);
      expect(streak.to.x).toBeGreaterThanOrEqual(start.x - radius);
    }
    expect(frame.puffs.length).toBeGreaterThan(3);
    for (const puff of frame.puffs) {
      expect(puff.x).toBeGreaterThanOrEqual(start.x - 1);
      expect(puff.x).toBeLessThan(rider.x);
      expect(puff.y).toBeGreaterThan(rider.y);
    }
    // The newest dust, at the hooves, is thicker and smaller than the dust left behind.
    const [newest, oldest] = [frame.puffs[0]!, frame.puffs.at(-1)!];
    expect(newest.x).toBeGreaterThan(oldest.x);
    expect(newest.alpha).toBeGreaterThan(oldest.alpha);
    expect(newest.rx).toBeLessThan(oldest.rx);
  });

  it("points the trail along the dash whichever way the rider runs", () => {
    const up = chargeTrailFrame({ x: 300, y: 600 }, { x: 300, y: 420 }, { x: 300, y: 180 }, 0.6, radius);
    for (const streak of up.streaks) expect(dot({ x: streak.to.x - streak.from.x, y: streak.to.y - streak.from.y }, { x: 0, y: -1 })).toBeLessThan(0);
  });

  it("leaves no dust before the rider has moved, and fades out as the dash runs down", () => {
    expect(chargeTrailFrame(start, start, target, 1, radius).puffs).toEqual([]);
    const running = chargeTrailFrame(start, { x: 280, y: 300 }, target, 0.6, radius);
    const ending = chargeTrailFrame(start, { x: 280, y: 300 }, target, 0.1, radius);
    const spent = chargeTrailFrame(start, { x: 280, y: 300 }, target, 0, radius);
    expect(Math.max(...ending.streaks.map((streak) => streak.alpha))).toBeLessThan(Math.max(...running.streaks.map((streak) => streak.alpha)));
    expect(spent.streaks).toEqual([]);
    expect(spent.puffs).toEqual([]);
  });

  it("bursts on the target: a flash first, sparks thrown forward, a ring of dust rolling out, all gone at the end", () => {
    const point = { x: 400, y: 300 };
    const rider = { x: 360, y: 300 };
    const fresh = chargeImpactFrame(point, rider, 1);
    const late = chargeImpactFrame(point, rider, 0.2);
    const gone = chargeImpactFrame(point, rider, 0);
    expect(fresh.rays.length).toBeGreaterThan(0);
    expect(late.rays).toEqual([]);
    for (const spark of fresh.sparks) expect(spark.to.x).toBeGreaterThan(point.x - 1);
    expect(late.ring.rx).toBeGreaterThan(fresh.ring.rx);
    expect(late.ring.alpha).toBeLessThan(fresh.ring.alpha);
    expect(gone.ring.alpha).toBe(0);
    expect(gone.sparks.every((spark) => spark.alpha === 0)).toBe(true);
  });

  it("follows the rider where the caller draws it, and is drawn the same every time for the same frame", () => {
    const effect: WorldEffect = { id: "trail", type: "chargeTrail", x: 100, y: 300, remaining: 8, duration: 14, fromX: 100, fromY: 300, toX: 520, toY: 300, sourceKind: "raider", unitId: "rider" };
    const draw = (riderX: number | undefined) => {
      const { ctx, points } = pointRecorder();
      renderWorldEffects({ ctx, effects: [effect], worldToScreen: (point) => point, nearScreen: () => true, unitPosition: (id) => (id === "rider" && riderX !== undefined ? { x: riderX, y: 300 } : undefined) });
      return points;
    };
    const near = draw(200);
    const far = draw(330);
    expect(Math.max(...near.map((point) => point.x))).toBeLessThan(200);
    expect(Math.max(...far.map((point) => point.x))).toBeGreaterThan(260);
    expect(Math.max(...far.map((point) => point.x))).toBeLessThan(330);
    expect(draw(330)).toEqual(far);
    // Drawn on its own, the trail still lies along the dash.
    const alone = draw(undefined);
    expect(alone.length).toBeGreaterThan(0);
    for (const point of alone) expect(point.x).toBeLessThanOrEqual(520);
  });
});

// A 2D context that keeps the points of every path drawn, and ignores the rest.
function pointRecorder() {
  const points: { x: number; y: number }[] = [];
  const gradient = { addColorStop() {} };
  const record = (x: unknown, y: unknown) => void points.push({ x: x as number, y: y as number });
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (key === "moveTo" || key === "lineTo" || key === "ellipse" || key === "arc") return (x: unknown, y: unknown) => record(x, y);
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => gradient;
      return () => undefined;
    },
    set(target, key, value) {
      if (typeof key === "string") target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, points };
}
