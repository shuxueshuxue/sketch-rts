import { unitControlsMercenaryCamp } from '../../shared/mercenary-camp';
import { routeTravelTicks } from '../../shared/route-selection';
import { ABILITY_DEFS, UNIT_DEFS, MERCENARY_UNIT_KINDS, unitMover } from '../../shared/catalog';
import { walkRoute } from '../../shared/terrain';
import { pointSegmentDistanceSquared } from '../../shared/navigation-math';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { friendlyUnitsAtMercenaryCamp, hiredMercenaryCount, mercenaryRoleLimit } from '../policy/mercenary-model';
import { neutralUnitsNear } from '../policy/snapshot';
import { canSupply } from '../policy/world-model';
import { isEnemyOwner } from '../policy/ownership';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';
import { distance } from '../policy/spatial';
import { mountedThreatReach, THINK_TICKS } from './mounted-micro';

function expeditionUnits(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land' && unit.kind !== 'worker'
    && unit.expiresTick === undefined && !options.memory.unitClaims[unit.id] && !options.memory.v6?.creep?.group.includes(unit.id)
    && !options.memory.v6?.raid?.unitIds.includes(unit.id));
}

export function campVisitors(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall' && building.complete);
  if (!home) return [];
  return expeditionUnits(snapshot, owner, options).flatMap(unit => snapshot.mercenaryCamps.flatMap(camp => {
    const order = unit.order, traveling = order.type === 'move' && order.avoidCombat && order.x === camp.x && order.y === camp.y;
    const atCamp = unitControlsMercenaryCamp(unit, camp);
    return atCamp && distance(unit, home) > V7_GATHERED_RANGE && (traveling || order.type === 'idle' || order.type === 'hold') ? [{ unit, camp, home }] : [];
  }));
}
export function returningMercenaries(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall' && building.complete);
  if (!home) return [];
  return expeditionUnits(snapshot, owner, options).filter(unit => {
    const order = unit.order;
    if (order.type === 'move' && order.avoidCombat && order.x === home.x && order.y === home.y)
      return distance(unit, home) > V7_GATHERED_RANGE;
    return snapshot.mercenaryCamps.some(camp => {
      const traveling = order.type === 'move' && order.avoidCombat && order.x === camp.x && order.y === camp.y;
      const atCamp = unitControlsMercenaryCamp(unit, camp);
      const mercenary = (MERCENARY_UNIT_KINDS as readonly string[]).includes(unit.kind) && order.type === 'idle';
      const finished = hiredMercenaryCount(snapshot, owner, camp.hireKind) >= mercenaryRoleLimit(camp.hireKind, options) || camp.stock === 0;
      return traveling && (finished || unit.hp < unit.maxHp) || mercenary && atCamp && distance(unit, home) > V7_GATHERED_RANGE
        || !mercenary && atCamp && (order.type === 'idle' || order.type === 'hold') && (finished || unit.hp < unit.maxHp) && distance(unit, home) > V7_GATHERED_RANGE;
    });
  }).map(unit => ({ unit, home }));
}
export function mercenaryAssignment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const camps = snapshot.mercenaryCamps.filter(camp => camp.stock > 0 && camp.cooldownRemaining === 0
    && neutralUnitsNear(snapshot, camp, 260).length === 0 && friendlyUnitsAtMercenaryCamp(snapshot, owner, camp).length === 0
    && hiredMercenaryCount(snapshot, owner, camp.hireKind) < mercenaryRoleLimit(camp.hireKind, options) && canSupply(snapshot, owner, camp.hireKind));
  if (!camps.length) return [];
  const returning = new Set([...returningMercenaries(snapshot, owner, options).map(({ unit }) => unit.id), ...campVisitors(snapshot, owner, options).map(({ unit }) => unit.id)]);
  const own = expeditionUnits(snapshot, owner, options).filter(unit => unit.kind !== 'horseArcher' && !returning.has(unit.id)
    && !UNIT_DEFS[unit.kind].abilities.some(ability => ['heal', 'summon'].includes(ABILITY_DEFS[ability].behavior))
    && unit.hp === unit.maxHp && unit.attackDamage > 0 && ['idle', 'move', 'attackMove', 'hold'].includes(unit.order.type));
  const foes = [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0 && foe.attackDamage > 0 && isEnemyOwner(snapshot, owner, foe.owner, options));
  const assignments = camps.flatMap(camp => own.flatMap(unit => {
    const travelTicks = routeTravelTicks(snapshot.map, unit, camp, 'land', unit.speed);
    if (travelTicks === undefined)
      return [];
    const route = walkRoute(snapshot.map, unit, camp);
    if (route === undefined)
      return [];
    const horizon = THINK_TICKS + travelTicks, points = [unit, ...route];
    const safe = foes.every(foe => {
      const range = mountedThreatReach(snapshot, foe, unit, horizon) + ('speed' in foe ? foe.speed : 0) * THINK_TICKS / SIM_TICKS_PER_SECOND;
      return points.slice(1).every((point, index) => pointSegmentDistanceSquared(foe, points[index]!, point) > range * range);
    });
    return safe ? [{ unit, camp, travelTicks }] : [];
  })).sort((a, b) => a.unit.level - b.unit.level || a.travelTicks - b.travelTicks || a.unit.id.localeCompare(b.unit.id));
  return assignments.slice(0, 1);
}
export function mercenaryControlUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return new Set([...campVisitors(snapshot, owner, options).map(({ unit }) => unit.id), ...returningMercenaries(snapshot, owner, options).map(({ unit }) => unit.id), ...mercenaryAssignment(snapshot, owner, options).map(({ unit }) => unit.id)]);
}
export const mercenaryControl = { id: 'mercenaryControl', phase: 'tactics', claimsUnits: mercenaryControlUnitIds,
  run: (snapshot, owner, options): GameCommand[] => {
    const returns = returningMercenaries(snapshot, owner, options), returnIds = new Set(returns.map(({ unit }) => unit.id));
    const waiting = campVisitors(snapshot, owner, options).filter(({ unit }) => !returnIds.has(unit.id));
    return [...waiting.flatMap(({ unit }) => unit.order.type === 'hold' ? [] : [{ type: 'holdPosition' as const, unitIds: [unit.id] }]),
      ...[...returns.map(({ unit, home }) => ({ unit, goal: home })), ...mercenaryAssignment(snapshot, owner, options).map(({ unit, camp }) => ({ unit, goal: camp }))]
        .flatMap(({ unit, goal }) => unit.order.type === 'move' && unit.order.avoidCombat && unit.order.x === goal.x && unit.order.y === goal.y ? [] : [{ type: 'move' as const, unitIds: [unit.id], x: goal.x, y: goal.y, avoidCombat: true }])];
  },
} satisfies AiScript;
