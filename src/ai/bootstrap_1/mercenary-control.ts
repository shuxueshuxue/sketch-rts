import { unitControlsMercenaryCamp } from '../../shared/mercenary-camp';
import { strikeGap } from '../../shared/combat-geometry';
import { canReach } from '../../shared/naval';
import { automaticTargetAllowed } from '../../shared/combat-target';
import { AUTO_ACQUIRE_RANGE } from '../../shared/sim';
import { armedFoes, safeLandTravelTicks } from './safe-land-route';
import { ABILITY_DEFS, UNIT_DEFS, MERCENARY_UNIT_KINDS, unitMover } from '../../shared/catalog';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { friendlyUnitsAtMercenaryCamp, hiredMercenaryCount, mercenaryRoleLimit } from '../policy/mercenary-model';
import { neutralUnitsNear } from '../policy/snapshot';
import { canSupply } from '../policy/world-model';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { V7_GATHERED_RANGE } from '../policy/v7/creep';
import { distance } from '../policy/spatial';
import { nearestByRoute, routeTravelTicks } from '../../shared/route-selection';
import { isEnemyOwner } from '../policy/ownership';

function courierHome(snapshot: GameSnapshot, owner: PlayerId, unit: Unit) {
  return nearestByRoute(snapshot.map, snapshot.buildings.filter(building => building.owner === owner
    && building.kind === 'townHall' && building.complete), unit, 'land');
}

function expeditionUnits(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return snapshot.units.filter(unit => unit.owner === owner && !unit.deck && unitMover(unit.kind) === 'land' && unit.kind !== 'worker'
    && unit.expiresTick === undefined && !options.memory.unitClaims[unit.id] && !options.memory.v6?.creep?.group.includes(unit.id)
    && !options.memory.v6?.raid?.unitIds.includes(unit.id));
}

/** A purchasing trip ends on return, death, boarding or loss of its home. */
function activeCourier(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const task = options.memory.mercenaryCourier;
  if (task === undefined) return undefined;
  const unit = snapshot.units.find(unit => unit.id === task.unitId && unit.owner === owner);
  const camp = snapshot.mercenaryCamps.find(camp => camp.id === task.campId);
  if (!unit || unit.deck || unit.order.type === 'board' || !camp) return undefined;
  const home = courierHome(snapshot, owner, unit);
  if (!home || distance(unit, home) <= V7_GATHERED_RANGE && (unit.order.type === 'idle'
      || unit.order.type === 'move' && unit.order.x === home.x && unit.order.y === home.y)) {
    return undefined;
  }
  return { unit, camp, home };
}

function mercenaryTravelers(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const courier = activeCourier(snapshot, owner, options);
  return expeditionUnits(snapshot, owner, options).filter(unit => unit.id === courier?.unit.id
    || (MERCENARY_UNIT_KINDS as readonly string[]).includes(unit.kind));
}

export function campVisitors(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return mercenaryTravelers(snapshot, owner, options).flatMap(unit => {
    const home = courierHome(snapshot, owner, unit);
    if (!home) return [];
    return snapshot.mercenaryCamps.flatMap(camp => {
      const order = unit.order, traveling = order.type === 'move' && order.avoidCombat && order.x === camp.x && order.y === camp.y;
      const atCamp = unitControlsMercenaryCamp(unit, camp);
      return atCamp && distance(unit, home) > V7_GATHERED_RANGE && (traveling || order.type === 'idle' || order.type === 'hold') ? [{ unit, camp, home }] : [];
    });
  });
}
export function returningMercenaries(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const courier = activeCourier(snapshot, owner, options);
  const foes = courier ? armedFoes(snapshot, owner, options) : [];
  const blockedTrip = courier !== undefined
    && safeLandTravelTicks(snapshot, courier.unit, courier.camp, foes) === undefined
    && safeLandTravelTicks(snapshot, courier.unit, courier.home, foes) !== undefined;
  return mercenaryTravelers(snapshot, owner, options).flatMap(unit => {
    const home = courierHome(snapshot, owner, unit);
    if (!home) return [];
    const order = unit.order;
    if (courier && unit.id === courier.unit.id && (blockedTrip || unit.hp < unit.maxHp || courier.camp.stock === 0
      || hiredMercenaryCount(snapshot, owner, courier.camp.hireKind) >= mercenaryRoleLimit(courier.camp.hireKind, options)))
      return distance(unit, home) > V7_GATHERED_RANGE ? [{ unit, home }] : [];
    if (order.type === 'move' && order.avoidCombat && order.x === home.x && order.y === home.y)
      return distance(unit, home) > V7_GATHERED_RANGE ? [{ unit, home }] : [];
    const returning = snapshot.mercenaryCamps.some(camp => {
      const traveling = order.type === 'move' && order.avoidCombat && order.x === camp.x && order.y === camp.y;
      const atCamp = unitControlsMercenaryCamp(unit, camp);
      const mercenary = (MERCENARY_UNIT_KINDS as readonly string[]).includes(unit.kind) && order.type === 'idle';
      const finished = hiredMercenaryCount(snapshot, owner, camp.hireKind) >= mercenaryRoleLimit(camp.hireKind, options) || camp.stock === 0;
      return traveling && (finished || unit.hp < unit.maxHp) || mercenary && atCamp && distance(unit, home) > V7_GATHERED_RANGE
        || !mercenary && atCamp && (order.type === 'idle' || order.type === 'hold') && (finished || unit.hp < unit.maxHp) && distance(unit, home) > V7_GATHERED_RANGE;
    });
    return returning ? [{ unit, home }] : [];
  });
}
export function mercenaryAssignment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const courier = activeCourier(snapshot, owner, options);
  if (courier) return unitControlsMercenaryCamp(courier.unit, courier.camp)
    || returningMercenaries(snapshot, owner, options).some(({ unit }) => unit.id === courier.unit.id) ? []
    : [{ ...courier, travelTicks: routeTravelTicks(snapshot.map, courier.unit, courier.camp, 'land', courier.unit.speed)! }];
  const camps = snapshot.mercenaryCamps.filter(camp => camp.stock > 0 && camp.cooldownRemaining === 0
    && neutralUnitsNear(snapshot, camp, 260).length === 0 && friendlyUnitsAtMercenaryCamp(snapshot, owner, camp).length === 0
    && hiredMercenaryCount(snapshot, owner, camp.hireKind) < mercenaryRoleLimit(camp.hireKind, options) && canSupply(snapshot, owner, camp.hireKind));
  if (!camps.length) return [];
  const returning = new Set([...returningMercenaries(snapshot, owner, options).map(({ unit }) => unit.id), ...campVisitors(snapshot, owner, options).map(({ unit }) => unit.id)]);
  const own = expeditionUnits(snapshot, owner, options).filter(unit => unit.kind !== 'horseArcher' && !returning.has(unit.id)
    && courierHome(snapshot, owner, unit) !== undefined
    && !UNIT_DEFS[unit.kind].abilities.some(ability => ['heal', 'summon'].includes(ABILITY_DEFS[ability].behavior))
    && unit.hp === unit.maxHp && unit.attackDamage > 0 && ['idle', 'move', 'attackMove', 'hold'].includes(unit.order.type));
  const foes = armedFoes(snapshot, owner, options);
  const assignments = camps.flatMap(camp => own.flatMap(unit => {
    const travelTicks = safeLandTravelTicks(snapshot, unit, camp, foes);
    return travelTicks === undefined ? [] : [{ unit, camp, travelTicks }];
  })).sort((a, b) => a.unit.level - b.unit.level || a.travelTicks - b.travelTicks || a.unit.id.localeCompare(b.unit.id));
  return assignments.slice(0, 1);
}
export function mercenaryControlUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const courier = activeCourier(snapshot, owner, options);
  return new Set([...(courier ? [courier.unit.id] : []), ...campVisitors(snapshot, owner, options).map(({ unit }) => unit.id), ...returningMercenaries(snapshot, owner, options).map(({ unit }) => unit.id), ...mercenaryAssignment(snapshot, owner, options).map(({ unit }) => unit.id)]);
}
export const mercenaryControl = { id: 'mercenaryControl', phase: 'tactics', claimsUnits: mercenaryControlUnitIds,
  run: (snapshot, owner, options): GameCommand[] => {
    if (activeCourier(snapshot, owner, options) === undefined) delete options.memory.mercenaryCourier;
    const returns = returningMercenaries(snapshot, owner, options), returnIds = new Set(returns.map(({ unit }) => unit.id));
    const waiting = campVisitors(snapshot, owner, options).filter(({ unit }) => !returnIds.has(unit.id));
    const assignments = mercenaryAssignment(snapshot, owner, options);
    if (assignments.length) options.memory.mercenaryCourier = { unitId: assignments[0]!.unit.id, campId: assignments[0]!.camp.id };
    const foes = waiting.length ? [...snapshot.units, ...snapshot.buildings].filter(foe => foe.hp > 0
      && isEnemyOwner(snapshot, owner, foe.owner, options)) : [];
    // A hold at the hire circle's edge can shoot a nearby neutral and pull it
    // onto the buyer. Keep the existing safe walk while that hold would fire.
    return [...waiting.flatMap(({ unit, camp }) => unit.order.type === 'hold'
      || unit.order.type === 'move' && unit.order.avoidCombat && unit.order.x === camp.x && unit.order.y === camp.y
        && foes.some(foe => strikeGap(unit, foe) <= Math.max(AUTO_ACQUIRE_RANGE, unit.attackRange)
          && automaticTargetAllowed(snapshot.units, owner, foe) && canReach(snapshot.map, unit, foe, snapshot.units))
      ? [] : [{ type: 'holdPosition' as const, unitIds: [unit.id] }]),
      ...[...returns.map(({ unit, home }) => ({ unit, goal: home })), ...assignments.map(({ unit, camp }) => ({ unit, goal: camp }))]
        .flatMap(({ unit, goal }) => unit.order.type === 'move' && unit.order.avoidCombat && unit.order.x === goal.x && unit.order.y === goal.y ? [] : [{ type: 'move' as const, unitIds: [unit.id], x: goal.x, y: goal.y, avoidCombat: true }])];
  },
} satisfies AiScript;

/** Stop is not covered by the legacy runner's movement ownership filter.
 * A returning hire must keep its avoid-combat road instead of waking a neutral. */
export function preserveMercenaryTravel(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, commands: GameCommand[]): GameCommand[] {
  if (!commands.some(command => command.type === 'stop')) return commands;
  const travelers = mercenaryControlUnitIds(snapshot, owner, options);
  return commands.flatMap((command): GameCommand[] => {
    if (command.type !== 'stop') return [command];
    const unitIds = command.unitIds.filter(id => !travelers.has(id));
    return unitIds.length ? [{ ...command, unitIds }] : [];
  });
}
