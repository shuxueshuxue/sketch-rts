import type { GameSnapshot, PlayerId } from '../../shared/types';
import { goalValueKey } from './goal-facts';
import type { GoalActionDeclaration } from './goal-planner-types';
import { strategyIsOpponent } from './ownership';

/** Lossless price inputs for selected proposals only. Physical time alone is
 * absent; changed actor state, opposition, hazards or terrain invalidate an
 * exact quotation even when an optimistic coarse price happens to be equal. */
export function createGoalRefinementRevision(snapshot: GameSnapshot, owner: PlayerId, geometryRevision: string) {
  const opposition = [...snapshot.units, ...snapshot.buildings].filter(entity => entity.hp > 0
    && (entity.owner === 'neutral' || strategyIsOpponent(snapshot, owner, entity.owner)));
  const shared = [geometryRevision, snapshot.teams, snapshot.variants, opposition, snapshot.projectiles, snapshot.effects, snapshot.obstacles];
  return (action: GoalActionDeclaration): string => {
    const ids = new Set<string>();
    const references = (value: unknown, key = '') => {
      if (Array.isArray(value)) { value.forEach(item => references(item, key)); return; }
      if (typeof value === 'string' && ['unitIds', 'dependentUnitIds', 'loadedUnitIds'].includes(key)) ids.add(value);
      if (!value || typeof value !== 'object') return;
      for (const [name, item] of Object.entries(value)) {
        if (name === 'entityId' && typeof item === 'string') ids.add(item);
        references(item, name);
      }
    };
    references(action.executor.parameters); references(action.demands);
    return goalValueKey([shared, [...snapshot.units, ...snapshot.buildings].filter(entity => ids.has(entity.id))]);
  };
}
