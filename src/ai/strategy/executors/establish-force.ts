import { unitMover } from '../../../shared/catalog';
import type { StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, grantedUnits, validExecutorGrant } from '../executor-grants';
import { landIdAt } from '../regions';
import { assessAllocatedForce } from '../allocated-force';

/** A reinforcement effect is presence on this land, not ownership of a hall or
 * permission to march through an uncleared camp at the island's center. */
export const establishForceExecutor: StrategyExecutor = {
  id: 'strategy.establish-force',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const units = grantedUnits(input).filter(unit => unit.kind !== 'worker' && unitMover(unit.kind) === 'land' && !unit.deck && !unit.cabin
      && landIdAt(input.snapshot.map, unit) === input.execution.target.landId
      && !input.grant.assignments.some(assignment => assignment.unitId === unit.id && assignment.interruption));
    const effect = input.execution.completionEffects.find(effect => effect.kind === 'force-present');
    const requiredForce = effect?.kind === 'force-present' ? effect.minimumStrength : 1;
    if (!assessAllocatedForce(input.owner, units, { metric: 'field-strength', requiredForce }).sufficient)
      return blockedExecutor(input, 'insufficient-reinforcement-force-actually-landed', units.map(unit => unit.id));
    return { ...executorFeedback(input), status: 'complete', phase: 'reinforcement-actually-landed',
      progress: [{ kind: 'garrison-arrived', unitIds: units.map(unit => unit.id), entityIds: [], basis: 'observed-world' }] };
  },
};
