import type { GameSnapshot, PlayerId } from '../../shared/types';
import { goalValueKey } from './goal-facts';
import type { GoalActionDeclaration } from './goal-planner-types';
import { strategyIsOpponent } from './ownership';
import { goalPlanningIdentity } from './goal-planning-references';

/** Lossless price inputs for selected proposals only. Physical time alone is
 * absent; changed actor state, opposition, hazards or terrain invalidate an
 * exact quotation even when an optimistic coarse price happens to be equal. */
export function createGoalRefinementRevision(snapshot: GameSnapshot, owner: PlayerId, geometryRevision: string) {
  const opposition = [...snapshot.units, ...snapshot.buildings].filter(entity => entity.hp > 0
    && (entity.owner === 'neutral' || strategyIsOpponent(snapshot, owner, entity.owner)));
  const shared = [geometryRevision, snapshot.teams, snapshot.variants, opposition, snapshot.projectiles, snapshot.effects, snapshot.obstacles];
  const world = goalPlanningIdentity('quotation-world', goalValueKey(shared));
  return (action: GoalActionDeclaration): string => {
    const ids = new Set<string>(), poolKinds = new Set<string>();
    const references = (value: unknown, key = '') => {
      if (Array.isArray(value)) { value.forEach(item => references(item, key)); return; }
      if (typeof value === 'string' && ['unitIds', 'dependentUnitIds', 'loadedUnitIds'].includes(key)) ids.add(value);
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      if (row.kind === 'pool-member' && typeof row.unitKind === 'string') poolKinds.add(row.unitKind);
      for (const [name, item] of Object.entries(value)) {
        if (name === 'entityId' && typeof item === 'string') ids.add(item);
        references(item, name);
      }
    };
    references(action.executor.parameters); references(action.demands);
    // A fungible builder has no identity until ready selection. Its price can
    // still depend on any actual member that can enter/leave the quoted pool;
    // include those native member states before a route profile is bound.
    const actors = goalPlanningIdentity('quotation-actors', goalValueKey([...snapshot.units, ...snapshot.buildings].filter(entity => ids.has(entity.id)
      || entity.owner === owner && poolKinds.has(entity.kind))));
    return goalPlanningIdentity('quotation-source', goalValueKey([world, actors]));
  };
}
