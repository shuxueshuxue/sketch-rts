import { GOLD_MINE_RULES } from '../../../shared/mining';
import { sameGround } from '../../../shared/terrain';
import { distance } from '../../policy/spatial';
import { assessAllocatedForce } from '../allocated-force';
import type { StrategyExecutor } from '../allocation-types';
import { blockedExecutor, grantedUnits, validExecutorGrant } from '../executor-grants';
import { defendSiteExecutor, defenseGatherPost } from './defend-site';

/** Completion hands this same cohort to DefendSite atomically; it never recruits
 * an island's whole army or releases the garrison into an unowned gap. */
export const establishGarrisonExecutor: StrategyExecutor = {
  id: 'strategy.establish-garrison',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const { snapshot, owner } = input, mine = input.objective.target;
    const hall = snapshot.buildings.find(building => building.kind === 'townHall' && building.owner === owner && building.hp > 0 && building.complete
      && sameGround(snapshot.map, building, mine.point) && distance(building, mine.point) <= GOLD_MINE_RULES.baseRange);
    if (!hall) return blockedExecutor(input, 'garrison-hall-not-yet-complete');
    const post = defenseGatherPost(hall, mine.point), site = { ...input.execution.target, entityId: hall.id, point: post };
    const feedback = defendSiteExecutor.execute({ ...input, execution: { ...input.execution, target: site } });
    const arrived = grantedUnits(input).filter(unit => unit.kind !== 'worker' && !unit.deck && !unit.cabin
      && sameGround(snapshot.map, unit, hall) && distance(unit, post) <= 240
      && !input.grant.assignments.some(assignment => assignment.unitId === unit.id && assignment.interruption));
    const demand = input.method.demands.find(demand => demand.kind === 'force' && demand.metric === 'field-strength');
    const required = demand?.kind === 'force' ? demand.strength : 1;
    return assessAllocatedForce(owner, arrived, { metric: 'field-strength', requiredForce: required }).sufficient
      ? { ...feedback, status: 'complete', phase: 'garrison-in-position', state: { ...feedback.state, hallId: hall.id } } : feedback;
  },
};
