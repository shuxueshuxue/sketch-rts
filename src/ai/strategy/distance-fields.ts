import { advanceMoverDistanceField, moverDistanceField, type GroundDistanceField, type Mover } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { Point } from './types';

const ages = new WeakMap<GroundDistanceField, number>();
export function createPlanningDistanceQuery(snapshot: GameSnapshot, buildBudget = Infinity, mover: Mover = 'land') {
  let built = 0, deferred = 0, work = 0;
  const queries = new Map<string, { field: GroundDistanceField; builtTick: number } | null>();
  return {
    field(goal: Point) {
      const key = `${goal.x}:${goal.y}`;
      if (queries.has(key)) return queries.get(key)!;
      let field = moverDistanceField(snapshot.map, goal, mover, true);
      if (!field && built < buildBudget) {
        if (Number.isFinite(buildBudget)) {
          const result = advanceMoverDistanceField(snapshot.map, goal, mover, 2048);
          field = result.field; work += result.work;
        } else field = moverDistanceField(snapshot.map, goal, mover);
        built++;
      }
      if (!field) { deferred++; queries.set(key, null); return null; }
      if (!ages.has(field)) ages.set(field, snapshot.tick);
      const result = { field, builtTick: ages.get(field)! };
      queries.set(key, result); return result;
    },
    get built() { return built; },
    get work() { return work; },
    get deferred() { return deferred; },
  };
}
