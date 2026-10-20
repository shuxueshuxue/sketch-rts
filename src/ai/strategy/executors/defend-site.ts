import type { GameCommand, Unit } from '../../../shared/types';
import { unitMover } from '../../../shared/catalog';
import { isOpenGround, sameGround, walkingDistance } from '../../../shared/terrain';
import { isOpponentOwner } from '../../policy/ownership';
import { distance } from '../../policy/spatial';
import { strengthOf } from '../../policy/v6/strength';
import { MINING_RALLY_RADIUS } from '../../bootstrap_1/mining-rally';
import { MINING_PURSUIT_RADIUS } from '../../bootstrap_1/mining-leash';
import type { ExecutorInput, ExecutorFeedback, ExecutionState, JsonValue, StrategyExecutor } from '../allocation-types';
import { blockedExecutor, executorFeedback, grantedUnits, sameAction, validExecutorGrant } from '../executor-grants';
import type { Point } from '../types';

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function statePoint(state: ExecutionState, key: string): Point | undefined {
  const point = state[key];
  return isRecord(point) && 'x' in point && 'y' in point
    && typeof point.x === 'number' && typeof point.y === 'number' ? { x: point.x, y: point.y } : undefined;
}

export function defenseGatherPost(from: Point, to: Point): Point {
  const amount = 200;
  const gap = Math.max(1, distance(from, to));
  return { x: from.x + (to.x - from.x) * Math.min(1, amount / gap),
    y: from.y + (to.y - from.y) * Math.min(1, amount / gap) };
}

/** A covered waiting post is behind a live tower, not merely near a tower icon. */
export function defenseCoverPost(input: Pick<ExecutorInput, 'snapshot' | 'owner'>, anchor: Point, field: Point) {
  return input.snapshot.buildings.filter(tower => tower.owner === input.owner && tower.hp > 0 && tower.complete
    && tower.attackDamage > 0 && distance(tower, anchor) <= tower.attackRange + MINING_PURSUIT_RADIUS)
    .flatMap(tower => {
      const gap = Math.max(1, distance(tower, field)), depth = tower.attackRange / 3;
      if (depth <= tower.radius + 80) return [];
      const point = { x: tower.x - (field.x - tower.x) * depth / gap, y: tower.y - (field.y - tower.y) * depth / gap };
      if (!isOpenGround(input.snapshot.map, point.x, point.y)
        || walkingDistance(input.snapshot.map, anchor, point) === undefined) return [];
      return [{ point, towerId: tower.id, gap: distance(anchor, point) }];
    }).sort((a, b) => a.gap - b.gap || (a.towerId < b.towerId ? -1 : 1))[0];
}

function aimedAt(foe: Unit, id: string) {
  return (foe.order.type === 'attack' || foe.order.type === 'attackMove') && foe.order.targetId === id;
}

function handoffs(input: ExecutorInput, units: readonly Unit[]): ExecutorFeedback['handoffs'] {
  return input.events.filter(event => event.kind === 'preempted' && sameAction(event.action, input.execution.token))
    .map(event => ({ eventId: event.id, disposition: units.length ? 'shrink' as const : 'pause' as const }));
}

export const defendSiteExecutor: StrategyExecutor = {
  id: 'strategy.defend-site',
  execute(input) {
    if (!validExecutorGrant(input)) return blockedExecutor(input, 'invalid-action-grant');
    const { snapshot, owner, execution } = input, base = executorFeedback(input);
    const site = snapshot.buildings.find(building => building.id === execution.target.entityId && building.owner === owner && building.hp > 0);
    if (!site) return { ...base, status: 'failed', reasons: [{ executor: this.id, outcome: 'abandoned',
      reason: 'defended-site-no-longer-present', taskId: execution.token.actionId }] };
    const granted = grantedUnits(input);
    const cohort = granted.filter(unit => !unit.deck && unitMover(unit.kind) === 'land' && unit.kind !== 'worker');
    const active = cohort.filter(unit => !input.grant.assignments.some(assignment => assignment.unitId === unit.id && assignment.interruption));
    const foes = snapshot.units.filter(unit => unit.hp > 0 && !unit.deck && unit.attackDamage > 0
      && unitMover(unit.kind) === 'land' && isOpponentOwner(snapshot, owner, unit.owner, {}) && distance(unit, site) <= 1400
      && sameGround(snapshot.map, unit, site));
    const waiting = execution.intent.kind === 'wait-in-cover';
    const point = statePoint(execution.state, 'post') ?? execution.target.point;
    if (waiting && !snapshot.buildings.some(tower => tower.owner === owner && tower.complete && tower.hp > 0
      && tower.attackDamage > 0 && distance(tower, point) + 80 <= tower.attackRange))
      return blockedExecutor(input, 'no-reachable-tower-cover', active.map(unit => unit.id));
    const units = active.filter(unit => walkingDistance(snapshot.map, unit, point) !== undefined);
    if (!units.length) return { ...blockedExecutor(input, active.length ? 'defense-route-unreachable'
      : cohort.length ? 'defenders-in-life-saving-interruption' : granted.length ? 'defenders-in-transit' : 'no-granted-defenders'),
      handoffs: handoffs(input, active) };
    const protectedEntities = [site, ...snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && distance(unit, site) <= 650)];
    const previousHp = execution.state.protectedHp;
    const hp = Object.fromEntries(protectedEntities.map(entity => [entity.id, entity.hp]));
    const underAttack = protectedEntities.some(entity => {
      const before = isRecord(previousHp) ? previousHp[entity.id] : undefined;
      return typeof before === 'number' && entity.hp < before
        || snapshot.projectiles.some(shot => shot.targetId === entity.id && isOpponentOwner(snapshot, owner, shot.owner, {}))
        || foes.some(foe => aimedAt(foe, entity.id) && distance(foe, entity) <= foe.attackRange + foe.radius + entity.radius);
    });
    const arrived = units.filter(unit => distance(unit, point) <= MINING_RALLY_RADIUS);
    const enough = arrived.length > 0 && strengthOf(arrived) >= strengthOf(foes) * 1.25;
    const phase = waiting ? 'cover' : execution.phase === 'fight' || enough || underAttack || arrived.length === units.length ? 'fight' : 'gather';
    const commands: GameCommand[] = [];
    for (const unit of units) {
      if (unit.order.type === 'cast' || unit.order.type === 'charge') continue;
      const returning = distance(unit, site) > MINING_PURSUIT_RADIUS;
      if (returning || distance(unit, point) > MINING_RALLY_RADIUS) {
        if (!(unit.order.type === 'move' && distance(unit.order, point) < 40)) commands.push({ type: 'move', unitIds: [unit.id], ...point, avoidCombat: true });
        continue;
      }
      const target = phase === 'fight' && unit.attackDamage > 0 && foes.filter(foe => distance(foe, site) <= MINING_PURSUIT_RADIUS)
        .sort((a, b) => distance(unit, a) - distance(unit, b))[0];
      if (target) {
        if (!aimedAt(unit, target.id)) commands.push({ type: 'attack', unitIds: [unit.id], targetId: target.id });
      } else if (unit.order.type !== 'hold') commands.push({ type: 'holdPosition', unitIds: [unit.id] });
    }
    const firstArrival = execution.state.arrivalRecorded !== true && arrived.length > 0;
    return { ...base, status: 'active', phase, state: { ...execution.state, post: { ...point }, protectedHp: hp,
      arrivalRecorded: execution.state.arrivalRecorded === true || firstArrival },
    commands: commands.map(command => ({ command, purpose: 'task' })),
    progress: firstArrival ? [{ kind: 'garrison-arrived', unitIds: arrived.map(unit => unit.id), entityIds: [site.id], basis: 'observed-world' }] : [],
    handoffs: handoffs(input, active) };
  },
};
