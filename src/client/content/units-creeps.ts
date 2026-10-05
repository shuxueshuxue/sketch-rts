import type { CreepFamilyUnitKind } from "../../shared/types";
import { EMBER, EMBER_GLOW, GOLD, INK, LEATHER, LEATHER_DARK, LINEN, STEEL, STEEL_DARK, WOOD, darker, ellipse, legs, line, polygon, staff, torso } from "../art/kit";
import type { Brush } from "../art/kit";
import type { UnitCard } from "./cards";

// The creep families of the camp templates (see shared/camps.ts): murlocs by the water, golems in the hills, ogres on the
// open ground, spiders in the forest, dragons at the great prizes. Drawn in the wildlings' hand, a size by level.
const MURLOC = "#5f9c8f";
const MURLOC_BELLY = "#c9dcb4";
const ROCK = "#9c9888";
const GRANITE = "#7d7a72";
const OGRE = "#9a9a62";
const SPIDER = "#4a4146";
const DRAGON = "#b5523f";
const DRAGON_BELLY = "#e8c27a";

function murlocBody(b: Brush, size = 1) {
  line(b, [[-4 * size, 7], [-6 * size, 15]], darker(MURLOC), 3 * size);
  line(b, [[4 * size, 7], [6 * size, 15]], darker(MURLOC), 3 * size);
  ellipse(b, 0, 1, 9 * size, 10 * size, MURLOC, INK);
  ellipse(b, 1, 4, 5 * size, 6 * size, MURLOC_BELLY);
  // The head is the body's top: a crest of fins and two round eyes.
  polygon(b, [[-6 * size, -7 * size], [-2 * size, -15 * size], [1 * size, -8 * size], [4 * size, -14 * size], [6 * size, -6 * size]], "#7fb8a0", INK, 1);
  ellipse(b, 2, -4 * size, 1.6, 1.6, "#f2dc6b", INK);
  ellipse(b, 6, -3 * size, 1.4, 1.4, "#f2dc6b", INK);
  polygon(b, [[3, 0], [9, -1], [5, 3]], "#e8d6b0", INK, 0.8);
}

function golemBody(b: Brush, fill: string, size: number, crystal?: string) {
  ellipse(b, 1, 16, 20 * size, 5.5 * size, "#30483638");
  line(b, [[-8 * size, 6], [-10 * size, 16]], darker(fill, 0.15), 6 * size);
  line(b, [[8 * size, 6], [10 * size, 16]], darker(fill, 0.15), 6 * size);
  polygon(b, [[-15 * size, 4], [-12 * size, -14 * size], [0, -18 * size], [12 * size, -13 * size], [15 * size, 5], [0, 9]], fill, INK, 1.4);
  for (const [x, y] of [[-6, -8], [5, -10], [-1, 0], [8, 1]]) polygon(b, [[x! * size - 3, y! * size], [x! * size, y! * size - 3], [x! * size + 3, y! * size + 1]], darker(fill, 0.2), "transparent", 0);
  ellipse(b, -16 * size, -2, 5 * size, 6 * size, fill, INK);
  ellipse(b, 16 * size, -2, 5 * size, 6 * size, fill, INK);
  ellipse(b, 0, -19 * size, 6 * size, 5 * size, darker(fill, 0.1), INK);
  ellipse(b, -2 * size, -20 * size, 1.3, 1.3, crystal ?? "#f2dc6b");
  ellipse(b, 2 * size, -20 * size, 1.3, 1.3, crystal ?? "#f2dc6b");
  if (crystal) for (const x of [-7, 0, 7]) polygon(b, [[x * size - 2, -17 * size], [x * size, -25 * size], [x * size + 2, -17 * size]], crystal, INK, 0.8);
}

function ogreBody(b: Brush, robe: string, size = 1) {
  legs(b, "brace", darker(OGRE, 0.25));
  torso(b, robe, 12, 3);
  ellipse(b, 0, -6, 12 * size, 9 * size, OGRE, INK);
  ellipse(b, 0, -2, 11 * size, 4, robe, INK);
  ellipse(b, 0, -19 * size, 7 * size, 6.5 * size, OGRE, INK);
  polygon(b, [[-4, -16 * size], [-2, -13 * size], [0, -16 * size]], LINEN, INK, 0.6);
  polygon(b, [[2, -16 * size], [4, -13 * size], [5, -16 * size]], LINEN, INK, 0.6);
  ellipse(b, -2.5, -21 * size, 1.1, 1.1, INK);
  ellipse(b, 2.5, -21 * size, 1.1, 1.1, INK);
}

function spiderBody(b: Brush, fill: string, size: number, mark?: string) {
  for (const side of [-1, 1]) {
    for (const [reach, rise] of [[17, -8], [20, -1], [19, 6], [15, 12]]) {
      line(b, [[side * 4 * size, 2], [side * reach! * 0.7 * size, rise! * size - 6], [side * reach! * size, rise! * size + 8]], darker(fill, 0.1), 1.8 * size);
    }
  }
  ellipse(b, -1, 5, 10 * size, 8 * size, fill, INK);
  ellipse(b, 0, -5 * size, 6 * size, 5 * size, darker(fill, 0.1), INK);
  if (mark) polygon(b, [[-1, 1], [-4, 5], [-1, 9], [2, 5]], mark, "transparent", 0);
  for (const x of [-2.5, 0, 2.5]) ellipse(b, x * size, -7 * size, 1, 1, "#e2554a");
}

function dragonBody(b: Brush, size: number) {
  ellipse(b, 0, 16, 22 * size, 5.5 * size, "#30483638");
  // Wings behind, the near one over the body.
  polygon(b, [[-4, -6 * size], [-26 * size, -24 * size], [-20 * size, -6 * size], [-28 * size, 0], [-6, 2]], darker(DRAGON, 0.2), INK, 1.1);
  for (const x of [-12, -6, 6, 12]) line(b, [[x * size, 8], [x * size - 1, 16]], darker(DRAGON, 0.25), 3 * size);
  ellipse(b, 0, 3, 16 * size, 9 * size, DRAGON, INK);
  ellipse(b, 2, 6, 10 * size, 4.5 * size, DRAGON_BELLY);
  line(b, [[-15 * size, 4], [-24 * size, 8], [-30 * size, 2]], DRAGON, 3.4 * size);
  polygon(b, [[10 * size, -2], [14 * size, -14 * size], [22 * size, -16 * size], [26 * size, -10 * size], [18 * size, -6 * size], [16 * size, 2]], DRAGON, INK, 1.2);
  ellipse(b, 20 * size, -13 * size, 1.4, 1.4, EMBER_GLOW);
  for (const x of [14, 18]) polygon(b, [[x * size, -15 * size], [x * size - 1, -21 * size], [x * size + 2, -16 * size]], LINEN, INK, 0.7);
  polygon(b, [[4, -6 * size], [20 * size, -26 * size], [16 * size, -8 * size], [8, 0]], lightenWing(), INK, 1);
}

function lightenWing() {
  return "#c97a5f";
}

export const CREEP_UNITS: Record<CreepFamilyUnitKind, UnitCard> = {
  murlocPeon: {
    name: { en: "Murloc Peon", zh: "鱼人苦工" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "shortSword"] },
    art: { tier: "basic", bearing: "foot", faction: "wild" },
    paint(b) {
      murlocBody(b, 0.9);
      line(b, [[7, 2], [16, -10]], WOOD, 2.4);
      polygon(b, [[15, -9], [19, -15], [17, -8]], STEEL, INK, 0.8);
    },
  },
  murlocHunter: {
    name: { en: "Murloc Hunter", zh: "鱼人猎手" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "arrow"] },
    art: { tier: "advanced", bearing: "foot", faction: "wild" },
    paint(b) {
      murlocBody(b);
      // The net: a ring with its mesh, held out.
      ellipse(b, 15, -4, 7, 7, "#e6d9b433", "#8a7a52");
      line(b, [[10, -8], [20, 0]], "#8a7a52", 0.8);
      line(b, [[10, 0], [20, -8]], "#8a7a52", 0.8);
      line(b, [[15, -11], [15, 3]], "#8a7a52", 0.8);
      line(b, [[7, 1], [11, -2]], MURLOC, 3);
    },
  },
  tidePriest: {
    name: { en: "Tide Priest", zh: "潮汐祭司" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "halo"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" },
    paint(b) {
      torso(b, "#5a7d9a", 15, 2);
      murlocBody(b, 0.95);
      staff(b, 16, -24, 16, "#6c5a3e");
      polygon(b, [[13, -24], [16, -32], [19, -24], [16, -21]], "#f0e3c0", INK, 1);
      for (const [x, y] of [[-14, -10], [-17, -2], [20, -30]]) ellipse(b, x!, y!, 2, 2, "#bfe4f033", "#5a7d9a");
    },
  },
  deepSnapper: {
    name: { en: "Deep Snapper", zh: "深渊巨鳌" },
    glyph: { silhouette: "wildling-thorns", marks: ["tail", "towerShield"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
    paint(b) {
      ellipse(b, 0, 16, 22, 6, "#30483638");
      for (const x of [-14, -7, 7, 14]) line(b, [[x, 6], [x * 1.2, 15]], "#4f6f62", 4);
      ellipse(b, 0, 0, 19, 12, "#3f6b62", INK);
      for (const [x, y] of [[-9, -3], [0, -6], [9, -3], [-4, 4], [5, 4]]) polygon(b, [[x! - 4, y!], [x!, y! - 4], [x! + 4, y!], [x!, y! + 4]], "#5f9c8f", INK, 0.8);
      ellipse(b, 19, 0, 6, 5, "#4f6f62", INK);
      ellipse(b, 21, -2, 1.2, 1.2, "#f2dc6b");
      for (const side of [-1, 1]) polygon(b, [[14, side * 8], [24, side * 12], [28, side * 8], [22, side * 6]], "#c96a52", INK, 1);
    },
  },
  rubbleGolem: {
    name: { en: "Rubble Golem", zh: "碎石魔像" },
    glyph: { silhouette: "golem-block", marks: ["blockSeams", "scar"] },
    art: { tier: "elite", bearing: "construct", faction: "wild" },
    paint(b) {
      golemBody(b, ROCK, 0.8);
    },
  },
  rockGolem: {
    name: { en: "Rock Golem", zh: "岩石魔像" },
    glyph: { silhouette: "golem-block", marks: ["blockSeams", "rune"] },
    art: { tier: "elite", bearing: "construct", faction: "wild" },
    paint(b) {
      golemBody(b, "#8f8a78", 0.95);
      line(b, [[-6, -10], [6, 2]], darker("#8f8a78", 0.35), 1.2);
    },
  },
  graniteGolem: {
    name: { en: "Granite Golem", zh: "花岗岩魔像" },
    glyph: { silhouette: "golem-block", marks: ["blockSeams", "spark", "rune"] },
    art: { tier: "elite", bearing: "construct", faction: "wild" },
    paint(b) {
      golemBody(b, GRANITE, 1.15, "#9fd2e8");
    },
  },
  ogreWarrior: {
    name: { en: "Ogre Warrior", zh: "食人魔战士" },
    glyph: { silhouette: "wildling-thorns", marks: ["visor", "shortSword"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" },
    paint(b) {
      ogreBody(b, LEATHER);
      line(b, [[10, 2], [20, -16]], WOOD, 5);
      ellipse(b, 21, -18, 5, 6, darker(WOOD, 0.1), INK);
    },
  },
  ogreMage: {
    name: { en: "Ogre Mage", zh: "食人魔法师" },
    glyph: { silhouette: "wildling-thorns", marks: ["visor", "crescent"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" },
    paint(b) {
      ogreBody(b, "#5a4a7a");
      staff(b, 17, -26, 16, "#6c5a3e");
      ellipse(b, 17, -28, 4, 4, EMBER, INK);
      ellipse(b, 17, -28, 1.6, 1.6, EMBER_GLOW);
    },
  },
  ogreLord: {
    name: { en: "Ogre Lord", zh: "食人魔领主" },
    glyph: { silhouette: "wildling-thorns", marks: ["visor", "flag"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" },
    paint(b) {
      ogreBody(b, LEATHER_DARK, 1.12);
      polygon(b, [[-6, -26], [-6, -31], [-3, -28], [0, -32], [3, -28], [6, -31], [6, -26]], GOLD, INK, 1);
      line(b, [[11, 6], [18, -22]], WOOD, 3.4);
      polygon(b, [[17, -26], [27, -22], [24, -12], [16, -15]], STEEL, STEEL_DARK, 1.2);
    },
  },
  spiderling: {
    name: { en: "Spiderling", zh: "小蜘蛛" },
    glyph: { silhouette: "wildling-thorns", marks: ["spark", "scar"] },
    art: { tier: "basic", bearing: "beast", faction: "wild" },
    paint(b) {
      spiderBody(b, SPIDER, 0.7);
    },
  },
  venomSpider: {
    name: { en: "Venom Spider", zh: "毒蛛" },
    glyph: { silhouette: "wildling-thorns", marks: ["spark", "curseSlash"] },
    art: { tier: "advanced", bearing: "beast", faction: "wild" },
    paint(b) {
      spiderBody(b, "#4f5a3a", 0.9, "#9fd36b");
      ellipse(b, 1, -1, 1.4, 2.2, "#9fd36b");
    },
  },
  spiderQueen: {
    name: { en: "Spider Queen", zh: "蛛后" },
    glyph: { silhouette: "wildling-thorns", marks: ["spark", "outerRing"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
    paint(b) {
      spiderBody(b, "#4b3a52", 1.3, "#c96aa0");
      polygon(b, [[-5, -12], [-5, -16], [-2, -14], [0, -17], [2, -14], [5, -16], [5, -12]], GOLD, INK, 0.9);
    },
  },
  dragonWhelp: {
    name: { en: "Dragon Whelp", zh: "幼龙" },
    glyph: { silhouette: "wildling-thorns", marks: ["innerSigil", "spark"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
    paint(b) {
      dragonBody(b, 0.75);
    },
  },
  redDragon: {
    name: { en: "Red Dragon", zh: "红龙" },
    glyph: { silhouette: "wildling-thorns", marks: ["innerSigil", "flag", "spark"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
    paint(b) {
      dragonBody(b, 1.25);
      ellipse(b, 34, -12, 4, 2.5, "#f2894b88");
    },
  },
};
