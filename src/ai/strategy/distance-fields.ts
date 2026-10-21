import { moverDistanceField, prepareMoverDistanceField, retainGoalDistanceField, type GroundDistanceField, type Mover } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { Point } from './types';
import { OBSERVATION_FIELD_LIMIT, type StrategyObservationMemory } from './observation-memory';
import { currentFactWork } from './fact-work';
import { withFactNavigation } from '../../shared/navigation-audit';

export function createPlanningDistanceQuery(snapshot: GameSnapshot, buildBudget = Infinity, mover: Mover = 'land', observation?: StrategyObservationMemory) {
  let built = 0, deferred = 0, work = 0;
  const queries = new Map<number, Map<number, { field: GroundDistanceField; builtTick: number } | null>>();
  return {
    field(goal: Point) {
      let row = queries.get(goal.y); if (!row) queries.set(goal.y, row = new Map());
      if (row.has(goal.x)) return row.get(goal.x)!;
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
        if (currentFactWork() && entry.readyTick >= snapshot.tick) {
          deferred++; row.set(goal.x, null); return null;
        }
        field = withFactNavigation({ kind: 'published-fact', throughWork: entry.work },
          () => prepareMoverDistanceField(snapshot.map, goal, mover, entry!.work)).field;
      } else if (built < buildBudget) {
        const queue = currentFactWork();
        if (queue) {
          const progress = entry;
          queue.register({ key: `field:${mover}:${goal.x}:${goal.y}`, minimum: 1,
            tier: progress.work > 0 ? 'existing-field' : 'background-field',
            run(allowance) {
              const before = progress.work;
              const result = prepareMoverDistanceField(snapshot.map, goal, mover, before + Math.min(2048, allowance));
              progress.work = result.work;
              if (result.complete) progress.readyTick = snapshot.tick;
              return { work: result.work - before, done: result.complete };
            } });
          deferred++; row.set(goal.x, null); return null;
        }
        const before = entry.work;
        const result = prepareMoverDistanceField(snapshot.map, goal, mover,
          Number.isFinite(buildBudget) ? before + 2048 : Infinity);
        field = result.field; entry.work = result.work; work += result.work - before;
        if (result.complete) entry.readyTick = snapshot.tick;
        built++;
      }
      if (!field) { deferred++; row.set(goal.x, null); return null; }
      retainGoalDistanceField(snapshot.map, goal, mover);
      const result = { field, builtTick: entry?.readyTick ?? snapshot.tick };
      row.set(goal.x, result); return result;
    },
    get built() { return built; },
    get work() { return work; },
    get deferred() { return deferred; },
  };
}
