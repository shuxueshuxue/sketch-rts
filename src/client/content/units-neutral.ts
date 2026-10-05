import type { UnitKind } from "../../shared/types";
import { BARK, EMBER_GLOW, GOLD, INK, LEAF, LEATHER, LEATHER_DARK, LINEN, MOSS, STEEL, STEEL_DARK, WOOD, arm, belt, blade, bow, darker, ellipse, halo, head, hood, leafMark, legs, line, polygon, staff, torso } from "../art/kit";
import type { UnitCard } from "./cards";

// Units nobody trains: summoned spirits, hired swords and the wildlings of creep camps.
export const NEUTRAL_UNITS = {
  spirit: {
    name: { en: "Spirit", zh: "灵体" },
    glyph: { silhouette: "spirit-wisp", marks: ["tail", "spark", "halo"] },
    art: { tier: "basic", bearing: "spirit", faction: "summoned" },
    paint(b, team) {
      ellipse(b, 0, 1, 17, 18, "#8dc6ba33");
      polygon(b, [[0, -23], [12, -4], [5, 9], [0, 18], [-11, 3]], "#b6d8b8", team);
      polygon(b, [[0, -14], [5, 0], [-1, 9], [-6, 0]], "#f2f1c5", "transparent", 0);
      ellipse(b, -2, -1, 1.2, 1.5, INK); ellipse(b, 3, -1, 1.2, 1.5, INK);
    },
  },
  mercenary: {
    name: { en: "Mercenary", zh: "雇佣兵" },
    glyph: { silhouette: "mercenary-badge", marks: ["coinSlash", "shortSword", "scar"] },
    art: { tier: "advanced", bearing: "foot", faction: "hired" },
    paint(b, team) {
      legs(b);
      torso(b, LEATHER);
      for (const [x, y] of [[-5, -5], [0, -5], [4, -5], [-6, 0], [5, 0]]) ellipse(b, x!, y!, 0.9, 0.9, GOLD);
      line(b, [[-7, -8], [8, 6]], team, 2.6);
      belt(b, LEATHER_DARK, GOLD);
      blade(b, [14, 3], [19, -36], 4.6, "#d6ded0", "#f0f2e8");
      line(b, [[10, 3], [18, 3]], GOLD, 2.4);
      arm(b, [6, -6], [14, 2], LEATHER);
      head(b);
      polygon(b, [[-7.5, -17], [-6, -22], [0, -23.5], [6, -20.5], [6, -17.5]], team);
      line(b, [[-7, -18], [-12, -14]], team, 2);
      line(b, [[-2, -18], [4, -12]], "#9a6a55", 1);
      polygon(b, [[-12, -8], [-5, -10], [-4, 0], [-11, 1]], STEEL, INK, 1.1);
      ellipse(b, -1, -4, 2.4, 2.4, GOLD, "#8d7852");
    },
  },
  contractArcher: {
    name: { en: "Contract Archer", zh: "契约弓手" },
    glyph: { silhouette: "mercenary-badge", marks: ["coinSlash", "bow", "arrow"] },
    art: { tier: "advanced", bearing: "foot", faction: "hired" },
    paint(b, team) {
      legs(b);
      torso(b, LEATHER, 12, 1);
      line(b, [[-8, -8], [8, -8]], team, 3);
      belt(b, LEATHER_DARK, GOLD);
      polygon(b, [[-13, 1], [-8, 0], [-7, 10], [-12, 11]], LEATHER_DARK, INK, 1);
      for (const x of [-12, -10]) line(b, [[x, 1], [x - 1, -4]], "#d8dfd0", 1.2);
      line(b, [[3, -1], [23, -3]], WOOD, 3);
      b.beginPath(); b.moveTo(21, -12); b.quadraticCurveTo(26, -3, 21, 6); b.strokeStyle = STEEL_DARK; b.lineWidth = 2.4; b.stroke();
      line(b, [[21, -12], [16, -3], [21, 6]], "#d6c494", 0.8);
      arm(b, [6, -6], [10, -1], LEATHER);
      head(b);
      ellipse(b, -1, -19.5, 12, 2.6, LEATHER_DARK, INK);
      polygon(b, [[-6, -20], [-5, -26], [3, -26.5], [5, -20]], LEATHER_DARK);
      line(b, [[-5, -21], [4.5, -21]], team, 1.6);
      line(b, [[-5, -24], [-13, -30]], "#e3d6a4", 1.6);
      ellipse(b, 5, -3, 2.2, 2.2, GOLD, "#8d7852");
    },
  },
  fieldMedic: {
    name: { en: "Field Medic", zh: "战地医师" },
    glyph: { silhouette: "mercenary-badge", marks: ["coinSlash", "halo", "cross"] },
    art: { tier: "advanced", bearing: "foot", faction: "hired" },
    paint(b, team) {
      legs(b);
      torso(b, LINEN, 12, 1);
      line(b, [[5, -8], [9, -3]], team, 3);
      belt(b, LEATHER_DARK, GOLD);
      line(b, [[-5, -9], [-12, 2]], "#856b46", 1.6);
      polygon(b, [[-17, 0], [-7, -1], [-6, 10], [-16, 11]], "#92764d", INK, 1);
      line(b, [[-11.5, 2], [-11.5, 8]], "#5d9a6b", 2.2);
      line(b, [[-14.5, 5], [-8.5, 5]], "#5d9a6b", 2.2);
      staff(b, 16, -20);
      polygon(b, [[13, -21], [19, -21], [19, -29], [16, -32], [13, -29]], "#b9dccf", INK, 1);
      line(b, [[16, -28], [16, -23]], "#5d9a6b", 1.4);
      arm(b, [6, -6], [15, 0], LINEN);
      head(b);
      polygon(b, [[-7, -17], [-6, -22.5], [0, -24], [6, -21], [6, -17.5]], team);
      ellipse(b, 3, 4, 2.2, 2.2, GOLD, "#8d7852");
    },
  },
  wildling: {
    name: { en: "Wildling", zh: "林间野人" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "scar", "curseSlash"] },
    art: { tier: "basic", bearing: "foot", faction: "wild" },
    paint(b, team) {
      line(b, [[-4, 7], [-6, 15]], BARK, 3.4);
      line(b, [[4, 7], [6, 15]], BARK, 3.4);
      ellipse(b, 0, 0, 9, 10, BARK, INK);
      for (let i = 0; i < 5; i++) polygon(b, [[-9 + i * 4, 5], [-7 + i * 4, 12], [-5 + i * 4, 5]], i % 2 ? LEAF : MOSS, "transparent", 0);
      line(b, [[7, -1], [15, -12]], WOOD, 3);
      ellipse(b, 16, -14, 3.6, 3.6, "#6c5a3e", INK);
      ellipse(b, 8, -1, 2, 2, BARK, INK);
      ellipse(b, 2, -10, 6, 5.5, "#9a8a60", INK);
      for (const x of [2, 6]) ellipse(b, x, -10.5, 1.2, 1.2, "#f2dc6b");
      line(b, [[-3, -14], [-7, -20]], LEAF, 1.8);
      line(b, [[1, -15], [0, -21]], MOSS, 1.8);
    },
  },
  mossGnawer: {
    name: { en: "Moss Gnawer", zh: "苔鼠" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "scar", "shortSword"] },
    art: { tier: "basic", bearing: "beast", faction: "wild" },
    paint(b, team) {
      b.beginPath(); b.moveTo(-12, 4); b.bezierCurveTo(-20, 2, -22, -8, -16, -10); b.strokeStyle = "#7a7458"; b.lineWidth = 2; b.stroke();
      for (const x of [-8, -3, 4, 8]) line(b, [[x, 6], [x - 1, 14]], "#5f5a44", 2.6);
      ellipse(b, 0, 3, 12, 7.5, "#7f8c62", INK);
      for (const x of [-8, -4, 0, 4]) polygon(b, [[x - 2, -3], [x, -8], [x + 2, -3]], MOSS, "transparent", 0);
      ellipse(b, 11, -1, 6, 5, "#909c73", INK);
      polygon(b, [[8, -5], [9, -10], [11, -5]], "#909c73", INK, 0.9);
      ellipse(b, 13, -2, 1, 1, INK);
      polygon(b, [[15, 2], [17, 2], [17, 6], [15, 5]], LINEN, INK, 0.7);
    },
  },
  thornSlinger: {
    name: { en: "Thorn Slinger", zh: "荆刺射手" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "bow", "arrow"] },
    art: { tier: "advanced", bearing: "foot", faction: "wild" },
    paint(b, team) {
      legs(b, "stand", BARK);
      torso(b, "#6f7f4f", 10);
      for (const x of [-9, -4, 1, 6]) polygon(b, [[x, -9], [x + 2, -13], [x + 3, -9]], "#9a8a55", "transparent", 0);
      belt(b, LEATHER_DARK);
      arm(b, [6, -6], [12, -2], "#6f7f4f", BARK);
      head(b, "#a8986a");
      hood(b, MOSS);
      leafMark(b, -8, -21, 3.2);
      bow(b, 15, -3, 16, "#5f6d3c", "#c9d59a");
      for (const y of [-12, 0, 10]) polygon(b, [[19, y], [23, y - 2], [21, y + 2]], "#9a8a55", "transparent", 0);
    },
  },
  barkMender: {
    name: { en: "Bark Mender", zh: "树皮医者" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "halo", "cross"] },
    art: { tier: "advanced", bearing: "foot", faction: "wild" },
    paint(b, team) {
      for (const [x, y] of [[-15, -8], [18, 4], [-12, 10]]) ellipse(b, x!, y!, 1.8, 1.8, "#c5e3a6");
      torso(b, BARK, 15, 2);
      for (const x of [-6, -1, 4]) line(b, [[x, -7], [x + (x < 0 ? -2 : 2), 13]], darker(BARK, 0.25), 0.9);
      belt(b, MOSS);
      staff(b, 16, -24, 16, "#6c5a3e");
      leafMark(b, 19, -27, 5, "#b9dc93");
      leafMark(b, 13, -25, 3.5, "#9fc47d");
      ellipse(b, 16, -26, 9, 9, "#c5e3a633");
      arm(b, [6, -6], [15, 0], BARK, "#a8986a");
      head(b, "#a8986a");
      for (const [x, y, s] of [[-7, -21, 4], [-2, -24, 4.5], [4, -22, 4]]) leafMark(b, x!, y!, s!, LEAF);
    },
  },
  stonebackBrute: {
    name: { en: "Stoneback Brute", zh: "石背蛮兽" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "blockSeams", "shieldBar"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
    paint(b, team) {
      ellipse(b, 1, 16, 22, 6, "#30483638");
      line(b, [[-8, 6], [-10, 16]], "#6f775f", 5);
      line(b, [[7, 6], [9, 16]], "#6f775f", 5);
      ellipse(b, -1, -2, 16, 13, "#8a9477", INK);
      polygon(b, [[-17, -4], [-12, -18], [-2, -21], [0, -12], [-9, -4]], "#b3b6a0", INK, 1.1);
      polygon(b, [[-5, -19], [5, -23], [10, -14], [1, -10]], "#a4a891", INK, 1.1);
      polygon(b, [[-12, -18], [-10, -24], [-7, -19]], MOSS, "transparent", 0);
      polygon(b, [[2, -22], [4, -28], [7, -22]], MOSS, "transparent", 0);
      line(b, [[10, -4], [16, 8]], "#7c866a", 6);
      ellipse(b, 17, 10, 4, 3.4, "#8a9477", INK);
      ellipse(b, 13, -9, 6.5, 5.5, "#9aa383", INK);
      ellipse(b, 15, -10, 1.1, 1.1, "#f2dc6b");
      polygon(b, [[16, -6], [18, -9], [19, -5]], LINEN, INK, 0.7);
    },
  },
  gladeWitch: {
    name: { en: "Glade Witch", zh: "林间女巫" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "crescent", "curseSlash"] },
    art: { tier: "elite", bearing: "foot", faction: "wild" },
    paint(b, team) {
      torso(b, "#5f7250", 15, 3);
      polygon(b, [[-10, -9], [8, -9], [11, 1], [-12, 1]], MOSS);
      for (let i = 0; i < 4; i++) leafMark(b, -8 + i * 5, 1, 2.6, LEAF);
      belt(b, "#3f4b35");
      line(b, [[17, 16], [16, 0], [19, -12], [15, -22], [18, -30]], "#5b6b3e", 2.4);
      ellipse(b, 18, -32, 4, 4, "#e2a9a0", INK);
      ellipse(b, 18, -32, 1.5, 1.5, EMBER_GLOW);
      arm(b, [6, -6], [16, -2], "#5f7250", "#c9c9a0");
      head(b, "#c9c9a0");
      polygon(b, [[-9, -9], [-9, -18], [-3, -23], [5, -21], [8, -15], [5, -17], [-4, -18], [-6, -9]], "#6f6a55");
      line(b, [[-4, -21], [-8, -30], [-13, -33]], "#a59962", 1.8);
      line(b, [[-8, -30], [-5, -35]], "#a59962", 1.5);
      line(b, [[2, -22], [5, -31], [9, -35]], "#a59962", 1.8);
      line(b, [[5, -31], [2, -36]], "#a59962", 1.5);
    },
  },
  ancientStag: {
    name: { en: "Ancient Stag", zh: "远古巨鹿" },
    glyph: { silhouette: "wildling-thorns", marks: ["thornFork", "visor", "halo"] },
    art: { tier: "elite", bearing: "beast", faction: "wild" },
    paint(b, team) {
      ellipse(b, 0, 17, 24, 6.5, "#30483638");
      for (const x of [-15, -8, 9, 15]) line(b, [[x, 5], [x - 2, 18]], "#898d6c", 2.6);
      ellipse(b, -2, 1, 19, 9.5, "#d3d0ac", INK);
      polygon(b, [[-17, -3], [-6, -9], [6, -8], [8, 1], [-12, 4]], MOSS, "transparent", 0);
      for (const x of [-13, -7, -1]) ellipse(b, x, 2, 1.6, 1.6, "#f2e9c7");
      polygon(b, [[8, 4], [6, -16], [11, -26], [19, -20], [22, -12], [16, -10], [17, 4]], "#e3dfbe");
      const antler = "#b79f5c";
      line(b, [[10, -24], [4, -32], [3, -42], [0, -46]], antler, 2.2);
      line(b, [[4, -32], [-3, -35], [-6, -42]], antler, 1.9);
      line(b, [[3, -40], [-2, -43]], antler, 1.6);
      line(b, [[15, -24], [21, -33], [21, -43], [25, -47]], antler, 2.2);
      line(b, [[21, -33], [28, -35], [31, -42]], antler, 1.9);
      line(b, [[21, -41], [26, -44]], antler, 1.6);
      for (const [x, y] of [[0, -46], [-6, -42], [25, -47], [31, -42]]) ellipse(b, x!, y!, 1.6, 1.6, EMBER_GLOW);
      ellipse(b, 16, -18, 1.4, 1.4, "#e8b94f");
      line(b, [[-20, 0], [-24, -5]], "#dad6b4", 3);
    },
  },
} satisfies Partial<Record<UnitKind, UnitCard>>;
