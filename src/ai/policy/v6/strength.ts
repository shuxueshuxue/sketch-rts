import { ABILITY_DEFS, UNIT_DEFS } from "../../../shared/catalog";
import type { Unit } from "../../../shared/types";

// @@@v6-strength - One strength currency for every V6 decision (attack, retreat, defend, creep, raid): a unit is worth its
// price in hundreds of gold, scaled by the health it has left and its veterancy stars. Creeps and spirits have no price, so
// they are rated by hit points times damage per second against a footman's. Casters are rated by their own fighting, not
// their price: a summoner's worth is its spirits, and those are counted as units of their own.
//
// A tower has no armor: 200 hit points and 16 damage every 1.5s at range 480. By the same hit points times damage rating
// that is one footman, and it costs 125; its reach over the shooters' 399 is worth a little more. The first version
// counted 2.5 and marched V6 into fights "its towers would win" that its towers never reached.
export const TOWER_STRENGTH = 1.3;
const CASTER_STRENGTH: Partial<Record<Unit["kind"], number>> = { summoner: 0.6, pyreCaller: 0.6, priest: 0.8, emberAcolyte: 0.8, fieldMedic: 0.9, witch: 0.9, ashHexer: 0.9 };
const FOOTMAN_RATING = Math.sqrt(UNIT_DEFS.footman.hp * (UNIT_DEFS.footman.attackDamage / (UNIT_DEFS.footman.attackCooldown / 20)));

// A fighter's worth by its own hit points and damage (a footman is 1), whatever it cost; casters as in unitStrength. What a
// camp's creeps answer to: by price an ember ravager is 1.2 footmen, by hit points and damage 0.95 (see v7-creep-force).
export function combatRating(unit: Unit) {
  if (unit.kind === "worker") return 0;
  const base = CASTER_STRENGTH[unit.kind] ?? Math.sqrt(unit.maxHp * (unit.attackDamage / Math.max(1, unit.attackCooldown / 20))) / FOOTMAN_RATING;
  return base * Math.max(0.1, unit.hp / Math.max(1, unit.maxHp)) * (1 + 0.15 * unit.level);
}

export function unitStrength(unit: Unit) {
  if (unit.kind === "worker") return 0;
  const cost = UNIT_DEFS[unit.kind].cost;
  const base = CASTER_STRENGTH[unit.kind] ?? (cost > 0 ? cost / 100 : undefined) ?? Math.sqrt(unit.maxHp * (unit.attackDamage / Math.max(1, unit.attackCooldown / 20))) / FOOTMAN_RATING;
  return base * Math.max(0.1, unit.hp / Math.max(1, unit.maxHp)) * (1 + 0.15 * unit.level);
}

// A fresh spirit, at full health: what a summoner puts back on the field every forty seconds.
export const SPIRIT_STRENGTH = Math.sqrt(UNIT_DEFS.spirit.hp * (UNIT_DEFS.spirit.attackDamage / (UNIT_DEFS.spirit.attackCooldown / 20))) / FOOTMAN_RATING;
const SPIRIT_CASTERS = new Set<Unit["kind"]>(["summoner", "pyreCaller"]);
// A summoner that recasts whenever it can keeps duration / cooldown spirits up on average (60s / 40s: one and a half).
const SUMMON = ABILITY_DEFS.summon;
const SPIRITS_PER_CASTER = SUMMON.behavior === "summon" ? SUMMON.summonDuration / SUMMON.cooldown : 1;

// The army that will still stand at the end of a long march. Spirits live sixty seconds, and crossing the map takes most
// of that: whatever is up now is replaced by the summoners' steady state. Twice V6 judged an attack by a peak of spirits,
// walked 3000 paces, and arrived with its summoners alone.
export function marchStrength(units: readonly Unit[]) {
  const standing = units.filter((unit) => unit.kind !== "spirit");
  return strengthOf(standing) + standing.filter((unit) => SPIRIT_CASTERS.has(unit.kind)).length * SPIRITS_PER_CASTER * SPIRIT_STRENGTH;
}

export function strengthOf(units: readonly Unit[]) {
  return units.reduce((total, unit) => total + unitStrength(unit), 0);
}
