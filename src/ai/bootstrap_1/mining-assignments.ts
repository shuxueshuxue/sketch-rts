import { GOLD_MINE_RULES } from '../../shared/mining';
import { sameGround } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { distance } from '../policy/spatial';
import type { AiScript } from '../policy/types';

type Miner = Unit & { order: Extract<Unit['order'], { type: 'mine' }> };

function assignments(snapshot: GameSnapshot, owner: PlayerId) {
  const halls = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall' && building.complete);
  const mines = snapshot.resources.filter(mine => mine.amount > 0 && halls.some(hall => distance(hall, mine) <= GOLD_MINE_RULES.baseRange));
  const counts = new Map(mines.map(mine => [mine.id, 0]));
  const workers = snapshot.units.filter((unit): unit is Miner => unit.owner === owner && unit.kind === 'worker' && !unit.deck && unit.order.type === 'mine');
  for (const worker of workers) if (counts.has(worker.order.resourceId)) {
    counts.set(worker.order.resourceId, counts.get(worker.order.resourceId)! + 1);
  }
  const result: { unitId: string; resourceId: string }[] = [];
  for (const worker of workers) {
    if (counts.has(worker.order.resourceId)) continue;
    const mine = mines.filter(mine => sameGround(snapshot.map, worker, mine))
      .sort((a, b) => counts.get(a.id)! - counts.get(b.id)! || distance(worker, a) - distance(worker, b))[0];
    if (mine) {
      result.push({ unitId: worker.id, resourceId: mine.id });
      counts.set(mine.id, counts.get(mine.id)! + 1);
    }
  }
  return result;
}

/** Losing a mining hall ends its workers' old hauling route. */
export const miningAssignments: AiScript = {
  id: 'miningAssignments', phase: 'tactics',
  run(snapshot, owner) {
    return assignments(snapshot, owner).map(({ unitId, resourceId }) => ({ type: 'mine' as const, unitIds: [unitId], resourceId }));
  },
};
