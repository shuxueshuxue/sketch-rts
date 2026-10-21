import { unitMover } from '../../../shared/catalog';
import { sameGround } from '../../../shared/terrain';
import { distance } from '../../policy/spatial';
import { assessAllocatedForce } from '../allocated-force';
import type { StrategyExecutor } from '../allocation-types';
import { blockedExecutor, grantedUnits, validExecutorGrant } from '../executor-grants';
import { strategicTargetCamp } from '../target-camp';
import { assembleExecutor, ASSEMBLY_RANGE } from './assemble';

/** A partial gathering cohort stays live until its actual rally force meets the
 * departure requirement. Future supply forecasts never become granted units. */
export const assembleForceExecutor: StrategyExecutor = {
  id: 'strategy.assemble-force',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const { intent } = input.execution;
    if (intent.kind !== 'assemble-force' || !Number.isFinite(intent.requiredForce) || intent.requiredForce <= 0)
      return blockedExecutor(input, 'invalid-force-assembly-requirement');
    const cohort = grantedUnits(input).filter(unit => unitMover(unit.kind) === 'land' && unit.kind !== 'worker'
      && unit.attackDamage > 0 && unit.expiresTick === undefined && !unit.deck && !unit.cabin
      && !input.grant.assignments.some(assignment => assignment.unitId === unit.id && assignment.interruption));
    if (!cohort.length) return blockedExecutor(input, 'no-granted-assembly-members');
    if (new Set(intent.posts.map(post => post.id)).size !== intent.posts.length
      || intent.posts.some(post => !post.target.landId)) return blockedExecutor(input, 'invalid-force-assembly-posts');
    const ambiguous = cohort.filter(unit => intent.posts.filter(post => post.unitIds.includes(unit.id)).length !== 1);
    if (ambiguous.length) return blockedExecutor(input, 'assembly-member-post-ambiguous', ambiguous.map(unit => unit.id));
    const camp = strategicTargetCamp(input.snapshot, intent.campTarget);
    // A vanished camp needs a new plan rather than a different force metric.
    if (!camp) return blockedExecutor(input, 'assembly-camp-no-longer-observed');
    const movements = intent.posts.flatMap(post => {
      const members = cohort.filter(unit => post.unitIds.includes(unit.id));
      if (!members.length) return [];
      const selected = new Set(members.map(unit => unit.id));
      return [assembleExecutor.execute({ ...input, execution: { ...input.execution, target: post.target },
        grant: { ...input.grant,
          leases: input.grant.leases.filter(lease => lease.resourceKey.startsWith('unit:') && selected.has(lease.resourceKey.slice(5))),
          assignments: input.grant.assignments.filter(assignment => selected.has(assignment.unitId)) } })];
    });
    const blocked = movements.find(movement => movement.status === 'blocked');
    if (blocked) return blocked;
    const arrived = cohort.filter(unit => {
      const post = intent.posts.find(post => post.unitIds.includes(unit.id))!;
      return sameGround(input.snapshot.map, unit, post.target.point) && distance(unit, post.target.point) <= ASSEMBLY_RANGE;
    });
    const assessment = assessAllocatedForce(input.owner, arrived,
      { metric: 'camp-force', camp, requiredForce: intent.requiredForce });
    const complete = assessment.sufficient;
    return { ...movements[0]!, commands: movements.flatMap(movement => movement.commands), status: complete ? 'complete' : 'active',
      phase: complete ? 'force-assembled' : movements.every(movement => movement.status === 'complete') ? 'waiting-for-force' : 'assembling-force',
      state: { ...input.execution.state, arrivedUnitIds: assessment.unitIds,
        assembledForce: assessment.force, requiredForce: assessment.requiredForce } };
  },
};
