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

/** Assessment copies only. The original entities and their HP are untouched. */
export function casualtySurvivors(units: readonly Unit[], casualties: ReturnType<typeof focusedCasualties>): Unit[] {
  const byId = new Map(units.map(unit => [unit.id, unit]));
  return casualties.survivors.map(survivor => {
    const original = byId.get(survivor.unitId);
    if (!original) throw new Error(`Missing casualty survivor ${survivor.unitId}`);
    return { ...original, hp: survivor.hp };
  });
}
