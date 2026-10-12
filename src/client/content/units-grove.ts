import type { TrainableUnitKind } from "../../shared/types";
import type { TrainedUnitCard } from "./cards";

export const GROVE_UNITS = {
  footman: {
    name: { en: "Footman", zh: "步兵" },
    description: { en: "Front-line melee soldier for early fights and body-blocking fragile units.", zh: "前排近战士兵，用于早期交战并保护脆弱单位。" },
    command: { icon: "△", hotkey: "f" },
    glyph: { silhouette: "shield-triangle", marks: ["shieldBar", "shortSword", "scar"] },
    art: { tier: "basic", bearing: "foot", faction: "grove" },
  },
  archer: {
    name: { en: "Archer", zh: "弓箭手" },
    description: { en: "A steady ranged firing line behind melee protection. Moving too far forces a fresh aim.", zh: "远程阵线单位，适合在近战保护下持续射击；大幅移动后需要重新瞄准。" },
    command: { icon: "⋉", hotkey: "a" },
    glyph: { silhouette: "bow-crest", marks: ["bow", "arrow", "satchel"] },
    art: { tier: "basic", bearing: "foot", faction: "grove" },
  },
  horseArcher: {
    name: { en: "Horse Archer", zh: "骑射手" },
    description: { en: "Fast mounted skirmisher. Can keep aim while moving farther between shots, trading damage per gold for mobility.", zh: "高速骑射单位，可在更大的位移范围内保留瞄准；用较低的攻价比换取风筝和机动优势。" },
    command: { icon: "⋉", hotkey: "h" },
    glyph: { silhouette: "bow-crest", marks: ["bow", "arrow", "reins"] },
    art: { tier: "advanced", bearing: "mounted", faction: "grove" },
  },
  raider: {
    name: { en: "Raider", zh: "掠袭者" },
    description: { en: "Fast melee harasser for chasing workers and punishing isolated targets.", zh: "高速近战骚扰单位，用于追击农民并惩罚落单目标。" },
    command: { icon: "◇", hotkey: "r" },
    glyph: { silhouette: "raider-kite", marks: ["reins", "spur", "shortSword"] },
    art: { tier: "basic", bearing: "mounted", faction: "grove" },
  },
  lancer: {
    name: { en: "Lancer", zh: "长枪兵" },
    description: { en: "Reach melee fighter with a slightly longer attack range than ordinary infantry.", zh: "长柄近战单位，攻击距离比普通步兵稍长。" },
    command: { icon: "↗", hotkey: "l" },
    glyph: { silhouette: "lancer-pennant", marks: ["longSpear", "flag", "shieldBar"] },
    art: { tier: "basic", bearing: "foot", faction: "grove" },
  },
  knight: {
    name: { en: "Knight", zh: "骑士" },
    description: { en: "Heavy cavalry for decisive fights and base pressure.", zh: "重骑兵，用于决定性会战和基地压制。" },
    command: { icon: "♜", hotkey: "k" },
    glyph: { silhouette: "knight-helm", marks: ["visor", "towerShield", "shortSword"] },
    art: { tier: "elite", bearing: "mounted", faction: "grove" },
  },
  witch: {
    name: { en: "Witch", zh: "女巫" },
    description: { en: "Debuff caster that weakens enemy damage through curse; also damages summoned targets.", zh: "减益施法者，通过诅咒削弱敌方伤害；还能直接伤害被诅咒的召唤物。" },
    command: { icon: "☾", hotkey: "c" },
    glyph: { silhouette: "witch-crescent", marks: ["crescent", "curseSlash", "spark"] },
    art: { tier: "advanced", bearing: "foot", faction: "grove" },
  },
  golem: {
    name: { en: "Golem", zh: "魔像" },
    description: { en: "Slow heavy siege body with high health and strong melee damage.", zh: "缓慢的重型攻坚单位，生命值高，近战伤害强。" },
    command: { icon: "▣", hotkey: "g" },
    glyph: { silhouette: "golem-block", marks: ["rune", "blockSeams", "scar"] },
    art: { tier: "elite", bearing: "construct", faction: "grove" },
  },
} satisfies Partial<Record<TrainableUnitKind, TrainedUnitCard>>;
