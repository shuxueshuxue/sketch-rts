import { detCos, detSin } from './det-math';
import { convexHull, expandConvex, polygonPlanes, polygonRadius, polygonTouchesCell, type Point } from './navigation-math';
export type OccupancyMask = {
  bounds: [
    number,
    number,
    number,
    number
  ];
  cells: number[];
};
const angle = Math.PI / 4, steps = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
/** A rasterized configuration-space footprint. Generated from geometry, never from a game map. */
export function buildNavigationMasks(hull: readonly Point[], cell: number): OccupancyMask[][] {
  const radius = polygonRadius(hull);
  const outline = (x: number, y: number, heading: number) => {
    const c=detCos(heading),s=detSin(heading);
    return hull.map(p => ({ x: x + p.x * c - p.y * s, y: y + p.x * s + p.y * c }));
  };
  const sweep = (h: number, turn: number, dx: number, dy: number) => {
    const count = Math.max(1, Math.ceil(Math.abs(turn) * radius / 2)), covered = new Set<string>();
    const error = turn ? radius * (turn / count) ** 2 / 8 + 1e-7 : 0;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (let i = 0; i < count; i++) {
      const envelope = convexHull([...outline(cell / 2 + dx * i / count, cell / 2 + dy * i / count, h + i * turn / count), ...outline(cell / 2 + dx * (i + 1) / count, cell / 2 + dy * (i + 1) / count, h + (i + 1) * turn / count)]);
      const poly = error ? expandConvex(envelope, error) : envelope;
      const l = Math.min(...poly.map(p => p.x)), t = Math.min(...poly.map(p => p.y)), r = Math.max(...poly.map(p => p.x)), b = Math.max(...poly.map(p => p.y));
      left = Math.min(left, l);
      top = Math.min(top, t);
      right = Math.max(right, r);
      bottom = Math.max(bottom, b);
      const axes = polygonPlanes(poly);
      for (let row = Math.floor(t / cell); row <= Math.floor((b - 1e-7) / cell); row++)
        for (let col = Math.floor(l / cell); col <= Math.floor((r - 1e-7) / cell); col++)
          if (polygonTouchesCell(axes, col * cell, row * cell, cell))
            covered.add(`${col},${row}`);
    }
    return { bounds: [left, top, right, bottom] as OccupancyMask['bounds'], cells: [...covered].flatMap(key => key.split(',').map(Number)) };
  };
  return Array.from({ length: 8 }, (_, h) => [sweep(h * angle, 0, 0, 0), sweep(h * angle, angle, 0, 0), sweep(h * angle, -angle, 0, 0), ...Array.from({ length: 4 }, (_, m) => { const [dx, dy] = steps[(h + m * 2) % 8]!; return sweep(h * angle, 0, dx * cell, dy * cell); })]);
}
