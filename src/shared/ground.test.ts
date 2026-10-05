import { perTick } from "./time";
import { describe, expect, it } from "vitest";
import { shove } from "./push";
import { createGame, issueCommand, stepGame } from "./sim";
import { CELL_GROUND, type Terrain } from "./terrain";

// A 40 by 40 grid of 32-unit cells, bare ground but for columns 10 to 29, which are all `char`.
function band(char: string): Terrain {
  return { cell: 32, cols: 40, rows: 40, cells: Array.from({ length: 1600 }, (_, at) => (at % 40 >= 10 && at % 40 < 30 ? char : ".")).join("") };
}

function field(char: string) {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  game.buildings = game.buildings.filter((building) => building.kind === "townHall").map((building, index) => ({ ...building, x: index === 0 ? 120 : 1160, y: index === 0 ? 120 : 1160 }));
  game.map = { ...game.map, terrain: band(char), width: 1280, height: 1280 };
  game.scriptedVictory = true;
  return game;
}

describe("a walk to ground it cannot reach", () => {
  it("ends at the shore nearest the point across the water, not pressed against the water for good", () => {
    const game = field("~");
    const footman = game.spawnUnit("player", "footman", 160, 640);
    // Columns 10 to 29 are deep water: the point lies beyond it.
    issueCommand(game, { type: "move", unitIds: [footman.id], x: 1100, y: 640 });
    let ticks = 0;
    while (ticks < 400 && footman.order.type === "move") {
      stepGame(game);
      ticks += 1;
    }
    expect(footman.order.type).toBe("idle");
    expect(Math.abs(footman.x - 9.5 * 32)).toBeLessThan(6);
  });
});

describe("ground that slows", () => {
  it("walks a footman through the shallows at three quarters of its pace and over bare ground at its full one", () => {
    const game = field(",");
    const wading = game.spawnUnit("player", "footman", 500, 640);
    const walking = game.spawnUnit("player", "footman", 100, 800);
    issueCommand(game, { type: "move", unitIds: [wading.id], x: 900, y: 640 });
    issueCommand(game, { type: "move", unitIds: [walking.id], x: 300, y: 800 });
    stepGame(game);
    expect(wading.x - 500).toBeCloseTo(perTick(wading.speed) * CELL_GROUND[","]!.pace, 6);
    expect(walking.x - 100).toBeCloseTo(perTick(walking.speed), 6);
  });

  it("brakes a slide on mud twice as hard as on bare ground, so it stops at half the distance", () => {
    const mud = field("m");
    const bare = field(".");
    const bogged = mud.spawnUnit("player", "footman", 500, 640);
    const free = bare.spawnUnit("player", "footman", 500, 640);
    shove(bogged, 1, 0, 60);
    shove(free, 1, 0, 60);
    for (let tick = 0; tick < 40; tick += 1) {
      stepGame(mud);
      stepGame(bare);
    }
    expect(free.x - 500).toBeCloseTo(60, 0);
    expect(bogged.x - 500).toBeCloseTo(60 / CELL_GROUND.m!.drag, 0);
  });
});
