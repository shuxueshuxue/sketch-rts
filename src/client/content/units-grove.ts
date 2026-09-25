import type { TrainableUnitKind } from "../../shared/types";
import { EMBER_GLOW, GOLD, INK, LEATHER, LINEN, MOSS, STEEL, STEEL_DARK, arm, belt, blade, bow, capeBehind, darker, ellipse, flag, halo, head, hemTrim, hood, horse, kettleHelm, kiteShield, leafMark, legs, lighter, line, pennant, plumedHelm, pointedHat, polygon, quilting, quiver, riderLeg, roundShield, skullCap, spear, staff, torso } from "../art/kit";
import type { TrainedUnitCard } from "./cards";

// Grove Kin: durable line holders, conventional ranged units, heavy tech.
export const GROVE_UNITS = {
  footman: {
    name: { en: "Footman", zh: "步兵" },
    description: { en: "Front-line melee soldier for early fights and body-blocking fragile units.", zh: "前排近战士兵，用于早期交战并保护脆弱单位。" },
    command: { icon: "△", hotkey: "f" },
    glyph: { silhouette: "shield-triangle", marks: ["shieldBar", "shortSword", "scar"] },
    art: { tier: "basic", bearing: "foot", faction: "grove" },
    paint(b, team) {
      legs(b);
      torso(b, team);
      quilting(b, team);
      belt(b);
      blade(b, [13, -1], [18, -20], 3.4);
      arm(b, [6, -6], [12, 1], team);
      head(b);
      kettleHelm(b);
      roundShield(b, -12, 1, 8, "#9c8058", team);
    },
  },
  archer: {
    name: { en: "Archer", zh: "弓箭手" },
    description: { en: "Light ranged unit. Strong when kept behind melee units, fragile if caught.", zh: "轻型远程单位。站在近战单位后方时很强，被贴身时很脆。" },
    command: { icon: "⋉", hotkey: "a" },
    glyph: { silhouette: "bow-crest", marks: ["bow", "arrow", "satchel"] },
    art: { tier: "basic", bearing: "foot", faction: "grove" },
    paint(b, team) {
      quiver(b);
      legs(b);
      torso(b, team);
      polygon(b, [[-7, -8], [6, -8], [8, 5], [-8, 5]], LEATHER, INK, 0.9);
      belt(b);
      arm(b, [6, -6], [12, -2], team);
      head(b);
      hood(b, darker(team, 0.18));
      bow(b, 15, -3, 17);
    },
  },
  raider: {
    name: { en: "Raider", zh: "掠袭者" },
    description: { en: "Fast melee harasser for chasing workers and punishing isolated targets.", zh: "高速近战骚扰单位，用于追击农民并惩罚落单目标。" },
    command: { icon: "◇", hotkey: "r" },
    glyph: { silhouette: "raider-kite", marks: ["reins", "spur", "shortSword"] },
    art: { tier: "basic", bearing: "mounted", faction: "grove" },
    paint(b, team) {
      ellipse(b, 2, 17, 22, 5.5, "#30483630");
      horse(b, "#9a7651", 0.92);
      polygon(b, [[-8, -3], [6, -5], [8, 5], [-8, 6]], team, INK, 1);
      b.translate(-2, -9);
      riderLeg(b);
      polygon(b, [[-7, -9], [6, -9], [9, 6], [-9, 6]], LEATHER, INK, 1.2);
      line(b, [[-8, 1], [8, 1]], team, 2.2);
      b.beginPath(); b.moveTo(-6, -11); b.bezierCurveTo(-14, -12, -18, -6, -25, -9); b.lineTo(-22, -4); b.bezierCurveTo(-16, -3, -12, -7, -5, -6); b.closePath();
      b.fillStyle = team; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
      head(b);
      hood(b, darker(team, 0.2));
      b.beginPath(); b.moveTo(12, -1); b.quadraticCurveTo(22, -12, 18, -27); b.quadraticCurveTo(20, -13, 14, 0); b.closePath();
      b.fillStyle = "#d6ded0"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
      arm(b, [5, -6], [12, 0], LEATHER);
    },
  },
  lancer: {
    name: { en: "Lancer", zh: "长枪兵" },
    description: { en: "Reach melee fighter with a slightly longer attack range than ordinary infantry.", zh: "长柄近战单位，攻击距离比普通步兵稍长。" },
    command: { icon: "↗", hotkey: "l" },
    glyph: { silhouette: "lancer-pennant", marks: ["longSpear", "flag", "shieldBar"] },
    art: { tier: "basic", bearing: "foot", faction: "grove" },
    paint(b, team) {
      legs(b, "brace");
      torso(b, team, 10);
      quilting(b, team);
      belt(b);
      spear(b, [11, 18], [17, -47], 9);
      pennant(b, 16.5, -37, team, 0.7);
      arm(b, [6, -6], [14, -3], team);
      arm(b, [-5, -6], [13.5, -13], darker(team, 0.1));
      head(b);
      skullCap(b);
    },
  },
  groveWarden: {
    name: { en: "Grove Warden", zh: "林地守卫" },
    description: { en: "Durable grove infantry that holds the line better than basic soldiers.", zh: "耐久的林地步兵，比基础士兵更适合顶线。" },
    command: { icon: "◭", hotkey: "v" },
    glyph: { silhouette: "shield-triangle", marks: ["shieldBar", "halo", "longSpear"] },
    art: { tier: "basic", bearing: "foot", faction: "grove" },
    paint(b, team) {
      legs(b);
      torso(b, team);
      polygon(b, [[-7, -8], [6, -8], [8, 3], [-8, 3]], LEATHER, INK, 0.9);
      belt(b);
      spear(b, [16, 16], [18, -33], 7);
      arm(b, [6, -6], [16, 0], team);
      head(b);
      kettleHelm(b);
      leafMark(b, -1, -29, 4.5);
      kiteShield(b, -12, 0, 12, 22, team, LINEN);
      leafMark(b, -12, -1, 4.2, "#b7cf94");
    },
  },
  knight: {
    name: { en: "Knight", zh: "骑士" },
    description: { en: "Heavy cavalry for decisive fights and base pressure. Heavy armor: takes 50% damage from shooters and casters, 70% from towers.", zh: "重骑兵，用于决定性会战和基地压制。重甲：受到射手和法师攻击的伤害为 50%，防御塔为 70%。" },
    command: { icon: "♜", hotkey: "k" },
    glyph: { silhouette: "knight-helm", marks: ["visor", "towerShield", "shortSword"] },
    art: { tier: "elite", bearing: "mounted", faction: "grove" },
    paint(b, team) {
      ellipse(b, 2, 20, 29, 7, "#30483638");
      horse(b, "#d4cfbb", 1.13, { cloth: team, trim: GOLD });
      b.translate(-3, -12);
      capeBehind(b, team);
      riderLeg(b, STEEL_DARK);
      polygon(b, [[-8, -9], [7, -9], [10, 7], [-10, 7]], STEEL, INK, 1.3);
      polygon(b, [[-8, -8], [-1, -7], [-3, 6], [-10, 6]], "#5c6f6533", "transparent", 0);
      line(b, [[-9, 1], [9, 1]], GOLD, 1.8);
      polygon(b, [[3, -10], [10, -8], [11, -2], [4, -3]], STEEL, INK, 1.1);
      spear(b, [-8, 4], [37, -35], 7, "#6e5940");
      pennant(b, 30.5, -28.5, team, 0.62);
      arm(b, [5, -5], [7, -2], STEEL, STEEL_DARK);
      plumedHelm(b, lighter(team, 0.15));
      polygon(b, [[-18, -6], [-7, -9], [-6, 6], [-11.5, 13], [-18, 7]], team, INK, 1.3);
      polygon(b, [[-16, -4], [-12, 2], [-8, -6]], "transparent", GOLD, 1.6);
      ellipse(b, -12, 2, 2, 2, GOLD);
    },
  },
  priest: {
    name: { en: "Priest", zh: "牧师" },
    description: { en: "Support caster with a targeted heal for wounded allies.", zh: "支援施法者，可以对受伤友军进行定点治疗。" },
    command: { icon: "+", hotkey: "p" },
    glyph: { silhouette: "priest-medallion", marks: ["halo", "cross", "satchel"] },
    art: { tier: "advanced", bearing: "foot", faction: "grove" },
    paint(b, team) {
      torso(b, LINEN, 15, 2);
      polygon(b, [[-4, -9], [-1, -9], [-2, 15], [-5, 15]], team, "transparent", 0);
      polygon(b, [[2, -9], [5, -9], [6, 15], [3, 15]], team, "transparent", 0);
      hemTrim(b, 15, 2);
      belt(b, "#b89c63");
      staff(b, 16, -27);
      line(b, [[11, -27], [21, -27]], GOLD, 2);
      leafMark(b, 16, -32, 4.5, "#d9c882");
      arm(b, [6, -6], [15, 0], LINEN);
      head(b);
      halo(b, -26);
    },
  },
  summoner: {
    name: { en: "Summoner", zh: "召唤师" },
    description: { en: "Caster that creates a temporary spirit at a target point.", zh: "施法者，可以在目标点召唤临时灵体。" },
    command: { icon: "◎", hotkey: "u" },
    glyph: { silhouette: "summoner-ring", marks: ["outerRing", "innerSigil", "spark"] },
    art: { tier: "advanced", bearing: "foot", faction: "grove" },
    paint(b, team) {
      b.beginPath(); b.ellipse(1, 14, 18, 5, 0, 0, Math.PI * 2); b.strokeStyle = "#8fcaae"; b.lineWidth = 1.4; b.setLineDash([3, 3]); b.stroke(); b.setLineDash([]);
      torso(b, team, 15, 2);
      hemTrim(b, 15, 2);
      line(b, [[-1, -9], [0, 15]], GOLD, 1.3);
      belt(b, darker(team, 0.35), GOLD);
      staff(b, 16, -24);
      b.beginPath(); b.arc(16, -30, 6, 0, Math.PI * 2); b.strokeStyle = GOLD; b.lineWidth = 1.8; b.stroke();
      ellipse(b, 16, -30, 3.2, 3.2, "#c7e6b0", INK);
      arm(b, [6, -6], [15, 0], team);
      head(b);
      hood(b, darker(team, 0.25));
      line(b, [[-9, -19], [-3, -25]], GOLD, 1.2);
    },
  },
  witch: {
    name: { en: "Witch", zh: "女巫" },
    description: { en: "Debuff caster that weakens enemy damage through curse.", zh: "减益施法者，通过诅咒削弱敌方伤害。" },
    command: { icon: "☾", hotkey: "c" },
    glyph: { silhouette: "witch-crescent", marks: ["crescent", "curseSlash", "spark"] },
    art: { tier: "advanced", bearing: "foot", faction: "grove" },
    paint(b, team) {
      torso(b, darker(team, 0.2), 15, 2);
      hemTrim(b, 15, 2);
      belt(b, "#3f3441", GOLD);
      staff(b, 16, -24, 16, "#5b4a3a");
      b.beginPath(); b.arc(16, -29, 6, Math.PI * 0.35, Math.PI * 1.65); b.arc(18, -29, 4.6, Math.PI * 1.6, Math.PI * 0.4, true); b.closePath();
      b.fillStyle = "#ece0a6"; b.fill(); b.strokeStyle = INK; b.lineWidth = 1; b.stroke();
      arm(b, [6, -6], [15, 0], darker(team, 0.2));
      head(b);
      pointedHat(b, darker(team, 0.08));
      line(b, [[-5, -4], [0, 1], [-3, 5]], "#9b5a8c", 1.3);
    },
  },
  golem: {
    name: { en: "Golem", zh: "魔像" },
    description: { en: "Slow heavy siege body with high health and strong melee damage. Heavy armor: takes 50% damage from shooters and casters, 70% from towers.", zh: "缓慢的重型攻坚单位，生命值高，近战伤害强。重甲：受到射手和法师攻击的伤害为 50%，防御塔为 70%。" },
    command: { icon: "▣", hotkey: "g" },
    glyph: { silhouette: "golem-block", marks: ["rune", "blockSeams", "scar"] },
    art: { tier: "elite", bearing: "construct", faction: "grove" },
    paint(b, team) {
      ellipse(b, 1, 16, 23, 6.5, "#30483638");
      polygon(b, [[-14, 0], [-4, 0], [-5, 17], [-16, 17]], "#838f7c");
      polygon(b, [[5, 0], [15, 0], [17, 17], [5, 17]], "#bac1a3");
      polygon(b, [[-19, -15], [-8, -23], [13, -20], [20, 2], [1, 9], [-18, 0]], "#9ca990");
      polygon(b, [[-8, -23], [13, -20], [7, -9], [-11, -10]], "#d1d2b1");
      polygon(b, [[-25, -10], [-15, -13], [-13, 7], [-23, 8]], "#818d77");
      polygon(b, [[16, -11], [26, -6], [24, 10], [16, 7]], "#b5bca0");
      line(b, [[-23, -8], [-16, -10]], GOLD, 1.8);
      line(b, [[17, -9], [25, -5]], GOLD, 1.8);
      ellipse(b, 0, -2, 5.5, 5.5, "#6a7c68", INK);
      polygon(b, [[0, -6.5], [4, -2], [0, 2.5], [-4, -2]], EMBER_GLOW, darker(team, 0.1), 1);
      line(b, [[-6, -15], [4, -15]], team, 2.4);
      ellipse(b, -3, -18, 1.4, 1.4, EMBER_GLOW); ellipse(b, 5, -17, 1.4, 1.4, EMBER_GLOW);
      polygon(b, [[-12, -21], [-6, -26], [0, -22], [-8, -20]], MOSS, "transparent", 0);
    },
  },
} satisfies Partial<Record<TrainableUnitKind, TrainedUnitCard>>;
