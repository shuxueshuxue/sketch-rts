import type { UnitKind } from "../shared/types";

export type UnitGlyph = {
  silhouette:
    | "worker-apron"
    | "shield-triangle"
    | "bow-crest"
    | "raider-kite"
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

export const UNIT_GLYPHS: Record<UnitKind, UnitGlyph> = {
  worker: { silhouette: "worker-apron", marks: ["pick", "satchel", "coinSlash"] },
  footman: { silhouette: "shield-triangle", marks: ["shieldBar", "shortSword", "scar"] },
  archer: { silhouette: "bow-crest", marks: ["bow", "arrow", "satchel"] },
  raider: { silhouette: "raider-kite", marks: ["reins", "spur", "shortSword"] },
  lancer: { silhouette: "lancer-pennant", marks: ["longSpear", "flag", "shieldBar"] },
  knight: { silhouette: "knight-helm", marks: ["visor", "towerShield", "shortSword"] },
  priest: { silhouette: "priest-medallion", marks: ["halo", "cross", "satchel"] },
  summoner: { silhouette: "summoner-ring", marks: ["outerRing", "innerSigil", "spark"] },
  witch: { silhouette: "witch-crescent", marks: ["crescent", "curseSlash", "spark"] },
  golem: { silhouette: "golem-block", marks: ["rune", "blockSeams", "scar"] },
  spirit: { silhouette: "spirit-wisp", marks: ["tail", "spark", "halo"] },
  mercenary: { silhouette: "mercenary-badge", marks: ["coinSlash", "shortSword", "scar"] },
  wildling: { silhouette: "wildling-thorns", marks: ["thornFork", "scar", "curseSlash"] },
  mossGnawer: { silhouette: "wildling-thorns", marks: ["thornFork", "scar", "shortSword"] },
  thornSlinger: { silhouette: "wildling-thorns", marks: ["thornFork", "bow", "arrow"] },
  barkMender: { silhouette: "wildling-thorns", marks: ["thornFork", "halo", "cross"] },
  stonebackBrute: { silhouette: "wildling-thorns", marks: ["thornFork", "blockSeams", "shieldBar"] },
  gladeWitch: { silhouette: "wildling-thorns", marks: ["thornFork", "crescent", "curseSlash"] },
  ancientStag: { silhouette: "wildling-thorns", marks: ["thornFork", "visor", "halo"] },
};

export function glyphFingerprint(glyph: UnitGlyph) {
  return `${glyph.silhouette}:${glyph.marks.join(",")}`;
}

export function glyphComplexity(glyph: UnitGlyph) {
  return new Set([glyph.silhouette, ...glyph.marks]).size;
}
