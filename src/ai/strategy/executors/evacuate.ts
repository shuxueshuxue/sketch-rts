import { sameGround } from '../../../shared/terrain';
import { distance } from '../../policy/spatial';
import { armedFoes, retreatLandRoad } from '../../bootstrap_1/safe-land-route';
import { workerThreatAt } from '../../bootstrap_1/worker-safety';
import type { ExecutorFeedback, StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, grantedUnits, validExecutorGrant } from '../executor-grants';

export const evacuateExecutor: StrategyExecutor = {
  id: 'strategy.evacuate',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const { snapshot, owner, execution } = input, destination = execution.target;
    const base = executorFeedback(input), workers = grantedUnits(input).filter(unit => unit.kind === 'worker');
    if (!workers.length) return blockedExecutor(input, 'no-granted-evacuees');
    const shelter = snapshot.buildings.find(building => building.id === destination.entityId && building.owner === owner
      && building.hp > 0 && building.complete);
    if (destination.entityId && !shelter) return { ...base, status: 'failed', reasons: [{ executor: this.id,
      outcome: 'abandoned', reason: 'evacuation-shelter-no-longer-valid', taskId: execution.token.actionId }] };
    const foes = armedFoes(snapshot, owner, {}), commands: ExecutorFeedback['commands'][number][] = [];
    for (const worker of workers) {
      if (worker.deck || !sameGround(snapshot.map, worker, destination.point)) return blockedExecutor(input, 'evacuation-requires-transport', workers.map(unit => unit.id));
      if (foes.some(foe => workerThreatAt(snapshot, worker, destination.point, foe))) return blockedExecutor(input, 'evacuation-shelter-exposed', workers.map(unit => unit.id));
      if (distance(worker, destination.point) <= 240) continue;
      const road = retreatLandRoad(snapshot, worker, destination.point, foes);
      if (!road || distance(road.points.at(-1)!, destination.point) > 240) return blockedExecutor(input, 'evacuation-route-blocked', workers.map(unit => unit.id));
      if (!(worker.order.type === 'move' && worker.order.avoidCombat && distance(worker.order, destination.point) < 40))
        commands.push({ command: { type: 'move', unitIds: [worker.id], ...destination.point, avoidCombat: true }, purpose: 'life-saving' });
    }
    const arrived = workers.every(worker => distance(worker, destination.point) <= 240);
    return { ...base, commands, phase: arrived ? 'evacuated' : 'evacuating',
      status: arrived ? input.objective.kind === 'Evacuate' ? 'complete' : 'abandoned' : 'active' };
  },
};
