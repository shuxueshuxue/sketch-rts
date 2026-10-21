import type { StrategyExecutor } from '../allocation-types';
import { assessForceAssemblyPosts } from '../assembly-posts';
import { blockedExecutor, grantedUnits, validExecutorGrant } from '../executor-grants';
import { assembleExecutor } from './assemble';

/** A partial gathering cohort stays live until its actual rally force meets the
 * departure requirement. Future supply forecasts never become granted units. */
export const assembleForceExecutor: StrategyExecutor = {
  id: 'strategy.assemble-force',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const { intent } = input.execution;
    if (intent.kind !== 'assemble-force')
      return blockedExecutor(input, 'invalid-force-assembly-requirement');
    const assessment = assessForceAssemblyPosts({ snapshot: input.snapshot, owner: input.owner, intent,
      unitIds: grantedUnits(input).map(unit => unit.id),
      interruptedUnitIds: input.grant.assignments.filter(assignment => assignment.interruption).map(assignment => assignment.unitId) });
    if (assessment.status === 'blocked') return blockedExecutor(input, assessment.reasonCode, [...assessment.unitIds]);
    if (!assessment.unitIds.length) return blockedExecutor(input, 'no-granted-assembly-members');
    const movements = intent.posts.flatMap(post => {
      const members = assessment.unitIds.filter(id => post.unitIds.includes(id));
      if (!members.length) return [];
      const selected = new Set(members);
      return [assembleExecutor.execute({ ...input, execution: { ...input.execution, target: post.target },
        grant: { ...input.grant,
          leases: input.grant.leases.filter(lease => lease.resourceKey.startsWith('unit:') && selected.has(lease.resourceKey.slice(5))),
          assignments: input.grant.assignments.filter(assignment => selected.has(assignment.unitId)) } })];
    });
    const blocked = movements.find(movement => movement.status === 'blocked');
    if (blocked) return blocked;
    const complete = assessment.sufficient;
    return { ...movements[0]!, commands: movements.flatMap(movement => movement.commands), status: complete ? 'complete' : 'active',
      phase: complete ? 'force-assembled' : movements.every(movement => movement.status === 'complete') ? 'waiting-for-force' : 'assembling-force',
      state: { ...input.execution.state, arrivedUnitIds: assessment.onStationUnitIds,
        assembledForce: assessment.assembledForce, requiredForce: assessment.requiredForce } };
  },
};
