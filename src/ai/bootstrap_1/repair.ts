import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { sameGround } from '../../shared/terrain';
import { isOpponentOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';

type RepairAssignment = { worker: Unit; tower: Building };

export const battleRepair: AiScript = {
  id: 'battleRepair',
  phase: 'tactics',
  run: planBattleRepairs,
  claimsUnits: (snapshot, owner, options) => new Set(repairAssignments(snapshot, owner, options).map(({ worker }) => worker.id)),
};

export function planBattleRepairs(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  return repairAssignments(snapshot, owner, options).flatMap(({ worker, tower }) =>
    worker.order.type === 'repair' && worker.order.buildingId === tower.id
      ? [] : [{ type: 'repair', unitIds: [worker.id], buildingId: tower.id }]);
}

function repairAssignments(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): RepairAssignment[] {
  if (snapshot.players[owner]!.gold < 1) return [];
  const foes = snapshot.units.filter(unit => isOpponentOwner(snapshot, owner, unit.owner, options));
  const towers = snapshot.buildings.filter(building => building.owner === owner && building.kind === 'defenseTower'
    && building.complete && building.hp < building.maxHp
    && (foes.some(unit => 'targetId' in unit.order && unit.order.targetId === building.id)
      || snapshot.projectiles.some(shot => isOpponentOwner(snapshot, owner, shot.owner, options) && shot.targetId === building.id)))
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
  // Mine slots are the actual income-producing workers. Repair uses the spare builder, never an occupied slot.
  const available = new Set(snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker'
    && !unit.deck && unit.mineSlot === undefined && ['idle', 'mine', 'repair'].includes(unit.order.type)));
  const assignments: RepairAssignment[] = [];
  for (const tower of towers) {
    const worker = [...available].filter(unit => distance(unit, tower) <= 320 && sameGround(snapshot.map, unit, tower))
      .sort((a, b) => Number(b.order.type === 'repair' && b.order.buildingId === tower.id)
        - Number(a.order.type === 'repair' && a.order.buildingId === tower.id) || distance(a, tower) - distance(b, tower))[0];
    if (!worker) continue;
    available.delete(worker);
    assignments.push({ worker, tower });
  }
  return assignments;
}
