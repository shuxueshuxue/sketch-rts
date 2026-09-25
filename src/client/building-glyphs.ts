import type { BuildingKind } from "../shared/types";
import { mapBuildingCards } from "./content/buildings";

export type BuildingGlyph = {
  frame:
    | "town-hall"
    | "barracks-yard"
    | "archery-range"
    | "stables-gate"
    | "sanctum-dome"
    | "workshop-gear"
    | "tower-spire"
    | "moon-well"
    | "ember-forge"
    | "cinder-spire"
    | "ember-shrine"
    | "ashen-hall"
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

export const BUILDING_GLYPHS: Record<BuildingKind, BuildingGlyph> = mapBuildingCards((card) => card.glyph);

export function buildingGlyphFingerprint(glyph: BuildingGlyph) {
  return `${glyph.frame}:${glyph.marks.join(",")}`;
}

export function buildingGlyphComplexity(glyph: BuildingGlyph) {
  return new Set([glyph.frame, ...glyph.marks]).size;
}
