import { seconds } from "./time";
import type { UnitKind } from "./types";
import type { UnitClass, UnitTargetFilter } from "./unit-targeting";

export const VETERAN_ACTIVE_SKILL_IDS = ["veteranRally", "veteranHealingWave", "veteranInnerFire"] as const;
export type VeteranActiveSkillId = typeof VETERAN_ACTIVE_SKILL_IDS[number];
export type VeteranSkillId = VeteranActiveSkillId
  | "veteranResilience" | "veteranMobility" | "veteranCommand" | "veteranVigilance"
  | "veteranPhalanx" | "veteranSteadyAim" | "veteranMarch" | "veteranRenewal"
  | "veteranSiegeDrill" | "veteranEndurance";

/** Rates are per second; multiplier 1 means unchanged; reduction .12 means 12% less damage. */
export type VeteranModifiers = {
  damageReduction?: number;
  regenPerSecond?: number;
  moveSpeedMultiplier?: number;
  attackSpeedMultiplier?: number;
  aimSpeedMultiplier?: number;
  attackRangeMultiplier?: number;
};

export type VeteranSkillEffect = { targets?: UnitTargetFilter } & (
  | { type: "passive"; modifiers: VeteranModifiers }
  | { type: "aura"; radius: number; modifiers: VeteranModifiers }
  | { type: "active"; action: "heal"; radius: number; maxTargets: number; cooldown: number; healAmount: number }
  | { type: "active"; action: "buff"; radius: number; maxTargets: number; cooldown: number; duration: number; modifiers: VeteranModifiers });

export type VeteranSkillDef = {
  id: VeteranSkillId;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  icon: string;
  pool: "common" | "specialist";
  effect: VeteranSkillEffect;
};

/** A shared catalog: simulation, command cards and descriptions use the same numerical rules. */
export const VETERAN_SKILLS: Record<VeteranSkillId, VeteranSkillDef> = {
  veteranResilience: {
    id: "veteranResilience", name: { zh: "百战之躯", en: "Battle Hardened" }, icon: "◆", pool: "common",
    description: { zh: "被动：自身受到的伤害降低 12%。", en: "Passive: take 12% less damage." },
    effect: { type: "passive", modifiers: { damageReduction: .12 } },
  },
  veteranMobility: {
    id: "veteranMobility", name: { zh: "迅捷行动", en: "Swift Movement" }, icon: "➤", pool: "common",
    description: { zh: "被动：自身移动速度提高 10%。", en: "Passive: gain 10% movement speed." },
    effect: { type: "passive", modifiers: { moveSpeedMultiplier: 1.1 } },
  },
  veteranCommand: {
    id: "veteranCommand", name: { zh: "协同作战", en: "Coordinated Assault" }, icon: "⚑", pool: "common",
    description: { zh: "光环：160 范围内友军（含自身）攻击速度提高 8%；同类光环不叠加。", en: "Aura: allies within 160, including self, gain 8% attack speed. Identical auras do not stack." },
    effect: { type: "aura", radius: 160, modifiers: { attackSpeedMultiplier: 1.08 } },
  },
  veteranVigilance: {
    id: "veteranVigilance", name: { zh: "警戒互助", en: "Watchful Company" }, icon: "◇", pool: "common",
    description: { zh: "光环：160 范围内友军（含自身）受到的伤害降低 8%；防护光环只取最强。", en: "Aura: allies within 160, including self, take 8% less damage. Only the strongest protection aura applies." },
    effect: { type: "aura", radius: 160, modifiers: { damageReduction: .08 } },
  },
  veteranRally: {
    id: "veteranRally", name: { zh: "战斗号令", en: "Rallying Cry" }, icon: "⚑", pool: "common",
    description: { zh: "主动／自动施放：160 范围内至多 5 名友军攻击速度提高 20%，持续 6 秒；冷却 24 秒。", en: "Active / autocast: up to 5 allies within 160 gain 20% attack speed for 6 seconds. Cooldown: 24 seconds." },
    effect: { type: "active", action: "buff", radius: 160, maxTargets: 5, cooldown: seconds(24), duration: seconds(6), modifiers: { attackSpeedMultiplier: 1.2 } },
  },
  veteranPhalanx: {
    id: "veteranPhalanx", name: { zh: "坚守阵线", en: "Hold the Line" }, icon: "▣", pool: "specialist",
    description: { zh: "光环：130 范围内友军（含自身）受到的伤害降低 12%；防护光环只取最强。", en: "Aura: allies within 130, including self, take 12% less damage. Only the strongest protection aura applies." },
    effect: { type: "aura", radius: 130, modifiers: { damageReduction: .12 } },
  },
  veteranSteadyAim: {
    id: "veteranSteadyAim", name: { zh: "沉着瞄准", en: "Steady Aim" }, icon: "◎", pool: "specialist",
    description: { zh: "被动：自身瞄准速度提高 30%；移动仍遵守原有瞄准限制。", en: "Passive: gain 30% aiming speed. Movement retains its normal effect on aim." },
    effect: { type: "passive", modifiers: { aimSpeedMultiplier: 1.3 } },
  },
  veteranMarch: {
    id: "veteranMarch", name: { zh: "行军领队", en: "March Leader" }, icon: "»", pool: "specialist",
    description: { zh: "光环：160 范围内友军（含自身）移动速度提高 10%；同类光环不叠加。", en: "Aura: allies within 160, including self, gain 10% movement speed. Identical auras do not stack." },
    effect: { type: "aura", radius: 160, modifiers: { moveSpeedMultiplier: 1.1 } },
  },
  veteranHealingWave: {
    id: "veteranHealingWave", name: { zh: "群体恢复", en: "Restoring Wave" }, icon: "✚", pool: "specialist",
    description: { zh: "主动／自动施放：恢复 180 范围内至多 5 名友军各 30 点生命，优先伤者；冷却 24 秒。不作用于机械单位。", en: "Active / autocast: heal up to 5 allies within 180 for 30 health each, prioritizing wounded units. Cooldown: 24 seconds. Does not affect mechanical units." },
    effect: { type: "active", action: "heal", targets: { unitClasses: ["nonMechanical"] }, radius: 180, maxTargets: 5, cooldown: seconds(24), healAmount: 30 },
  },
  veteranInnerFire: {
    id: "veteranInnerFire", name: { zh: "心灵之火", en: "Inner Fire" }, icon: "✦", pool: "specialist",
    description: { zh: "主动／自动施放：180 范围内至多 5 名友军受到的伤害降低 20%，持续 6 秒；冷却 24 秒。短时防护只取最强。", en: "Active / autocast: up to 5 allies within 180 take 20% less damage for 6 seconds. Cooldown: 24 seconds. Only the strongest temporary ward applies." },
    effect: { type: "active", action: "buff", radius: 180, maxTargets: 5, cooldown: seconds(24), duration: seconds(6), modifiers: { damageReduction: .2 } },
  },
  veteranRenewal: {
    id: "veteranRenewal", name: { zh: "休养庇护", en: "Renewing Presence" }, icon: "❋", pool: "specialist",
    description: { zh: "光环：150 范围内友军（含自身）每秒恢复 1.2 点生命；同类光环不叠加，不作用于机械单位。", en: "Aura: allies within 150, including self, restore 1.2 health per second. Identical auras do not stack. Does not affect mechanical units." },
    effect: { type: "aura", targets: { unitClasses: ["nonMechanical"] }, radius: 150, modifiers: { regenPerSecond: 1.2 } },
  },
  veteranSiegeDrill: {
    id: "veteranSiegeDrill", name: { zh: "测距训练", en: "Rangefinding" }, icon: "⌖", pool: "specialist",
    description: { zh: "被动：自身攻击射程提高 10%；最小射程保持不变。", en: "Passive: gain 10% attack range. Minimum range is unchanged." },
    effect: { type: "passive", modifiers: { attackRangeMultiplier: 1.1 } },
  },
  veteranEndurance: {
    id: "veteranEndurance", name: { zh: "坚韧恢复", en: "Enduring Recovery" }, icon: "♥", pool: "specialist",
    description: { zh: "被动：非机械单位自身每秒恢复 3 点生命。", en: "Passive: non-mechanical units restore 3 health per second." },
    effect: { type: "passive", targets: { unitClasses: ["nonMechanical"] }, modifiers: { regenPerSecond: 3 } },
  },
};

export const VETERAN_COMMON_SKILL_IDS: readonly VeteranSkillId[] = [
  "veteranResilience", "veteranMobility", "veteranCommand", "veteranVigilance", "veteranRally",
];

/** Explicit many-to-many eligibility. An absent row receives three common choices. */
export const VETERAN_SPECIALIST_SKILLS: Partial<Record<UnitKind, readonly VeteranSkillId[]>> = {
  footman: ["veteranPhalanx", "veteranEndurance"],
  lancer: ["veteranPhalanx", "veteranEndurance"],
  ashWarden: ["veteranPhalanx", "veteranEndurance"],
  emberRavager: ["veteranMarch", "veteranEndurance"],
  cinderRunner: ["veteranMarch"],
  archer: ["veteranSteadyAim"],
  sparkArcher: ["veteranSteadyAim"],
  horseArcher: ["veteranSteadyAim", "veteranMarch"],
  raider: ["veteranMarch", "veteranEndurance"],
  knight: ["veteranPhalanx", "veteranMarch", "veteranEndurance"],
  golem: ["veteranPhalanx", "veteranMarch"],
  ashChieftain: ["veteranPhalanx", "veteranEndurance"],
  cinderRevenant: ["veteranPhalanx", "veteranEndurance"],
  priest: ["veteranHealingWave", "veteranInnerFire", "veteranRenewal"],
  emberAcolyte: ["veteranHealingWave", "veteranInnerFire", "veteranRenewal"],
  summoner: ["veteranInnerFire", "veteranRenewal"],
  pyreCaller: ["veteranInnerFire", "veteranRenewal"],
  witch: ["veteranInnerFire", "veteranRenewal"],
  ashHexer: ["veteranInnerFire", "veteranRenewal"],
  mercenary: ["veteranPhalanx", "veteranMarch", "veteranEndurance"],
  contractArcher: ["veteranSteadyAim"],
  fieldMedic: ["veteranHealingWave", "veteranInnerFire", "veteranRenewal"],
  ballista: ["veteranSiegeDrill"],
  catapult: ["veteranSiegeDrill"],
  organGun: ["veteranSiegeDrill"],
  siegeRam: ["veteranPhalanx", "veteranMarch"],
  warship: ["veteranSiegeDrill"],
  bombardShip: ["veteranSiegeDrill"],
  fireShip: ["veteranSiegeDrill"],
  cutter: ["veteranSteadyAim", "veteranMarch"],
  wildling: ["veteranMarch"],
  mossGnawer: ["veteranMarch"],
  thornSlinger: ["veteranSteadyAim"],
  barkMender: ["veteranHealingWave", "veteranInnerFire", "veteranRenewal"],
  stonebackBrute: ["veteranPhalanx", "veteranEndurance"],
  gladeWitch: ["veteranInnerFire", "veteranRenewal"],
  ancientStag: ["veteranMarch", "veteranEndurance"],
  murlocHunter: ["veteranSteadyAim"],
  tidePriest: ["veteranHealingWave", "veteranInnerFire", "veteranRenewal"],
  deepSnapper: ["veteranPhalanx", "veteranEndurance"],
  rubbleGolem: ["veteranPhalanx", "veteranMarch"],
  rockGolem: ["veteranPhalanx", "veteranMarch"],
  graniteGolem: ["veteranPhalanx", "veteranMarch"],
  ogreWarrior: ["veteranPhalanx", "veteranEndurance"],
  ogreMage: ["veteranInnerFire", "veteranRenewal"],
  ogreLord: ["veteranPhalanx", "veteranEndurance"],
  spiderling: ["veteranMarch"],
  venomSpider: ["veteranMarch"],
  spiderQueen: ["veteranMarch", "veteranEndurance"],
  dragonWhelp: ["veteranSteadyAim", "veteranMarch"],
  redDragon: ["veteranSteadyAim", "veteranMarch"],
};

export function isVeteranSkillId(value: unknown): value is VeteranSkillId {
  return typeof value === "string" && Object.hasOwn(VETERAN_SKILLS, value);
}

export function isVeteranActiveSkillId(value: unknown): value is VeteranActiveSkillId {
  return isVeteranSkillId(value) && VETERAN_SKILLS[value].effect.type === "active";
}

/** A support skill may benefit other unit classes; only personal passives require the learner to qualify. */
export function veteranSkillFitsUnitClass(skill: VeteranSkillId, unitClass: UnitClass): boolean {
  const effect = VETERAN_SKILLS[skill].effect;
  return effect.type !== "passive" || !effect.targets?.unitClasses || effect.targets.unitClasses.includes(unitClass);
}

/** No global RNG: unrelated births, commands and drawing the panel cannot advance this stream. */
export function rollVeteranSkillChoices(kind: UnitKind, unitId: string, seed: string | number = 0, unitClass?: UnitClass): [VeteranSkillId, VeteranSkillId, VeteranSkillId] {
  let state = 2166136261;
  // JSON retains component boundaries, including unusual IDs containing separators.
  const key = JSON.stringify(["veteran-skills-v1", seed, unitId, kind]);
  for (let index = 0; index < key.length; index += 1) state = Math.imul(state ^ key.charCodeAt(index), 16777619) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const shuffled = (values: readonly VeteranSkillId[]) => {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [result[index], result[other]] = [result[other]!, result[index]!];
    }
    return result;
  };
  const specialist = (VETERAN_SPECIALIST_SKILLS[kind] ?? []).filter(skill => unitClass === undefined || veteranSkillFitsUnitClass(skill, unitClass));
  const specialistCount = specialist.length === 0 ? 0 : Math.min(specialist.length, random() < .5 ? 1 : 2);
  // Common slots come first, so users can compare the general alternatives in a stable position.
  const choices = [
    ...shuffled(VETERAN_COMMON_SKILL_IDS).slice(0, 3 - specialistCount),
    ...shuffled(specialist).slice(0, specialistCount),
  ];
  return [choices[0]!, choices[1]!, choices[2]!];
}
