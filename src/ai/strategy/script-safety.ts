import { ABILITY_DEFS } from '../../shared/catalog';
import type { GameCommand, GameSnapshot } from '../../shared/types';
import type { DecisionFacts } from './decision';
import type { Situation, ResourceDemand } from './types';
import type { CommandAdmission, StrategyAllocationMemory } from './allocation-types';
import { commandSetsNativeOrder } from './allocation-ledger';
import { appendAllocationEvent } from './allocation-lifecycle';
import { sameAction } from './control';

/** Purpose follows the actual local service, not a move/attack command shape.
 * These existing scripts retain their native rescue authority under control. */
export function isLifeSavingScript(id: string): boolean {
  return ['campRecovery', 'frontRecovery', 'mobileCare', 'medicalRecovery', 'skirmishPreservation'].includes(id);
}

/** The same range rule as the existing runner: an instant heal leaves its
 * caster's task intact; a charge or walk-to-cast takes over its native order. */
export function safetyCommandReplacesOrder(snapshot: GameSnapshot, command: GameCommand): boolean {
  if (command.type !== 'cast') return commandSetsNativeOrder(command);
  const definition = ABILITY_DEFS[command.ability];
  const caster = snapshot.units.find(unit => unit.id === command.unitId);
  const target = command.targetId ? [...snapshot.units, ...snapshot.buildings].find(entity => entity.id === command.targetId) : command;
  const radius = target && !('order' in target) && 'radius' in target ? target.radius : 0;
  return definition.behavior === 'charge' || !!(caster && target && target.x !== undefined && target.y !== undefined
    && Math.hypot(caster.x - target.x, caster.y - target.y) > definition.range + radius);
}

/** The accepted native service command proves the interruption. It preserves
 * the real parent and its vacancy without inventing an admitted parent order. */
export function recordScriptSafetyInterruptions(memory: StrategyAllocationMemory, snapshot: GameSnapshot,
  situation: DecisionFacts<Situation>, admissions: readonly CommandAdmission[]): StrategyAllocationMemory {
  let next = memory;
  for (const admission of admissions) {
    if (admission.status !== 'accepted' || admission.source !== 'script' || admission.purpose !== 'life-saving'
      || !isLifeSavingScript(admission.executor) || !safetyCommandReplacesOrder(snapshot, admission.command)) continue;
    const unitIds = 'unitIds' in admission.command ? admission.command.unitIds : 'unitId' in admission.command ? [admission.command.unitId] : [];
    for (const unitId of unitIds) {
      const assignment = next.assignments[`assignment:${unitId}`], lease = next.leases[`unit:${unitId}`];
      if (!assignment || !lease || !sameAction(assignment.action, lease.action)) continue;
      const fact = situation.units.find(unit => unit.id === unitId);
      const methodAction = next.methods[assignment.methodId]?.actions.find(action => action.id === assignment.action.actionId);
      const demand: ResourceDemand | undefined = methodAction?.demands.find(demand => assignment.role === 'worker'
        ? demand.kind === 'workers' : demand.kind === 'force' || demand.kind === 'transport')
        ?? (fact ? fact.roles.includes('worker') ? { kind: 'workers', count: 1, at: assignment.target }
          : { kind: 'force', metric: 'field-strength', strength: fact.strength, roles: fact.roles,
            at: assignment.target, neededByTick: null, permanent: fact.expiresTick === null } : undefined);
      if (!demand) continue;
      const vacancyId = `vacancy:${assignment.id}:${assignment.action.generation}`;
      const reason = { code: 'script-life-saving-interruption', factIds: [unitId, admission.commandId],
        values: { executor: admission.executor } };
      next = { ...next,
        assignments: { ...next.assignments, [assignment.id]: { ...assignment, interruption: {
          kind: admission.executor.includes('Care') || admission.executor.includes('medical') ? 'healing' : 'retreat',
          executor: admission.executor, sinceTick: assignment.interruption?.sinceTick ?? snapshot.tick,
          resumeStage: assignment.interruption?.resumeStage ?? assignment.stage, vacancyId } } },
        vacancies: { ...next.vacancies, [vacancyId]: { id: vacancyId, objectiveId: assignment.objectiveId,
          action: assignment.action, assignmentId: assignment.id, sinceTick: next.vacancies[vacancyId]?.sinceTick ?? snapshot.tick,
          demand: demand.kind === 'workers' ? { ...demand, count: 1 } : demand, replacementAssignmentIds: [], reason } } };
      if (!assignment.interruption) next = appendAllocationEvent(next, { objectiveId: assignment.objectiveId,
        methodId: assignment.methodId, action: assignment.action, kind: 'interrupted', assignmentId: assignment.id, vacancyId, reason }, snapshot.tick);
    }
  }
  return next;
}
