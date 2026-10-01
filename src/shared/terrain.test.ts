import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, stepGame } from "./sim";
import { isBuildPlacementClear } from "./build-placement";
import { isFootprintBuildable, isShoreFootprint, isWalkable, segmentWalkable, steerPoint, walkableGoal, walkingDistance, type Terrain } from "./terrain";

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
    expect(isFootprintBuildable(map(terrain), 5 * 32, 5 * 32, 48)).toBe(true);
    expect(isFootprintBuildable(map(terrain), 10 * 32 - 20, 5 * 32, 30)).toBe(false);
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

// A 20 by 20 grid: land on the left (shallows across row 3, a pond at rows 15-16, rock on the coast at rows 12-13), the sea
// from column 10 on, and an island in the sea at columns 13-15, rows 8-11.
function harbor(): Terrain {
  let cells = "";
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 20; col += 1) {
      if (col >= 10) cells += row >= 8 && row <= 11 && col >= 13 && col <= 15 ? "." : "~";
      else if (row >= 15 && row <= 16 && col >= 2 && col <= 3) cells += "~";
      else if (row >= 12 && row <= 13 && col === 9) cells += "#";
      else cells += row === 3 && col >= 2 && col <= 4 ? "," : ".";
    }
  }
  return { cell: 32, cols: 20, rows: 20, cells };
}

const at = (col: number, row: number) => ({ x: col * 32 + 16, y: row * 32 + 16 });

describe("the sea", () => {
  it("is the ships', the land the soldiers', and the shallows both's", () => {
    const sea = map(harbor());
    for (const [col, row, ship, soldier] of [[12, 2, true, false], [5, 5, false, true], [3, 3, true, true], [2, 15, true, false], [14, 9, false, true], [9, 12, false, false]] as const) {
      expect(isWalkable(sea, at(col, row).x, at(col, row).y, "sea"), `ship at ${col},${row}`).toBe(ship);
      expect(isWalkable(sea, at(col, row).x, at(col, row).y), `soldier at ${col},${row}`).toBe(soldier);
    }
  });

  it("sails a ship round the island to the far side, never over land", () => {
    const sea = map(harbor());
    const goal = at(18, 9);
    let ship = at(11, 9);
    expect(segmentWalkable(sea, ship, goal, "sea")).toBe(false);
    // Each tick as the sim's walk takes it (see @@@terrain-walk): toward the steer point, or along one axis when the step
    // would end on land.
    for (let tick = 0; tick < 400 && Math.hypot(goal.x - ship.x, goal.y - ship.y) > 0; tick += 1) {
      const aim = steerPoint(sea, ship, goal, "sea");
      const gap = Math.hypot(aim.x - ship.x, aim.y - ship.y);
      const next = gap <= 3.2 ? aim : { x: ship.x + ((aim.x - ship.x) / gap) * 3.2, y: ship.y + ((aim.y - ship.y) / gap) * 3.2 };
      if (isWalkable(sea, next.x, next.y, "sea")) ship = next;
      else if (isWalkable(sea, next.x, ship.y, "sea")) ship = { x: next.x, y: ship.y };
      else if (isWalkable(sea, ship.x, next.y, "sea")) ship = { x: ship.x, y: next.y };
      expect(isWalkable(sea, ship.x, ship.y, "sea")).toBe(true);
    }
    expect(ship).toEqual(goal);
    expect(walkingDistance(sea, at(11, 9), goal, "sea")!).toBeGreaterThan(8 * 32);
  });

  it("stops a ship sent inland at the shore, and joins no two waters", () => {
    const sea = map(harbor());
    expect(walkableGoal(sea, at(7, 8).x, at(7, 8).y, "sea")).toEqual(at(10, 8));
    expect(walkingDistance(sea, at(12, 2), at(2, 15), "sea")).toBeUndefined();
    expect(walkingDistance(sea, at(5, 5), at(14, 9))).toBeUndefined();
  });

  it("leaves the soldiers' ways as they were when ships ask too", () => {
    const terrain = harbor();
    const before = walkingDistance(map(terrain), at(1, 1), at(8, 18));
    steerPoint(map(terrain), at(11, 9), at(18, 9), "sea");
    walkableGoal(map(terrain), at(5, 5).x, at(5, 5).y, "sea");
    expect(walkingDistance(map(terrain), at(1, 1), at(8, 18))).toBe(before);
    expect(walkableGoal(map(terrain), at(12, 2).x, at(12, 2).y)).toEqual(at(9, 2));
  });

  it("places a shipyard on the shore only: its center on land, water under part of it, no part on rock", () => {
    const sea = map(harbor());
    expect(isShoreFootprint(sea, 300, at(0, 5).y, 44)).toBe(true);
    expect(isShoreFootprint(sea, 340, at(0, 5).y, 44)).toBe(false);
    expect(isShoreFootprint(sea, 200, at(0, 5).y, 44)).toBe(false);
    expect(isShoreFootprint(sea, 300, at(0, 12).y, 44)).toBe(false);
    // Any water will do, a pond's or an island's shore.
    expect(isShoreFootprint(sea, at(3, 14).x, at(3, 14).y, 44)).toBe(true);
    expect(isShoreFootprint(sea, at(13, 8).x, at(13, 8).y, 44)).toBe(true);
    expect(isShoreFootprint({}, 300, at(0, 5).y, 44)).toBe(false);
  });

  it("lets a worker raise a shipyard on the shore, and refuses one inland or a farm half in the sea", () => {
    const terrain = harbor();
    const sim = createGame("bareDuel", {
      players: ["player", "enemy"],
      scenario: {
        players: { player: { gold: 1_000 } },
        replaceDefaultUnits: true,
        replaceDefaultBuildings: true,
        addBuildings: [
          { id: "hall-a", owner: "player", kind: "townHall", x: 80, y: 80 },
          { id: "hall-b", owner: "enemy", kind: "townHall", x: 200, y: 560 },
        ],
        addUnits: [{ id: "worker", owner: "player", kind: "worker", x: 200, y: at(0, 5).y }],
      },
    });
    sim.map = { ...sim.map, width: 640, height: 640, terrain };
    expect(() => issuePlayerCommand(sim, "player", { type: "build", unitId: "worker", buildingKind: "shipyard", x: 200, y: 300 })).toThrow(/blocked ground/);
    expect(() => issuePlayerCommand(sim, "player", { type: "build", unitId: "worker", buildingKind: "farm", x: 310, y: 300 })).toThrow(/blocked ground/);
    issuePlayerCommand(sim, "player", { type: "build", unitId: "worker", buildingKind: "shipyard", x: 300, y: at(0, 5).y });
    for (let tick = 0; tick < 600; tick += 1) stepGame(sim);
    expect(sim.buildings.find((building) => building.kind === "shipyard")?.complete).toBe(true);
  });
});
