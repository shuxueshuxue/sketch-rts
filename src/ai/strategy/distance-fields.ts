import { moverDistanceField, prepareMoverDistanceField, type GroundDistanceField, type Mover } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { Point } from './types';
import { OBSERVATION_FIELD_LIMIT, type StrategyObservationMemory } from './observation-memory';

export function createPlanningDistanceQuery(snapshot: GameSnapshot, buildBudget = Infinity, mover: Mover = 'land', observation?: StrategyObservationMemory) {
  let built = 0, deferred = 0, work = 0;
  const queries = new Map<string, { field: GroundDistanceField; builtTick: number } | null>();
  return {
    field(goal: Point) {
      const key = `${goal.x}:${goal.y}`;
      if (queries.has(key)) return queries.get(key)!;
      const entries = observation?.fields[mover];
      let entry = entries?.find(entry => entry.goal.x === goal.x && entry.goal.y === goal.y);
      if (entries && !entry) {
        if (entries.length >= OBSERVATION_FIELD_LIMIT) entries.shift();
        entry = { goal: { ...goal }, work: 0, readyTick: null }; entries.push(entry);
      }
      let field: GroundDistanceField | undefined;
      if (!entry) {
        // Stateless diagnostic evaluation is complete and cache-independent.
        field = moverDistanceField(snapshot.map, goal, mover);
      } else if (entry.readyTick !== null) {
        field = prepareMoverDistanceField(snapshot.map, goal, mover, entry.work).field;
      } else if (built < buildBudget) {
        const before = entry.work;
        const result = prepareMoverDistanceField(snapshot.map, goal, mover,
          Number.isFinite(buildBudget) ? before + 2048 : Infinity);
        field = result.field; entry.work = result.work; work += result.work - before;
        if (result.complete) entry.readyTick = snapshot.tick;
        built++;
      }
      if (!field) { deferred++; queries.set(key, null); return null; }
      const result = { field, builtTick: entry?.readyTick ?? snapshot.tick };
      queries.set(key, result); return result;
    },
    get built() { return built; },
    get work() { return work; },
    get deferred() { return deferred; },
  };
}
