import { BUILDING_DEFS } from "../shared/catalog";
import { footprintCells, isFootprintBuildable, isWalkable } from "../shared/terrain";
import type { BuildingKind, GameSnapshot } from "../shared/types";

type Point = { x: number; y: number };

// The cells a body takes on a map's grid, as the sim lays it (see @@@building-footprint): the cell size and the first
// and last column and row. A map without terrain has no grid, and so no cells.
export type FootprintSquare = { cell: number; left: number; right: number; top: number; bottom: number };

export function footprintSquare(snapshot: Pick<GameSnapshot, "map">, at: Point, radius: number): FootprintSquare | undefined {
  const cell = snapshot.map.terrain?.cell;
  return cell === undefined ? undefined : { cell, ...footprintCells(cell, at.x, at.y, radius) };
}

// Draws a footprint's cells as squares in their ink, faintly filled and edged, on a canvas showing the world from `camera`.
export function drawFootprint(ctx: CanvasRenderingContext2D, square: FootprintSquare, camera: Point, inkOf: (col: number, row: number) => string) {
  const { cell } = square;
  ctx.save();
  ctx.lineWidth = 1.5;
  for (let row = square.top; row <= square.bottom; row += 1) {
    for (let col = square.left; col <= square.right; col += 1) {
      const x = col * cell - camera.x;
      const y = row * cell - camera.y;
      ctx.fillStyle = ctx.strokeStyle = inkOf(col, row);
      ctx.globalAlpha = 0.3;
      ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      ctx.globalAlpha = 0.9;
      ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
    }
  }
  ctx.restore();
}

// @@@footprint-preview - Which cells of a building's footprint (see footprintSquare) stop it, as Warcraft III marks them
// red: a cell off the map, under another building, rock pile or gate's footprint, or ground the building cannot take. A
// building on dry ground takes only buildable ground; a shipyard (see @@@shore-footprint) takes ground a worker walks or
// water, but no forest, rock or ramp. Whether a shipyard's footprint as a whole holds a dry cell and open water is no one
// cell's fault, so it marks none.
export function blockedFootprintCells(snapshot: Pick<GameSnapshot, "map" | "buildings" | "obstacles">, kind: BuildingKind, square: FootprintSquare) {
  const { cell } = square;
  const map = snapshot.map;
  const terrain = map.terrain;
  const others = [...snapshot.buildings, ...(snapshot.obstacles ?? [])].map((body) => footprintCells(cell, body.x, body.y, body.radius));
  const blocked = new Set<string>();
  for (let row = square.top; row <= square.bottom; row += 1) {
    for (let col = square.left; col <= square.right; col += 1) {
      const off = !terrain || col < 0 || row < 0 || col >= terrain.cols || row >= terrain.rows;
      const taken = others.some((other) => col >= other.left && col <= other.right && row >= other.top && row <= other.bottom);
      const x = (col + 0.5) * cell;
      const y = (row + 0.5) * cell;
      // One cell's ground: a footprint of a single cell round that cell's center.
      const ground = BUILDING_DEFS[kind].shore
        ? (isWalkable(map, x, y, "land") || isWalkable(map, x, y, "sea")) && terrain?.levels?.[row * terrain.cols + col] !== "2"
        : isFootprintBuildable(map, x, y, cell / 2);
      if (off || taken || !ground) blocked.add(`${col},${row}`);
    }
  }
  return blocked;
}
