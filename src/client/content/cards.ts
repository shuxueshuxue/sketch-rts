// @@@content-cards - Everything the client shows about a unit or a building lives on one card: its names, the words on
// its tooltip, its command button, its glyph, its art rank and the painter that draws it. The tables the rest of the
// client reads (labels, tooltips, command card, glyphs, art ranks, the unit sheet) are derived from the cards, so a new
// unit is its rules in shared/catalog.ts plus one card here; the compiler lists whatever is missing.
import type { Brush } from "../art/kit";
import type { BuildingGlyph } from "../building-glyphs";
import type { UnitGlyph } from "../glyphs";
import type { UnitArt } from "../unit-art";

export type Localized = { en: string; zh: string };

export type CommandButton = { icon: string; hotkey: string };

export type UnitCard = {
  name: Localized;
  glyph: UnitGlyph;
  art: UnitArt;
  // Draws the unit around the origin (feet at y=16), team being the owner's color.
  paint: (b: Brush, team: string) => void;
};

export type TrainedUnitCard = UnitCard & {
  description: Localized;
  command: CommandButton;
};

// A unit ability: its name, the words on its tooltip, and its command button (the numbers come from the catalog).
export type AbilityCard = {
  name: Localized;
  description: Localized;
  command: CommandButton;
};

export type BuildingCard = {
  name: Localized;
  description: Localized;
  command: CommandButton;
  glyph: BuildingGlyph;
  // Draws the building on its plot (the ground and the plot are drawn for it), team being the owner's color.
  paint: (b: Brush, team: string) => void;
};
