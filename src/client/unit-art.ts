import type { UnitKind } from "../shared/types";
import { mapUnitCards } from "./content/units";

/**
 * How much gear a unit's model carries. Rank follows the catalog: basic line
 * troops cost at most 120 gold, advanced specialists and hired swords 130–160,
 * elites 190 or more (and 3+ supply). Neutral creeps rank by camp food power.
 */
export type UnitArtTier = "civilian" | "basic" | "advanced" | "elite";

/** Only units trained at the stables ride; everyone else is drawn on foot. */
export type UnitArtBearing = "foot" | "mounted" | "construct" | "beast" | "spirit";

export type UnitArtFaction = "grove" | "ember" | "hired" | "wild" | "summoned";

export type UnitArt = {
  tier: UnitArtTier;
  bearing: UnitArtBearing;
  faction: UnitArtFaction;
};

export const UNIT_ART: Record<UnitKind, UnitArt> = mapUnitCards((card) => card.art);

export const UNIT_ART_TIERS: readonly UnitArtTier[] = ["civilian", "basic", "advanced", "elite"];
