import { ABILITY_DEFS, POISON_DAMAGE, SLOW_PACE } from '../shared/catalog';
import { areEnemyOwners } from '../shared/sim/command-validation';
import { isInCabin } from '../shared/ship-cabin';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import type { GameSnapshot, Unit, UnitStatusEffect } from '../shared/types';
import { matchesUnitTarget } from '../shared/unit-targeting';
import { isVeteranSkillId, VETERAN_SKILLS, type VeteranModifiers, type VeteranSkillId } from '../shared/veteran-skills';
import type { AbilityIconId } from './ability-icons';

export type StatusPolarity = 'buff' | 'debuff' | 'neutral';
type Locale = 'zh' | 'en';
export type PresentedUnitStatus = {
  key: string;
  type: UnitStatusEffect['type'] | 'aura' | 'lifetime' | 'invulnerable';
  polarity: StatusPolarity;
  icon: AbilityIconId;
  name: string;
  description: string;
  remainingTicks?: number;
  badge: string;
  sourceIds: string[];
};

const STATUS_NAMES: Record<UnitStatusEffect['type'], Record<Locale, string>> = {
  curse: { zh: '诅咒', en: 'Cursed' }, guardian: { zh: '守护', en: 'Guardian' },
  scorch: { zh: '灼烧印记', en: 'Scorched' }, slow: { zh: '减速', en: 'Slowed' },
  stun: { zh: '眩晕', en: 'Stunned' }, root: { zh: '定身', en: 'Rooted' },
  poison: { zh: '中毒', en: 'Poisoned' }, bloodlust: { zh: '嗜血', en: 'Bloodlust' },
  protection: { zh: '心灵之火', en: 'Inner Fire' }, veteranBuff: { zh: '战斗号令', en: 'Rallying Cry' },
};
const STATUS_ORDER: Record<PresentedUnitStatus['type'], number> = {
  stun: 0, root: 1, slow: 2, curse: 3, poison: 4, scorch: 5,
  guardian: 6, invulnerable: 7, protection: 8, bloodlust: 9, veteranBuff: 10, aura: 11, lifetime: 12,
};

/** Shared with battlefield presentation; cooldowns are not active statuses. */
export function activeUnitStatusEffects(unit: Pick<Unit, 'hp' | 'effects'>): UnitStatusEffect[] {
  return unit.hp > 0 ? unit.effects.filter(effect => Number.isFinite(effect.remaining) && effect.remaining > 0) : [];
}

function effectKey(effect: UnitStatusEffect) {
  return effect.type === 'bloodlust' || effect.type === 'veteranBuff' ? 'temporaryAttackSpeed'
    : effect.type === 'protection' ? `protection:${JSON.stringify(effect.damageFilter ?? {})}` : effect.type;
}

/** HUD and battlefield signs follow the same non-stacking temporary layers. */
export function effectiveUnitStatusEffects(unit: Pick<Unit, 'hp' | 'effects'>): UnitStatusEffect[] {
  const picked = new Map<string, UnitStatusEffect>();
  const bloodlust = ABILITY_DEFS.bloodlust;
  const speed = (effect: UnitStatusEffect) => effect.type === 'bloodlust' && bloodlust.behavior === 'bloodlust' ? bloodlust.attackSpeed : effect.attackSpeedMultiplier ?? 1;
  for (const effect of activeUnitStatusEffects(unit)) {
    if ((effect.type === 'protection' && !((effect.damageReduction ?? 0) > 0)) || (effect.type === 'veteranBuff' && !(speed(effect) > 1))) continue;
    const key = effectKey(effect);
    const old = picked.get(key);
    const strength = (status: UnitStatusEffect) => key === 'temporaryAttackSpeed' ? speed(status) : status.type === 'protection' ? status.damageReduction ?? 0 : status.type === 'curse' ? 1 - (status.damageMultiplier ?? .4) : 1;
    if (!old || strength(effect) > strength(old) || strength(effect) === strength(old) && effect.remaining > old.remaining) picked.set(key, effect);
  }
  return [...picked.values()];
}

export function unitStatusPolarity(effect: UnitStatusEffect): 'buff' | 'debuff' {
  return effect.type === 'guardian' || effect.type === 'bloodlust' || effect.type === 'protection' || effect.type === 'veteranBuff' ? 'buff' : 'debuff';
}

export function unitStatusIcon(effect: UnitStatusEffect): AbilityIconId {
  switch (effect.type) {
    case 'curse': return effect.damageMultiplier === .45 || effect.damageMultiplier === .3 ? 'ashCurse' : 'curse';
    case 'guardian': return 'guardianScroll';
    case 'scorch': return 'incendiaryFlume';
    case 'slow': return 'statusSlow';
    case 'stun': return 'statusStun';
    case 'root': return 'web';
    case 'poison': return 'statusPoison';
    case 'bloodlust': return 'bloodlust';
    case 'protection': return 'veteranInnerFire';
    case 'veteranBuff': return 'veteranRally';
  }
}

/** A live fraction never reads 0; short crowd control retains tenths of a second. */
export function statusDurationBadge(ticks: number): string {
  const seconds = ticks / SIM_TICKS_PER_SECOND;
  if (!(seconds > 0) || !Number.isFinite(seconds)) return '';
  if (seconds < 3) return `${Math.ceil(seconds * 10) / 10}s`;
  const rounded = Math.ceil(seconds);
  return rounded >= 60 ? `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}` : `${rounded}s`;
}

function percent(value: number) { return `${Math.round(value * 100)}%`; }

function effectDescription(effect: UnitStatusEffect, locale: Locale): string {
  const zh = locale === 'zh';
  switch (effect.type) {
    case 'curse': return zh ? `造成的伤害降低 ${percent(1 - (effect.damageMultiplier ?? .4))}。` : `Deal ${percent(1 - (effect.damageMultiplier ?? .4))} less damage.`;
    case 'guardian': return zh ? '免疫伤害；被挡住的攻击不会附加命中状态。' : 'Immune to damage. Blocked hits cannot apply on-hit statuses.';
    case 'scorch': return zh ? '余烬近战单位对其造成额外伤害；灰烬诅咒的削弱进一步增强。印记本身不持续扣血。' : 'Ember melee troops deal additional damage to this target, and Ash Curse becomes stronger. The mark itself does not deal damage over time.';
    case 'slow': return zh ? `移动速度降低 ${percent(1 - SLOW_PACE)}。` : `Movement speed reduced by ${percent(1 - SLOW_PACE)}.`;
    case 'stun': return zh ? '无法移动、攻击或施放技能。' : 'Cannot move, attack or cast abilities.';
    case 'root': return zh ? '无法移动，仍可攻击。' : 'Cannot move; can still attack.';
    case 'poison': return zh ? `每秒受到 ${POISON_DAMAGE} 点毒性伤害。再次中毒刷新持续时间。` : `Take ${POISON_DAMAGE} poison damage per second. Another bite refreshes the duration.`;
    case 'bloodlust': {
      const def = ABILITY_DEFS.bloodlust;
      const speed = def.behavior === 'bloodlust' ? def.attackSpeed : 1;
      return zh ? `攻击速度提高 ${percent(speed - 1)}；短时攻速增益只取最强。` : `Attack speed increased by ${percent(speed - 1)}. Only the strongest temporary attack-speed buff applies.`;
    }
    case 'protection': return zh ? `受到的${effect.damageFilter ? '匹配类型' : ''}伤害降低 ${percent(effect.damageReduction ?? 0)}；短时防护只取最强。` : `Take ${percent(effect.damageReduction ?? 0)} less ${effect.damageFilter ? 'matching ' : ''}damage. Only the strongest temporary ward applies.`;
    case 'veteranBuff': return zh ? `攻击速度提高 ${percent((effect.attackSpeedMultiplier ?? 1) - 1)}；短时攻速增益只取最强。` : `Attack speed increased by ${percent((effect.attackSpeedMultiplier ?? 1) - 1)}. Only the strongest temporary attack-speed buff applies.`;
  }
}

/** Query one focused unit, or provide a spatial list of potential aura sources. */
export function activeVeteranAuraSources(snapshot: GameSnapshot, unit: Unit, sources: Iterable<Unit> = snapshot.units): { source: Unit; skill: VeteranSkillId; modifiers: VeteranModifiers }[] {
  if (unit.hp <= 0 || isInCabin(unit)) return [];
  const candidates: { source: Unit; skill: VeteranSkillId; modifiers: VeteranModifiers }[] = [];
  for (const source of sources) {
    if (source.hp <= 0 || isInCabin(source) || !isVeteranSkillId(source.veteranSkill) || areEnemyOwners(snapshot, source.owner, unit.owner)) continue;
    const effect = VETERAN_SKILLS[source.veteranSkill].effect;
    if (effect.type !== 'aura' || (source.x - unit.x) ** 2 + (source.y - unit.y) ** 2 > effect.radius ** 2 || !matchesUnitTarget(unit, effect.targets, snapshot)) continue;
    candidates.push({ source, skill: source.veteranSkill, modifiers: effect.modifiers });
  }
  // One protection/pace/recovery aura per modifier, as in buildVeteranFrame.
  const strongest = new Map<keyof VeteranModifiers, typeof candidates[number]>();
  for (const candidate of candidates) for (const key of Object.keys(candidate.modifiers) as (keyof VeteranModifiers)[]) {
    const old = strongest.get(key);
    if (!old || (candidate.modifiers[key] ?? 0) > (old.modifiers[key] ?? 0)) strongest.set(key, candidate);
  }
  return [...new Set(strongest.values())];
}

/** Read-only UI projection: no stats, effects, cooldowns or save data are changed. */
export function presentUnitStatuses(snapshot: GameSnapshot, unit: Unit, locale: Locale = 'zh'): PresentedUnitStatus[] {
  if (unit.hp <= 0) return [];
  const result: PresentedUnitStatus[] = [];
  const effects = effectiveUnitStatusEffects(unit);
  for (const effect of effects) result.push({
    key: effectKey(effect), type: effect.type, polarity: unitStatusPolarity(effect), icon: unitStatusIcon(effect),
    name: STATUS_NAMES[effect.type][locale], description: effectDescription(effect, locale),
    remainingTicks: effect.remaining, badge: statusDurationBadge(effect.remaining), sourceIds: effect.sourceId ? [effect.sourceId] : [],
  });
  if (unit.invulnerable && !effects.some(effect => effect.type === 'guardian')) result.push({ key: 'invulnerable', type: 'invulnerable', polarity: 'buff', icon: 'guardianScroll', name: locale === 'zh' ? '无敌' : 'Invulnerable', description: locale === 'zh' ? '当前免疫伤害。' : 'Currently immune to damage.', badge: '', sourceIds: [] });
  for (const { source, skill } of activeVeteranAuraSources(snapshot, unit)) {
    const definition = VETERAN_SKILLS[skill];
    result.push({ key: `aura:${skill}`, type: 'aura', polarity: 'buff', icon: skill,
      name: definition.name[locale], description: definition.description[locale], badge: '∞', sourceIds: [source.id] });
  }
  if (unit.expiresTick !== undefined && unit.expiresTick > snapshot.tick) result.push({ key: 'lifetime', type: 'lifetime', polarity: 'neutral', icon: snapshot.players[unit.owner]?.race === 'ember' ? 'cinderSoul' : 'summon', name: locale === 'zh' ? '召唤时限' : 'Summon lifetime', description: locale === 'zh' ? '召唤物会在倒计时结束后消失。' : 'This summon disappears when the countdown ends.', remainingTicks: unit.expiresTick - snapshot.tick, badge: statusDurationBadge(unit.expiresTick - snapshot.tick), sourceIds: [] });
  return result.sort((a, b) => STATUS_ORDER[a.type] - STATUS_ORDER[b.type] || a.key.localeCompare(b.key));
}
