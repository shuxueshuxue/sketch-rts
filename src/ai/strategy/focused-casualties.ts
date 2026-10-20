import { UNIT_DEFS } from '../../shared/catalog';
import type { Unit } from '../../shared/types';

export type RecoveryService = Readonly<{ unitId: string; hpPerTick: number; startsInTicks: number }>;

/** A deterministic focus-fire approximation, not fractional deaths. Damage
 * consumes the lowest current HP first, with ID breaking ties. Wounds cost no
 * catalog gold. Only explicit healing facts can promise a recovery time. */
export function focusedCasualties(units: readonly Unit[], damageExposure: number, recovery: readonly RecoveryService[] = []) {
  if (!Number.isFinite(damageExposure) || damageExposure < 0) throw new Error('Invalid casualty damage exposure');
  const seen = new Set<string>();
  for (const unit of units) {
    if (seen.has(unit.id)) throw new Error(`Duplicate casualty member ${unit.id}`);
    seen.add(unit.id);
    if (!Number.isFinite(unit.hp) || !Number.isFinite(unit.maxHp) || unit.hp < 0 || unit.maxHp <= 0)
      throw new Error(`Invalid casualty HP ${unit.id}`);
  }
  const services = new Map<string, RecoveryService>();
  for (const service of recovery) {
    if (services.has(service.unitId) || !seen.has(service.unitId) || !Number.isFinite(service.hpPerTick) || service.hpPerTick <= 0
      || !Number.isFinite(service.startsInTicks) || service.startsInTicks < 0) throw new Error('Invalid casualty recovery service');
    services.set(service.unitId, service);
  }
  const ordered = units.filter(unit => unit.hp > 0).slice().sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const deadUnitIds: string[] = [], permanentDeadUnitIds: string[] = [];
  const survivors: { unitId: string; hp: number; maxHp: number; damage: number; permanent: boolean }[] = [];
  let unappliedDamage = damageExposure, expectedLossGold = 0, expectedHpLost = 0;
  for (const unit of ordered) {
    const damage = Math.min(unit.hp, unappliedDamage), hp = unit.hp - damage;
    unappliedDamage -= damage; expectedHpLost += damage;
    if (hp <= 0) {
      deadUnitIds.push(unit.id);
      if (unit.expiresTick === undefined) {
        permanentDeadUnitIds.push(unit.id);
        expectedLossGold += UNIT_DEFS[unit.kind].cost;
      }
    } else survivors.push({ unitId: unit.id, hp, maxHp: unit.maxHp, damage, permanent: unit.expiresTick === undefined });
  }
  survivors.sort((a, b) => a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0);
  const wounds = survivors.filter(unit => unit.hp < unit.maxHp).map(unit => {
    const service = services.get(unit.unitId), missingHp = unit.maxHp - unit.hp;
    const durationTicks = service ? Math.ceil(missingHp / service.hpPerTick) : null;
    return { unitId: unit.unitId, missingHp, battleDamage: unit.damage,
      startsInTicks: service?.startsInTicks ?? null, durationTicks,
      readyInTicks: service && durationTicks !== null ? service.startsInTicks + durationTicks : null };
  });
  return { damageExposure, expectedHpLost, unappliedDamage, expectedLossGold,
    deadUnitIds, permanentDeadUnitIds, survivors, wounds };
}

/** Calibration only: not selected by any production quotation. First spread
 * (1-alpha) of capped damage in proportion to current HP, then focus the rest
 * on the remaining lowest-HP members. Endpoints are physical proportional
 * damage and pure focus, not fractional catalog losses. Both phases conserve
 * one HP budget; the existing casualty/recovery model settles actual deaths.
 * The ordering is part of this experimental model and must be held fixed when
 * fitting one global alpha with leave-one-map-out validation. */
export function experimentalMixedCasualties(units: readonly Unit[], damageExposure: number, alpha: number,
  recovery: readonly RecoveryService[] = []): ReturnType<typeof focusedCasualties> {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('Invalid casualty mixture alpha');
  const focused = focusedCasualties(units, damageExposure, recovery);
  const ordered = units.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const totalHp = ordered.reduce((sum, unit) => sum + unit.hp, 0);
  if (alpha === 1 || damageExposure === 0 || damageExposure >= totalHp) return focused;
  const applied = Math.min(totalHp, damageExposure), proportion = (1 - alpha) * applied;
  const originals = new Map(units.map(unit => [unit.id, unit]));
  const spread = ordered.map(unit => ({ ...unit, hp: unit.hp - proportion * unit.hp / totalHp }));
  const distributed = totalHp - spread.reduce((sum, unit) => sum + unit.hp, 0);
  const settled = focusedCasualties(spread, Math.max(0, applied - distributed), recovery);
  const damage = (unitId: string, hp: number) => originals.get(unitId)!.hp - hp;
  return { ...settled, damageExposure, expectedHpLost: applied, unappliedDamage: damageExposure - applied,
    survivors: settled.survivors.map(unit => ({ ...unit, damage: damage(unit.unitId, unit.hp) })),
    wounds: settled.wounds.map(wound => ({ ...wound, battleDamage: damage(wound.unitId,
      settled.survivors.find(unit => unit.unitId === wound.unitId)!.hp) })) };
}

/** Mechanism calibration only. The order and reaction-window burst are facts
 * supplied from the initial combat geometry, never observed future victims.
 * The only fitted values are engagementShare and retreatHpRatio. A selected
 * fighter takes sustained damage down to the retreat boundary, then at most
 * one reaction-window burst before withdrawing. Overkill is spent on that
 * victim; it cannot be redirected to another soldier. Damage left after the
 * selected front withdraws is avoided, not pushed into the unengaged rear. */
export function experimentalRetreatCasualties(input: Readonly<{
  units: readonly Unit[]; damageExposure: number; engagementOrder: readonly string[];
  exposureKind: 'damage-potential' | 'effective-hp';
  burstByUnit: readonly Readonly<{ unitId: string; damage: number }>[];
  engagementShare: number; retreatHpRatio: number;
}>, recovery: readonly RecoveryService[] = []) {
  const { units, damageExposure, engagementShare, retreatHpRatio } = input;
  const baseline = focusedCasualties(units, 0, recovery);
  if (!Number.isFinite(damageExposure) || damageExposure < 0 || !Number.isFinite(engagementShare)
    || engagementShare < 0 || engagementShare > 1 || !Number.isFinite(retreatHpRatio) || retreatHpRatio < 0 || retreatHpRatio > 1
    || input.exposureKind !== 'damage-potential' && input.exposureKind !== 'effective-hp')
    throw new Error('Invalid casualty retreat parameters');
  const byId = new Map(units.map(unit => [unit.id, unit])), order = new Set(input.engagementOrder);
  if (order.size !== input.engagementOrder.length || input.engagementOrder.some(id => !byId.get(id) || byId.get(id)!.hp <= 0))
    throw new Error('Invalid casualty engagement order');
  const bursts = new Map<string, number>();
  for (const burst of input.burstByUnit) {
    if (!byId.has(burst.unitId) || bursts.has(burst.unitId) || !Number.isFinite(burst.damage) || burst.damage < 0)
      throw new Error('Invalid casualty reaction burst');
    bursts.set(burst.unitId, burst.damage);
  }
  if (input.engagementOrder.some(id => !bursts.has(id))) throw new Error('Missing casualty reaction burst');
  const engagedUnitIds = input.engagementOrder.slice(0, Math.ceil(input.engagementOrder.length * engagementShare));
  const engaged = new Set(engagedUnitIds), damage = new Map<string, number>(), withdrawnUnitIds: string[] = [];
  let left = damageExposure, overkillDamage = 0;
  for (const id of engagedUnitIds) {
    const unit = byId.get(id)!, threshold = unit.maxHp * retreatHpRatio;
    const sustained = Math.min(left, Math.max(0, unit.hp - threshold));
    let hp = unit.hp - sustained;
    left -= sustained;
    if (hp > 0 && hp <= threshold) {
      const burst = Math.min(left, bursts.get(id)!), effective = Math.min(hp, burst);
      // An effective-HP audit already removed overkill from its input budget.
      const spent = input.exposureKind === 'effective-hp' ? effective : burst;
      left -= spent; overkillDamage += spent - effective;
      hp -= effective;
      if (hp > 0) withdrawnUnitIds.push(id);
    }
    damage.set(id, unit.hp - hp);
  }
  // Settlement, catalog death price and recovery stay in the same shared model.
  const settled = units.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map(unit => focusedCasualties([unit], damage.get(unit.id) ?? 0, recovery.filter(service => service.unitId === unit.id)));
  return { ...baseline, damageExposure, exposureKind: input.exposureKind,
    expectedHpLost: settled.reduce((sum, part) => sum + part.expectedHpLost, 0),
    expectedLossGold: settled.reduce((sum, part) => sum + part.expectedLossGold, 0),
    unappliedDamage: overkillDamage + left, overkillDamage, avoidedDamage: left,
    deadUnitIds: settled.flatMap(part => part.deadUnitIds), permanentDeadUnitIds: settled.flatMap(part => part.permanentDeadUnitIds),
    survivors: settled.flatMap(part => part.survivors), wounds: settled.flatMap(part => part.wounds),
    engagedUnitIds, withdrawnUnitIds, unengagedUnitIds: baseline.survivors.filter(unit => !engaged.has(unit.unitId)).map(unit => unit.unitId) };
}

/** Assessment copies only. The original entities and their HP are untouched. */
export function casualtySurvivors(units: readonly Unit[], casualties: ReturnType<typeof focusedCasualties>): Unit[] {
  const byId = new Map(units.map(unit => [unit.id, unit]));
  return casualties.survivors.map(survivor => {
    const original = byId.get(survivor.unitId);
    if (!original) throw new Error(`Missing casualty survivor ${survivor.unitId}`);
    return { ...original, hp: survivor.hp };
  });
}
