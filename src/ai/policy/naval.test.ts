import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../../shared/sim";
import { isShoreFootprint, type Terrain } from "../../shared/terrain";
import { createAiPolicyMemory } from "../memory";
import { desiredExpansionMine } from "./expansion-model";
import { navalUnitIds, navalWant } from "./naval";
import { nextExpansionMine, readV6Intel } from "./v6/intel";
import { projectedSupplyUsed } from "./world-model";

// A 30 by 20 grid: land in columns 0-8, shallows down column 9, the sea beyond, and in it an island (columns 20-24, rows
// 7-12) ringed with shallows.
function coast(): Terrain {
  let cells = "";
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 30; col += 1) {
      const island = col >= 20 && col <= 24 && row >= 7 && row <= 12;
      const rim = col >= 19 && col <= 25 && row >= 6 && row <= 13;
      cells += col <= 8 || island ? "." : col === 9 || rim ? "," : "~";
    }
  }
  return { cell: 32, cols: 30, rows: 20, cells };
}

const at = (col: number, row: number) => ({ x: col * 32 + 16, y: row * 32 + 16 });

// The player holds two halls on the land with workers mining; the only other mine is the island's.
function islandGame(terrain = coast()) {
  const game = createGame("bareDuel", {
    players: ["player", "enemy"],
    scenario: {
      players: { player: { gold: 1_000 } },
      replaceDefaultUnits: true,
      replaceDefaultBuildings: true,
      replaceDefaultResources: true,
      replaceDefaultMercenaryCamps: true,
      replaceDefaultLandmarks: true,
      addBuildings: [
        { id: "hall-a", owner: "player", kind: "townHall", ...at(3, 3) },
        { id: "hall-b", owner: "player", kind: "townHall", ...at(3, 15) },
      ],
      addResources: [
        { id: "main", kind: "goldMine", ...at(1, 3), amount: 6_000 },
        { id: "natural", kind: "goldMine", ...at(1, 15), amount: 6_000 },
        { id: "island", kind: "goldMine", ...at(22, 9), amount: 6_000 },
      ],
      addUnits: [
        { id: "w1", owner: "player", kind: "worker", ...at(2, 4), order: { type: "mine", resourceId: "main", phase: "toMine", timer: 0 } },
        { id: "w2", owner: "player", kind: "worker", ...at(2, 14), order: { type: "mine", resourceId: "natural", phase: "toMine", timer: 0 } },
      ],
    },
  });
  game.map = { ...game.map, width: terrain.cols * terrain.cell, height: terrain.rows * terrain.cell, terrain };
  return game;
}

describe("the AI on the water", () => {
  it("wants a shipyard on its own shore for an island's mine once it holds two bases", () => {
    const game = islandGame();
    const snapshot = snapshotGame(game);
    const want = navalWant(snapshot, "player", { version: "v8", memory: createAiPolicyMemory() })!;
    expect(want.id).toBe("naval:shipyard");
    const command = want.issue(new Set());
    expect(command).toMatchObject({ type: "build", buildingKind: "shipyard" });
    if (command?.type !== "build") throw new Error("no build");
    expect(isShoreFootprint(snapshot.map, command.x, command.y, 44)).toBe(true);
    expect(command.x).toBeLessThan(at(10, 0).x);
  });

  it("never sends its workers to expand to a mine they cannot walk to", () => {
    const game = islandGame();
    // One hall, and no mine left on its land: by a straight line the island's is the next.
    game.buildings = game.buildings.filter((building) => building.id !== "hall-b");
    game.resources = game.resources.filter((mine) => mine.id !== "natural");
    const snapshot = snapshotGame(game);
    expect(desiredExpansionMine(snapshot, "player")).toBeUndefined();
    expect(nextExpansionMine(snapshot, readV6Intel(snapshot, "player", { version: "v8" }))).toBeUndefined();
  });

  it("counts the passengers aboard a transport in its supply, as the sim does", () => {
    const game = islandGame();
    const worker = game.units.find((unit) => unit.id === "w1")!;
    game.units = game.units.filter((unit) => unit !== worker);
    game.units.push({ ...game.units[0]!, id: "ferry", kind: "transport", x: at(12, 4).x, y: at(12, 4).y, cargo: [worker] });
    expect(projectedSupplyUsed(snapshotGame(game), "player")).toBe(1 + 1 + 1);
  });

  it("does nothing on a map whose land is one whole and that has no ship", () => {
    let cells = "";
    for (let index = 0; index < 600; index += 1) cells += ".";
    const game = islandGame({ cell: 32, cols: 30, rows: 20, cells });
    const snapshot = snapshotGame(game);
    expect(navalWant(snapshot, "player", { version: "v8", memory: createAiPolicyMemory() })).toBeUndefined();
    expect(navalUnitIds(snapshot, "player").size).toBe(0);
  });
});
