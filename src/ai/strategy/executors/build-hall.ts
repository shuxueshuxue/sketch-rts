import { BUILDING_DEFS } from '../../../shared/catalog';
import { GOLD_MINE_RULES } from '../../../shared/mining';
import { miningHallSite } from '../../../shared/mining-site';
import { isBuildPlacementClear } from '../../../shared/build-placement';
import { sameGround } from '../../../shared/terrain';
import { distance } from '../../policy/spatial';
import type { ExecutorFeedback, StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, grantedUnits, sameAction, validExecutorGrant } from '../executor-grants';

export const buildHallExecutor: StrategyExecutor = {
  id: 'strategy.build-hall',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const { snapshot, owner, execution } = input, base = executorFeedback(input);
    const mine = snapshot.resources.find(mine => mine.id === input.objective.target.entityId && mine.amount > 0);
    if (!mine) return { ...base, status: 'failed', reasons: [{ executor: this.id, outcome: 'abandoned', reason: 'construction-mine-no-longer-valid' }] };
    const hall = snapshot.buildings.find(building => building.kind === 'townHall' && building.hp > 0
      && sameGround(snapshot.map, building, mine) && distance(building, mine) <= GOLD_MINE_RULES.baseRange);
    if (hall && hall.owner !== owner) return { ...base, status: 'failed', reasons: [{ executor: this.id, outcome: 'abandoned', reason: 'construction-site-occupied-by-other-owner' }] };
    const progress: ExecutorFeedback['progress'][number][] = [];
    const accepted = hall && input.grant.commands.find(entry => sameAction(entry.action, execution.token)
      && entry.command.type === 'build' && entry.command.buildingKind === 'townHall' && distance(entry.command, hall) < 1);
    const capital = input.grant.budgets.find(budget => sameAction(budget.action, execution.token) && budget.objectiveId === input.objective.id
      && budget.state === 'reserved' && budget.amountGold - budget.paidGold >= BUILDING_DEFS.townHall.cost);
    const payments: ExecutorFeedback['payments'] = accepted && hall && capital ? [{ budgetId: capital.id, amountGold: BUILDING_DEFS.townHall.cost,
      proof: { kind: 'foundation', buildingId: hall.id, acceptedCommandId: accepted.id } }] : [];
    if (hall && execution.state.hallId !== hall.id) progress.push({ kind: 'hall-founded', unitIds: [], entityIds: [hall.id], basis: 'observed-world' });
    if (hall?.complete) return { ...base, status: 'complete', phase: 'hall-complete', state: { ...execution.state, hallId: hall.id },
      payments, progress: [...progress, { kind: 'hall-complete', unitIds: [], entityIds: [hall.id], basis: 'observed-world' }] };
    const workers = grantedUnits(input).filter(unit => unit.kind === 'worker' && !unit.deck && !unit.cabin
      && sameGround(snapshot.map, unit, mine) && !input.grant.assignments.some(assignment => assignment.unitId === unit.id && assignment.interruption));
    if (!workers.length) return blockedExecutor(input, 'no-granted-construction-worker-on-target-land');
    if (hall) return { ...base, status: 'active', phase: 'constructing', state: { ...execution.state, hallId: hall.id }, progress, payments,
      commands: workers.filter(unit => !(unit.order.type === 'repair' && unit.order.buildingId === hall.id)
        && !(unit.order.type === 'build' && distance(unit.order, hall) < 1)).map(unit => ({
        command: { type: 'repair', unitIds: [unit.id], buildingId: hall.id }, purpose: 'task' })) };
    const budget = input.grant.budgets.find(budget => sameAction(budget.action, execution.token) && budget.objectiveId === input.objective.id
      && budget.state === 'reserved' && budget.amountGold - budget.paidGold >= BUILDING_DEFS.townHall.cost);
    if (!budget) return blockedExecutor(input, 'no-granted-hall-capital', workers.map(unit => unit.id));
    const prior = execution.state.constructionPoint;
    const point = prior && typeof prior === 'object' && 'x' in prior && 'y' in prior && typeof prior.x === 'number' && typeof prior.y === 'number'
      ? { x: prior.x, y: prior.y } : miningHallSite(snapshot, mine, execution.target.point);
    if (!point || !isBuildPlacementClear(snapshot, 'townHall', point)) return blockedExecutor(input, 'construction-geometry-blocked', workers.map(unit => unit.id));
    const worker = workers[0]!;
    const issued = input.grant.commands.some(entry => sameAction(entry.action, execution.token)
      && entry.command.type === 'build' && entry.command.buildingKind === 'townHall'
      && entry.command.unitId === worker.id && distance(entry.command, point) < 1);
    const building = worker.order.type === 'build' && worker.order.buildingKind === 'townHall' && distance(worker.order, point) < 1;
    return { ...base, status: 'active', phase: 'await-foundation', state: { ...execution.state, constructionPoint: { ...point } },
      commands: issued || building ? [] : [{ command: { type: 'build', unitId: worker.id, buildingKind: 'townHall', ...point }, purpose: 'task' }] };
  },
};
