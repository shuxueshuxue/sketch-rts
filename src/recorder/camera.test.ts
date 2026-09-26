import { describe, expect, it } from "vitest";
import { sketchScene } from "../sdk/scene";
import { snapshotGame } from "../shared/sim";
import type { GameSnapshot } from "../shared/types";
import { RecorderCamera, selectUnits } from "./camera";
import { parseFixedCamera, parseSize, parseUnitSelector } from "./options";

const SIZE = { width: 800, height: 600 };

function snapshotWith(units: { owner: string; kind: "footman" | "raider"; x: number; y: number }[]): GameSnapshot {
  const scene = sketchScene("camera").map("bareDuel").replaceDefaults().player("north").player("south");
  for (const unit of units) scene.unit(unit.owner, unit.kind, unit.x, unit.y);
  return snapshotGame(scene.build().createGame());
}

function moved(snapshot: GameSnapshot, dx: number): GameSnapshot {
  return { ...snapshot, units: snapshot.units.map((unit) => ({ ...unit, x: unit.x + dx })) };
}

describe("recorder camera", () => {
  it("puts a fixed camera's point at the centre of the frame, zoomed", () => {
    const snapshot = snapshotWith([]);
    expect(new RecorderCamera({ type: "fixed", x: 2000, y: 1500 }, SIZE).view(snapshot, 0)).toEqual({ x: 1600, y: 1200, width: 800, height: 600, zoom: 1 });
    expect(new RecorderCamera({ type: "fixed", x: 2000, y: 1500, zoom: 2 }, SIZE).view(snapshot, 0)).toEqual({ x: 1800, y: 1350, width: 800, height: 600, zoom: 2 });
  });

  it("stops at the map's edge like the client's camera", () => {
    const snapshot = snapshotWith([]);
    const view = new RecorderCamera({ type: "fixed", x: 10, y: snapshot.map.height }, SIZE).view(snapshot, 0);
    expect([view.x, view.y]).toEqual([0, snapshot.map.height - 600]);
  });

  it("follows the centre of the selected units, easing after the first frame", () => {
    const start = snapshotWith([
      { owner: "north", kind: "footman", x: 1000, y: 1000 },
      { owner: "north", kind: "raider", x: 1200, y: 1400 },
      { owner: "south", kind: "footman", x: 3000, y: 3000 },
    ]);
    const camera = new RecorderCamera({ type: "follow", select: { owners: ["north"] }, lagSeconds: 1 }, SIZE);
    const first = camera.view(start, 0);
    expect([first.x + 400, first.y + 300]).toEqual([1100, 1200]);

    // The units jump 400 east; after one lag the camera has closed 1 - 1/e of the gap, to the nearest pixel.
    const next = camera.view(moved(start, 400), 1);
    expect(next.x).toBe(Math.round(700 + 400 * (1 - Math.exp(-1))));

    const locked = new RecorderCamera({ type: "follow", select: { owners: ["north"] }, lagSeconds: 0 }, SIZE);
    locked.view(start, 0);
    expect(locked.view(moved(start, 400), 0.05).x + 400).toBe(1500);
  });

  it("holds still when nobody it follows is left", () => {
    const start = snapshotWith([{ owner: "north", kind: "raider", x: 1500, y: 1500 }]);
    const camera = new RecorderCamera({ type: "follow", select: { kinds: ["raider"] }, lagSeconds: 0 }, SIZE);
    const before = camera.view(start, 0);
    expect(camera.view({ ...start, units: [] }, 0.05)).toEqual(before);
  });

  it("selects player units by owner, kind and id, never neutral ones", () => {
    const snapshot = snapshotWith([
      { owner: "north", kind: "footman", x: 1000, y: 1000 },
      { owner: "north", kind: "raider", x: 1100, y: 1000 },
      { owner: "south", kind: "raider", x: 1200, y: 1000 },
      { owner: "neutral", kind: "footman", x: 1300, y: 1000 },
    ]);
    expect(selectUnits(snapshot.units).map((unit) => unit.owner)).toEqual(["north", "north", "south"]);
    expect(selectUnits(snapshot.units, { kinds: ["raider"] }).map((unit) => unit.owner)).toEqual(["north", "south"]);
    expect(selectUnits(snapshot.units, { owners: ["north"], kinds: ["raider"] })).toHaveLength(1);
  });
});

describe("recorder options", () => {
  it("parses sizes, fixed cameras and follow filters", () => {
    expect(parseSize("1280x720")).toEqual({ width: 1280, height: 720 });
    expect(() => parseSize("1280*720")).toThrow(/1280x720/);
    expect(parseFixedCamera("2048, 1900")).toEqual({ type: "fixed", x: 2048, y: 1900 });
    expect(parseFixedCamera("2048,1900,1.5")).toEqual({ type: "fixed", x: 2048, y: 1900, zoom: 1.5 });
    expect(() => parseFixedCamera("2048")).toThrow(/x,y/);
    expect(parseUnitSelector("all")).toEqual({});
    expect(parseUnitSelector("owner=north,kind=raider|knight")).toEqual({ owners: ["north"], kinds: ["raider", "knight"] });
    expect(() => parseUnitSelector("kind=dragon")).toThrow(/dragon/);
    expect(() => parseUnitSelector("colour=red")).toThrow(/colour/);
  });
});
