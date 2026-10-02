import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../../shared/sim";
import { isShoreFootprint, type Terrain } from "../../shared/terrain";
import { createAiPolicyMemory } from "../memory";
import { desiredExpansionMine } from "./expansion-model";
import { navalUnitIds, navalWant, planNavalTactics } from "./naval";
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

// A 30 by 20 grid of land with water in columns 10-19, rows 2-17 (a lake, or with `pond` a pond of four cells there): the
// land is one whole round it. The player holds two halls west of it, the enemy a hall east of it with a worker by it.
function lakeGame(pond = false, tower = false) {
  let cells = "";
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 30; col += 1) cells += (pond ? col >= 18 && col <= 19 && row >= 8 && row <= 9 : col >= 10 && col <= 19 && row >= 2 && row <= 17) ? "~" : ".";
  }
  const terrain: Terrain = { cell: 32, cols: 30, rows: 20, cells };
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
        { id: "hall-e", owner: "enemy", kind: "townHall", ...at(24, 9) },
        ...(tower ? [{ id: "tower-e", owner: "enemy", kind: "defenseTower" as const, ...at(21, 6) }] : []),
      ],
      addResources: [
        { id: "main", kind: "goldMine", ...at(1, 3), amount: 6_000 },
        { id: "natural", kind: "goldMine", ...at(1, 15), amount: 6_000 },
        { id: "enemy-main", kind: "goldMine", ...at(27, 9), amount: 6_000 },
      ],
      addUnits: [
        { id: "w1", owner: "player", kind: "worker", ...at(2, 4), order: { type: "mine", resourceId: "main", phase: "toMine", timer: 0 } },
        { id: "w2", owner: "player", kind: "worker", ...at(2, 14), order: { type: "mine", resourceId: "natural", phase: "toMine", timer: 0 } },
        { id: "we", owner: "enemy", kind: "worker", ...at(21, 10) },
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
    // V9 leaves the island's mine alone (see @@@v9-water).
    expect(navalWant(snapshot, "player", { version: "v2", requestedVersion: "v9", memory: createAiPolicyMemory() })).toBeUndefined();
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

  it("assaults an enemy's last base on an island: a transport first, idle soldiers aboard, the landed at its hall", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = islandGame();
    game.resources = game.resources.filter((mine) => mine.id !== "island");
    game.buildings.push(
      { ...game.buildings.find((building) => building.id === "hall-a")!, id: "enemy-hall", owner: "enemy", x: at(22, 9).x, y: at(22, 9).y },
      { ...game.buildings.find((building) => building.id === "hall-a")!, id: "yard", kind: "shipyard", x: 275, y: at(0, 10).y, radius: 44 },
    );
    const footman = (id: string, col: number, row: number) => ({ ...game.units.find((unit) => unit.id === "w1")!, id, kind: "footman" as const, ...at(col, row), order: { type: "idle" as const }, radius: 18 });
    game.units.push(footman("f1", 5, 5), footman("f2", 6, 5), footman("f3", 5, 6));
    expect(navalWant(snapshotGame(game), "player", options)?.id).toBe("naval:transport");
    game.units.push({ ...game.units.find((unit) => unit.id === "w1")!, id: "ferry", kind: "transport", ...at(11, 9), order: { type: "idle" }, radius: 30 });
    const board = planNavalTactics(snapshotGame(game), "player", options).find((command) => command.type === "board");
    expect(board).toMatchObject({ type: "board", transportId: "ferry" });
    if (board?.type !== "board") throw new Error("no boarding");
    expect([...board.unitIds].sort()).toEqual(["f1", "f2", "f3"]);
    // One stands on the island already: it goes for the hall, and is the naval script's to move.
    game.units.push(footman("landed", 21, 11));
    const landed = planNavalTactics(snapshotGame(game), "player", options).find((command) => command.type === "attackMove" && command.unitIds.includes("landed"));
    expect(landed).toMatchObject({ x: at(22, 9).x, y: at(22, 9).y });
    expect(navalUnitIds(snapshotGame(game), "player", options).has("landed")).toBe(true);
  });

  it("counts the passengers aboard a transport in its supply, as the sim does", () => {
    const game = islandGame();
    const worker = game.units.find((unit) => unit.id === "w1")!;
    game.units = game.units.filter((unit) => unit !== worker);
    game.units.push({ ...game.units[0]!, id: "ferry", kind: "transport", x: at(12, 4).x, y: at(12, 4).y, cargo: [worker] });
    expect(projectedSupplyUsed(snapshotGame(game), "player")).toBe(1 + 1 + 1);
  });

  it("raids the enemy's door across a lake: a shipyard on its own shore, then its warships shoot the enemy's worker", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = lakeGame();
    const want = navalWant(snapshotGame(game), "player", options)!;
    expect(want.id).toBe("naval:shipyard");
    const command = want.issue(new Set());
    if (command?.type !== "build") throw new Error("no build");
    expect(isShoreFootprint(game.map, command.x, command.y, 44)).toBe(true);
    expect(command.x).toBeLessThan(at(10, 0).x);
    game.buildings.push({ ...game.buildings.find((building) => building.id === "hall-a")!, id: "yard", kind: "shipyard", x: command.x, y: command.y, radius: 44 });
    expect(navalWant(snapshotGame(game), "player", options)?.id).toBe("naval:warship");
    game.units.push({ ...game.units.find((unit) => unit.id === "w1")!, id: "ship", kind: "warship", ...at(12, 9), order: { type: "idle" }, hp: 180, maxHp: 180, attackRange: 390 });
    expect(planNavalTactics(snapshotGame(game), "player", options)).toContainEqual({ type: "attack", unitIds: ["ship"], targetId: "we" });
  });

  it("raises no shipyard on water an enemy's warship sails, where the ship would sink the site", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = lakeGame();
    game.units.push({ ...game.units.find((unit) => unit.id === "we")!, id: "gun", kind: "warship", ...at(18, 16), order: { type: "idle" }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390 });
    expect(navalWant(snapshotGame(game), "player", options)?.issue(new Set())).toBeUndefined();
  });

  it("leaves a door its towers cover, and a pond, alone", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    expect(navalWant(snapshotGame(lakeGame(false, true)), "player", options)).toBeUndefined();
    expect(navalWant(snapshotGame(lakeGame(true)), "player", options)).toBeUndefined();
  });

  it("does nothing on a map whose land is one whole and that has no ship", () => {
    let cells = "";
    for (let index = 0; index < 600; index += 1) cells += ".";
    const game = islandGame({ cell: 32, cols: 30, rows: 20, cells });
    const snapshot = snapshotGame(game);
    expect(navalWant(snapshot, "player", { version: "v8", memory: createAiPolicyMemory() })).toBeUndefined();
    expect(navalUnitIds(snapshot, "player", { version: "v8", memory: createAiPolicyMemory() }).size).toBe(0);
  });
});
