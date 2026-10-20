import { combatWeapons } from '../../shared/combat-capabilities';
import { hasSpell, unitRules } from '../../shared/catalog';
import { strikeGap, strikeReach } from '../../shared/combat-geometry';
import { resolveUnitDamage, unitAttackDamageProfile } from '../../shared/damage';
import { attackDamageProfile } from '../../shared/damage-types';
import { canReach } from '../../shared/naval';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameSnapshot, Unit } from '../../shared/types';
import { buildVeteranFrame, temporaryAttackSpeedMultiplier } from '../../shared/veteran-runtime';
import { incomingItemDamage } from '../bootstrap_1/damage-footprints';
import { THINK_TICKS } from '../policy/threat-reach';

/** Contact-local upper bounds, not a forecast of the pose after a march.
 * One reaction window is the existing 15-tick policy interval. A capable
 * weapon may release immediately after its saved cooldown and may close at
 * its saved speed. Ignoring aiming/projectile delay is an explicit upper
 * bound, not a claim that every capable enemy fires at every soldier.
 * Target choice and the engaged share belong to the casualty model.
 * Unprojected future positions are unknown, never a distant zero burst. */
export function casualtyContactFacts(input: Readonly<{
  snapshot: GameSnapshot;
  units: readonly Unit[];
  opponents: readonly (Unit | Building)[];
  posture: 'present-contact' | 'unprojected-future';
}>) {
  if (input.posture === 'unprojected-future') return {
    status: 'unknown' as const, reason: 'battle-posture-not-projected', reactionTicks: THINK_TICKS,
  };
  const { snapshot } = input;
  const units = [...input.units].filter(unit => unit.hp > 0).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(units.map(unit => unit.id)).size !== units.length) throw new Error('Duplicate contact casualty member');
  const opponents = [...input.opponents].filter(foe => foe.hp > 0).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // These hit-time modifiers have not been exposed as a shared pure native
  // query. Do not silently publish an unmodified lower number as a burst cap.
  if (opponents.some(foe => 'order' in foe && (foe.deck || foe.cabin
    || unitRules(snapshot, foe).casterSlayer && units.some(unit => unit.expiresTick !== undefined || hasSpell(unit.kind))
    || (foe.kind === 'emberRavager' || foe.kind === 'cinderRunner') && units.some(unit => unit.effects.some(effect => effect.type === 'scorch')))))
    return { status: 'unknown' as const, reason: 'contact-target-modifier-or-deck-unmodeled', reactionTicks: THINK_TICKS };
  const veteran = buildVeteranFrame(snapshot);
  const rows = units.map(unit => {
    const local = opponents.filter(foe => !('order' in foe) || canReach(snapshot.map, foe, unit, snapshot.units));
    const projectiles = snapshot.projectiles.filter(shot => shot.targetId === unit.id && shot.owner !== unit.owner
      && shot.remaining <= THINK_TICKS && shot.remaining >= 0);
    const projectileDamage = projectiles.reduce((sum, shot) => sum + resolveUnitDamage(snapshot, unit, shot.damage,
      shot.damageProfile ?? attackDamageProfile(shot.sourceKind ?? 'defenseTower'), veteran.get(unit.id)?.reductions,
      { armorAlreadyApplied: shot.armorAlreadyApplied === true }).damage, 0);
    let margin: number | null = null;
    const weapons = local.flatMap(foe => combatWeapons(snapshot, foe).flatMap(weapon => {
      const reach = 'order' in foe ? strikeReach(foe, unit, weapon.range) : weapon.range;
      const gap = strikeGap(foe, unit) - reach;
      if (Number.isFinite(gap)) margin = margin === null ? gap : Math.min(margin, gap);
      const closing = ('speed' in foe ? foe.speed : 0) * THINK_TICKS / SIM_TICKS_PER_SECOND;
      const ready = Math.max(0, foe.cooldown);
      if (gap > closing || reach < 0 || weapon.damage <= 0) return [];
      const attackSpeed = 'order' in foe ? (veteran.get(foe.id)?.attackSpeedMultiplier ?? 1) * temporaryAttackSpeedMultiplier(foe) : 1;
      const periodTicks = Math.max(1, Math.round(weapon.cooldown / attackSpeed));
      const attacks = ready <= THINK_TICKS ? 1 + Math.floor((THINK_TICKS - ready) / periodTicks) : 0;
      const profile = 'order' in foe ? unitAttackDamageProfile(snapshot, foe) : attackDamageProfile(foe.kind);
      const damagePerHit = resolveUnitDamage(snapshot, unit, weapon.damage, profile, veteran.get(unit.id)?.reductions).damage;
      return [{ sourceId: foe.id, attacks, damage: damagePerHit * attacks, damagePerTick: damagePerHit / periodTicks }];
    }));
    const targetedBy = local.filter(foe => 'order' in foe
      && (foe.order.type === 'attack' || foe.order.type === 'attackMove') && foe.order.targetId === unit.id).map(foe => foe.id);
    const itemDamage = incomingItemDamage(snapshot, unit, local, THINK_TICKS);
    return { unitId: unit.id, targetedBy, projectileIds: projectiles.map(shot => shot.id).sort(),
      weaponMargin: margin, weapons, projectileDamage, itemDamage,
      burstDamage: projectileDamage + itemDamage + weapons.reduce((sum, weapon) => sum + weapon.damage, 0),
      pursuitDamagePerTick: weapons.reduce((sum, weapon) => sum + weapon.damagePerTick, 0) };
  });
  const engagementOrder = rows.slice().sort((a, b) => Number(b.targetedBy.length > 0 || b.projectileIds.length > 0)
    - Number(a.targetedBy.length > 0 || a.projectileIds.length > 0)
    || (a.weaponMargin ?? Infinity) - (b.weaponMargin ?? Infinity)
    || (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0)).map(row => row.unitId);
  return { status: 'known' as const, reactionTicks: THINK_TICKS, engagementOrder,
    burstByUnit: Object.fromEntries(rows.map(row => [row.unitId, row.burstDamage])), rows,
    pursuitByUnit: rows.map(row => ({ unitId: row.unitId, damagePerTick: row.pursuitDamagePerTick })),
    limitations: ['weapon-release-upper-bound-ignores-aim-and-flight-delay', 'spell-and-area-effects-not-extrapolated'] };
}
