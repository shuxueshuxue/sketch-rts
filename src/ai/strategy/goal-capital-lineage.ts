import type { AllocationBudget, IssuedActionCommand, StrategyAllocationMemory } from './allocation-types';
import { sameAction } from './control';
import { GOLD_MINE_RULES } from '../../shared/mining';

/** Restore old admission provenance from its explicit world-asset identity.
 * Never infer a payment from price, cash loss, or a nearby building alone. */
function matchesAsset(memory: StrategyAllocationMemory, budget: AllocationBudget, command: IssuedActionCommand): boolean {
  if (budget.plannedGold === undefined || command.command.type !== 'build') return false;
  const execution = memory.executions[command.action.actionId];
  if (!execution || !sameAction(execution.token, command.action) || execution.objectiveId !== budget.objectiveId) return false;
  const content = memory.goalReferences?.entries[budget.spendId]?.content;
  const prior = content && typeof content === 'object' && 'priorId' in content ? content.priorId : budget.spendId;
  if (typeof prior !== 'string' || !prior.startsWith('goal-capital:')) return false;
  let asset: { owner?: string; kind?: string; mineId?: string; buildingKind?: string; point?: { x: number; y: number } };
  try { asset = JSON.parse(prior.slice('goal-capital:'.length)); } catch { return false; }
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return false;
  if (asset.owner !== memory.owner) return false;
  const target = memory.objectives[budget.objectiveId]?.target;
  return asset.kind === 'hall' ? command.command.buildingKind === 'townHall'
    && target !== undefined && typeof asset.mineId === 'string' && target.entityId === asset.mineId
    && Math.hypot(command.command.x - target.point.x, command.command.y - target.point.y) <= GOLD_MINE_RULES.baseRange
    : asset.kind === 'building' && asset.buildingKind === command.command.buildingKind
      && asset.point?.x === command.command.x && asset.point?.y === command.command.y;
}

export function admittedCommandSpendIds(memory: StrategyAllocationMemory, command: IssuedActionCommand): readonly string[] {
  if (command.spendIds) return command.spendIds;
  if (!['build', 'train'].includes(command.command.type)) return [];
  const execution = memory.executions[command.action.actionId];
  const declaration = execution && memory.methods[execution.methodId]?.actions.find(action => action.id === command.action.actionId);
  return Object.values(memory.budgets).filter(budget => declaration?.spendIds.includes(budget.spendId)
    && sameAction(budget.action, command.action) || matchesAsset(memory, budget, command)
    || execution && !memory.methods[execution.methodId] && sameAction(budget.action, command.action)
    || budget.plannedGold === undefined && sameAction(budget.action, command.action)).map(budget => budget.spendId).sort();
}

export function issuedCapitalPurchase(memory: StrategyAllocationMemory, budget: AllocationBudget): IssuedActionCommand | undefined {
  return Object.values(memory.issuedCommands).filter(command => admittedCommandSpendIds(memory, command).includes(budget.spendId))
    .sort((a, b) => a.acceptedTick - b.acceptedTick || a.id.localeCompare(b.id))[0];
}
