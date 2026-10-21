import type { GameSnapshot } from '../../shared/types';
import type { StrategyAllocationMemory } from './allocation-types';
import type { GoalEntityReference } from './goal-planner-types';

export type GoalCohortCommitments = Record<string, { cohort: GoalEntityReference[]; generation: number; sinceTick: number }>;

/** Preference from actual same-goal execution history, outside world fact
 * readers. A saved commitment survives terminal execution GC. Older saves can
 * recover the first group from retained real assignment/progress receipts. */
export function retainGoalCohortCommitments(memory: GoalCohortCommitments, authority: StrategyAllocationMemory | undefined,
  snapshot: GameSnapshot, owner: string) {
  if (!authority || authority.owner !== owner || authority.evaluatedTick > snapshot.tick) return;
  const rows: { goal: string; cohort: GoalEntityReference[]; generation: number; tick: number }[] = [];
  const add = (goal: string, kind: string, parameters: unknown, generation: number, tick: number) => {
    if (!['assemble', 'transport-force', 'clear-camp'].includes(kind) || !parameters || typeof parameters !== 'object') return;
    const cohort = (parameters as Record<string, unknown>).cohort;
    if (!Array.isArray(cohort) || !cohort.length || !cohort.every(ref => ref && typeof ref === 'object'
      && ref.kind === 'existing' && typeof ref.entityId === 'string')) return;
    if (!cohort.some(ref => snapshot.units.some(unit => unit.id === ref.entityId && unit.owner === owner
      && unit.kind !== 'worker' && unit.attackDamage > 0))) return;
    rows.push({ goal, cohort: structuredClone(cohort), generation, tick });
  };
  for (const event of authority.events) {
    if (event.kind !== 'assignment-stage' && !(event.kind === 'action-finished' && event.outcome === 'complete')) continue;
    if (event.methodId !== `goal-bundle:${event.objectiveId}`) continue;
    for (const kind of ['assemble', 'transport-force', 'clear-camp']) {
      const marker = `goal-action:${kind}:`, start = event.action.actionId.indexOf(marker);
      if (start < 0) continue;
      try { add(event.objectiveId, kind, JSON.parse(event.action.actionId.slice(start + marker.length)), event.action.generation, event.tick); }
      catch { /* A noncanonical action ID is not a receipt for a group. */ }
    }
  }
  for (const execution of Object.values(authority.executions)) {
    const intent = execution.intent;
    if (intent.kind !== 'goal-action') continue;
    const accepted = Object.values(authority.issuedCommands).some(command => command.action.actionId === execution.token.actionId
      && command.action.generation === execution.token.generation);
    if (!accepted && execution.status !== 'complete') continue;
    add(intent.goalId, intent.actionKind, intent.parameters, execution.token.generation, execution.sinceTick);
  }
  for (const goal of new Set(rows.map(row => row.goal))) {
    const candidates = rows.filter(row => row.goal === goal).sort((a, b) => a.tick - b.tick || a.generation - b.generation);
    const old = memory[goal];
    const next = old ? candidates.filter(row => row.generation > old.generation).at(-1) : candidates[0];
    if (next) memory[goal] = { cohort: next.cohort, sinceTick: next.tick,
      generation: Math.max(...candidates.map(row => row.generation)) };
  }
}
