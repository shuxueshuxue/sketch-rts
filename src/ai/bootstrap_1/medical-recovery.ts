import { ABILITY_DEFS, UNIT_DEFS, unitMover } from '../../shared/catalog';
import { abilityCooldown } from '../../shared/ability-cooldowns';
import { isStunned } from '../../shared/unit-abilities';
import { canReceiveHealing } from '../../shared/healing';
import { nearestByRoute } from '../../shared/route-selection';
import { matchesUnitTarget } from '../../shared/unit-targeting';
import type { AbilityKind, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { distance } from '../policy/spatial';
import { V7_WOUNDED_SHARE } from '../policy/v6/general';
import type { AiScript, PresetAiPolicyOptions } from '../policy/types';
import { armedFoes } from './safe-land-route';
import { medicalRoadIsSafe } from './medical-task-safety';

export function recoveryPatients(snapshot: GameSnapshot, owner: PlayerId) {
  return snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unit.kind !== 'worker'
    && unit.expiresTick === undefined && unit.hp < unit.maxHp * V7_WOUNDED_SHARE
    && canReceiveHealing(unit, snapshot));
}

function assignments(snapshot: GameSnapshot, owner: PlayerId, patients: readonly Unit[], admit: (healer: Unit, target: Unit, ability: AbilityKind) => boolean) {
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
      if (!target || !admit(healer, target, ability)) return [];
      if (abilityCooldown(healer, ability) <= 0 && distance(healer, target) <= definition.range) {
        projectedHealth.set(target.id, projectedHealth.get(target.id)! + definition.healAmount);
      }
      return [{ healer, target, ability }];
    });
}

type MedicalOptions = Pick<PresetAiPolicyOptions, 'teams'>;

export function planMedicalRecoveryTasks(snapshot: GameSnapshot, owner: PlayerId, patients: readonly Unit[], options: MedicalOptions = {}) {
  const foes = armedFoes(snapshot, owner, options);
  const commands: GameCommand[] = [], occupied = new Set<string>(), released = new Set<string>();
  assignments(snapshot, owner, patients, (healer, target, ability) => {
    const ready = abilityCooldown(healer, ability) <= 0;
    const inRange = distance(healer, target) <= ABILITY_DEFS[ability].range;
    // Waiting for cooldown is not a movement/healing task in this frame. The
    // backline remains responsible until the spell is actually ready.
    if (isStunned(healer) || !ready && inRange) { released.add(healer.id); return false; }
    // An immediate spell completes during command issue and leaves every old
    // order intact. It owns no movement; the existing backline owns that frame's
    // physical command, including when the old order could acquire a new foe.
    if (ready && inRange) {
      released.add(healer.id);
      commands.push({ type: 'cast', unitId: healer.id, ability, targetId: target.id });
      return true;
    }
    if (!medicalRoadIsSafe(snapshot, healer, target, ready ? ABILITY_DEFS[ability].range : 0, foes)) {
      released.add(healer.id); return false;
    }
    occupied.add(healer.id);
    commands.push(ready ? { type: 'cast', unitId: healer.id, ability, targetId: target.id }
      : { type: 'move', unitIds: [healer.id], x: target.x, y: target.y });
    return true;
  });
  // The patient can disappear between thinks. A rejected legacy heal/hold still
  // needs its backline owner to replace it even when no new assignment exists.
  for (const healer of snapshot.units.filter(unit => unit.owner === owner && !unit.deck
    && UNIT_DEFS[unit.kind].abilities.some(ability => ABILITY_DEFS[ability].behavior === 'heal'))) {
    if (occupied.has(healer.id)) continue;
    const order = healer.order;
    const target = order.type === 'cast' && ABILITY_DEFS[order.ability].behavior === 'heal'
      ? snapshot.units.find(unit => unit.id === order.targetId) : order.type === 'hold' ? healer : undefined;
    if (target && !medicalRoadIsSafe(snapshot, healer, target, order.type === 'cast' ? ABILITY_DEFS[order.ability].range : 0, foes)) released.add(healer.id);
  }
  const casting = new Set(commands.flatMap(command => command.type === 'cast' ? [command.unitId] : []));
  return { commands, occupied, released, casting };
}

export function planMedicalRecovery(snapshot: GameSnapshot, owner: PlayerId, patients: readonly Unit[], options: MedicalOptions = {}): GameCommand[] {
  return planMedicalRecoveryTasks(snapshot, owner, patients, options).commands;
}

const currentPlans = new WeakMap<GameSnapshot, Map<PlayerId, { teams: MedicalOptions['teams']; plan: ReturnType<typeof planMedicalRecoveryTasks> }>>();

function currentMedicalPlan(snapshot: GameSnapshot, owner: PlayerId, options: MedicalOptions) {
  let owners = currentPlans.get(snapshot);
  if (!owners) { owners = new Map(); currentPlans.set(snapshot, owners); }
  const cached = owners.get(owner);
  if (cached && cached.teams === options.teams) return cached.plan;
  const plan = planMedicalRecoveryTasks(snapshot, owner, recoveryPatients(snapshot, owner), options);
  owners.set(owner, { teams: options.teams, plan });
  return plan;
}

export function medicalRecoveryUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: MedicalOptions = {}) {
  return currentMedicalPlan(snapshot, owner, options).occupied;
}

export function medicalRecoveryReleasedUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: MedicalOptions = {}) {
  return currentMedicalPlan(snapshot, owner, options).released;
}

/** Planned spells suppress duplicate ability selection without owning movement. */
export function medicalRecoveryCastingUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: MedicalOptions = {}) {
  return currentMedicalPlan(snapshot, owner, options).casting;
}

/** Only an admitted medical movement task owns its healer's physical order. */
export const medicalRecovery: AiScript = {
  id: 'medicalRecovery', phase: 'tactics',
  claimsUnits: medicalRecoveryUnitIds,
  run: (snapshot, owner, options) => currentMedicalPlan(snapshot, owner, options).commands,
};
