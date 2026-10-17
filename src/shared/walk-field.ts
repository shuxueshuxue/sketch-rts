import type { Point } from './navigation-math';

// @@@walk-field - How a body walks a floor laid with fixed waypoints (a deck, or decks joined with a bridge or shore).
// The graph is the floor's: its waypoints, which pairs see each other past the fixed fittings and railing, and how far
// apart they are, each measured once and kept with the floor. From it, a field per goal: how far each waypoint is from
// the goal by the fixed floor alone, shared by every body going there. A body takes the leg to the waypoint that leaves
// it the least walk, among legs clear of the floor and of the bodies around it now; a leg that brings it no nearer the
// goal is not taken, and it stands where it is. Bodies decide only the leg taken now, not the whole route: a body in the
// way of the best leg is stepped round, through points beside it, when that still brings the walker nearer.
export type WalkGraph = {
  nodes: Point[];
  // Whether two waypoints see each other (0: not yet asked, 1: yes, -1: no), and how far apart they are (NaN: not yet).
  links: Int8Array;
  distances: Float64Array;
  fields: Map<string, Float64Array>;
};

export function walkGraph(nodes: Point[]): WalkGraph {
  return { nodes, links: new Int8Array(nodes.length ** 2), distances: new Float64Array(nodes.length ** 2).fill(NaN), fields: new Map() };
}

/** How far each waypoint is from the goal by the fixed floor (Infinity where it cannot be walked to). */
export function walkField(graph: WalkGraph, goal: Point, clear: (a: Point, b: Point) => boolean) {
  const key = `${goal.x},${goal.y}`;
  let field = graph.fields.get(key);
  if (field) return field;
  const { nodes, links, distances } = graph, count = nodes.length;
  field = new Float64Array(count).fill(Infinity);
  for (let i = 0; i < count; i++) if (clear(goal, nodes[i]!)) field[i] = Math.hypot(nodes[i]!.x - goal.x, nodes[i]!.y - goal.y);
  const done = new Uint8Array(count);
  for (let pass = 0; pass < count; pass++) {
    let current = -1;
    for (let i = 0; i < count; i++) if (!done[i] && (current < 0 || field[i]! < field[current]!)) current = i;
    if (current < 0 || !Number.isFinite(field[current]!)) break;
    done[current] = 1;
    for (let i = 0; i < count; i++) {
      if (done[i]) continue;
      const index = current * count + i;
      if (!links[index]) links[index] = links[i * count + current] = clear(nodes[current]!, nodes[i]!) ? 1 : -1;
      if (links[index] !== 1) continue;
      let distance = distances[index]!;
      if (distance !== distance) distances[index] = distances[i * count + current] = distance = Math.hypot(nodes[i]!.x - nodes[current]!.x, nodes[i]!.y - nodes[current]!.y);
      if (field[current]! + distance < field[i]!) field[i] = field[current]! + distance;
    }
  }
  if (graph.fields.size >= 32) graph.fields.delete(graph.fields.keys().next().value!);
  graph.fields.set(key, field);
  return field;
}

/** The waypoint a body at `from` heads for next, or undefined to stand. When a body stands in the way of the best leg,
 * `around` offers points to step round it (beside that body); each is weighed by the walk left from it. */
export function walkLeg(graph: WalkGraph, field: Float64Array, goal: Point, from: Point, clear: (a: Point, b: Point) => boolean,
  open: (a: Point, b: Point) => boolean, around?: (from: Point, toward: Point) => Point[]) {
  const nodes = graph.nodes, order = ranked(graph, field, from);
  // The walk left from a point: through the best waypoint in sight of it.
  const walkFrom = (point: Point, ranking: { order: number[]; total: Float64Array }) => {
    for (const i of ranking.order) if (clear(point, nodes[i]!)) return { node: i, walk: ranking.total[i]! };
    return undefined;
  };
  const best = walkFrom(from, order);
  if (!best) return undefined;
  const here = best.walk;
  // The best leg clear of the bodies too that still brings the walker nearer.
  let take: Point | undefined, cost = Infinity;
  for (const i of order.order) {
    if (field[i]! >= here - 1e-6 || !clear(from, nodes[i]!)) continue;
    if (open(from, nodes[i]!)) { take = nodes[i]!; cost = order.total[i]!; break; }
  }
  // A body stands in the best leg: a step round it may leave a shorter walk.
  if (around && take !== nodes[best.node] && field[best.node]! < here - 1e-6) {
    for (const point of around(from, nodes[best.node]!)) {
      if (!clear(from, point) || !open(from, point)) continue;
      const rest = clear(point, goal) ? Math.hypot(goal.x - point.x, goal.y - point.y) : walkFrom(point, ranked(graph, field, point))?.walk;
      if (rest === undefined || rest >= here - 1e-6) continue;
      const total = Math.hypot(point.x - from.x, point.y - from.y) + rest;
      if (total < cost) { take = point; cost = total; }
    }
  }
  return take;
}

// The waypoints a point might walk through, best first: by the walk from the point through each, ignoring what is in the
// way (the caller checks).
function ranked(graph: WalkGraph, field: Float64Array, from: Point) {
  const nodes = graph.nodes, total = new Float64Array(nodes.length), order: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (!Number.isFinite(field[i]!)) continue;
    total[i] = Math.hypot(nodes[i]!.x - from.x, nodes[i]!.y - from.y) + field[i]!;
    order.push(i);
  }
  order.sort((a, b) => total[a]! - total[b]! || a - b);
  return { order, total };
}
