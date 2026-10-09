import { detCos, detSin } from '../../shared/det-math';
import { isWalkable, sameGround } from '../../shared/terrain';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { isOpponentOwner } from '../policy/ownership';
import { distance, type Point } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { neutralCamps } from '../policy/v7/creep';
import { mountedEscape, mountedMicro, mountedTargetOrder } from './mounted-micro';

const THREAT_RANGE = 750;

function firingPoint(snapshot: GameSnapshot, rider: Unit, worker: Unit, towers: readonly Building[]): Point | undefined {
  const angles = [Math.atan2(rider.y - worker.y, rider.x - worker.x),
    ...towers.map(tower => Math.atan2(worker.y - tower.y, worker.x - tower.x)),
    ...Array.from({ length: 16 }, (_, index) => index * Math.PI / 8)];
  return angles.map(angle => ({ x: worker.x + detCos(angle) * (rider.attackRange - 10), y: worker.y + detSin(angle) * (rider.attackRange - 10) }))
    .filter(point => point.x >= 0 && point.y >= 0 && point.x < snapshot.map.width && point.y < snapshot.map.height
      && isWalkable(snapshot.map, point.x, point.y) && sameGround(snapshot.map, rider, point)
      && towers.every(tower => distance(point, tower) > tower.attackRange + rider.radius))
    .sort((a, b) => distance(rider, a) - distance(rider, b))[0];
}

function raidWorkers(snapshot: GameSnapshot, owner: PlayerId, hall: Building) {
  return snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && !unit.deck && distance(unit, hall) <= 650);
}

function assign(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const available = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'horseArcher' && !unit.deck
    && !['board', 'cast', 'charge'].includes(unit.order.type)
    && options.memory.unitClaims[unit.id]?.kind !== 'retreat');
  const byId = new Map(available.map(unit => [unit.id, unit]));
  const towers = snapshot.buildings.filter(building => building.complete && building.attackDamage > 0 && isOpponentOwner(snapshot, owner, building.owner, options));
  const active = options.memory.mounted ? options.memory.mounted.filter(assignment => {
    assignment.unitIds = assignment.unitIds.filter(id => byId.has(id));
    if (assignment.unitIds.length === 0) return false;
    const objective = assignment.objective;
    if (objective.kind === 'camp') return snapshot.units.some(unit => objective.ids.includes(unit.id));
    const hall = snapshot.buildings.find(building => building.id === objective.hallId);
    if (!hall) return false;
    const crew = assignment.unitIds.map(id => byId.get(id)!);
    // A cleared or fully covered mining line ends the raid; nearby pursuers still belong to this fight.
    return raidWorkers(snapshot, objective.owner, hall).some(worker => crew.some(rider => firingPoint(snapshot, rider, worker, towers)))
      || snapshot.units.some(unit => unit.attackDamage > 0 && !unit.deck && isOpponentOwner(snapshot, owner, unit.owner, options)
        && crew.some(rider => distance(unit, rider) < THREAT_RANGE && (distance(unit, rider) <= rider.attackRange
          || (unit.order.type === 'attack' || unit.order.type === 'attackMove') && unit.order.targetId === rider.id)));
  }) : [];
  options.memory.mounted = active;
  const assigned = new Set(active.flatMap(assignment => assignment.unitIds));
  // Health gates a new sortie; an injured rider keeps its current fight until recovery takes command.
  let riders = available.filter(unit => unit.hp >= unit.maxHp * .8 && !assigned.has(unit.id));
  const raid = active.find(assignment => assignment.objective.kind === 'raid' && assignment.unitIds.length < 3);
  if (raid) {
    const lead = byId.get(raid.unitIds[0]!)!;
    const recruits = riders.filter(unit => sameGround(snapshot.map, lead, unit)).slice(0, 3 - raid.unitIds.length);
    raid.unitIds.push(...recruits.map(unit => unit.id));
    riders = riders.filter(unit => !recruits.includes(unit));
  }
  if (!riders.length) return active;
  const lead = riders[0]!;
  const halls = snapshot.buildings.filter(building => building.kind === 'townHall' && isOpponentOwner(snapshot, owner, building.owner, options))
    .filter(hall => raidWorkers(snapshot, hall.owner, hall).some(worker => sameGround(snapshot.map, lead, worker) && firingPoint(snapshot, lead, worker, towers)))
    .sort((a, b) => distance(lead, a) - distance(lead, b));
  const camp = neutralCamps(snapshot).filter(camp => !active.some(assignment => assignment.objective.kind === 'camp'
      && assignment.objective.ids.some(id => camp.creeps.some(unit => unit.id === id))) && sameGround(snapshot.map, lead, camp.center)
    && snapshot.resources.some(mine => mine.amount > 0 && distance(mine, camp.center) <= GOLD_MINE_RULES.baseRange))
    .sort((a, b) => distance(lead, a.center) - distance(lead, b.center))[0];
  if (halls.length && (riders.length >= 2 || !camp)) {
    const hall = halls[0]!;
    active.push({ unitIds: riders.slice(0, 3).map(unit => unit.id), objective: { kind: 'raid', hallId: hall.id, owner: hall.owner } });
    return active;
  }
  if (!camp) return active;
  active.push({ unitIds: [lead.id], objective: { kind: 'camp', ids: camp.creeps.map(unit => unit.id) } });
  return active;
}

export const mountedTasks: AiScript = {
  id: 'mountedTasks', phase: 'tactics',
  claimsUnits: (snapshot, owner, options) => new Set(assign(snapshot, owner, options).flatMap(assignment => assignment.unitIds)),
  run(snapshot, owner, options): GameCommand[] {
    const towers = snapshot.buildings.filter(building => building.complete && building.attackDamage > 0 && isOpponentOwner(snapshot, owner, building.owner, options));
    return options.memory.mounted!.flatMap(assignment => {
      const objective = assignment.objective;
      const candidates = objective.kind === 'camp' ? snapshot.units.filter(unit => objective.ids.includes(unit.id))
        : raidWorkers(snapshot, objective.owner, snapshot.buildings.find(building => building.id === objective.hallId)!);
      return snapshot.units.filter(unit => assignment.unitIds.includes(unit.id)).flatMap(rider => {
        const workers = candidates.map(target => ({ target, point: objective.kind === 'camp' ? target : firingPoint(snapshot, rider, target, towers) }))
          .filter((choice): choice is { target: Unit; point: Point } => choice.point !== undefined);
        const local = snapshot.units.filter(unit => unit.attackDamage > 0 && !unit.deck && unit.owner !== owner
          && (unit.owner === 'neutral' || isOpponentOwner(snapshot, owner, unit.owner, options))
          && (distance(unit, rider) < THREAT_RANGE || objective.kind === 'camp' && objective.ids.includes(unit.id)));
        const pursuers = local.filter(unit => isOpponentOwner(snapshot, owner, unit.owner, options)
          && (distance(rider, unit) <= rider.attackRange
            || (unit.order.type === 'attack' || unit.order.type === 'attackMove') && unit.order.targetId === rider.id))
          .map(target => ({ target, point: target }));
        const inRange = workers.filter(choice => distance(rider, choice.target) <= rider.attackRange);
        const choices = objective.kind === 'camp' ? workers : inRange.length ? inRange : pursuers.length ? pursuers : workers;
        choices.sort((a, b) => (objective.kind === 'raid'
          ? Number(distance(rider, b.target) <= rider.attackRange) - Number(distance(rider, a.target) <= rider.attackRange) : 0)
          || mountedTargetOrder(a.target, b.target) || distance(rider, a.target) - distance(rider, b.target));
        const choice = choices[0];
        if (choice) return [mountedMicro(snapshot, rider, choice.target, [...local, ...towers], objective.kind === 'camp' ? { kind: 'camp' } : { kind: 'raid', station: choice.point })];
        return towers.some(tower => distance(rider, tower) <= tower.attackRange)
          ? [mountedEscape(snapshot, rider, towers, 0, undefined)] : [{ type: 'holdPosition', unitIds: [rider.id] }];
      });
    });
  },
};
