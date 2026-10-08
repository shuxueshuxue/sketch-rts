import { UNIT_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { projectedSupplyUsed } from '../policy/world-model';
import type { AiScript } from '../policy/types';

/** Fill a mining base while it rises, before competing army and technology purchases. */
export const miningWorkforce: AiScript = {
  id: 'miningWorkforce',
  phase: 'economy',
  run: planMiningWorkforce,
};

export function planMiningWorkforce(snapshot: GameSnapshot, owner: PlayerId): GameCommand[] {
  const halls = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'townHall');
  const miningHalls = halls.filter(hall => snapshot.resources.some(mine => mine.amount > 0
    && Math.hypot(mine.x - hall.x, mine.y - hall.y) <= GOLD_MINE_RULES.baseRange));
  const workers = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && !unit.deck).length;
  const queued = halls.reduce((total, hall) => total + hall.queue.filter(job => job.unitKind === 'worker').length, 0);
  let missing = Math.min(36, miningHalls.length * GOLD_MINE_RULES.workstations + 1) - workers - queued;
  let gold = snapshot.players[owner]!.gold;
  let supply = projectedSupplyUsed(snapshot, owner);
  const commands: GameCommand[] = [];
  for (const hall of halls) {
    if (missing <= 0 || gold < UNIT_DEFS.worker.cost || supply + UNIT_DEFS.worker.supplyUsed > snapshot.players[owner]!.supplyCap) break;
    if (!hall.complete || hall.queue.length > 0) continue;
    commands.push({ type: 'train', buildingId: hall.id, unitKind: 'worker' });
    missing -= 1;
    gold -= UNIT_DEFS.worker.cost;
    supply += UNIT_DEFS.worker.supplyUsed;
  }
  return commands;
}
