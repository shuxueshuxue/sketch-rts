import type { TrainableUnitKind } from "../../shared/types";
import type { TrainedUnitCard } from "./cards";
import { unitPainter } from "../art/painted-units";

export const EMBER_UNITS = {
  ashWarden: {
    name: { en: "Ash Warden", zh: "灰烬守卫" },
    description: { en: "Durable ember infantry that holds the line better than basic soldiers.", zh: "耐久的灰烬步兵，比基础士兵更适合顶线。" },
    command: { icon: "◭", hotkey: "g" },
    glyph: { silhouette: "shield-triangle", marks: ["shieldBar", "halo", "longSpear"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" },
    paint: unitPainter("ashWarden"),
  },

  emberRavager: {
    name: { en: "Ember Ravager", zh: "余烬劫掠者" },
    description: { en: "Aggressive ember infantry with strong close-range damage.", zh: "进攻性的余烬步兵，近距离伤害很强。" },
    command: { icon: "◆", hotkey: "v" },
    glyph: { silhouette: "ember-bruiser", marks: ["shortSword", "spark", "scar"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" },
    paint: unitPainter("emberRavager"),
  },
  cinderRunner: {
    name: { en: "Cinder Runner", zh: "余火奔袭者" },
    description: { en: "Fast ember melee unit for chasing weak targets and forcing fights.", zh: "高速余烬近战单位，用于追击弱目标并强行开战。" },
    command: { icon: "◇", hotkey: "r" },
    glyph: { silhouette: "cinder-skirmisher", marks: ["tail", "spark", "shortSword"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" },
    paint: unitPainter("cinderRunner"),
  },
  sparkArcher: {
    name: { en: "Spark Archer", zh: "火花弓手" },
    description: { en: "Arrows have a 15% chance to ignite a small patch of ground for 6 seconds. Burns clustered enemies and scorches them for allied melee attacks.", zh: "箭矢有 15% 概率点燃一小块地面，持续 6 秒。克制密集站位，灼烧状态可配合友军近战攻击。" },
    command: { icon: "⋊", hotkey: "a" },
    glyph: { silhouette: "bow-crest", marks: ["bow", "arrow", "spark"] },
    art: { tier: "basic", bearing: "foot", faction: "ember" },
    paint: unitPainter("sparkArcher"),
  },
  ashHexer: {
    name: { en: "Ash Hexer", zh: "灰烬巫师" },
    description: { en: "Ember debuff caster that weakens enemy damage through curse.", zh: "余烬减益施法者，通过诅咒削弱敌方伤害。" },
    command: { icon: "☾", hotkey: "x" },
    glyph: { silhouette: "witch-crescent", marks: ["crescent", "curseSlash", "rune"] },
    art: { tier: "advanced", bearing: "foot", faction: "ember" },
    paint: unitPainter("ashHexer"),
  },
  ashChieftain: {
    name: { en: "Ash Chieftain", zh: "灰烬酋长" },
    description: { en: "Ember war leader who hunts casters: deals extra damage to summoned units and casters.", zh: "猎杀法师的余烬首领：对召唤生物和法师造成额外伤害。" },
    command: { icon: "♛", hotkey: "h" },
    glyph: { silhouette: "ember-bruiser", marks: ["visor", "spark", "curseSlash"] },
    art: { tier: "elite", bearing: "foot", faction: "ember" },
    paint: unitPainter("ashChieftain"),
  },
  cinderRevenant: {
    name: { en: "Cinder Revenant", zh: "余烬复生者" },
    description: { en: "Ember elite with modest health that burns its wounds away.", zh: "生命值不高的余烬精英，伤口在余烬中迅速愈合。" },
    command: { icon: "✺", hotkey: "n" },
    glyph: { silhouette: "ember-bruiser", marks: ["spark", "halo", "scar"] },
    art: { tier: "elite", bearing: "foot", faction: "ember" },
    paint: unitPainter("cinderRevenant"),
  },
} satisfies Partial<Record<TrainableUnitKind, TrainedUnitCard>>;
