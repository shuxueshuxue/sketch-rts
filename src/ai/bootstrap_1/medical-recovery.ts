import { ABILITY_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { canReceiveHealing } from '../../shared/healing';
import { canReach } from '../../shared/naval';
import { matchesUnitTarget } from '../../shared/unit-targeting';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { distance } from '../policy/spatial';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';
import type { AiScript } from '../policy/types';

function assignments(snapshot: GameSnapshot, owner: PlayerId) {
  const own = snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unit.kind !== 'worker');
  const patients = own.filter(unit => unit.expiresTick === undefined && unit.hp < unit.maxHp * V7_WOUNDED_SHARE
    && canReceiveHealing(unit, snapshot));
  const pairs = own.flatMap(healer => {
    const ability = UNIT_DEFS[healer.kind].abilities.find(ability => ABILITY_DEFS[ability].behavior === 'heal');
    if (!ability) return [];
    return patients.filter(patient => matchesUnitTarget(patient, ABILITY_DEFS[ability].targets, snapshot)
      && canReach(snapshot.map, healer, patient)).map(target => ({ healer, target, ability, gap: distance(healer, target) }));
  });
  const assigned = new Set<string>();
  return pairs.sort((a, b) => a.gap - b.gap).filter(({ healer, target }) => {
    if (assigned.has(healer.id) || assigned.has(target.id)) return false;
    assigned.add(healer.id); assigned.add(target.id);
    return true;
  });
}

export function medicalUnitIds(snapshot: GameSnapshot, owner: PlayerId) {
  return new Set(assignments(snapshot, owner).flatMap(({ healer, target }) => [healer.id, target.id]));
}

/** A critical patient meets its healer instead of marching away faster than the healer can follow. */
export const medicalRecovery: AiScript = {
  id: 'medicalRecovery', phase: 'tactics',
  claimsUnits: medicalUnitIds,
  run(snapshot, owner): GameCommand[] {
    return assignments(snapshot, owner).flatMap(({ healer, target, ability, gap }): GameCommand[] => {
      const inRange = gap <= ABILITY_DEFS[ability].range;
      const commands: GameCommand[] = [inRange && abilityCooldown(healer, ability) <= 0
        ? { type: 'cast', unitId: healer.id, ability, targetId: target.id }
        : { type: 'holdPosition', unitIds: [healer.id] }];
      if (target.id !== healer.id) {
        commands.push(!inRange
          ? { type: 'move', unitIds: [target.id], x: healer.x, y: healer.y }
          : { type: 'holdPosition', unitIds: [target.id] });
      }
      return commands;
    });
  },
};
