import type { AiScript } from '../policy/types';
import type { StrategyAllocationMemory } from './allocation-types';
import { isLifeSavingScript } from './script-safety';

/** The general combines its old strategic selector and local movement in one
 * module. Its local tag does not make starting a new expansion a local order. */
export function isIncumbentStrategyScript(script: AiScript): boolean {
  return script.phase === 'tactics' && script.id !== 'veteranSkills' && !isLifeSavingScript(script.id)
    && (script.id === 'v6General' || script.redirects !== 'local');
}

/** Control has one strategic planner. Old strategic producers run only while
 * continuing a receipt-backed task; cold facts never authorize a fallback
 * mission which would become an imported competitor on the next think. */
export function continuedIncumbentScripts(scripts: readonly AiScript[], authority: StrategyAllocationMemory): AiScript[] {
  const producers = new Set(Object.values(authority.leases).flatMap(lease => {
    const execution = authority.executions[lease.action.actionId];
    return lease.origin === 'imported-task' && execution ? [execution.executor] : [];
  }));
  return scripts.filter(script => !isIncumbentStrategyScript(script) || producers.has(script.id));
}
