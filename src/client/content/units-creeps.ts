import type { CreepFamilyUnitKind } from "../../shared/types";
import type { UnitCard } from "./cards";

export const CREEP_UNITS: Record<CreepFamilyUnitKind, UnitCard> = {
  murlocPeon: {
    name: { en: "Murloc Peon", zh: "鱼人苦工" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "shortSword"] },
    art: { tier: "basic", bearing: "foot", faction: "wild" },
  },
  murlocHunter: {
    name: { en: "Murloc Hunter", zh: "鱼人猎手" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "arrow"] },
    art: { tier: "advanced", bearing: "foot", faction: "wild" },
  },
  tidePriest: {
    name: { en: "Tide Priest", zh: "潮汐祭司" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "halo"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" },
  },
  deepSnapper: {
    name: { en: "Deep Snapper", zh: "深渊巨鳌" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "towerShield"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
  },
  rubbleGolem: {
    name: { en: "Rubble Golem", zh: "碎石魔像" },
    glyph: { silhouette: "golem-block", marks: ["blockSeams", "scar"] },
    art: { tier: "elite", bearing: "construct", faction: "wild" },
  },
  rockGolem: {
    name: { en: "Rock Golem", zh: "岩石魔像" },
    glyph: { silhouette: "golem-block", marks: ["blockSeams", "rune"] },
    art: { tier: "elite", bearing: "construct", faction: "wild" },
  },
  graniteGolem: {
    name: { en: "Granite Golem", zh: "花岗岩魔像" },
    glyph: { silhouette: "golem-block", marks: ["blockSeams", "spark", "rune"] },
    art: { tier: "elite", bearing: "construct", faction: "wild" },
  },
  ogreWarrior: {
    name: { en: "Ogre Warrior", zh: "食人魔战士" },
    glyph: { silhouette: "wildling-thorns", marks: ["visor", "shortSword"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" },
  },
  ogreMage: {
    name: { en: "Ogre Mage", zh: "食人魔法师" },
    glyph: { silhouette: "wildling-thorns", marks: ["visor", "crescent"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" },
  },
  ogreLord: {
    name: { en: "Ogre Lord", zh: "食人魔领主" },
    glyph: { silhouette: "wildling-thorns", marks: ["visor", "flag"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" },
  },
  spiderling: {
    name: { en: "Spiderling", zh: "小蜘蛛" },
    glyph: { silhouette: "wildling-thorns", marks: ["spark", "scar"] },
    art: { tier: "basic", bearing: "beast", faction: "wild" },
  },
  venomSpider: {
    name: { en: "Venom Spider", zh: "毒蛛" },
    glyph: { silhouette: "wildling-thorns", marks: ["spark", "curseSlash"] },
    art: { tier: "advanced", bearing: "beast", faction: "wild" },
  },
  spiderQueen: {
    name: { en: "Spider Queen", zh: "蛛后" },
    glyph: { silhouette: "wildling-thorns", marks: ["spark", "outerRing"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
  },
  dragonWhelp: {
    name: { en: "Dragon Whelp", zh: "幼龙" },
    glyph: { silhouette: "wildling-thorns", marks: ["innerSigil", "spark"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
  },
  redDragon: {
    name: { en: "Red Dragon", zh: "红龙" },
    glyph: { silhouette: "wildling-thorns", marks: ["innerSigil", "flag", "spark"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
  },
};
