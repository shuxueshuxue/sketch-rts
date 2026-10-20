import { groundDistanceField, type GroundDistanceField } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { Point } from './types';

const ages = new WeakMap<GroundDistanceField, number>();
export function createPlanningDistanceQuery(snapshot: GameSnapshot, buildBudget = Infinity) {
  let built = 0, deferred = 0;
  const queries = new Map<string, { field: GroundDistanceField; builtTick: number } | null>();
  return {
    field(goal: Point) {
      const key = `${goal.x}:${goal.y}`;
      if (queries.has(key)) return queries.get(key)!;
      let field = groundDistanceField(snapshot.map, goal, true);
      if (!field && built < buildBudget) { field = groundDistanceField(snapshot.map, goal); built++; }
      if (!field) { deferred++; queries.set(key, null); return null; }
      if (!ages.has(field)) ages.set(field, snapshot.tick);
      const result = { field, builtTick: ages.get(field)! };
      queries.set(key, result); return result;
    },
    get built() { return built; },
    get deferred() { return deferred; },
  };
}
