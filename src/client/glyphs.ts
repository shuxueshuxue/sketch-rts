import type { UnitKind } from "../shared/types";
import { mapUnitCards } from "./content/units";

export type UnitGlyph = {
  silhouette:
    | "worker-apron"
    | "shield-triangle"
    | "bow-crest"
    | "raider-kite"
    | "ember-bruiser"
    | "cinder-skirmisher"
    | "lancer-pennant"
    | "knight-helm"
    | "priest-medallion"
    | "summoner-ring"
    | "witch-crescent"
    | "golem-block"
    | "spirit-wisp"
    | "mercenary-badge"
    | "wildling-thorns";
  marks: GlyphMark[];
};

export type GlyphMark =
  | "pick"
  | "satchel"
  | "shieldBar"
  | "shortSword"
  | "bow"
  | "arrow"
  | "reins"
  | "spur"
  | "longSpear"
  | "flag"
  | "visor"
  | "towerShield"
  | "halo"
  | "cross"
  | "outerRing"
  | "innerSigil"
  | "crescent"
  | "curseSlash"
  | "rune"
  | "blockSeams"
  | "tail"
  | "spark"
  | "coinSlash"
  | "scar"
  | "thornFork";

export const UNIT_GLYPHS: Record<UnitKind, UnitGlyph> = mapUnitCards((card) => card.glyph);

export function glyphFingerprint(glyph: UnitGlyph) {
  return `${glyph.silhouette}:${glyph.marks.join(",")}`;
}

export function glyphComplexity(glyph: UnitGlyph) {
  return new Set([glyph.silhouette, ...glyph.marks]).size;
}

export function unitGlyphScale(radius: number) {
  return Math.max(0.72, Math.min(1.65, radius / 18));
}
