import { strikeGap } from '../../shared/combat-geometry';
import { groundMoveForecast, groundSteeringRoute, routeLeavesDisks, routeWithinDistance } from '../../shared/route-selection';
import { unitMover } from '../../shared/catalog';
import { capsuleClearsBodies } from '../../shared/navigation-math';
import { constrainGroundShipStep } from '../../shared/ship-collisions';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { buildingMoveArrival } from '../../shared/sim';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { distance } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { availableV6Army, LOCAL_RANGE } from '../policy/v6/general';
import { isBacklineKind } from '../policy/v6/backline';
import { chargeMinimum, mountedMicro, mountedTargetOrder, mountedThreatReach, THINK_TICKS } from './mounted-micro';
import { availableMountedRiders, mountedFiringPoint } from './mounted-tasks';
import { armedFoes } from './safe-land-route';
import { threatLandDisks, threatLandRouter, threatRoadCommands } from './threat-roads';
import { mainArmyIntel, mineGuardUnitIds, uncoveredMiningRaid } from './mine-defense';
import { hostileDamageDisks } from './damage-footprints';

const allocations = new WeakMap<GameSnapshot, Map<PlayerId, ReadonlySet<string>>>();

/** Only this frame's executed task removes a rider from the main commander. */
export function mountedFieldOwns(snapshot: GameSnapshot, owner: PlayerId, unitId: string) {
  const frame = allocations.get(snapshot);
  return frame !== undefined && frame.has(owner) && frame.get(owner)!.has(unitId);
}

/** Prospective recruits and active riders assess the same opponent, road and firing cover. */
export function mountedFieldTargets(snapshot: GameSnapshot, owner: PlayerId, rider: Unit, crew: ReadonlySet<string>, options: AiPolicyContext) {
  return mountedFieldChoices(snapshot, owner, rider, crew, options).map(choice => choice.target);
}

function mountedFieldChoices(snapshot: GameSnapshot, owner: PlayerId, rider: Unit, crew: ReadonlySet<string>, options: AiPolicyContext) {
  const foes = armedFoes(snapshot, owner, options);
  const towers = foes.filter((foe): foe is Building => !('order' in foe));
  const defenders = foes.filter((foe): foe is Unit => 'order' in foe && foe.owner !== 'neutral');
  const enemies = defenders.filter(unit => !unit.deck && unit.kind !== 'worker');
  const engaged = (target: Unit) => strikeGap(rider, target) <= rider.attackRange
    || (target.order.type === 'attack' || target.order.type === 'attackMove') && target.order.targetId !== undefined
      && crew.has(target.order.targetId);
  const pursued = foes.some(foe => 'order' in foe && (foe.order.type === 'attack' || foe.order.type === 'attackMove')
    && foe.order.targetId === rider.id);
  const route = threatLandRouter(snapshot, rider, foes);
  const admit = (target: Unit): {target: Unit; road: ReturnType<typeof route>}[] => {
    if (strikeGap(rider, target) <= rider.attackRange || pursued) return [{target, road: undefined}];
    const point = mountedFiringPoint(snapshot, rider, target, towers, defenders);
    const road = point && route(point);
    return road ? [{target, road}] : [];
  };
  const local = enemies.filter(target => engaged(target)
    || routeWithinDistance(snapshot.map, rider, target, 'land', LOCAL_RANGE));
  const nearby = local.flatMap(admit);
  // Admission retains the exact road checked against the execution threat set,
  // including armed workers. A target alone is not a promised firing position.
  const choices = nearby.length ? nearby : enemies.filter(target => !local.includes(target)
    && target.speed < rider.speed && mountedThreatReach(snapshot, target, rider, rider.attackCooldown) < rider.attackRange)
    .flatMap(admit);
  return choices.sort(({target:a}, {target:b}) => Number(engaged(b)) - Number(engaged(a))
    || mountedTargetOrder(a, b) || distance(rider, a) - distance(rider, b));
}

/** Free cavalry can fight an exposed army without an available mine or neutral camp. */
export function mountedFieldPlans(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  if (uncoveredMiningRaid(snapshot, owner, options)) return [];
  const guards = mineGuardUnitIds(snapshot, owner, options);
  const riders = availableMountedRiders(snapshot, owner, options)
    .filter(unit => !guards.has(unit.id) && !options.memory.v6?.creep?.group.includes(unit.id)
      && !options.memory.mounted?.some(task => task.unitIds.includes(unit.id)));
  const crew = new Set(riders.map(rider => rider.id));
  return riders.flatMap(rider => {
    const choices = mountedFieldChoices(snapshot, owner, rider, crew, options);
    return choices.length ? [{ rider, ...choices[0]! }] : [];
  });
}

/** An exposed field rider can return by an admitted road instead of fleeing into a map edge. */
export function mountedFieldRetreatRoad(snapshot: GameSnapshot, owner: PlayerId, rider: Unit,
  foes: readonly (Unit | Building)[], options: AiPolicyContext) {
  // This next-think estimate covers ordinary walking, not current control or a shove.
  if (rider.effects.some(effect => effect.type === 'slow' || effect.type === 'root' || effect.type === 'stun')
    || rider.pushX !== undefined || rider.pushY !== undefined) return undefined;
  // Preserve the existing escape's charge minimum window rather than crossing its outer edge.
  if (foes.some(foe => 'order' in foe && chargeMinimum(foe, rider, THINK_TICKS + rider.cooldown).length > 0)) return undefined;
  const intel = mainArmyIntel(snapshot, owner, options);
  const front = availableV6Army(snapshot, options, intel).filter(unit => unit.id !== rider.id && !unit.deck
    && unit.kind !== 'worker' && !isBacklineKind(unit) && unitMover(unit.kind) === 'land' && unit.attackDamage > 0);
  // Only an actual available front is a regroup goal. An empty hall or an
  // unoccupied commander post does not promise any fighting screen.
  const goals = front.map(unit => ({ x: unit.x, y: unit.y }));
  const route = threatLandRouter(snapshot, rider, foes), disks = threatLandDisks(snapshot, rider, foes);
  const hazards = hostileDamageDisks(snapshot, rider, foes, THINK_TICKS + rider.cooldown);
  const bodies = snapshot.units.filter(unit => unit.id !== rider.id && !unit.deck && unitMover(unit.kind) === 'land'
    && !(unit.kind === 'worker' && unit.order.type === 'mine'));
  return goals.flatMap(goal => {
    const steering = groundSteeringRoute(snapshot.map, rider, goal), end = steering[steering.length - 1]!;
    if (distance(end, goal) > MOVE_ORDER_ARRIVAL_RANGE) return [];
    const road = route(end), first = road?.points[1];
    if (!road || !first || !routeLeavesDisks(road.points, hazards)) return [];
    // Only a first waypoint covering the whole next think is represented here.
    // Terrain pace is at most one; the existing arrival radius could otherwise
    // activate the queued turn before this single-segment estimate ends.
    if (distance(rider, first) <= rider.speed * THINK_TICKS / SIM_TICKS_PER_SECOND + MOVE_ORDER_ARRIVAL_RANGE) return [];
    const arrivalPoint = buildingMoveArrival(snapshot, rider, first, THINK_TICKS);
    if (arrivalPoint && arrivalPoint.movementTick < THINK_TICKS && road.points.length > 2) return [];
    const next = arrivalPoint?.point ?? groundMoveForecast(snapshot.map, rider, first, rider.speed, THINK_TICKS);
    if (!routeLeavesDisks([rider, next], disks) || !routeLeavesDisks([rider, next], hazards)
      || !capsuleClearsBodies(rider, next, rider.radius, bodies)
      || constrainGroundShipStep(snapshot.map, rider, rider, next, snapshot.units) !== next) return [];
    return [{ road }];
  }).sort((a, b) => a.road.ticks - b.road.ticks)[0]?.road;
}

export const mountedField = {
  id: 'mountedField', phase: 'tactics',
  claimsUnits: (snapshot, owner, options) => new Set(mountedFieldPlans(snapshot, owner, options).map(plan => plan.rider.id)),
  run(snapshot, owner, options) {
    const plans = mountedFieldPlans(snapshot, owner, options);
    const frame = allocations.get(snapshot);
    if (frame === undefined) allocations.set(snapshot, new Map([[owner, new Set(plans.map(plan => plan.rider.id))]]));
    else frame.set(owner, new Set(plans.map(plan => plan.rider.id)));
    const foes = armedFoes(snapshot, owner, options);
    return plans.flatMap(({ rider, target, road }) => {
      if (road) return threatRoadCommands(rider, road);
      const command = mountedMicro(snapshot, rider, target, foes, { kind: 'field' });
      const pursued = foes.some(foe => 'order' in foe && (foe.order.type === 'attack' || foe.order.type === 'attackMove')
        && foe.order.targetId === rider.id);
      const retreat = command.type === 'move' && pursued ? mountedFieldRetreatRoad(snapshot, owner, rider, foes, options) : undefined;
      return retreat ? threatRoadCommands(rider, retreat) : [command];
    });
  },
} satisfies AiScript;
