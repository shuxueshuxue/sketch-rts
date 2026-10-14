import { describe, expect, it } from "vitest";
import { BUILDING_DEFS } from "../shared/catalog";
import { createGame } from "../shared/sim";
import { snapToFootprint } from "../shared/terrain";
import { blockedFootprintCells, footprintSquare } from "./footprint-view";

const cellsOf = (square: { left: number; right: number; top: number; bottom: number }) => ({ cols: square.right - square.left + 1, rows: square.bottom - square.top + 1 });

describe("footprint view", () => {
  const game = createGame("greystonePass", { players: ["p1", "p2"], aiPlayers: [] });
  const hall = game.buildings.find((building) => building.owner === "p1" && building.kind === "townHall")!;
  const cell = game.map.terrain!.cell;

  it("takes the sim's cells: three across for a hall, two for a farm, none on a map without a grid", () => {
    expect(cellsOf(footprintSquare(game, hall, hall.radius)!)).toEqual({ cols: 3, rows: 3 });
    const farm = snapToFootprint(game.map, BUILDING_DEFS.farm.radius, { x: hall.x + 300, y: hall.y });
    expect(cellsOf(footprintSquare(game, farm, BUILDING_DEFS.farm.radius)!)).toEqual({ cols: 2, rows: 2 });
    expect(footprintSquare(createGame("bareDuel", { aiPlayers: [] }), { x: 500, y: 500 }, BUILDING_DEFS.farm.radius)).toBeUndefined();
  });

  it("marks red the cells under another building's footprint, not the open ones beside it, and those off the map", () => {
    const radius = BUILDING_DEFS.farm.radius;
    const hallCells = footprintSquare(game, hall, hall.radius)!;
    // A farm whose left column is the hall's right column.
    const at = { x: (hallCells.right + 1) * cell, y: (hallCells.top + 1) * cell };
    const square = footprintSquare(game, at, radius)!;
    const blocked = blockedFootprintCells(game, "farm", square);
    for (let row = square.top; row <= square.bottom; row += 1) {
      expect(blocked.has(`${hallCells.right},${row}`)).toBe(true);
      expect(blocked.has(`${hallCells.right + 1},${row}`)).toBe(false);
    }

    const corner = blockedFootprintCells(game, "farm", footprintSquare(game, { x: 0, y: 0 }, radius)!);
    for (const off of ["-1,-1", "-1,0", "0,-1"]) expect(corner.has(off)).toBe(true);
  });

  it("marks red a shipyard's cells on forest or rock, and not its water or ground", () => {
    const terrain = game.map.terrain!;
    const at = (col: number, row: number) => terrain.cells[row * terrain.cols + col];
    // A deep-water cell with forest or rock among its eight neighbours, away from the map's edge and every building.
    let centre: { col: number; row: number } | undefined;
    for (let i = 0; i < terrain.cells.length && !centre; i += 1) {
      const col = i % terrain.cols, row = Math.floor(i / terrain.cols);
      if (terrain.cells[i] !== "~" || col < 2 || row < 2 || col > terrain.cols - 3 || row > terrain.rows - 3) continue;
      const near = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => at(col + dx, row + dy)));
      if (near.some((char) => char === "T" || char === "#")) centre = { col, row };
    }
    expect(centre).toBeDefined();
    const point = { x: (centre!.col + 0.5) * cell, y: (centre!.row + 0.5) * cell };
    const square = footprintSquare(game, point, BUILDING_DEFS.shipyard.radius)!;
    expect(cellsOf(square)).toEqual({ cols: 3, rows: 3 });
    const blocked = blockedFootprintCells(game, "shipyard", square);
    for (let row = square.top; row <= square.bottom; row += 1) {
      for (let col = square.left; col <= square.right; col += 1) {
        const char = at(col, row);
        expect(blocked.has(`${col},${row}`), `${col},${row} is ${char}`).toBe(char === "T" || char === "#");
      }
    }
  });
});
