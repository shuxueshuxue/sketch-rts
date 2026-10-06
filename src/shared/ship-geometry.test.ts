import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createUnit } from "./map";
import { boardUnit, deckPointFits } from "./decks";
import { bodyMass } from "./physical-body";
import { localToWorld, worldToLocal, hullContact, shipProfile } from "./ship-geometry";
import geometry from "./generated/ship-geometry.json";

describe("shared ship model geometry", () => {
  it("was exported from the current authored ship definitions", () => {
    expect(geometry.sourceSha256).toBe(createHash("sha256").update(readFileSync("assets/naval/ships.json")).digest("hex"));
  });
  it("transforms local deck coordinates reversibly for every rendered heading", () => {
    const ship = createUnit("hull", "player", "transport", 1000, 1000);
    for (let frame = 0; frame < geometry.camera.directions; frame++) {
      ship.sailing = { heading: frame * Math.PI * 2 / geometry.camera.directions, speed: 0, load: 0, balance: 0 };
      const point = worldToLocal(ship, localToWorld(ship, { x: 21, y: -13 }));
      expect(point.x).toBeCloseTo(21, 5); expect(point.y).toBeCloseTo(-13, 5);
    }
  });
  it("uses rotated convex hulls rather than center radii for ship contact", () => {
    const a = createUnit("a", "player", "warship", 1000, 1000);
    const b = createUnit("b", "enemy", "warship", 1110, 1000);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThan(a.radius+b.radius);
    expect(hullContact(a,b)?.overlap).toBeGreaterThan(0);
    b.y += 140; expect(hullContact(a,b)).toBeUndefined();
  });
  it("fits a healer and shooter around a warship's actual fittings", () => {
    const ship = createUnit("hull", "player", "warship", 0, 0);
    const crew = [createUnit("priest", "player", "priest", 0, 0), createUnit("archer", "player", "archer", 0, 0)];
    for (const unit of crew) expect(boardUnit(ship,unit,crew)).toBe(true);
    for (const unit of crew) expect(deckPointFits(ship,unit,unit.deck!,crew)).toBe(true);
  });
  it("derives variant mass and mission capacity from their physical scale", () => {
    const soldier = createUnit("soldier", "player", "footman", 0, 0);
    expect(bodyMass({ ...soldier, radius: soldier.radius*2 })).toBe(bodyMass(soldier)*8);
    const ship = {...createUnit("hull", "player", "carrier", 0, 0),deckScale:1};
    const scaled = shipProfile({ ...ship, deckScale: 2 })!;
    expect(scaled.loadCapacity).toBe(shipProfile(ship)!.loadCapacity*4);
    expect(scaled.hullMass).toBe(shipProfile(ship)!.hullMass*8);
  });
});
