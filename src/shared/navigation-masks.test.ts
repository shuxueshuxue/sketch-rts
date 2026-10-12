import { describe, expect, it } from "vitest";
import { createUnit } from "./map";
import { shipProfile, SHIP_KINDS } from "./ship-geometry";
import { detCos, detSin } from "./det-math";
import { polygonPlanes, polygonTouchesCell } from "./navigation-math";
import prepared from "./generated/ship-navigation-masks.json";
import prepared64 from "./generated/ship-navigation-masks-64.json";
describe("configuration-space ship stencils", () => {
  it.each([32,64])("covers intermediate hulls for every ship, heading, turn and docking maneuver at cell %d", (cell) => {
    const preparedCells=cell===32?prepared:prepared64;
    const directions = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const;
    for (const kind of SHIP_KINDS) {
      const hull = shipProfile(createUnit("ship", "player", kind, 0, 0))!.hull;
      for (let heading = 0; heading < 8; heading++)
        for (let move = 0; move < 7; move++) {
          const mask = preparedCells[kind][heading]![move]!;
          const occupied = new Set(Array.from({ length: mask.cells.length / 2 }, (_, i) => `${mask.cells[i * 2]},${mask.cells[i * 2 + 1]}`));
          const turn = move === 1 ? Math.PI / 4 : move === 2 ? -Math.PI / 4 : 0;
          const [dx, dy] = move < 3 ? [0, 0] : directions[(heading + (move - 3) * 2) % 8]!;
          for (let step = 0; step <= 16; step++) {
            const fraction = step / 16, angle = heading * Math.PI / 4 + turn * fraction;
            const polygon = hull.map(p => ({ x: cell/2 + dx * cell * fraction + p.x * detCos(angle) - p.y * detSin(angle), y: cell/2 + dy * cell * fraction + p.x * detSin(angle) + p.y * detCos(angle) }));
            const axes = polygonPlanes(polygon);
            const l = Math.min(...polygon.map(p => p.x)), r = Math.max(...polygon.map(p => p.x));
            const t = Math.min(...polygon.map(p => p.y)), b = Math.max(...polygon.map(p => p.y));
            for (let row = Math.floor(t / cell); row <= Math.floor((b - 1e-7) / cell); row++)
              for (let col = Math.floor(l / cell); col <= Math.floor((r - 1e-7) / cell); col++)
                if (polygonTouchesCell(axes, col * cell, row * cell, cell))
                  expect(occupied.has(`${col},${row}`), `${kind}/${heading}/${move}/${step}: ${col},${row}`).toBe(true);
          }
        }
    }
  });
});
