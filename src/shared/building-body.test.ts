import { describe, expect, it } from "vitest";
import { shove } from "./push";
import { createGame, issueCommand, issuePlayerCommand, stepGame } from "./sim";
import { walkingDistance, type Terrain } from "./terrain";
import type { Building, Unit } from "./types";

// An open 40 by 40 grid of 32-unit cells: terrain everywhere walkable, so only buildings stand in the way.
function openTerrain(): Terrain {
  return { cell: 32, cols: 40, rows: 40, cells: ".".repeat(40 * 40) };
}

function field(withTerrain = true) {
  const terrain = withTerrain ? openTerrain() : undefined;
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  game.buildings = game.buildings.filter((building) => building.kind === "townHall").map((building, index) => ({ ...building, x: index === 0 ? 120 : 1160, y: index === 0 ? 120 : 1160 }));
  game.map = terrain ? { ...game.map, terrain, width: 1280, height: 1280 } : { ...game.map, width: 1280, height: 1280 };
  game.scriptedVictory = true;
  return game;
}

type Field = ReturnType<typeof field>;

function steps(game: Field, ticks: number) {
  for (let tick = 0; tick < ticks; tick += 1) stepGame(game);
}

function wall(game: Field, owner: "player" | "enemy", x: number, ys: number[]) {
  const template = game.buildings.find((building) => building.owner === owner)!;
  for (const [index, y] of ys.entries()) {
    game.buildings.push({ ...template, id: `wall-${owner}-${index}`, kind: "farm", x, y, radius: 30, hp: 320, maxHp: 320, queue: [], researchQueue: [] } as Building);
  }
}

const inside = (unit: Unit, building: Building) => Math.hypot(unit.x - building.x, unit.y - building.y) < unit.radius + building.radius - 0.5;

describe("buildings as bodies", () => {
  it("walks a unit round a wall of buildings to the goal behind it, never into one", () => {
    const game = field();
    // A wall of farms across x 640 from y 300 to y 900; the goal straight behind it.
    wall(game, "player", 640, [300, 364, 428, 492, 556, 620, 684, 748, 812, 876]);
    const footman = game.spawnUnit("player", "footman", 400, 600);
    issueCommand(game, { type: "move", unitIds: [footman.id], x: 880, y: 600 });
    let touched = false;
    for (let tick = 0; tick < 600 && footman.order.type === "move"; tick += 1) {
      stepGame(game);
      if (game.buildings.some((building) => inside(footman, building))) touched = true;
    }
    expect(touched).toBe(false);
    expect(Math.hypot(footman.x - 880, footman.y - 600)).toBeLessThan(10);
  });

  it("walks a worker down the far ramp to a farm under its cliff, not straight at the cliff", () => {
    const game = field();
    // A cliff of rock along row 20 with its ramp at the east end (columns 35 to 39); a farm below it, under the worker.
    const cells = Array.from({ length: 40 * 40 }, (_, at) => (Math.floor(at / 40) === 20 && at % 40 < 35 ? "#" : ".")).join("");
    game.map = { ...game.map, terrain: { cell: 32, cols: 40, rows: 40, cells } };
    wall(game, "player", 336, [720]);
    const worker = game.spawnUnit("player", "worker", 336, 560);
    // Below the cliff, by the farm's wall.
    issueCommand(game, { type: "move", unitIds: [worker.id], x: 336, y: 680 });
    let ticks = 0;
    while (ticks < 2000 && worker.order.type === "move") {
      stepGame(game);
      ticks += 1;
    }
    expect(worker.order.type).toBe("idle");
    expect(worker.y).toBeGreaterThan(672);
  });

  it("measures the AIs' walking distances on the terrain alone, from a hall's center too", () => {
    const game = field();
    stepGame(game);
    const hall = game.buildings.find((building) => building.owner === "player")!;
    const open = walkingDistance(game.map, hall, { x: 1000, y: 120 });
    expect(open).toBeDefined();
    wall(game, "player", 560, [24, 88, 152, 216, 280, 344, 408, 472]);
    stepGame(game);
    expect(walkingDistance(game.map, hall, { x: 1000, y: 120 })).toBe(open);
  });

  it("sets a unit standing where a building is laid out on the building's rim", () => {
    const game = field();
    const worker = game.spawnUnit("player", "worker", 600, 600);
    const building = { ...game.buildings[0]!, id: "site", kind: "farm", x: 610, y: 600, radius: 30, hp: 32, maxHp: 320, complete: false, queue: [], researchQueue: [] } as Building;
    game.buildings.push(building);
    stepGame(game);
    expect(Math.hypot(worker.x - building.x, worker.y - building.y)).toBeCloseTo(worker.radius + building.radius, 6);
  });

  it("lets a footman strike a town hall from its wall", () => {
    const game = field();
    const hall = game.buildings.find((building) => building.owner === "enemy")!;
    const footman = game.spawnUnit("player", "footman", hall.x - 200, hall.y);
    issueCommand(game, { type: "attack", unitIds: [footman.id], targetId: hall.id });
    steps(game, 200);
    expect(hall.hp).toBeLessThan(hall.maxHp);
    expect(inside(footman, hall)).toBe(false);
  });

  it("stops a slide at a building's wall", () => {
    const game = field();
    const hall = game.buildings.find((building) => building.owner === "player")!;
    const footman = game.spawnUnit("player", "footman", hall.x + 120, hall.y);
    shove(footman, -1, 0, 200);
    steps(game, 30);
    expect(inside(footman, hall)).toBe(false);
    expect(footman.x).toBeGreaterThan(hall.x);
  });

  it("keeps workers mining round their hall", () => {
    const game = field();
    const hall = game.buildings.find((building) => building.owner === "player")!;
    game.resources = [{ id: "mine", kind: "goldMine", x: hall.x + 200, y: hall.y + 60, amount: 5000 }];
    const workers = [0, 1, 2].map((index) => game.spawnUnit("player", "worker", hall.x + 80, hall.y + 60 + index * 30));
    issuePlayerCommand(game, "player", { type: "mine", unitIds: workers.map((worker) => worker.id), resourceId: "mine" });
    const gold = game.players.player!.gold;
    steps(game, 600);
    expect(game.players.player!.gold).toBeGreaterThan(gold + 50);
  });

  it("ends a builder's walk at the site's wall on its own side, and the site goes up", () => {
    const game = field();
    game.players.player!.gold = 1000;
    // The builder's spot lies inside the site, on the side away from the worker.
    const worker = game.spawnUnit("player", "worker", 900, 600);
    issueCommand(game, { type: "build", unitId: worker.id, buildingKind: "barracks", x: 700, y: 600 });
    const site = game.buildings.find((building) => building.kind === "barracks")!;
    let touched = false;
    for (let tick = 0; tick < 500 && !site.complete; tick += 1) {
      stepGame(game);
      if (inside(worker, site)) touched = true;
    }
    expect(site.complete).toBe(true);
    expect(touched).toBe(false);
    expect(worker.x).toBeGreaterThan(site.x);
  });

  it("lets a worker on a mining run pass through other units", () => {
    const game = field();
    const hall = game.buildings.find((building) => building.owner === "player")!;
    game.resources = [{ id: "mine", kind: "goldMine", x: hall.x + 400, y: hall.y + 200, amount: 5000 }];
    const worker = game.spawnUnit("player", "worker", 600, 600);
    const footman = game.spawnUnit("player", "footman", 605, 600);
    issuePlayerCommand(game, "player", { type: "mine", unitIds: [worker.id], resourceId: "mine" });
    stepGame(game);
    expect({ x: footman.x, y: footman.y }).toEqual({ x: 605, y: 600 });
  });

  it("leaves a map without terrain open: its walks go straight through buildings, as they always did", () => {
    const game = field(false);
    wall(game, "player", 640, [600]);
    const footman = game.spawnUnit("player", "footman", 500, 600);
    issueCommand(game, { type: "move", unitIds: [footman.id], x: 780, y: 600 });
    steps(game, 120);
    expect(Math.hypot(footman.x - 780, footman.y - 600)).toBeLessThan(10);
    expect(Math.abs(footman.y - 600)).toBeLessThan(1);
  });
});
