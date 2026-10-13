import { detCos, detSin } from '../../shared/det-math';
import { isOpenGround, isWalkable, sameGround, walkingDistance } from '../../shared/terrain';
import { nearestByRoute } from '../../shared/route-selection';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { retreatLandTravelTicks } from './safe-land-route';
import { GOLD_MINE_RULES } from '../../shared/mining';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { isOpponentOwner } from '../policy/ownership';
import { distance, type Point } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { neutralCamps, type Camp } from '../policy/v7/creep';
import { THINK_TICKS, mountedEscape, mountedMicro, mountedTargetOrder, mountedThreatReach } from './mounted-micro';

const THREAT_RANGE = 750;

export function mountedFiringPoint(snapshot: GameSnapshot, rider: Unit, worker: Point, towers: readonly Building[], defenders: readonly Unit[]): Point | undefined {
  const angles = [Math.atan2(rider.y - worker.y, rider.x - worker.x),
    ...towers.map(tower => Math.atan2(worker.y - tower.y, worker.x - tower.x)),
    ...Array.from({ length: 16 }, (_, index) => index * Math.PI / 8)];
  const points = angles.map(angle => ({ x: worker.x + detCos(angle) * (rider.attackRange - 10), y: worker.y + detSin(angle) * (rider.attackRange - 10) }))
    .filter(point => point.x >= 0 && point.y >= 0 && point.x < snapshot.map.width && point.y < snapshot.map.height
      && isOpenGround(snapshot.map, point.x, point.y) && sameGround(snapshot.map, rider, point)
      && towers.every(tower => distance(point, tower) > tower.attackRange + rider.radius)
      && defenders.every(foe => {
        const gap = distance(point, foe);
        return gap >= THREAT_RANGE || gap > mountedThreatReach(snapshot, foe, { ...point, radius: rider.radius }, THINK_TICKS + rider.cooldown)
          + foe.speed * THINK_TICKS / SIM_TICKS_PER_SECOND;
      }));
  if (distance(rider, worker) < THREAT_RANGE) return nearestByRoute(snapshot.map, points, rider, 'land');
  return points.map(point => ({ point, road: walkingDistance(snapshot.map, rider, point, 'land')! }))
    .sort((a, b) => a.road - b.road)
    .find(({ point }) => retreatLandTravelTicks(snapshot, rider, point, [...towers, ...defenders]) !== undefined)?.point;
}

function raidWorkers(snapshot: GameSnapshot, owner: PlayerId, hall: Building) {
  return snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && !unit.deck && distance(unit, hall) <= 650);
}

function exposedMiningLine(snapshot: GameSnapshot, rider: Unit, worker: Unit, hall: Building, towers: readonly Building[], defenders: readonly Unit[]) {
  if (mountedFiringPoint(snapshot, rider, worker, towers, defenders)) return true;
  if (worker.order.type !== 'mine') return false;
  const resourceId = worker.order.resourceId;
  const mine = snapshot.resources.find(resource => resource.id === resourceId && resource.amount > 0);
  if (!mine) return false;
  const gap = distance(hall, mine);
  if (gap > GOLD_MINE_RULES.baseRange || gap <= GOLD_MINE_RULES.entryRange) return false;
  const entry = { x: mine.x + (hall.x - mine.x) * GOLD_MINE_RULES.entryRange / gap,
    y: mine.y + (hall.y - mine.y) * GOLD_MINE_RULES.entryRange / gap };
  return isWalkable(snapshot.map, entry.x, entry.y) && sameGround(snapshot.map, worker, entry)
    && mountedFiringPoint(snapshot, rider, entry, towers, defenders) !== undefined;
}

/** Prospective scouts and live raids use the same exposed line and admitted station. */
export function nextMountedRaid(snapshot: GameSnapshot, owner: PlayerId, rider: Unit,
  towers: readonly Building[], defenders: readonly Unit[], options: AiPolicyContext) {
  return nearestByRoute(snapshot.map, snapshot.buildings
      .filter(building => building.kind === 'townHall' && isOpponentOwner(snapshot, owner, building.owner, options))
      .filter(hall => raidWorkers(snapshot, hall.owner, hall).some(worker => sameGround(snapshot.map, rider, worker) && exposedMiningLine(snapshot, rider, worker, hall, towers, defenders))), rider, 'land');
}

/** Recruitment and live assignments use the same next profitable camp and actual road ordering. */
export function nextMountedCamp(snapshot: GameSnapshot, rider: Unit, camps: readonly Camp[], occupied: ReadonlySet<string>) {
  const choices = camps.filter(camp => !camp.creeps.some(creep => occupied.has(creep.id)) && sameGround(snapshot.map, rider, camp.center)
    && snapshot.resources.some(mine => mine.amount > 0 && distance(mine, camp.center) <= GOLD_MINE_RULES.baseRange));
  return nearestByRoute(snapshot.map, choices.map(camp => ({ ...camp.center, camp })), rider, 'land')?.camp;
}

export function availableMountedRiders(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'horseArcher' && !unit.deck
    && unit.id !== options.memory.shopping?.unitId
    && !['board', 'cast', 'charge'].includes(unit.order.type)
    && options.memory.unitClaims[unit.id]?.kind !== 'retreat');
}

function assign(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const available = availableMountedRiders(snapshot, owner, options);
  const byId = new Map(available.map(unit => [unit.id, unit]));
  const towers = snapshot.buildings.filter(building => building.complete && building.attackDamage > 0 && isOpponentOwner(snapshot, owner, building.owner, options));
  const defenders = snapshot.units.filter(unit => unit.attackDamage > 0 && !unit.deck && isOpponentOwner(snapshot, owner, unit.owner, options));
  const active = options.memory.mounted ? options.memory.mounted.filter(assignment => {
    assignment.unitIds = assignment.unitIds.filter(id => byId.has(id));
    if (assignment.unitIds.length === 0) return false;
    const objective = assignment.objective;
    if (objective.kind === 'camp') return snapshot.units.some(unit => objective.ids.includes(unit.id));
    const hall = snapshot.buildings.find(building => building.id === objective.hallId);
    if (!hall) return false;
    const crew = assignment.unitIds.map(id => byId.get(id)!);
    // A cleared or fully covered mining line ends the raid; nearby pursuers still belong to this fight.
    return raidWorkers(snapshot, objective.owner, hall).some(worker => crew.some(rider => exposedMiningLine(snapshot, rider, worker, hall, towers, defenders)))
      || snapshot.units.some(unit => unit.attackDamage > 0 && !unit.deck && isOpponentOwner(snapshot, owner, unit.owner, options)
        && crew.some(rider => distance(unit, rider) < THREAT_RANGE && (distance(unit, rider) <= rider.attackRange
          || (unit.order.type === 'attack' || unit.order.type === 'attackMove') && unit.order.targetId === rider.id)));
  }) : [];
  options.memory.mounted = active;
  const assigned = new Set(active.flatMap(assignment => assignment.unitIds));
  // Health gates a new sortie; an injured rider keeps its current fight until recovery takes command.
  let riders = available.filter(unit => unit.hp >= unit.maxHp * .8 && !assigned.has(unit.id));
  for (const raid of active.filter(assignment => assignment.objective.kind === 'raid' && assignment.unitIds.length < 3)) {
    const lead = byId.get(raid.unitIds[0]!)!;
    const recruits = riders.filter(unit => sameGround(snapshot.map, lead, unit)).slice(0, 3 - raid.unitIds.length);
    raid.unitIds.push(...recruits.map(unit => unit.id));
    riders = riders.filter(unit => !recruits.includes(unit));
  }
  if (!riders.length) return active;
  const campLocations = neutralCamps(snapshot);
  while (riders.length) {
    const lead = riders[0]!;
    const local = riders.filter(unit => sameGround(snapshot.map, lead, unit));
    const hall = nextMountedRaid(snapshot, owner, lead, towers, defenders, options);
    const occupied = new Set(active.flatMap(task => task.objective.kind === 'camp' ? task.objective.ids : []));
    const camp = nextMountedCamp(snapshot, lead, campLocations, occupied);
    // A lone scout raids an exposed line when it is closer than the next camp.
    if (hall && (local.length >= 2 || !camp
      || walkingDistance(snapshot.map, lead, hall, 'land')! < walkingDistance(snapshot.map, lead, camp.center, 'land')!)) {
      const crew = local.slice(0, 3);
      active.push({ unitIds: crew.map(unit => unit.id), objective: { kind: 'raid', hallId: hall.id, owner: hall.owner } });
      riders = riders.filter(unit => !crew.includes(unit));
      continue;
    }
    if (!camp) { riders = riders.filter(unit => !local.includes(unit)); continue; }
    active.push({ unitIds: [lead.id], objective: { kind: 'camp', ids: camp.creeps.map(unit => unit.id) } });
    riders = riders.filter(unit => unit !== lead);
  }
  return active;
}

export const mountedTasks: AiScript = {
  id: 'mountedTasks', phase: 'tactics',
  claimsUnits: (snapshot, owner, options) => new Set(assign(snapshot, owner, options).flatMap(assignment => assignment.unitIds)),
  run(snapshot, owner, options): GameCommand[] {
    const towers = snapshot.buildings.filter(building => building.complete && building.attackDamage > 0 && isOpponentOwner(snapshot, owner, building.owner, options));
    const defenders = snapshot.units.filter(unit => unit.attackDamage > 0 && !unit.deck && isOpponentOwner(snapshot, owner, unit.owner, options));
    return options.memory.mounted!.flatMap(assignment => {
      const objective = assignment.objective;
      const candidates = objective.kind === 'camp' ? snapshot.units.filter(unit => objective.ids.includes(unit.id))
        : raidWorkers(snapshot, objective.owner, snapshot.buildings.find(building => building.id === objective.hallId)!);
      return snapshot.units.filter(unit => assignment.unitIds.includes(unit.id)).flatMap(rider => {
        const workers = candidates.map(target => ({ target, point: objective.kind === 'camp' ? target : mountedFiringPoint(snapshot, rider, target, towers, defenders) }))
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
          ? [mountedEscape(snapshot, rider, towers, 0, undefined, true)] : [{ type: 'holdPosition', unitIds: [rider.id] }];
      });
    });
  },
};
