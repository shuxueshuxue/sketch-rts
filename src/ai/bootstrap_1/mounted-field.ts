import { strikeGap } from '../../shared/combat-geometry';
import { routeWithinDistance } from '../../shared/route-selection';
import { walkingDistance } from '../../shared/terrain';
import type { GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { isOpponentOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { LOCAL_RANGE } from '../policy/v6/general';
import { mountedMicro, mountedTargetOrder } from './mounted-micro';
import { availableMountedRiders, mountedFiringPoint } from './mounted-tasks';
import { armedFoes } from './safe-land-route';
import { mineGuardUnitIds, uncoveredMiningRaid } from './mine-defense';

const allocations = new WeakMap<GameSnapshot, Map<PlayerId, ReadonlySet<string>>>();

/** Only this frame's executed task removes a rider from the main commander. */
export function mountedFieldOwns(snapshot: GameSnapshot, owner: PlayerId, unitId: string) {
  const frame = allocations.get(snapshot);
  return frame !== undefined && frame.has(owner) && frame.get(owner)!.has(unitId);
}

/** Prospective recruits and active riders assess the same opponent, road and firing cover. */
export function mountedFieldTargets(snapshot: GameSnapshot, owner: PlayerId, rider: Unit, crew: ReadonlySet<string>, options: AiPolicyContext) {
  const towers = snapshot.buildings.filter(building => building.complete && building.attackDamage > 0
    && isOpponentOwner(snapshot, owner, building.owner, options));
  const enemies = snapshot.units.filter(unit => unit.attackDamage > 0 && !unit.deck && unit.kind !== 'worker'
    && isOpponentOwner(snapshot, owner, unit.owner, options));
  return enemies.filter(target => strikeGap(rider, target) <= rider.attackRange
    || routeWithinDistance(snapshot.map, rider, target, 'land', LOCAL_RANGE)
    || (target.order.type === 'attack' || target.order.type === 'attackMove') && target.order.targetId !== undefined
      && crew.has(target.order.targetId) && walkingDistance(snapshot.map, rider, target, 'land') !== undefined)
    .filter(target => strikeGap(rider, target) <= rider.attackRange
      || (target.order.type === 'attack' || target.order.type === 'attackMove') && target.order.targetId === rider.id
      || mountedFiringPoint(snapshot, rider, target, towers, enemies) !== undefined)
    .sort((a, b) => mountedTargetOrder(a, b) || distance(rider, a) - distance(rider, b));
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
    const foes = armedFoes(snapshot, owner, options);
    return plans.map(({ rider, target }) => mountedMicro(snapshot, rider, target, foes, { kind: 'field' }));
  },
};

