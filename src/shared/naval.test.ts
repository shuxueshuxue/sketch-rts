import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, snapshotGame, stepGame, type Game } from "./sim";
import { commandValidationError } from "./sim/command-validation";
import { isWalkable, type Terrain } from "./terrain";
import type { ScenarioBuildingSeed, ScenarioUnitSeed } from "./types";

// A 30 by 20 grid: land in columns 0-8, a strip of shallows down column 9, the sea from column 10 on, and in it an island
// (columns 20-24, rows 7-12) ringed with shallows.
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

function game(units: ScenarioUnitSeed[], buildings: ScenarioBuildingSeed[] = []): Game {
  const created = createGame("bareDuel", {
    players: ["player", "enemy"],
    scenario: {
      players: { player: { gold: 2_000 }, enemy: { gold: 2_000 } },
      replaceDefaultUnits: true,
      replaceDefaultBuildings: true,
      addBuildings: [{ id: "hall-a", owner: "player", kind: "townHall", ...at(2, 2) }, { id: "hall-b", owner: "enemy", kind: "townHall", ...at(2, 17) }, ...buildings],
      addUnits: units,
    },
  });
  const terrain = coast();
  created.map = { ...created.map, width: terrain.cols * terrain.cell, height: terrain.rows * terrain.cell, terrain };
  return created;
}

const unit = (sim: Game, id: string) => sim.units.find((candidate) => candidate.id === id);
const run = (sim: Game, ticks: number, each?: () => void) => {
  for (let tick = 0; tick < ticks; tick += 1) {
    stepGame(sim);
    each?.();
  }
};

describe("ships", () => {
  it("launch from the shipyard's water and sail round an island to their rally, never over land", () => {
    const sim = game([], [{ id: "yard", owner: "player", kind: "shipyard", x: 275, y: at(0, 10).y }]);
    issuePlayerCommand(sim, "player", { type: "setRally", buildingIds: ["yard"], ...at(28, 9) });
    issuePlayerCommand(sim, "player", { type: "train", buildingId: "yard", unitKind: "warship" });
    run(sim, 900, () => {
      for (const ship of sim.units.filter((candidate) => candidate.kind === "warship")) expect(isWalkable(sim.map, ship.x, ship.y, "sea")).toBe(true);
    });
    const ship = sim.units.find((candidate) => candidate.kind === "warship")!;
    expect(Math.hypot(ship.x - at(28, 9).x, ship.y - at(28, 9).y)).toBeLessThan(5);
  });

  it("are struck only by what reaches them: a soldier leaves one out on deep water alone and wades out to one in the shallows", () => {
    const sim = game([
      { id: "footman", owner: "player", kind: "footman", ...at(7, 5) },
      { id: "warship", owner: "enemy", kind: "warship", ...at(13, 5) },
    ]);
    run(sim, 100);
    expect(unit(sim, "footman")!.hp).toBeLessThan(145);
    expect(unit(sim, "footman")!.x).toBe(at(7, 5).x);
    expect(unit(sim, "warship")!.hp).toBe(180);
    issuePlayerCommand(sim, "enemy", { type: "move", unitIds: ["warship"], ...at(9, 5) });
    run(sim, 100);
    expect(unit(sim, "warship")!.hp).toBeLessThan(180);
  });

  it("and the workers wading their shallows pass each other by, on layers of their own (see @@@ship-layer)", () => {
    const sim = game([
      { id: "worker", owner: "player", kind: "worker", ...at(9, 5) },
      { id: "warship", owner: "player", kind: "warship", x: at(9, 5).x + 10, y: at(9, 5).y },
    ]);
    run(sim, 20);
    expect(unit(sim, "worker")!).toMatchObject(at(9, 5));
    expect(unit(sim, "warship")!).toMatchObject({ x: at(9, 5).x + 10, y: at(9, 5).y });
  });

  it("are no rider's to charge out on deep water: the command is turned away, not thrown", () => {
    const sim = game([
      { id: "raider", owner: "player", kind: "raider", ...at(6, 5) },
      { id: "warship", owner: "enemy", kind: "warship", ...at(14, 5) },
    ]);
    expect(commandValidationError(snapshotGame(sim), "player", { type: "cast", unitId: "raider", ability: "charge", targetId: "warship" })).toMatch(/out of reach/);
  });

  it("count their passengers in their owner's supply, in the command checks as in the sim", () => {
    const sim = game([{ id: "ferry", owner: "player", kind: "transport", ...at(12, 4) }]);
    const cap = sim.players.player!.supplyCap;
    // Workers up to the cap, all but the transport's own supply, eight of them aboard.
    for (let index = 0; index < cap - 1; index += 1) sim.units.push({ ...unit(sim, "ferry")!, id: `w${index}`, kind: "worker", ...at(3, 5), order: { type: "idle" }, cargo: undefined });
    const ferry = unit(sim, "ferry")!;
    ferry.cargo = sim.units.filter((candidate) => candidate.kind === "worker").slice(0, 8);
    sim.units = sim.units.filter((candidate) => !ferry.cargo!.includes(candidate));
    expect(commandValidationError(snapshotGame(sim), "player", { type: "train", buildingId: "hall-a", unitKind: "worker" })).toMatch(/more supply/);
    expect(() => issuePlayerCommand(sim, "player", { type: "train", buildingId: "hall-a", unitKind: "worker" })).toThrow(/more supply/);
  });

  it("are shot from the beach by an archer within its range, and shoot what stands on the shore", () => {
    const sim = game([
      { id: "archer", owner: "player", kind: "archer", ...at(7, 12) },
      { id: "warship", owner: "enemy", kind: "warship", ...at(13, 12) },
    ]);
    run(sim, 120);
    expect(unit(sim, "warship")!.hp).toBeLessThan(180);
    expect(unit(sim, "archer")!.hp).toBeLessThan(72);
  });

  it("lose to a tower on the shore, one against one", () => {
    const sim = game([{ id: "warship", owner: "enemy", kind: "warship", ...at(20, 3) }], [{ id: "tower", owner: "player", kind: "defenseTower", ...at(7, 3) }]);
    issuePlayerCommand(sim, "enemy", { type: "attack", unitIds: ["warship"], targetId: "tower" });
    run(sim, 1_200);
    expect(unit(sim, "warship")).toBeUndefined();
    expect(sim.buildings.find((building) => building.id === "tower")!.hp).toBeGreaterThan(0);
  });
});

describe("transports", () => {
  it("honors a larger campaign ship capacity through native boarding and supply accounting", () => {
    const sim = game([
      { id: "carrier", owner: "player", kind: "transport", ...at(11, 9) },
      ...Array.from({length: 12}, (_,i) => ({id:`crew-${i}`,owner:"player",kind:"worker" as const,...at(5+i%2,5+Math.floor(i/2))})),
    ]);
    const carrier=unit(sim,"carrier")!;carrier.cargoCapacity=30;
    const supply=sim.players.player!.supplyUsed;
    issuePlayerCommand(sim,"player",{type:"board",unitIds:sim.units.filter(u=>u.kind==="worker").map(u=>u.id),transportId:carrier.id});
    run(sim,500);
    expect(carrier.cargo).toHaveLength(12);expect(sim.players.player!.supplyUsed).toBe(supply);
  });
  it("take aboard the soldiers told to board up to eight supply, and set them ashore on an island", () => {
    const sim = game([
      { id: "transport", owner: "player", kind: "transport", ...at(11, 9) },
      { id: "w1", owner: "player", kind: "worker", ...at(5, 8) },
      { id: "w2", owner: "player", kind: "worker", ...at(5, 9) },
      { id: "w3", owner: "player", kind: "worker", ...at(5, 10) },
      { id: "w4", owner: "player", kind: "worker", ...at(5, 11) },
      { id: "f1", owner: "player", kind: "footman", ...at(4, 9) },
      { id: "f2", owner: "player", kind: "footman", ...at(4, 10) },
      { id: "f3", owner: "player", kind: "footman", ...at(3, 10) },
    ]);
    const supply = sim.players.player!.supplyUsed;
    issuePlayerCommand(sim, "player", { type: "board", unitIds: ["w1", "w2", "w3", "w4", "f1", "f2", "f3"], transportId: "transport" });
    run(sim, 400);
    const transport = unit(sim, "transport")!;
    expect(transport.cargo!.map((passenger) => passenger.id).sort()).toEqual(["f1", "f2", "w1", "w2", "w3", "w4"]);
    // The one that did not fit is told so: its order ends (and, idle by the enemy hall, it may turn on it).
    expect(unit(sim, "f3")!.order.type).not.toBe("board");
    expect(unit(sim, "w1")).toBeUndefined();
    expect(sim.players.player!.supplyUsed).toBe(supply);
    issuePlayerCommand(sim, "player", { type: "unload", unitIds: ["transport"], ...at(22, 9) });
    run(sim, 600);
    expect(transport.cargo).toBeUndefined();
    for (const id of ["f1", "f2", "w1", "w2", "w3", "w4"]) {
      const landed = unit(sim, id)!;
      expect(landed.x).toBeGreaterThan(at(18, 0).x);
      expect(isWalkable(sim.map, landed.x, landed.y)).toBe(true);
    }
  });

  it("drown their passengers when sunk, and the ship that sank them is credited with them", () => {
    const sim = game([
      { id: "transport", owner: "player", kind: "transport", ...at(14, 4), hp: 5 },
      { id: "w1", owner: "player", kind: "worker", ...at(8, 4) },
      { id: "w2", owner: "player", kind: "worker", ...at(8, 5) },
      { id: "warship", owner: "enemy", kind: "warship", ...at(16, 15) },
    ]);
    issuePlayerCommand(sim, "player", { type: "board", unitIds: ["w1", "w2"], transportId: "transport" });
    run(sim, 200);
    expect(unit(sim, "transport")!.cargo).toHaveLength(2);
    issuePlayerCommand(sim, "enemy", { type: "attack", unitIds: ["warship"], targetId: "transport" });
    run(sim, 400);
    expect(unit(sim, "transport")).toBeUndefined();
    expect(sim.match.stats.unitsLost.player).toBe(3);
    expect(sim.match.stats.unitsKilled.enemy).toBe(3);
    expect(unit(sim, "warship")!.kills).toBe(3);
  });

  it("pick no fights: a transport has no weapon, and an attack-move only moves it", () => {
    const sim = game([
      { id: "transport", owner: "player", kind: "transport", ...at(10, 4) },
      { id: "footman", owner: "enemy", kind: "footman", ...at(8, 4) },
    ]);
    issuePlayerCommand(sim, "player", { type: "attackMove", unitIds: ["transport"], ...at(16, 4) });
    expect(unit(sim, "transport")!.order.type).toBe("move");
    run(sim, 200);
    expect(["idle", "move"]).toContain(unit(sim, "transport")!.order.type);
    expect(Math.hypot(unit(sim, "transport")!.x - at(16, 4).x, unit(sim, "transport")!.y - at(16, 4).y)).toBeLessThan(5);
  });
});
