import { detCos, detSin } from '../../shared/det-math';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { groundSteeringRoute, routeClearsDisks, routeLeavesDisks, routeWithinDistance } from '../../shared/route-selection';
import { isOpenGround } from '../../shared/terrain';
import type { Building, GameCommand, GameSnapshot, Unit } from '../../shared/types';
import { distance, type Point } from '../policy/spatial';
import { CREEP_STAGING_TURNS, neutralCamps, type Camp } from '../policy/v7/creep';
import { JOIN_RANGE } from '../policy/v6/general';
import { strengthOf } from '../policy/v6/strength';
import { DETOUR_GAP, END_CLEARANCE, PASS_CLEARANCE } from '../policy/v9/march';
import { retreatThreatReach } from './safe-land-route';
import { THINK_TICKS } from './mounted-micro';

type March = { kind: 'direct' } | { kind: 'detour'; point: Point } | { kind: 'blocked' };

/** A transit road must clear camps on every native steering segment, including its second leg. */
export function assaultCampRouter(snapshot: GameSnapshot, goal: Point, camps: readonly Camp[], contactAtDestination: boolean) {
  const transit = camps.filter(camp => !contactAtDestination || distance(camp.center, goal) > camp.reach + END_CLEARANCE);
  const disks = transit.flatMap(camp => camp.creeps.map(creep => ({ x: creep.x, y: creep.y, radius: PASS_CLEARANCE })));
  const target = snapshot.buildings.find(building => distance(building, goal) <= MOVE_ORDER_ARRIVAL_RANGE);
  const roads = new Map<string, ReturnType<typeof groundSteeringRoute>>();
  const nativeRoad = (from: Point, to: Point) => {
    const key = `${from.x}:${from.y}:${to.x}:${to.y}`;
    if (!roads.has(key)) roads.set(key, groundSteeringRoute(snapshot.map, from, to));
    return roads.get(key)!;
  };
  const roadTo = (from: Point, to: Point, reach: number) => {
    const road = nativeRoad(from, to);
    return distance(road[road.length - 1]!, to) <= reach && routeLeavesDisks(road, disks) ? road : undefined;
  };
  return (unit: Unit): March => {
    const arrival = target ? target.radius + unit.radius + unit.attackRange : MOVE_ORDER_ARRIVAL_RANGE;
    const direct = nativeRoad(unit, goal);
    if (distance(direct[direct.length - 1]!, goal) > arrival) return { kind: 'blocked' };
    if (routeLeavesDisks(direct, disks)) return { kind: 'direct' };
    const blocking = transit.map(camp => {
      const coverage = camp.creeps.map(creep => ({ x: creep.x, y: creep.y, radius: PASS_CLEARANCE }));
      return { camp, at: routeLeavesDisks(direct, coverage) ? -1 : direct.findIndex((point, index) => index > 0
        && !routeClearsDisks([direct[index - 1]!, point], coverage)) };
    }).filter(item => item.at >= 0).sort((a, b) => a.at - b.at);
    const points = blocking.slice(0, 1).flatMap(({ camp }) => {
      const gap = distance(camp.center, goal), radius = camp.reach + DETOUR_GAP;
      const dx = (goal.x - camp.center.x) / gap, dy = (goal.y - camp.center.y) / gap;
      return CREEP_STAGING_TURNS.flatMap(turn => [turn, turn + Math.PI]).map(turn => {
        const cos = detCos(turn), sin = detSin(turn);
        const point = { x: camp.center.x + (dx * cos - dy * sin) * radius,
          y: camp.center.y + (dx * sin + dy * cos) * radius };
        return point;
      }).filter(point => point.x >= 0 && point.y >= 0 && point.x <= snapshot.map.width && point.y <= snapshot.map.height
        && isOpenGround(snapshot.map, point.x, point.y) && distance(point, unit) > MOVE_ORDER_ARRIVAL_RANGE);
    });
    // Dijkstra over native road legs around the first obstructing camp, admitting no unsafe edge.
    const nodes = [unit, ...points, goal], costs = nodes.map(() => Infinity), first: (Point | undefined)[] = nodes.map(() => undefined);
    costs[0] = 0;
    const pending = new Set(nodes.map((_, index) => index));
    while (pending.size) {
      const at = [...pending].sort((a, b) => costs[a]! - costs[b]!)[0]!;
      if (costs[at] === Infinity) break;
      pending.delete(at);
      if (nodes[at] === goal) return { kind: 'detour', point: first[at]! };
      for (const next of pending) {
        const road = roadTo(nodes[at]!, nodes[next]!, nodes[next] === goal ? arrival : MOVE_ORDER_ARRIVAL_RANGE);
        if (road === undefined) continue;
        const cost = costs[at]! + road.slice(1).reduce((sum, point, index) => sum + distance(road[index]!, point), 0);
        if (cost < costs[next]!) { costs[next] = cost; first[next] = at === 0 ? nodes[next]! : first[at]; }
      }
    }
    return { kind: 'blocked' };
  };
}

/** Split an assault's movement by each fighter's actual road; blocked transit holds outside the camp. */
export function routeAssaultCampCommands(snapshot: GameSnapshot, commands: GameCommand[], group: readonly string[], goal: Point, foes: readonly (Unit | Building)[]) {
  const camps = neutralCamps(snapshot);
  const fighters = snapshot.units.filter(unit => group.includes(unit.id));
  const together = fighters.length > 0 && fighters.every(unit =>
    routeWithinDistance(snapshot.map, unit, fighters[0]!, 'land', JOIN_RANGE));
  const columns = together ? [] : fighters.map(leader => ({ leader, units: fighters.filter(unit =>
    routeWithinDistance(snapshot.map, unit, leader, 'land', JOIN_RANGE)) }))
    .sort((a, b) => strengthOf(b.units) - strengthOf(a.units));
  const gathering = columns.length > 0 && columns[0]!.units.length < fighters.length
    && columns[0]!.units.every(unit => foes.every(foe => distance(unit, foe) > retreatThreatReach(snapshot, foe, unit, THINK_TICKS)))
    ? columns[0] : undefined;
  const destination = gathering ? gathering.leader : goal;
  const route = assaultCampRouter(snapshot, destination, camps, !gathering);
  const assigned = new Set(commands.flatMap(command => 'unitIds' in command ? command.unitIds : []));
  const continuing = snapshot.units.filter(unit => group.includes(unit.id) && !assigned.has(unit.id))
    .flatMap<GameCommand>(unit => unit.order.type === 'attackMove' || unit.order.type === 'move'
      ? [{ type: unit.order.type, unitIds: [unit.id], x: unit.order.x, y: unit.order.y }] : []);
  return [...commands, ...continuing].flatMap(command => {
    if (command.type !== 'attackMove' && command.type !== 'move') return [command];
    const original: string[] = [], routed: GameCommand[] = [];
    for (const id of command.unitIds) {
      if (!group.includes(id)) { original.push(id); continue; }
      const unit = snapshot.units.find(unit => unit.id === id)!;
      if (gathering && gathering.units.includes(unit)) {
        routed.push({ type: 'holdPosition', unitIds: [id] });
        continue;
      }
      const road = route(unit);
      if (road.kind === 'direct') {
        const order = unit.order, moving = order.type === 'move' || order.type === 'attackMove';
        if (gathering) routed.push({ type: 'move', unitIds: [id], x: destination.x, y: destination.y, avoidCombat: true });
        else if (assigned.has(id) && distance(command, goal) <= MOVE_ORDER_ARRIVAL_RANGE) original.push(id);
        else if (assigned.has(id) || !moving || distance(order, goal) > MOVE_ORDER_ARRIVAL_RANGE)
          routed.push({ ...command, unitIds: [id], ...goal });
      }
      else if (road.kind === 'detour') {
        if (!(unit.order.type === 'move' && unit.order.avoidCombat && distance(unit.order, road.point) <= MOVE_ORDER_ARRIVAL_RANGE))
          routed.push({ type: 'move', unitIds: [id], ...road.point, avoidCombat: true });
      }
      else routed.push({ type: 'holdPosition', unitIds: [id] });
    }
    return [...(original.length ? [{ ...command, unitIds: original }] : []), ...routed];
  });
}
