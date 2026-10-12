import { ABILITY_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { canReceiveHealing } from '../../shared/healing';
import { nearestByRoute } from '../../shared/route-selection';
import { matchesUnitTarget } from '../../shared/unit-targeting';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { distance } from '../policy/spatial';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';
import type { AiScript } from '../policy/types';

export function recoveryPatients(snapshot: GameSnapshot, owner: PlayerId) {
  return snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unit.kind !== 'worker'
    && unit.expiresTick === undefined && unit.hp < unit.maxHp * V7_WOUNDED_SHARE
    && canReceiveHealing(unit, snapshot));
}

function assignments(snapshot: GameSnapshot, owner: PlayerId, patients: readonly Unit[]) {
  const own = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unit.kind !== 'worker');
  const projectedHealth = new Map(patients.map(patient => [patient.id, patient.hp]));
  const healers = own.flatMap(healer => UNIT_DEFS[healer.kind].abilities.flatMap(ability => {
    const definition = ABILITY_DEFS[ability];
    return definition.behavior === 'heal' ? [{ healer, ability, definition }] : [];
  }));
  // A ready heal in this frame changes which patient needs the next healer's spell.
  return healers.sort((a, b) => abilityCooldown(a.healer, a.ability) - abilityCooldown(b.healer, b.ability))
    .flatMap(({ healer, ability, definition }) => {
      const eligible = patients.filter(patient => projectedHealth.get(patient.id)! < patient.maxHp
        && matchesUnitTarget(patient, definition.targets, snapshot));
      const ready = eligible.filter(patient => distance(healer, patient) <= definition.range);
      const target = ready.length > 0
        ? ready.sort((a, b) => projectedHealth.get(a.id)! / a.maxHp - projectedHealth.get(b.id)! / b.maxHp
          || distance(healer, a) - distance(healer, b))[0]
        : nearestByRoute(snapshot.map, eligible, healer, unitMover(healer.kind));
      if (!target) return [];
      if (abilityCooldown(healer, ability) <= 0 && distance(healer, target) <= definition.range) {
        projectedHealth.set(target.id, projectedHealth.get(target.id)! + definition.healAmount);
      }
      return [{ healer, target, ability }];
    });
}

export function planMedicalRecovery(snapshot: GameSnapshot, owner: PlayerId, patients: readonly Unit[]): GameCommand[] {
  return assignments(snapshot, owner, patients).map(({ healer, target, ability }) =>
    abilityCooldown(healer, ability) <= 0
      ? { type: 'cast', unitId: healer.id, ability, targetId: target.id }
      : distance(healer, target) > ABILITY_DEFS[ability].range
        ? { type: 'move', unitIds: [healer.id], x: target.x, y: target.y }
        : { type: 'holdPosition', unitIds: [healer.id] });
}

export function medicalRecoveryUnitIds(snapshot: GameSnapshot, owner: PlayerId) {
  return new Set(assignments(snapshot, owner, recoveryPatients(snapshot, owner)).map(({ healer }) => healer.id));
}

/** Recovery owns the healer until critical permanent patients can fight again. */
export const medicalRecovery: AiScript = {
  id: 'medicalRecovery', phase: 'tactics',
  claimsUnits: medicalRecoveryUnitIds,
  run: (snapshot, owner) => planMedicalRecovery(snapshot, owner, recoveryPatients(snapshot, owner)),
};
