import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, stepGame } from "./sim";
import { isBuildPlacementClear } from "./build-placement";
import { isFootprintWalkable, isWalkable, segmentWalkable, steerPoint, walkableGoal, walkingDistance, type Terrain } from "./terrain";

// A 20 by 20 grid of 32-unit cells: open ground with a forest wall down column 10 from the top to row 15, so the way
// from the left half to the right half goes round its foot.
function walled(): Terrain {
  const rows: string[] = [];
  for (let row = 0; row < 20; row += 1) {
    let line = "";
    for (let col = 0; col < 20; col += 1) line += col === 10 && row <= 15 ? "T" : ".";
    rows.push(line);
  }
  return { cell: 32, cols: 20, rows: 20, cells: rows.join("") };
}

const map = (terrain: Terrain) => ({ terrain, width: terrain.cols * terrain.cell, height: terrain.rows * terrain.cell });

describe("terrain", () => {
  it("knows where a unit may stand and snaps a goal in the forest to its edge", () => {
    const terrain = walled();
    expect(isWalkable(map(terrain), 100, 100)).toBe(true);
    expect(isWalkable(map(terrain), 10 * 32 + 5, 100)).toBe(false);
    expect(isWalkable({}, 10 * 32 + 5, 100)).toBe(true);
    const goal = walkableGoal(map(terrain), 10 * 32 + 16, 5 * 32 + 16);
    expect(isWalkable(map(terrain), goal.x, goal.y)).toBe(true);
    expect(Math.abs(goal.x - (10 * 32 + 16))).toBe(32);
    expect(walkableGoal(map(terrain), 50, 60)).toEqual({ x: 50, y: 60 });
  });

  it("sees along open ground and not through the wall, nor between two blocks that only touch at a corner", () => {
    const terrain = walled();
    expect(segmentWalkable(map(terrain), { x: 40, y: 40 }, { x: 300, y: 500 })).toBe(true);
    expect(segmentWalkable(map(terrain), { x: 100, y: 100 }, { x: 500, y: 100 })).toBe(false);
    expect(segmentWalkable(map(terrain), { x: 100, y: 600 }, { x: 600, y: 600 })).toBe(true);
    const diagonal: Terrain = { cell: 32, cols: 4, rows: 4, cells: ".....T....T....." };
    expect(segmentWalkable(map(diagonal), { x: 16, y: 16 }, { x: 112, y: 112 })).toBe(false);
  });

  it("steers round the wall's foot and measures the walk round it", () => {
    const terrain = walled();
    const from = { x: 5 * 32, y: 3 * 32 };
    const to = { x: 15 * 32, y: 3 * 32 };
    const aim = steerPoint(map(terrain), from, to);
    expect(aim.y).toBeGreaterThan(from.y);
    expect(segmentWalkable(map(terrain), from, aim)).toBe(true);
    const walk = walkingDistance(map(terrain), from, to)!;
    expect(walk).toBeGreaterThan(Math.hypot(to.x - from.x, to.y - from.y) * 2);
    expect(walkingDistance({}, from, to)).toBeCloseTo(320);
  });

  it("refuses a building any part of which would stand in the forest", () => {
    const terrain = walled();
    expect(isFootprintWalkable(map(terrain), 5 * 32, 5 * 32, 48)).toBe(true);
    expect(isFootprintWalkable(map(terrain), 10 * 32 - 20, 5 * 32, 30)).toBe(false);
    expect(isBuildPlacementClear({ buildings: [], map: map(terrain) }, "farm", { x: 10 * 32 - 20, y: 5 * 32 })).toBe(false);
    expect(isBuildPlacementClear({ buildings: [], map: map(terrain) }, "farm", { x: 5 * 32, y: 5 * 32 })).toBe(true);
  });
});

describe("walking on terrain", () => {
  function game(terrain: Terrain) {
    const created = createGame("bareDuel", {
      players: ["player", "enemy"],
      scenario: {
        replaceDefaultUnits: true,
        replaceDefaultBuildings: true,
        addBuildings: [
          { id: "hall-a", owner: "player", kind: "townHall", x: 100, y: 580 },
          { id: "hall-b", owner: "enemy", kind: "townHall", x: 560, y: 580 },
        ],
        addUnits: [
          { id: "runner", owner: "player", kind: "footman", x: 5 * 32, y: 3 * 32 },
          { id: "a", owner: "player", kind: "footman", x: 9 * 32 + 20, y: 5 * 32 },
          { id: "b", owner: "player", kind: "footman", x: 9 * 32 + 22, y: 5 * 32 + 4 },
        ],
      },
    });
    created.map = { ...created.map, width: terrain.cols * terrain.cell, height: terrain.rows * terrain.cell, terrain };
    return created;
  }

  it("walks a unit round the wall to a point behind it, never setting foot in the forest", () => {
    const terrain = walled();
    const sim = game(terrain);
    issuePlayerCommand(sim, "player", { type: "move", unitIds: ["runner"], x: 15 * 32, y: 3 * 32 });
    let longest = 0;
    for (let tick = 0; tick < 600; tick += 1) {
      stepGame(sim);
      const runner = sim.units.find((unit) => unit.id === "runner")!;
      expect(isWalkable(sim.map, runner.x, runner.y)).toBe(true);
      longest = Math.max(longest, runner.y);
      if (runner.order.type === "idle") break;
    }
    const runner = sim.units.find((unit) => unit.id === "runner")!;
    expect(runner.order.type).toBe("idle");
    expect(Math.hypot(runner.x - 15 * 32, runner.y - 3 * 32)).toBeLessThan(5);
    expect(longest).toBeGreaterThan(15 * 32);
  });

  it("ends a move into the forest at its edge, and pushes no unit into it", () => {
    const terrain = walled();
    const sim = game(terrain);
    issuePlayerCommand(sim, "player", { type: "move", unitIds: ["runner"], x: 10 * 32 + 16, y: 3 * 32 + 16 });
    for (let tick = 0; tick < 300; tick += 1) stepGame(sim);
    const runner = sim.units.find((unit) => unit.id === "runner")!;
    expect(runner.order.type).toBe("idle");
    for (const unit of sim.units) expect(isWalkable(sim.map, unit.x, unit.y)).toBe(true);
  });

  it("refuses a build order on blocked ground", () => {
    const terrain = walled();
    const sim = game(terrain);
    sim.units.push({ ...sim.units.find((unit) => unit.id === "runner")!, id: "worker", kind: "worker" });
    expect(() => issuePlayerCommand(sim, "player", { type: "build", unitId: "worker", buildingKind: "farm", x: 10 * 32, y: 5 * 32 })).toThrow(/blocked ground/);
  });
});
