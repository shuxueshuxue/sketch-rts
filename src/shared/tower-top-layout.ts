import { detCos, detSin } from "./det-math";
import type { Building, Unit } from "./types";

type Circle = { x: number; y: number; radius: number };
const EPS = 1e-7;
// A bounded, deterministic search: at most four troops (each costs at least one supply).
const DIRECTIONS = Array.from({ length: 16 }, (_, i) => ({ x: detCos(i * Math.PI / 8), y: detSin(i * Math.PI / 8) }));
function intersections(a: Circle, b: Circle): { x: number; y: number }[] {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  if (d < EPS || d > a.radius + b.radius + EPS || d < Math.abs(a.radius - b.radius) - EPS) return [];
  const along = (a.radius ** 2 - b.radius ** 2 + d ** 2) / (2 * d);
  const height = Math.sqrt(Math.max(0, a.radius ** 2 - along ** 2));
  const x = a.x + dx * along / d, y = a.y + dy * along / d;
  return [{ x: x - dy * height / d, y: y + dx * height / d }, { x: x + dy * height / d, y: y - dx * height / d }];
}

/** Fit whole bodies inside the circular top, without overlap. The same layout admits and seats troops. */
export function towerTopLayout(tower: Pick<Building, "x" | "y" | "radius">, troops: readonly Pick<Unit, "id" | "radius">[]) {
  const sorted = [...troops].sort((a, b) => b.radius - a.radius || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: Circle[] = [];
  const search = (index: number): boolean => {
    if (index === sorted.length) return true;
    const radius = sorted[index]!.radius, reach = tower.radius - radius;
    if (!(radius > 0) || reach < 0) return false;
    const boundary = { x: 0, y: 0, radius: reach };
    const exclusions = placed.map(other => ({ ...other, radius: other.radius + radius }));
    const candidates = [{ x: 0, y: 0 }, ...DIRECTIONS.map(dir => ({ x: dir.x * reach, y: dir.y * reach }))];
    for (const [i, circle] of exclusions.entries()) {
      candidates.push(...intersections(boundary, circle));
      for (const other of exclusions.slice(0, i)) candidates.push(...intersections(circle, other));
    }
    for (const point of candidates) {
      if (Math.hypot(point.x, point.y) + radius > tower.radius + EPS
        || placed.some(other => Math.hypot(point.x - other.x, point.y - other.y) < radius + other.radius - EPS)) continue;
      placed.push({ ...point, radius });
      if (search(index + 1)) return true;
      placed.pop();
    }
    return false;
  };
  if (!search(0)) return undefined;
  return new Map(sorted.map((unit, i) => [unit.id, { x: tower.x + placed[i]!.x, y: tower.y + placed[i]!.y }]));
}
