import { describe, expect, it } from "vitest";
import { estimateTextureInkCoverage, generateTerrainLinework } from "./terrain-texture";
import type { MapId } from "../shared/types";

const VIEWPORT = { width: 1280, height: 800 };

describe("terrain texture linework", () => {
  it("generates sparse readable scene recipes instead of dense tiling", () => {
    const strokes = generateTerrainLinework({ mapId: "verdantCrossroads", camera: { x: 0, y: 0 }, ...VIEWPORT });
    const layers = new Set(strokes.map((stroke) => stroke.layer));
    const coverage = estimateTextureInkCoverage(strokes, VIEWPORT.width, VIEWPORT.height);

    expect(strokes.length).toBeGreaterThan(6);
    expect(strokes.length).toBeLessThan(55);
    expect(layers).toEqual(new Set(["contour", "hatch", "silhouette"]));
    expect(coverage).toBeGreaterThan(0.002);
    expect(coverage).toBeLessThan(0.03);
    expect(strokes.every((stroke) => stroke.color.startsWith("rgba(") && stroke.width <= 1.4)).toBe(true);
  });

  it("varies linework by map scene while staying deterministic for SDK/UI tests", () => {
    const sample = (mapId: MapId) => hashStrokes(generateTerrainLinework({ mapId, camera: { x: 640, y: 480 }, ...VIEWPORT }));

    expect(sample("verdantCrossroads")).toBe(sample("verdantCrossroads"));
    expect(new Set([sample("verdantCrossroads"), sample("bareDuel"), sample("wildMarches")]).size).toBe(3);
  });
});

function hashStrokes(strokes: ReturnType<typeof generateTerrainLinework>) {
  let hash = 2166136261;
  for (const stroke of strokes) {
    for (const point of stroke.points) {
      hash ^= Math.round(point.x * 10) + Math.round(point.y * 10) * 31 + stroke.layer.length * 997;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash;
}
