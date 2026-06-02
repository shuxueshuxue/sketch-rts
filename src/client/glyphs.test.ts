import { describe, expect, it } from "vitest";
import { TRAINABLE_UNIT_KINDS, UNIT_DEFS } from "../shared/catalog";
import { UNIT_GLYPHS, glyphComplexity, glyphFingerprint, unitGlyphScale } from "./glyphs";
import type { UnitKind } from "../shared/types";

describe("unit glyph catalog", () => {
  it("gives every unit kind a distinct multi-mark sketch symbol", () => {
    const unitKinds = Object.keys(UNIT_DEFS) as UnitKind[];
    const fingerprints = unitKinds.map((kind) => glyphFingerprint(UNIT_GLYPHS[kind]));

    expect(Object.keys(UNIT_GLYPHS).sort()).toEqual(unitKinds.sort());
    expect(new Set(fingerprints).size).toBe(unitKinds.length);

    for (const kind of TRAINABLE_UNIT_KINDS) {
      expect(glyphComplexity(UNIT_GLYPHS[kind]), kind).toBeGreaterThanOrEqual(4);
    }
  });

  it("scales sketched unit models from gameplay radius", () => {
    expect(unitGlyphScale(13)).toBeLessThan(unitGlyphScale(17));
    expect(unitGlyphScale(17)).toBeLessThan(unitGlyphScale(22));
    expect(unitGlyphScale(22)).toBeLessThan(unitGlyphScale(32));
  });
});
