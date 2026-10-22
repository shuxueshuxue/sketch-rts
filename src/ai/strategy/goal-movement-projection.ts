import type { GameSnapshot, Unit } from '../../shared/types';
import { bindGoalFact } from './goal-fact-matching';
import { goalValueKey } from './goal-facts';
import { goalPoolMemberCandidates } from './goal-pool-members';
import { goalReplayAncestors, orderGoalReplayEvents } from './goal-replay-order';
import type { GoalFactReader, GoalPlanningContext } from './goal-planner-types';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const point = (value: unknown): { x: number; y: number } | null => {
  const row = record(value);
  return row && typeof row.x === 'number' && Number.isFinite(row.x) && typeof row.y === 'number' && Number.isFinite(row.y)
    ? { x: row.x, y: row.y } : null;
};
const entity = (value: unknown): string | null => {
  const row = record(value); return row?.kind === 'existing' && typeof row.entityId === 'string' ? row.entityId : null;
};
const ids = (value: unknown) => Array.isArray(value) ? value.flatMap(item => entity(item) ? [entity(item)!] : []) : [];

/** Evaluate selected physical moves on existing identities. No native order is
 * issued and no prospective unit is inserted. The supplied reader uses the
 * same published geometry/query as the present world. Its future availability
 * is retained, so this evidence can never make a move ready in the live world. */
export function createGoalMovementProjection(context: GoalPlanningContext,
  worldReader: (snapshot: GameSnapshot) => GoalFactReader): NonNullable<GoalPlanningContext['readProjectedFact']> {
  type Entry = { unit: Unit; tick: number; actionId: string };
  const prefixes = new WeakMap<object, { moved: Map<string, Entry>; read: GoalFactReader; snapshot: GameSnapshot }>();
  return (input, projection) => {
    const fact = bindGoalFact(input, projection.bindings), p = fact.predicate;
    let prefix = prefixes.get(projection.actions);
    if (!prefix) {
    const moved = new Map<string, Entry>();
    const actual = new Map(context.snapshot.units.filter(unit => unit.owner === context.owner && unit.hp > 0).map(unit => [unit.id, unit]));
    const move = (id: string, to: { x: number; y: number }, tick: number, actionId: string, heading?: unknown) => {
      const before = moved.get(id)?.unit ?? actual.get(id); if (!before) return;
      const unit = { ...before, ...to };
      delete unit.deck; delete unit.cabin;
      if (unit.sailing) {
        unit.sailing = { ...unit.sailing, ...(typeof heading === 'number' ? { heading } : {}) };
        delete unit.sailing.route; delete unit.sailing.planningJob;
      }
      moved.set(id, { unit, tick, actionId });
    };
    const ancestors = goalReplayAncestors(projection.actions);
    const ordered = ancestors && orderGoalReplayEvents(projection.actions.map(step => ({ id: step.action.id,
      tick: step.finishTick, value: step, dependsOn: projection.actions.filter(parent =>
        parent.finishTick <= step.finishTick && ancestors.get(step.action.id)!.has(parent.action.id)).map(parent => parent.action.id) })),
      (a, b) => a.action.id < b.action.id ? -1 : a.action.id > b.action.id ? 1 : 0);
    if (!ordered) return { fact, state: 'unmet', observedTick: context.tick, revision: 'invalid-projected-causality',
      evidence: [], reason: { code: 'projected-prefix-dependencies-invalid', factIds: [fact.id], values: {} } };
    // An equal-finish return follows the voyage that released its hull,
    // regardless of saved array order or allocated action version numbers.
    for (const step of ordered) {
      const kind = step.action.kind, parameters = step.action.executor.parameters;
      if (kind === 'transport-force' || kind === 'transport-worker') {
        const landing = record(parameters.landing), ground = point(landing?.ground), water = point(landing?.water);
        if (!ground || !water) continue;
        const members = [...ids(parameters.cohort), ...(Array.isArray(parameters.dependentUnitIds)
          ? parameters.dependentUnitIds.filter((id): id is string => typeof id === 'string') : [])];
        for (const id of members) move(id, ground, step.finishTick, step.action.id);
        const hull = entity(parameters.transport); if (hull) move(hull, water, step.finishTick, step.action.id, landing?.heading);
      } else if (kind === 'assemble' || kind === 'evacuate') {
        const to = point(record(parameters.at)?.point); if (!to) continue;
        const members = kind === 'assemble' ? ids(parameters.cohort) : Array.isArray(parameters.unitIds)
          ? parameters.unitIds.filter((id): id is string => typeof id === 'string') : [];
        for (const id of members) move(id, to, step.finishTick, step.action.id);
      } else if (kind === 'position-transport') {
        const to = point(record(parameters.at)?.point), id = entity(parameters.transport);
        if (to && id) move(id, to, step.finishTick, step.action.id);
      }
    }
    const snapshot = { ...context.snapshot, units: context.snapshot.units.map(unit => moved.get(unit.id)?.unit ?? unit) };
    prefix = { moved, read: worldReader(snapshot), snapshot };
    prefixes.set(projection.actions, prefix);
    }
    const { moved, snapshot } = prefix;
    let relevant: string[];
    if (p.kind === 'route') relevant = p.actor?.kind === 'pool-member'
      ? goalPoolMemberCandidates({ snapshot, owner: context.owner, reference: p.actor }).map(unit => unit.id)
      : p.actor?.kind === 'existing' ? [p.actor.entityId] : [];
    else if (p.kind === 'worker-at') relevant = p.worker?.kind === 'existing' ? [p.worker.entityId]
      : [...moved].filter(([, entry]) => entry.unit.kind === 'worker').map(([id]) => id);
    else if (p.kind === 'force-at' || p.kind === 'force-available' || p.kind === 'camp-staging' || p.kind === 'interception-capability')
      relevant = p.cohort ? p.cohort.flatMap(ref => ref.kind === 'existing' ? [ref.entityId] : [])
        : [...moved].filter(([, entry]) => entry.unit.kind !== 'worker' && entry.unit.attackDamage > 0).map(([id]) => id);
    else if (p.kind === 'unit-available') relevant = [...moved].filter(([, entry]) => entry.unit.kind === p.unitKind).map(([id]) => id);
    else if (p.kind === 'transport-at') relevant = p.transport.kind === 'existing' ? [p.transport.entityId] : [];
    else if (p.kind === 'cargo-aboard') relevant = p.units.flatMap(ref => ref.kind === 'existing' ? [ref.entityId] : []);
    else return null;
    const changes = relevant.flatMap(id => moved.has(id) ? [moved.get(id)!] : []);
    if (!changes.length) return null;
    const availableTick = Math.max(context.tick, ...changes.map(row => row.tick));
    if (p.kind === 'route' && p.actor?.kind === 'existing') {
      const actor = moved.get(p.actor.entityId)!.unit;
      // A route from one landing cannot price an action after another landing.
      // Geometry alone proves no ownership of its hypothetical start pose.
      if (context.precision !== 'coarse' && Math.hypot(actor.x - p.from.point.x, actor.y - p.from.point.y) > 1e-6) return {
        fact, state: 'unmet', observedTick: context.tick, revision: goalValueKey([fact.id, actor.x, actor.y, availableTick]),
        entityIds: [actor.id], availableTick, evidence: [],
        reason: { code: 'projected-route-origin-mismatch', factIds: [fact.id, ...changes.map(row => row.actionId)], values: {} },
      };
    }
    const observed = prefix.read(fact);
    return { ...observed, availableTick: Math.max(availableTick, observed.availableTick ?? context.tick),
      revision: goalValueKey([observed.revision, changes.map(row => [row.actionId, row.tick, row.unit.id, row.unit.x, row.unit.y])]),
      reason: { ...observed.reason, factIds: [...new Set([...observed.reason.factIds, ...changes.map(row => row.actionId)])].sort(),
        values: { ...observed.reason.values, projectedWorld: true } } };
  };
}
