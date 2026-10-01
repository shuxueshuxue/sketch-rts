import { UNIT_DEFS } from "./catalog";
import type { CreepFamilyUnitKind } from "./types";

// @@@camp-templates - What stands in a creep camp, as on a Warcraft III map: the generator says where a camp is, how hard
// (its tier) and on what ground (its habitat); campRoster draws which creeps from the templates below. A habitat has its
// family (murlocs by the water, golems in the hills, spiders in the forest, ogres on open ground) and dragons may hold any
// red camp. A camp's level is its creeps' levels together (food power): green 2-6, a camp to level on at home; orange
// 7-13, with at least one creep that has a trait, armor or an ability, guarding an expansion, a shop or a mercenary post;
// red 14 and up, a leader with its band, at the middle, an island or a far prize. No two camps on one map share a
// template (the copies a mirrored map makes of one camp are one draw); only when a tier's every template is spent does
// one come again.
export type CampTier = "green" | "orange" | "red";
export type CampHabitat = "water" | "hill" | "forest" | "open";
export type CampFamily = "murloc" | "golem" | "ogre" | "spider" | "dragon";
export type CampTemplate = { id: string; family: CampFamily; tier: CampTier; kinds: CreepFamilyUnitKind[] };

export const HABITAT_FAMILY: Record<CampHabitat, Exclude<CampFamily, "dragon">> = { water: "murloc", hill: "golem", forest: "spider", open: "ogre" };
export const TIER_LEVELS: Record<CampTier, { min: number; max: number }> = { green: { min: 2, max: 6 }, orange: { min: 7, max: 13 }, red: { min: 14, max: Infinity } };

export const CAMP_TEMPLATES: readonly CampTemplate[] = [
  { id: "murloc-green-1", family: "murloc", tier: "green", kinds: ["murlocPeon", "murlocPeon"] },
  { id: "murloc-green-2", family: "murloc", tier: "green", kinds: ["murlocPeon", "murlocHunter"] },
  { id: "murloc-green-3", family: "murloc", tier: "green", kinds: ["murlocPeon", "murlocPeon", "murlocHunter"] },
  { id: "murloc-green-4", family: "murloc", tier: "green", kinds: ["murlocHunter", "murlocHunter"] },
  { id: "murloc-orange-1", family: "murloc", tier: "orange", kinds: ["murlocHunter", "murlocHunter", "tidePriest"] },
  { id: "murloc-orange-2", family: "murloc", tier: "orange", kinds: ["deepSnapper", "murlocPeon", "murlocHunter"] },
  { id: "murloc-orange-3", family: "murloc", tier: "orange", kinds: ["deepSnapper", "tidePriest"] },
  { id: "murloc-orange-4", family: "murloc", tier: "orange", kinds: ["murlocPeon", "murlocHunter", "murlocHunter", "tidePriest"] },
  { id: "murloc-red-1", family: "murloc", tier: "red", kinds: ["deepSnapper", "deepSnapper", "tidePriest", "murlocHunter"] },
  { id: "murloc-red-2", family: "murloc", tier: "red", kinds: ["deepSnapper", "tidePriest", "tidePriest", "murlocHunter", "murlocHunter"] },
  { id: "golem-green-1", family: "golem", tier: "green", kinds: ["rubbleGolem"] },
  { id: "golem-green-2", family: "golem", tier: "green", kinds: ["rubbleGolem", "rubbleGolem"] },
  { id: "golem-orange-1", family: "golem", tier: "orange", kinds: ["rockGolem", "rubbleGolem"] },
  { id: "golem-orange-2", family: "golem", tier: "orange", kinds: ["rockGolem", "rockGolem"] },
  { id: "golem-orange-3", family: "golem", tier: "orange", kinds: ["graniteGolem", "rubbleGolem"] },
  { id: "golem-orange-4", family: "golem", tier: "orange", kinds: ["rockGolem", "rubbleGolem", "rubbleGolem"] },
  { id: "golem-red-1", family: "golem", tier: "red", kinds: ["graniteGolem", "rockGolem", "rockGolem"] },
  { id: "golem-red-2", family: "golem", tier: "red", kinds: ["graniteGolem", "graniteGolem", "rubbleGolem"] },
  { id: "ogre-green-1", family: "ogre", tier: "green", kinds: ["ogreWarrior"] },
  { id: "ogre-green-2", family: "ogre", tier: "green", kinds: ["ogreWarrior", "ogreWarrior"] },
  { id: "ogre-orange-1", family: "ogre", tier: "orange", kinds: ["ogreWarrior", "ogreMage"] },
  { id: "ogre-orange-2", family: "ogre", tier: "orange", kinds: ["ogreLord", "ogreMage"] },
  { id: "ogre-orange-3", family: "ogre", tier: "orange", kinds: ["ogreWarrior", "ogreWarrior", "ogreMage"] },
  { id: "ogre-orange-4", family: "ogre", tier: "orange", kinds: ["ogreMage", "ogreMage", "ogreWarrior"] },
  { id: "ogre-red-1", family: "ogre", tier: "red", kinds: ["ogreLord", "ogreMage", "ogreWarrior", "ogreWarrior"] },
  { id: "ogre-red-2", family: "ogre", tier: "red", kinds: ["ogreLord", "ogreLord", "ogreMage"] },
  { id: "spider-green-1", family: "spider", tier: "green", kinds: ["spiderling", "spiderling"] },
  { id: "spider-green-2", family: "spider", tier: "green", kinds: ["spiderling", "venomSpider"] },
  { id: "spider-green-3", family: "spider", tier: "green", kinds: ["venomSpider", "venomSpider"] },
  { id: "spider-green-4", family: "spider", tier: "green", kinds: ["spiderling", "spiderling", "spiderling", "venomSpider"] },
  { id: "spider-orange-1", family: "spider", tier: "orange", kinds: ["spiderQueen", "spiderling", "spiderling"] },
  { id: "spider-orange-2", family: "spider", tier: "orange", kinds: ["spiderQueen", "venomSpider"] },
  { id: "spider-orange-3", family: "spider", tier: "orange", kinds: ["venomSpider", "venomSpider", "venomSpider", "spiderling"] },
  { id: "spider-orange-4", family: "spider", tier: "orange", kinds: ["spiderQueen", "venomSpider", "venomSpider"] },
  { id: "spider-red-1", family: "spider", tier: "red", kinds: ["spiderQueen", "spiderQueen", "venomSpider", "venomSpider"] },
  { id: "spider-red-2", family: "spider", tier: "red", kinds: ["spiderQueen", "spiderQueen", "spiderling", "spiderling", "spiderling", "spiderling"] },
  { id: "dragon-red-1", family: "dragon", tier: "red", kinds: ["redDragon", "dragonWhelp", "dragonWhelp"] },
];

export function campLevel(kinds: readonly CreepFamilyUnitKind[]) {
  return kinds.reduce((total, kind) => total + (UNIT_DEFS[kind].creepFoodPower ?? 0), 0);
}

// The creeps of a camp of the tier on the habitat, drawn from the templates no other camp of the map has taken (`used`,
// one set for the whole map, takes the drawn template's id): its habitat's family's, and for a red camp the dragons'
// too. When those are spent, any unspent template of the tier; when those are, any of the family's again.
export function campRoster(random: () => number, tier: CampTier, habitat: CampHabitat, used: Set<string>): { templateId: string; kinds: CreepFamilyUnitKind[] } {
  const family = HABITAT_FAMILY[habitat];
  const own = CAMP_TEMPLATES.filter((template) => template.tier === tier && (template.family === family || (tier === "red" && template.family === "dragon")));
  const fresh = own.filter((template) => !used.has(template.id));
  const pool = fresh.length > 0 ? fresh : CAMP_TEMPLATES.filter((template) => template.tier === tier && !used.has(template.id));
  const choices = pool.length > 0 ? pool : own;
  const template = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!;
  used.add(template.id);
  return { templateId: template.id, kinds: [...template.kinds] };
}
