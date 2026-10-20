import type { GameSnapshot, PlayerId } from '../../shared/types';
import type { AiPolicyContext, AiCommandEntry } from '../policy/types';
import type { CampObjectivePoint } from '../situation/neutral-camp-objectives';
import { walkableGoal } from '../../shared/terrain';

/** Project actual sites and persistent task stations. Classification itself only
 * consumes these points and camp facts; it knows no executor names or maps.
 */
export function campObjectivePoints(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  entries: readonly AiCommandEntry[], stationRanges: ReadonlyMap<string, number>): CampObjectivePoint[] {
  const targets: CampObjectivePoint[] = [];
  const add = (id: string, point: { x: number; y: number } | undefined, kind: CampObjectivePoint['kind'] = 'site') => {
    if (point) targets.push({ id, x: point.x, y: point.y, ...(kind ? { kind } : {}) });
  };
  for (const hall of snapshot.buildings) if (hall.owner === owner && hall.kind === 'townHall' && hall.hp > 0) add(`hall:${hall.id}`, hall);
  const orders = [...snapshot.units.filter(unit => unit.owner === owner).map(unit => unit.order), ...entries.map(entry => entry.command),
    ...Object.values(options.memory.unitClaims).flatMap(claim => claim.interruption ? [claim.interruption.parent] : claim.campTravel ? [claim.campTravel.command] : [])];
  for (const order of orders) if (order.type === 'build') add(`build:${order.buildingKind}:${order.x}:${order.y}`, order);
  // A route that has no acceptable alternative already declared this camp a
  // prerequisite. Passing armies can supply that shared effect in their march.
  for (const claim of Object.values(options.memory.unitClaims)) {
    if (claim.campTravel?.childOnly) continue;
    const child = claim.campTravel?.subgoal;
    if (child?.kind === 'clear-camp' && !['abandoned', 'failed', 'complete'].includes(child.status))
      add(`prerequisite:${child.id}`, child.target.point, 'clearance');
  }
  // A march waypoint is not a promised station. Native hold orders and task
  // anchors below are; ships' water goals are projected onto the actual shore.
  for (const entry of entries) if ((stationRanges.get(entry.scriptId) ?? 0) > 0 && entry.command.type === 'holdPosition')
    for (const id of entry.command.unitIds) add(`hold:${id}`, snapshot.units.find(unit => unit.id === id && unit.owner === owner && !unit.deck));
  const memory = options.memory;
  add(`rally:${memory.miningDefense?.hallId}`, memory.miningDefense?.point);
  add(`leash:${memory.miningLeash?.hallId}`, memory.miningLeash?.point);
  add(`expansion:${memory.landExpansion?.mineId}:assembly`, memory.landExpansion?.staging);
  if (memory.v6?.general?.mode === 'hold' || memory.v6?.general?.stage === 'gather') add('general:assembly', memory.v6.general.target);
  add(`post:${memory.territory?.objective?.targetId}`, memory.territory?.objective?.point);
  for (const task of Object.values(memory.naval?.conquests ?? {})) if (task.abandonedTick === undefined && task.stage !== 'complete') {
    add(`landing:${task.mineId}`, walkableGoal(snapshot.map, task.landing.x, task.landing.y));
    add(`island:${task.mineId}:assembly`, task.staging);
  }
  for (const [id, ferry] of Object.entries(memory.naval?.ferries ?? {})) if (ferry.phase !== 'return')
    add(`landing:${id}`, walkableGoal(snapshot.map, ferry.to.x, ferry.to.y));
  return [...new Map(targets.map(target => [target.id, target])).values()];
}
