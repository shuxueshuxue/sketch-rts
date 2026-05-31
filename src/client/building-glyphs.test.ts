import { describe, expect, it } from "vitest";
import { BUILDING_DEFS } from "../shared/catalog";
import { BUILDING_GLYPHS, buildingGlyphComplexity, buildingGlyphFingerprint } from "./building-glyphs";
import type { BuildingKind } from "../shared/types";

describe("building glyph catalog", () => {
  it("gives every building kind a distinct readable sketch structure", () => {
    const buildingKinds = Object.keys(BUILDING_DEFS) as BuildingKind[];
    const fingerprints = buildingKinds.map((kind) => buildingGlyphFingerprint(BUILDING_GLYPHS[kind]));

    expect(Object.keys(BUILDING_GLYPHS).sort()).toEqual(buildingKinds.sort());
    expect(new Set(fingerprints).size).toBe(buildingKinds.length);

    for (const kind of buildingKinds) {
      expect(buildingGlyphComplexity(BUILDING_GLYPHS[kind]), kind).toBeGreaterThanOrEqual(4);
    }
  });
});
