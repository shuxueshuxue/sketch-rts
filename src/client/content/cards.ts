// @@@content-cards - Presentation metadata: names, tooltip words, command buttons,
// glyphs and art ranks. Geometry belongs to the art composers and model library.
// Labels, command cards and the unit sheet derive their metadata from these tables.
import type { BuildingGlyph } from "../building-glyphs";
import type { UnitGlyph } from "../glyphs";
import type { UnitArt } from "../unit-art";

export type Localized = { en: string; zh: string };

export type CommandButton = { icon: string; hotkey: string };

export type UnitCard = {
  name: Localized;
  glyph: UnitGlyph;
  art: UnitArt;
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
};
