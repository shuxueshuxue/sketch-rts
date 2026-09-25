import type { TrainableUnitKind } from "../../shared/types";
import { ASH, EMBER, EMBER_GLOW, GOLD, INK, LEATHER_DARK, LINEN, SKIN, WOOD, arm, belt, blade, bow, darker, ellipse, halo, head, hemTrim, hood, hornedCap, legs, lighter, line, polygon, quiver, staff, torso } from "../art/kit";
import type { TrainedUnitCard } from "./cards";

// Ember Pact: faster fragile fighters, early support casters, and the ashen hall's heavies.
export const EMBER_UNITS = {
  emberRavager: {
    name: { en: "Ember Ravager", zh: "余烬劫掠者" },
    description: { en: "Aggressive ember infantry with strong close-range damage.", zh: "进攻性的余烬步兵，近距离伤害很强。" },
    command: { icon: "◆", hotkey: "v" },
    glyph: { silhouette: "ember-bruiser", marks: ["shortSword", "spark", "scar"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" },
    paint(b, team) {
      legs(b, "brace");
      torso(b, team, 8);
      line(b, [[-7, -8], [8, 6]], LEATHER_DARK, 2.6);
      line(b, [[6, -8], [-8, 6]], LEATHER_DARK, 2.6);
      belt(b, LEATHER_DARK);
      arm(b, [-6, -7], [-13, 2], SKIN, SKIN, 4.4);
      line(b, [[-12, -1], [-13, 1]], EMBER, 2.4);
      b.beginPath(); b.moveTo(13, 0); b.lineTo(15, -12); b.quadraticCurveTo(26, -20, 26, -8); b.lineTo(17, -4); b.closePath();
      b.fillStyle = "#cfd6c8"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1.1; b.stroke();
      line(b, [[16, -12], [25.5, -9]], EMBER, 1.6);
      line(b, [[12, 3], [15, -12]], WOOD, 2.4);
      arm(b, [6, -7], [13, 1], SKIN, SKIN, 4.4);
      line(b, [[12, -2], [13.5, 0]], EMBER, 2.4);
      head(b);
      hornedCap(b);
    },
  },
  cinderRunner: {
    name: { en: "Cinder Runner", zh: "余火奔袭者" },
    description: { en: "Fast ember melee unit for chasing weak targets and forcing fights.", zh: "高速余烬近战单位，用于追击弱目标并强行开战。" },
    command: { icon: "◇", hotkey: "r" },
    glyph: { silhouette: "cinder-skirmisher", marks: ["tail", "spark", "shortSword"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" },
    paint(b, team) {
      for (const [y, x] of [[-4, -19], [3, -22], [10, -18]]) line(b, [[x!, y!], [x! + 7, y!]], "#9a948a", 1.2);
      legs(b, "stride");
      b.beginPath(); b.moveTo(-5, -11); b.bezierCurveTo(-12, -14, -18, -8, -26, -12); b.lineTo(-23, -6); b.bezierCurveTo(-16, -4, -11, -8, -4, -7); b.closePath();
      b.fillStyle = lighter(team, 0.1); b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
      torso(b, team, 8, 0, 2);
      belt(b, ASH);
      blade(b, [-10, 2], [-17, -3], 2.2);
      arm(b, [-5, -6], [-10, 2], team);
      blade(b, [14, 1], [21, -6], 2.2);
      arm(b, [7, -6], [14, 1], team);
      head(b, SKIN, 2);
      hood(b, darker(team, 0.25));
      line(b, [[-3, -12], [6, -11]], ASH, 2.4);
    },
  },
  sparkArcher: {
    name: { en: "Spark Archer", zh: "火花弓手" },
    description: { en: "Fragile ember ranged unit with quick pressure and shorter reach.", zh: "脆弱的余烬远程单位，压制速度快但射程较短。" },
    command: { icon: "⋊", hotkey: "a" },
    glyph: { silhouette: "bow-crest", marks: ["bow", "arrow", "spark"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" },
    paint(b, team) {
      quiver(b, ASH);
      ellipse(b, -9, -17, 2.4, 2.4, EMBER_GLOW);
      legs(b);
      torso(b, team);
      line(b, [[-7, -8], [7, 5]], ASH, 2.4);
      belt(b, ASH);
      arm(b, [6, -6], [12, -2], team);
      head(b);
      hood(b, ASH);
      line(b, [[-2, -20], [4.5, -18.5]], EMBER, 1.4);
      bow(b, 14, -3, 13, "#6b4b36", EMBER_GLOW);
      ellipse(b, 29, -4, 3.5, 3.5, "#f4c86e55");
    },
  },
  emberAcolyte: {
    name: { en: "Ember Acolyte", zh: "余烬侍僧" },
    description: { en: "Ember support caster with a targeted heal for wounded allies.", zh: "余烬支援施法者，可以对受伤友军进行定点治疗。" },
    command: { icon: "+", hotkey: "p" },
    glyph: { silhouette: "priest-medallion", marks: ["halo", "spark", "cross"] },
    art: { tier: "advanced", bearing: "foot", faction: "ember" },
    paint(b, team) {
      torso(b, LINEN, 15, 2);
      line(b, [[-8, -8], [9, 12]], team, 3.4);
      hemTrim(b, 15, 2);
      belt(b, "#b89c63", GOLD);
      staff(b, 16, -26);
      line(b, [[16, -26], [21, -28], [22, -24]], "#6b5a45", 1.6);
      ellipse(b, 22, -17, 6, 6, "#f4c86e40");
      polygon(b, [[19.5, -22], [24.5, -22], [25, -14], [19, -14]], EMBER_GLOW, GOLD, 1.2);
      line(b, [[22, -21], [22, -15]], EMBER, 1.4);
      arm(b, [6, -6], [15, 0], LINEN);
      head(b);
      line(b, [[-7, -19.5], [5, -19.5]], GOLD, 1.8);
      polygon(b, [[-1, -21], [0.5, -24.5], [2, -21]], EMBER, "transparent", 0);
    },
  },
  ashHexer: {
    name: { en: "Ash Hexer", zh: "灰烬巫师" },
    description: { en: "Ember debuff caster that weakens enemy damage through curse.", zh: "余烬减益施法者，通过诅咒削弱敌方伤害。" },
    command: { icon: "☾", hotkey: "x" },
    glyph: { silhouette: "witch-crescent", marks: ["crescent", "curseSlash", "rune"] },
    art: { tier: "advanced", bearing: "foot", faction: "ember" },
    paint(b, team) {
      torso(b, ASH, 15, 2);
      line(b, [[-10.5, 11], [10.5, 11]], team, 2.4);
      hemTrim(b, 15, 2);
      belt(b, "#3a3632", GOLD);
      line(b, [[16, 16], [15, -8], [18, -16], [14, -24], [17, -29]], "#4f4238", 2.4);
      for (const [x, y, r] of [[19, -33, 3], [15, -37, 2.4], [20, -40, 1.8]]) ellipse(b, x!, y!, r!, r!, "#8f8a8266");
      ellipse(b, 17, -29, 2, 2, EMBER);
      arm(b, [6, -6], [15, -2], ASH);
      head(b);
      hood(b, darker(ASH, 0.2));
      polygon(b, [[-3, -20], [7, -19], [6, -10], [2, -8], [-2, -12]], "#e8dfc6", INK, 1);
      line(b, [[1, -16], [5, -16]], INK, 1.2);
      line(b, [[1, -12], [4, -9]], "#984e43", 1.2);
    },
  },
  pyreCaller: {
    name: { en: "Pyre Caller", zh: "薪火召唤者" },
    description: { en: "Ember summoner that creates temporary spirits near the fight.", zh: "余烬召唤者，可以在战斗附近召唤临时灵体。" },
    command: { icon: "◎", hotkey: "u" },
    glyph: { silhouette: "summoner-ring", marks: ["outerRing", "spark", "rune"] },
    art: { tier: "advanced", bearing: "foot", faction: "ember" },
    paint(b, team) {
      for (const a of [0.4, 2.5, 4.4]) polygon(b, [[Math.cos(a) * 18, 4 + Math.sin(a) * 6 - 3], [Math.cos(a) * 18 + 2, 4 + Math.sin(a) * 6], [Math.cos(a) * 18, 4 + Math.sin(a) * 6 + 3], [Math.cos(a) * 18 - 2, 4 + Math.sin(a) * 6]], EMBER_GLOW, EMBER, 0.8);
      torso(b, team, 15, 2);
      polygon(b, [[-9, -9], [8, -9], [10, -1], [-10, -1]], darker(team, 0.25));
      hemTrim(b, 15, 2);
      belt(b, darker(team, 0.4), GOLD);
      staff(b, 16, -23);
      polygon(b, [[10, -24], [22, -24], [19, -19], [13, -19]], GOLD, INK, 1);
      polygon(b, [[12, -24], [14, -31], [16, -28], [18, -35], [21, -24]], EMBER, "#9c4a36", 1);
      polygon(b, [[14.5, -24], [16.5, -29], [18.5, -24]], EMBER_GLOW, "transparent", 0);
      arm(b, [6, -6], [15, -1], team);
      head(b);
      line(b, [[-7, -19], [5, -19]], GOLD, 1.6);
    },
  },
  ashChieftain: {
    name: { en: "Ash Chieftain", zh: "灰烬酋长" },
    description: { en: "Ember war leader who hunts casters: deals 50% extra damage to summoned units and casters. Heavy armor: takes 50% damage from shooters and casters, 70% from towers.", zh: "猎杀法师的余烬首领：对召唤生物和法师造成 50% 额外伤害。重甲：受到射手和法师攻击的伤害为 50%，防御塔为 70%。" },
    command: { icon: "♛", hotkey: "h" },
    glyph: { silhouette: "ember-bruiser", marks: ["visor", "spark", "curseSlash"] },
    art: { tier: "elite", bearing: "foot", faction: "ember" },
    paint(b, team) {
      legs(b, "brace", ASH);
      polygon(b, [[-12, -12], [10, -12], [13, -4], [-15, -4]], "#7b6a58", INK, 1.1);
      torso(b, team, 10, 2);
      line(b, [[-8, -6], [8, 6]], LEATHER_DARK, 2.8);
      belt(b, LEATHER_DARK, EMBER_GLOW);
      for (const x of [-5, -1, 3]) ellipse(b, x, -7, 1.4, 1.8, "#e4dcc0", INK);
      line(b, [[13, 10], [17, -26]], WOOD, 2.6);
      b.beginPath(); b.moveTo(16, -24); b.quadraticCurveTo(30, -26, 28, -12); b.lineTo(16, -15); b.closePath();
      b.fillStyle = "#cfd6c8"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1.1; b.stroke();
      line(b, [[18, -22], [27, -14]], EMBER, 1.6);
      arm(b, [6, -7], [14, -4], team, SKIN, 4.6);
      arm(b, [-6, -7], [-11, 2], team, SKIN, 4.6);
      head(b);
      hornedCap(b);
      line(b, [[-4, -12], [2, -12]], EMBER, 1.4);
    },
  },
  cinderRevenant: {
    name: { en: "Cinder Revenant", zh: "余烬复生者" },
    description: { en: "Ember elite with modest health that burns its wounds away, regenerating 7 health per second. Heavy armor: takes 50% damage from shooters and casters, 70% from towers.", zh: "生命值不高的余烬精英，伤口在余烬中迅速愈合，每秒恢复 7 点生命。重甲：受到射手和法师攻击的伤害为 50%，防御塔为 70%。" },
    command: { icon: "✺", hotkey: "n" },
    glyph: { silhouette: "ember-bruiser", marks: ["spark", "halo", "scar"] },
    art: { tier: "elite", bearing: "foot", faction: "ember" },
    paint(b, team) {
      b.beginPath(); b.ellipse(0, 14, 16, 4.5, 0, 0, Math.PI * 2); b.strokeStyle = EMBER; b.lineWidth = 1.3; b.setLineDash([2, 3]); b.stroke(); b.setLineDash([]);
      legs(b, "stride", ASH);
      torso(b, "#4a4440", 9, 0, 1);
      line(b, [[-5, -7], [-1, -1], [-4, 6]], EMBER_GLOW, 1.6);
      line(b, [[4, -6], [1, 1], [5, 7]], EMBER, 1.4);
      belt(b, team);
      blade(b, [13, 1], [22, -10], 2.4, "#e8b27a", EMBER_GLOW);
      arm(b, [6, -6], [13, 1], "#4a4440", "#3a3431");
      arm(b, [-6, -6], [-11, 1], "#4a4440", "#3a3431");
      head(b, "#3a3431");
      b.beginPath(); b.moveTo(-7, -18); b.quadraticCurveTo(-6, -30, -1, -34); b.quadraticCurveTo(1, -28, 4, -31); b.quadraticCurveTo(7, -24, 6, -18); b.closePath();
      b.fillStyle = EMBER; b.fill(); b.strokeStyle = darker(EMBER, 0.3); b.lineWidth = 1; b.stroke();
      ellipse(b, -1, -24, 2.2, 3.2, EMBER_GLOW);
      ellipse(b, 2.4, -15.5, 1, 1.2, EMBER_GLOW);
    },
  },
} satisfies Partial<Record<TrainableUnitKind, TrainedUnitCard>>;
