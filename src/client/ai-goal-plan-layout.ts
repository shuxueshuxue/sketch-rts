import type { GoalPlan } from '../ai/strategy/goal-planner-types';

export type GoalGraphOrder = 'time' | 'regression';
type Node = { id: string; recordId: string; kind: 'goal' | 'fact' | 'action'; x: number; y: number; reference?: boolean };
type Edge = { from: string; to: string; kind: string; recordFrom: string; recordTo: string };
export type GoalGraphLayout = { nodes: Node[]; edges: Edge[]; width: number; height: number; omitted: number };
const cache = new WeakMap<GoalPlan, GoalGraphLayout>();
export const GOAL_CARD = { width: 116, height: 86, column: 140, row: 108 };

/** A reading projection, not a change to the recorded plan: effect -> achiever
 * -> prerequisite. Shared prerequisites merge in their longest-path column. */
export function goalGraphLayout(plan: GoalPlan): GoalGraphLayout {
  const old = cache.get(plan); if (old) return old;
  const all = [{ id: '$goal', kind: 'goal' as const }, ...plan.facts.map(row => ({ id: row.id, kind: 'fact' as const })),
    ...plan.actions.map(row => ({ id: row.id, kind: 'action' as const }))];
  const rows = all.slice(0, 201), ids = new Set(rows.map(row => row.id));
  const desired = new Set(plan.goal.effects.map(row => row.id));
  const edges: Edge[] = plan.edges.map(row => ({ ...row, recordFrom: row.from, recordTo: row.to,
    from: row.kind === 'requires' ? row.from : row.to, to: row.kind === 'requires' ? row.to : row.from }))
    .filter(row => ids.has(row.from) && ids.has(row.to));
  for (const fact of plan.facts) if (desired.has(fact.observation.fact.id) && ids.has(fact.id))
    edges.push({ from: '$goal', to: fact.id, kind: 'goal-effect', recordFrom: '$goal', recordTo: fact.id });
  const incoming = new Map(rows.map(row => [row.id, 0])), next = new Map(rows.map(row => [row.id, [] as string[]]));
  for (const edge of edges) { incoming.set(edge.to, incoming.get(edge.to)! + 1); next.get(edge.from)!.push(edge.to); }
  const queue = rows.filter(row => incoming.get(row.id) === 0).map(row => row.id), depth = new Map<string, number>();
  for (const id of queue) depth.set(id, id === '$goal' ? 0 : 1);
  for (let i = 0; i < queue.length; i++) for (const id of next.get(queue[i]!)!) {
    depth.set(id, Math.max(depth.get(id) ?? 0, depth.get(queue[i]!)! + 1));
    incoming.set(id, incoming.get(id)! - 1); if (incoming.get(id) === 0) queue.push(id);
  }
  let last = Math.max(0, ...depth.values());
  // Invalid/cyclic records remain inspectable. A backwards dependency becomes
  // an explicitly marked reference leaf instead of a backwards arrow.
  for (const row of rows) if (!queue.includes(row.id)) depth.set(row.id, ++last);
  const projected = rows.map(row => ({ ...row, recordId: row.id, reference: false }));
  let omitted = all.length - rows.length;
  for (const edge of edges) if (depth.get(edge.to)! <= depth.get(edge.from)!) {
    const original = projected.find(row => row.id === edge.to)!;
    if (projected.length >= 201) { edge.to = ''; omitted++; continue; }
    const id = `$reference-${projected.length}`;
    projected.push({ ...original, id, reference: true }); depth.set(id, depth.get(edge.from)! + 1); edge.to = id;
  }
  const columns = new Map<number, typeof projected>();
  for (const row of projected) { const column = depth.get(row.id)!; const list = columns.get(column) ?? []; list.push(row); columns.set(column, list); }
  const maxRows = Math.max(1, ...[...columns.values()].map(rows => rows.length));
  const nodes = [...columns].flatMap(([column, rows]) => rows.map((row, index) => ({ ...row,
    x: 16 + column * GOAL_CARD.column, y: 14 + ((maxRows - rows.length) / 2 + index) * GOAL_CARD.row })));
  const value = { nodes, edges: edges.filter(row => row.to), width: Math.max(300, ...nodes.map(row => row.x + GOAL_CARD.width + 16)),
    height: maxRows * GOAL_CARD.row + 8, omitted };
  cache.set(plan, value); return value;
}
