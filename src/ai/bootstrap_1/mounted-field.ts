import { strikeGap } from '../../shared/combat-geometry';
import { routeWithinDistance } from '../../shared/route-selection';
import { walkingDistance } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { isOpponentOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { LOCAL_RANGE } from '../policy/v6/general';
import { mountedMicro, mountedTargetOrder, mountedThreatReach } from './mounted-micro';
import { availableMountedRiders, mountedFiringPoint, mountedFiringRouter } from './mounted-tasks';
import { armedFoes } from './safe-land-route';
import { threatRoadCommands } from './threat-roads';
import { mineGuardUnitIds, uncoveredMiningRaid } from './mine-defense';

const allocations = new WeakMap<GameSnapshot, Map<PlayerId, ReadonlySet<string>>>();

/** Only this frame's executed task removes a rider from the main commander. */
export function mountedFieldOwns(snapshot: GameSnapshot, owner: PlayerId, unitId: string) {
  const frame = allocations.get(snapshot);
  return frame !== undefined && frame.has(owner) && frame.get(owner)!.has(unitId);
}

/** Finished towers and armed fighters: what a field target is admitted against and its rider then rides through. */
function fieldCover(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return {
    towers: snapshot.buildings.filter(building => building.complete && building.attackDamage > 0
      && isOpponentOwner(snapshot, owner, building.owner, options)),
    enemies: snapshot.units.filter(unit => unit.attackDamage > 0 && !unit.deck && unit.kind !== 'worker'
      && isOpponentOwner(snapshot, owner, unit.owner, options)),
  };
}

/** Prospective recruits and active riders assess the same opponent, road and firing cover. */
export function mountedFieldTargets(snapshot: GameSnapshot, owner: PlayerId, rider: Unit, crew: ReadonlySet<string>, options: AiPolicyContext) {
  const { towers, enemies } = fieldCover(snapshot, owner, options);
  const engaged = (target: Unit) => strikeGap(rider, target) <= rider.attackRange
    || (target.order.type === 'attack' || target.order.type === 'attackMove') && target.order.targetId !== undefined
      && crew.has(target.order.targetId);
  const local = enemies.filter(target => engaged(target)
    || routeWithinDistance(snapshot.map, rider, target, 'land', LOCAL_RANGE));
  const admitted = (target: Unit) => strikeGap(rider, target) <= rider.attackRange
    || (target.order.type === 'attack' || target.order.type === 'attackMove') && target.order.targetId === rider.id
    || mountedFiringPoint(snapshot, rider, target, towers, enemies) !== undefined;
  const nearby = local.filter(admitted);
  // Fight the current front before evaluating an independent journey across the map.
  const targets = nearby.length ? nearby : enemies.filter(target => !local.includes(target)
    && target.speed < rider.speed && mountedThreatReach(snapshot, target, rider, rider.attackCooldown) < rider.attackRange)
    .filter(admitted);
  return targets.sort((a, b) => Number(engaged(b)) - Number(engaged(a))
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
    const targets = mountedFieldTargets(snapshot, owner, rider, crew, options);
    return targets.length ? [{ rider, target: targets[0]! }] : [];
  });
}

export const mountedField: AiScript = {
  id: 'mountedField', phase: 'tactics',
  claimsUnits: (snapshot, owner, options) => new Set(mountedFieldPlans(snapshot, owner, options).map(plan => plan.rider.id)),
  run(snapshot, owner, options) {
    const plans = mountedFieldPlans(snapshot, owner, options);
    const frame = allocations.get(snapshot);
    if (frame === undefined) allocations.set(snapshot, new Map([[owner, new Set(plans.map(plan => plan.rider.id))]]));
    else frame.set(owner, new Set(plans.map(plan => plan.rider.id)));
    const foes = armedFoes(snapshot, owner, options), { towers, enemies } = fieldCover(snapshot, owner, options);
    return plans.flatMap(({ rider, target }) => {
      if (strikeGap(rider, target) > rider.attackRange
        && !foes.some(foe => 'order' in foe && (foe.order.type === 'attack' || foe.order.type === 'attackMove')
          && foe.order.targetId === rider.id)) {
        // The station and road the admission found, against the same cover.
        const point = mountedFiringPoint(snapshot, rider, target, towers, enemies)!;
        return threatRoadCommands(rider, mountedFiringRouter(snapshot, rider, towers, enemies)(point)!);
      }
      return [mountedMicro(snapshot, rider, target, foes, { kind: 'field' })];
    });
  },
};

