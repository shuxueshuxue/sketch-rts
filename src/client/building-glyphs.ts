import type { BuildingKind } from "../shared/types";

export type BuildingGlyph = {
  frame:
    | "town-hall"
    | "barracks-yard"
    | "archery-range"
    | "stables-gate"
    | "sanctum-dome"
    | "workshop-gear"
    | "tower-spire"
    | "farm-plot";
  marks: BuildingGlyphMark[];
};

export type BuildingGlyphMark =
  | "roof"
  | "banner"
  | "door"
  | "crossedBlades"
  | "target"
  | "bowRack"
  | "horseshoe"
  | "rail"
  | "moonRune"
  | "sparkRune"
  | "cog"
  | "hammer"
  | "arrowSlit"
  | "watchEye"
  | "furrows"
  | "scareMark";

export const BUILDING_GLYPHS: Record<BuildingKind, BuildingGlyph> = {
  townHall: { frame: "town-hall", marks: ["roof", "banner", "door"] },
  barracks: { frame: "barracks-yard", marks: ["crossedBlades", "banner", "door"] },
  archeryRange: { frame: "archery-range", marks: ["target", "bowRack", "banner"] },
  stables: { frame: "stables-gate", marks: ["horseshoe", "rail", "door"] },
  sanctum: { frame: "sanctum-dome", marks: ["moonRune", "sparkRune", "banner"] },
  workshop: { frame: "workshop-gear", marks: ["cog", "hammer", "door"] },
  defenseTower: { frame: "tower-spire", marks: ["arrowSlit", "watchEye", "banner"] },
  farm: { frame: "farm-plot", marks: ["furrows", "scareMark", "door"] },
};

export function buildingGlyphFingerprint(glyph: BuildingGlyph) {
  return `${glyph.frame}:${glyph.marks.join(",")}`;
}

export function buildingGlyphComplexity(glyph: BuildingGlyph) {
  return new Set([glyph.frame, ...glyph.marks]).size;
}
