import type { BuildingKind } from "../../shared/types";
import { type Brush, GOLD, INK, ellipse, flag, house, line, polygon, tower } from "../art/kit";
import type { BuildingCard } from "./cards";

// Parts several buildings share.
function yard(b: Brush, team: string, details: () => void) {
  house(b, -4, -2, 1.08, team);
  details();
  flag(b, -9, -28, team, 0.75);
}

function spire(b: Brush, team: string) {
  tower(b, 0, -1, 1.12, team);
  flag(b, 0, -45, team, 0.5);
}

function well(b: Brush, team: string, water: string, shimmer: string) {
  ellipse(b, 0, 12, 30, 17, "#9b9c80", INK);
  ellipse(b, 0, 6, 30, 16, "#e7ddba", INK);
  ellipse(b, 0, 6, 23, 11, water, INK);
  ellipse(b, 0, 5, 16, 6, shimmer);
  for (const x of [-27, 27]) tower(b, x, -9, 0.35, team);
}

function forge(b: Brush, team: string) {
  house(b, -4, 4, 1.06, team);
  polygon(b, [[17, -32], [27, -35], [27, -6], [17, -1]], "#8e917b");
  polygon(b, [[14, -35], [24, -39], [31, -35], [21, -31]], "#d0c6a5");
  polygon(b, [[-14, 10], [1, 13], [1, 26], [-14, 22]], "#543e32");
  ellipse(b, -6, 17, 5, 6, "#e9ac59");
}

export const BUILDING_CARDS: Record<BuildingKind, BuildingCard> = {
  townHall: {
    name: { en: "Town Hall", zh: "城镇大厅" },
    description: { en: "Main economy building. Trains workers, receives gold, researches building durability, and provides base supply.", zh: "主要经济建筑。训练农民、接收金矿、研究建筑耐久，并提供基础人口。" },
    command: { icon: "⌂", hotkey: "h" },
    glyph: { frame: "town-hall", marks: ["roof", "banner", "door"] },
    paint(b, team) {
      tower(b, -24, -3, 0.72, team);
      house(b, 3, 0, 1.08, team);
      tower(b, 29, 5, 0.61, team);
      flag(b, -24, -43, team, 0.6);
      line(b, [[-10, 28], [10, 33], [16, 29]], "#ece5c8", 3);
    },
  },
  barracks: {
    name: { en: "Barracks", zh: "兵营" },
    description: { en: "Core military building that trains melee soldiers and researches army upgrades.", zh: "核心军事建筑。训练近战士兵，并研究军队升级。" },
    command: { icon: "▱", hotkey: "b" },
    glyph: { frame: "barracks-yard", marks: ["crossedBlades", "banner", "door"] },
    paint(b, team) {
      yard(b, team, () => {
        polygon(b, [[18, 2], [30, 5], [28, 19], [23, 23], [17, 15]], team);
        line(b, [[16, -4], [34, 20]], "#d6ddcc", 2.4);
        line(b, [[33, -3], [17, 22]], "#d6ddcc", 2.4);
      });
    },
  },
  archeryRange: {
    name: { en: "Archery Range", zh: "靶场" },
    description: { en: "Ranged production building that trains archers.", zh: "远程生产建筑，用于训练弓箭手。" },
    command: { icon: "⌁", hotkey: "r" },
    glyph: { frame: "archery-range", marks: ["target", "bowRack", "banner"] },
    paint(b, team) {
      yard(b, team, () => {
        line(b, [[25, 10], [18, 31], [33, 31], [25, 10]], "#796b4c", 2);
        ellipse(b, 26, 9, 10, 13, "#e9d8ae", INK);
        ellipse(b, 26, 9, 6, 8, team);
        ellipse(b, 26, 9, 2, 3, GOLD);
      });
    },
  },
  stables: {
    name: { en: "Stables", zh: "马厩" },
    description: { en: "Mounted unit production building for fast raiders and heavy knights.", zh: "骑乘单位生产建筑，用于高速掠袭者和重骑士。" },
    command: { icon: "⌂", hotkey: "s" },
    glyph: { frame: "stables-gate", marks: ["horseshoe", "rail", "door"] },
    paint(b, team) {
      yard(b, team, () => {
        for (let i = 0; i < 4; i++) line(b, [[-31 + i * 17, 23 + i * 3], [-31 + i * 17, 10 + i * 3]], "#7e7555", 2.5);
        line(b, [[-31, 16], [20, 25]], "#b9a576", 3);
        b.beginPath(); b.arc(-11, 4, 5, 0, Math.PI); b.strokeStyle = GOLD; b.lineWidth = 2; b.stroke();
      });
    },
  },
  sanctum: {
    name: { en: "Sanctum", zh: "圣所" },
    description: { en: "Caster production building for priests, summoners, and witches.", zh: "施法者生产建筑，用于牧师、召唤师和女巫。" },
    command: { icon: "✣", hotkey: "c" },
    glyph: { frame: "sanctum-dome", marks: ["moonRune", "sparkRune", "banner"] },
    paint(b, team) {
      house(b, 0, 7, 1, team);
      ellipse(b, -2, -22, 22, 15, "#809d90", INK);
      polygon(b, [[-24, -21], [-16, -38], [-3, -49], [12, -36], [21, -22]], team);
      line(b, [[-3, -46], [-3, -22]], GOLD, 1.5);
      ellipse(b, -3, -50, 3, 3, GOLD, INK);
    },
  },
  workshop: {
    name: { en: "Workshop", zh: "工坊" },
    description: { en: "Heavy unit production building that trains golems.", zh: "重型单位生产建筑，用于训练魔像。" },
    command: { icon: "⚙", hotkey: "o" },
    glyph: { frame: "workshop-gear", marks: ["cog", "hammer", "door"] },
    paint(b, team) {
      forge(b, team);
      ellipse(b, -29, 9, 11, 11, "#a9a88d", INK);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        line(b, [[-29 + Math.cos(a) * 6, 9 + Math.sin(a) * 6], [-29 + Math.cos(a) * 13, 9 + Math.sin(a) * 13]], INK, 3);
      }
      ellipse(b, -29, 9, 4, 4, GOLD, INK);
    },
  },
  defenseTower: {
    name: { en: "Defense Tower", zh: "防御塔" },
    description: { en: "Static defense that fires at nearby enemy units.", zh: "静态防御建筑，会攻击附近敌方单位。" },
    command: { icon: "⌖", hotkey: "t" },
    glyph: { frame: "tower-spire", marks: ["arrowSlit", "watchEye", "banner"] },
    paint(b, team) {
      spire(b, team);
    },
  },
  moonWell: {
    name: { en: "Moon Well", zh: "月井" },
    description: { en: "Support building that periodically heals wounded friendly soldiers nearby.", zh: "支援建筑，会周期性治疗附近受伤友方士兵。" },
    command: { icon: "◐", hotkey: "m" },
    glyph: { frame: "moon-well", marks: ["moonRune", "sparkRune", "door"] },
    paint(b, team) {
      well(b, team, "#5f9d98", "#acd1bb");
      ellipse(b, 0, -17, 9, 9, "#f2e2ac", "#93865d");
      ellipse(b, 4, -20, 7, 7, "#b6b995");
    },
  },
  emberForge: {
    name: { en: "Ember Forge", zh: "余烬熔炉" },
    description: { en: "Ember military building that trains ravagers and cinder runners.", zh: "余烬军事建筑，用于训练劫掠者和奔袭者。" },
    command: { icon: "▰", hotkey: "b" },
    glyph: { frame: "ember-forge", marks: ["crossedBlades", "sparkRune", "hammer"] },
    paint(b, team) {
      forge(b, team);
    },
  },
  cinderSpire: {
    name: { en: "Cinder Spire", zh: "烬火尖塔" },
    description: { en: "Ember support building that trains ranged units and casters.", zh: "余烬支援建筑，用于训练远程单位和施法者。" },
    command: { icon: "♢", hotkey: "c" },
    glyph: { frame: "cinder-spire", marks: ["sparkRune", "watchEye", "banner"] },
    paint(b, team) {
      spire(b, team);
      polygon(b, [[-5, -29], [1, -45], [8, -29], [0, -22]], "#efb06a", "#974c39");
    },
  },
  emberShrine: {
    name: { en: "Ember Shrine", zh: "余烬神龛" },
    description: { en: "Ember support building that periodically heals wounded friendly soldiers nearby.", zh: "余烬支援建筑，会周期性治疗附近受伤友方士兵。" },
    command: { icon: "◒", hotkey: "m" },
    glyph: { frame: "ember-shrine", marks: ["sparkRune", "moonRune", "door"] },
    paint(b, team) {
      well(b, team, "#bc684a", "#e6ac61");
      polygon(b, [[-7, 4], [-10, -12], [0, -28], [5, -11], [10, -5], [7, 4]], "#edc170", "#ba7746");
    },
  },
  ashenHall: {
    name: { en: "Ashen Hall", zh: "灰烬战殿" },
    description: { en: "Ember heavy unit hall that trains ash chieftains and cinder revenants.", zh: "余烬重型单位殿堂，用于训练灰烬酋长和余烬复生者。" },
    command: { icon: "♨", hotkey: "a" },
    glyph: { frame: "ashen-hall", marks: ["crossedBlades", "sparkRune", "banner"] },
    paint(b, team) {
      house(b, -2, 3, 1.1, team);
      polygon(b, [[-30, -18], [-38, -36], [-25, -24]], "#e4dcc0", INK);
      polygon(b, [[25, -18], [33, -36], [21, -24]], "#e4dcc0", INK);
      polygon(b, [[-14, 10], [2, 13], [2, 26], [-14, 22]], "#3a3431");
      ellipse(b, -6, 17, 5, 6, "#e07a45");
      ellipse(b, 26, 16, 7, 4, "#48413c", INK);
      polygon(b, [[21, 14], [23, 2], [26, -7], [29, 3], [31, 14]], "#edc170", "#ba7746");
      flag(b, -8, -30, team, 0.75);
    },
  },
  farm: {
    name: { en: "Farm", zh: "农场" },
    description: { en: "Supply building. Build more farms before training past the cap.", zh: "人口建筑。超过人口上限前需要建造更多农场。" },
    command: { icon: "⌗", hotkey: "e" },
    glyph: { frame: "farm-plot", marks: ["furrows", "scareMark", "door"] },
    paint(b, team) {
      polygon(b, [[-35, 11], [-7, -2], [30, 13], [3, 32]], "#8e8860");
      for (let i = 0; i < 5; i++) {
        line(b, [[-28 + i * 7, 12 + i * 3], [-6 + i * 7, 1 + i * 3]], "#dbbb72", 3);
        for (let j = 0; j < 3; j++) line(b, [[-25 + i * 7 + j * 6, 11 + i * 3 - j * 3], [-27 + i * 7 + j * 6, 5 + i * 3 - j * 3]], "#ded29c", 1);
      }
      house(b, 12, -17, 0.6, team);
      line(b, [[-37, 20], [-37, 4], [-18, 10], [-18, 28]], "#726d4e", 2);
    },
  },
};

export function mapBuildingCards<T>(pick: (card: BuildingCard) => T): Record<BuildingKind, T> {
  return Object.fromEntries(Object.entries(BUILDING_CARDS).map(([kind, card]) => [kind, pick(card)])) as Record<BuildingKind, T>;
}
