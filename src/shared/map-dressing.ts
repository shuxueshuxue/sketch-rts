import { detCos, detSin } from "./det-math";
import type { Terrain } from "./terrain";
import type { TerrainLandmark } from "./types";
const seedOf = (seed: string) =>
  [...seed].reduce(
    (n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0,
    2166136261,
  );
/** Visual ground cover is independent of movement, construction and pathfinding. */
export function terrainSurfaces(terrain: Terrain, seed: string) {
  const salt = seedOf(seed);
  return [...terrain.cells]
    .map((cell, index) => {
      if (cell !== ".") return " ";
      const col = index % terrain.cols,
        row = Math.floor(index / terrain.cols);
      const near = (char: string) =>
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => {
          const x = col + dx!,
            y = row + dy!;
          return (
            x >= 0 &&
            y >= 0 &&
            x < terrain.cols &&
            y < terrain.rows &&
            terrain.cells[y * terrain.cols + x] === char
          );
        });
      if (near(",")) return "s";
      if (near("#")) return "r";
      const wave =
        detSin((col + (salt % 91)) / 11) +
        detCos((row + (salt % 53)) / 9) +
        detSin((col + row) / 17) * 0.7;
      return wave > 1.1 ? "g" : wave < -0.9 ? "d" : " ";
    })
    .join("");
}
export function coastalDressing(
  terrain: Terrain,
  protectedPoints: readonly { x: number; y: number }[],
  seed: string,
): TerrainLandmark[] {
  const marks: TerrainLandmark[] = [],
    salt = seedOf(seed);
  for (let row = 2; row < terrain.rows - 2; row += 4)
    for (let col = 2; col < terrain.cols - 2; col += 4) {
      const value =
        Math.imul((row * terrain.cols + col) ^ salt, 2246822519) >>> 0;
      if (value % 11 > 1) continue;
      const x = (col + 0.5) * terrain.cell,
        y = (row + 0.5) * terrain.cell;
      if (protectedPoints.some((p) => Math.hypot(p.x - x, p.y - y) < 220))
        continue;
      const cell = terrain.cells[row * terrain.cols + col];
      if (![".", ",", "m"].includes(cell!)) continue;
      const nearby = [-1, 1, -terrain.cols, terrain.cols].map(
        (d) => terrain.cells[row * terrain.cols + col + d],
      );
      const kind: TerrainLandmark["kind"] =
        cell === ","
          ? "reeds"
          : cell === "m"
            ? "lilies"
            : nearby.includes("T")
              ? "mushrooms"
              : nearby.includes("#")
                ? "pebbles"
                : (["flowers", "bush", "stump", "pebbles"] as const)[
                    value % 4
                  ]!;
      marks.push({
        id: `coastal-decor-${marks.length}`,
        kind,
        x,
        y,
        size: 44 + (value % 34),
        rotation: (value % 628) / 100,
      });
    }
  return marks;
}
