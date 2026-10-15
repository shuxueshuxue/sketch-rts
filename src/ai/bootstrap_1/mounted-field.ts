import { strikeGap } from '../../shared/combat-geometry';
import { routeWithinDistance } from '../../shared/route-selection';
import type { Building, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { distance } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { LOCAL_RANGE } from '../policy/v6/general';
import { mountedMicro, mountedTargetOrder, mountedThreatReach } from './mounted-micro';
import { availableMountedRiders, mountedFiringPoint } from './mounted-tasks';
import { armedFoes } from './safe-land-route';
import { threatLandRouter, threatRoadCommands } from './threat-roads';
import { mineGuardUnitIds, uncoveredMiningRaid } from './mine-defense';

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

export const mountedField = {
  id: 'mountedField', phase: 'tactics',
  claimsUnits: (snapshot, owner, options) => new Set(mountedFieldPlans(snapshot, owner, options).map(plan => plan.rider.id)),
  run(snapshot, owner, options) {
    const plans = mountedFieldPlans(snapshot, owner, options);
    const frame = allocations.get(snapshot);
    if (frame === undefined) allocations.set(snapshot, new Map([[owner, new Set(plans.map(plan => plan.rider.id))]]));
    else frame.set(owner, new Set(plans.map(plan => plan.rider.id)));
    const foes = armedFoes(snapshot, owner, options);
    return plans.flatMap(({ rider, target, road }) => road
      ? threatRoadCommands(rider, road)
      : [mountedMicro(snapshot, rider, target, foes, { kind: 'field' })]);
  },
} satisfies AiScript;
