import type { UnitKind } from "../shared/types";

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

export const UNIT_ART: Record<UnitKind, UnitArt> = {
  worker: { tier: "civilian", bearing: "foot", faction: "grove" },
  footman: { tier: "basic", bearing: "foot", faction: "grove" },
  archer: { tier: "basic", bearing: "foot", faction: "grove" },
  lancer: { tier: "basic", bearing: "foot", faction: "grove" },
  groveWarden: { tier: "basic", bearing: "foot", faction: "grove" },
  raider: { tier: "basic", bearing: "mounted", faction: "grove" },
  priest: { tier: "advanced", bearing: "foot", faction: "grove" },
  summoner: { tier: "advanced", bearing: "foot", faction: "grove" },
  witch: { tier: "advanced", bearing: "foot", faction: "grove" },
  knight: { tier: "elite", bearing: "mounted", faction: "grove" },
  golem: { tier: "elite", bearing: "construct", faction: "grove" },
  emberRavager: { tier: "basic", bearing: "foot", faction: "ember" },
  cinderRunner: { tier: "basic", bearing: "foot", faction: "ember" },
  sparkArcher: { tier: "basic", bearing: "foot", faction: "ember" },
  emberAcolyte: { tier: "advanced", bearing: "foot", faction: "ember" },
  ashHexer: { tier: "advanced", bearing: "foot", faction: "ember" },
  pyreCaller: { tier: "advanced", bearing: "foot", faction: "ember" },
  mercenary: { tier: "advanced", bearing: "foot", faction: "hired" },
  contractArcher: { tier: "advanced", bearing: "foot", faction: "hired" },
  fieldMedic: { tier: "advanced", bearing: "foot", faction: "hired" },
  spirit: { tier: "basic", bearing: "spirit", faction: "summoned" },
  wildling: { tier: "basic", bearing: "foot", faction: "wild" },
  mossGnawer: { tier: "basic", bearing: "beast", faction: "wild" },
  thornSlinger: { tier: "advanced", bearing: "foot", faction: "wild" },
  barkMender: { tier: "advanced", bearing: "foot", faction: "wild" },
  stonebackBrute: { tier: "elite", bearing: "beast", faction: "wild" },
  gladeWitch: { tier: "elite", bearing: "foot", faction: "wild" },
  ancientStag: { tier: "elite", bearing: "beast", faction: "wild" },
};

export const UNIT_ART_TIERS: readonly UnitArtTier[] = ["civilian", "basic", "advanced", "elite"];
