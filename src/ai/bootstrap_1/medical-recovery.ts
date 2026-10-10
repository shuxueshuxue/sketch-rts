import { ABILITY_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { canReceiveHealing } from '../../shared/healing';
import { canReach } from '../../shared/naval';
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
  return own.flatMap(healer => {
    const ability = UNIT_DEFS[healer.kind].abilities.find(ability => ABILITY_DEFS[ability].behavior === 'heal');
    if (!ability) return [];
    const target = patients.filter(patient => matchesUnitTarget(patient, ABILITY_DEFS[ability].targets, snapshot)
      && canReach(snapshot.map, healer, patient)).sort((a, b) => distance(healer, a) - distance(healer, b))[0];
    return target ? [{ healer, target, ability }] : [];
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

/** Recovery owns the healer until critical permanent patients can fight again. */
export const medicalRecovery: AiScript = {
  id: 'medicalRecovery', phase: 'tactics',
  claimsUnits: (snapshot, owner) => new Set(assignments(snapshot, owner, recoveryPatients(snapshot, owner)).map(({ healer }) => healer.id)),
  run: (snapshot, owner) => planMedicalRecovery(snapshot, owner, recoveryPatients(snapshot, owner)),
};
