import { describe, expect, it } from "vitest";
import { createUnit } from "../../shared/map";
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from "../../shared/sim";
import { isShoreFootprint, isWalkable, sameGround, type Terrain } from "../../shared/terrain";
import { createAiPolicyMemory } from "../memory";
import { desiredExpansionMine } from "./expansion-model";
import { navalUnitIds, navalWant, navalBudgetReserve, planNavalTactics } from "./naval";
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
function islandGame(terrain = coast(), players = ["player", "enemy"]) {
  const game = createGame("bareDuel", {
    players,
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
        { id: "farm", owner: "player", kind: "farm", ...at(5, 18) },
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
  for(let i=3;i<=6;i++)game.units.push({...createUnit(`w${i}`,"player","worker",at(3,4+i).x,at(3,4+i).y),order:{type:"mine",resourceId:"main",phase:"toMine",timer:0}});
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
        { id: "farm", owner: "player", kind: "farm", ...at(5, 18) },
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
    // Every live policy shares the same terrain-driven naval capability.
    expect(navalWant(snapshot, "player", { version: "v2", requestedVersion: "v9", memory: createAiPolicyMemory() })?.id).toBe("naval:shipyard");
  });

  it("raises its shipyard on a shore no enemy tower covers", () => {
    const game = islandGame();
    const tower = { ...game.buildings.find((building) => building.id === "hall-a")!, id: "tower-e", owner: "enemy" as const, kind: "defenseTower" as const, ...at(7, 0), radius: 22, complete: true };
    game.buildings.push(tower);
    const command = navalWant(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() })?.issue(new Set());
    if (command?.type !== "build") throw new Error("no shipyard");
    expect(Math.hypot(command.x - tower.x, command.y - tower.y)).toBeGreaterThan(480 + 44);
  });

  it("raises no shipyard under its own tower within reach of an enemy warship the tower does not reach", () => {
    const game = islandGame();
    game.buildings.push({ ...game.buildings.find((building) => building.id === "hall-a")!, id: "tower", kind: "defenseTower", ...at(5, 3), radius: 22, complete: true });
    const ship = { ...game.units.find((unit) => unit.id === "w1")!, id: "e-ship", owner: "enemy" as const, kind: "warship" as const, ...at(22, 3), order: { type: "idle" as const }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390, radius: 28 };
    game.units.push(ship);
    const command = navalWant(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() })?.issue(new Set());
    if (command?.type !== "build" || command.buildingKind !== "shipyard") throw new Error("no shipyard");
    expect(Math.hypot(command.x - ship.x, command.y - ship.y)).toBeGreaterThan(390 + 44 + 100);
  });

  it("builds an escort instead of abandoning contested water", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = islandGame();
    game.buildings.push({ ...game.buildings.find((building) => building.id === "hall-a")!, id: "yard", kind: "shipyard", x: 275, y: at(0, 10).y, radius: 44 });
    const enemyShip = (id: string, col: number) => ({ ...game.units.find((unit) => unit.id === "w1")!, id, owner: "enemy" as const, kind: "warship" as const, ...at(col, 17), order: { type: "idle" as const }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390, radius: 28 });
    game.units.push(enemyShip("e1", 14));
    expect(navalWant(snapshotGame(game), "player", options)?.id).toBe("naval:transport");
    game.units.push(enemyShip("e2", 16));
    expect(navalWant(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() })?.id).toBe("naval:warship");
  });

  it("breaks a blockade in the closeout: another warship, and no transport, until its fleet outweighs the enemy's", () => {
    const game = islandGame();
    const hall = game.buildings.find((building) => building.id === "hall-a")!;
    game.buildings.push({ ...hall, id: "hall-e", owner: "enemy", ...at(22, 10) }, { ...hall, id: "yard", kind: "shipyard", x: 275, y: at(0, 10).y, radius: 44 });
    const warship = (id: string, owner: "player" | "enemy", col: number) => ({ ...game.units.find((unit) => unit.id === "w1")!, id, owner, kind: "warship" as const, ...at(col, 16), order: { type: "idle" as const }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390, radius: 28 });
    game.units.push(warship("p1", "player", 11), warship("p2", "player", 12), warship("e1", "enemy", 26), warship("e2", "enemy", 27));
    expect(navalWant(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() })?.id).toBe("naval:warship");
    // Its fleet outweighing theirs, the transport comes.
    game.units.push(warship("p3", "player", 13), warship("p4", "player", 14));
    expect(navalWant(snapshotGame(game), "player", { version: "v8", memory: createAiPolicyMemory() })?.id).toBe("naval:transport");
  });

  it("keeps its idle warships off the shallows its workers cross to the island", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = islandGame();
    game.buildings.push({ ...game.buildings.find((building) => building.id === "hall-a")!, id: "yard", kind: "shipyard", x: 275, y: at(0, 10).y, radius: 44 });
    game.units.push({ ...game.units.find((unit) => unit.id === "w1")!, id: "ship", kind: "warship", ...at(12, 3), order: { type: "idle" }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390, radius: 28 });
    const station = planNavalTactics(snapshotGame(game), "player", options).find((command) => command.type === "move" && command.unitIds.includes("ship"));
    if (station?.type !== "move") throw new Error("no station");
    expect(isWalkable(game.map, station.x, station.y, "sea")).toBe(true);
    expect(isWalkable(game.map, station.x, station.y)).toBe(false);
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

  it("crosses to an opponent's island hall while it still stands ashore: against it alone at once, against more with its general's edge (see @@@transport-attack)", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = islandGame(coast(), ["player", "enemy", "rival"]);
    // One hall of its own: nothing on the water but the crossing (no island to take, no raid without a second base).
    game.resources = game.resources.filter((mine) => mine.id !== "island");
    game.buildings = game.buildings.filter((building) => building.id !== "hall-b");
    const hall = game.buildings.find((building) => building.id === "hall-a")!;
    game.buildings.push({ ...hall, id: "enemy-island", owner: "enemy", ...at(22, 9) }, { ...hall, id: "enemy-shore", owner: "enemy", ...at(6, 9) });
    expect(navalWant(snapshotGame(game), "player", options)?.id).toBe("naval:shipyard");
    // A second opponent ashore, and soldiers on the island the player has none to outweigh: no crossing.
    const footman = game.units.find((unit) => unit.id === "w1")!;
    game.buildings.push({ ...hall, id: "rival-shore", owner: "rival", ...at(6, 17) });
    game.units.push(...[8, 10].map((row) => ({ ...footman, id: `guard-${row}`, owner: "enemy", kind: "footman" as const, ...at(21, row), order: { type: "idle" as const }, radius: 18 })));
    // A naval raid remains possible; transporting the outmatched land army does not.
    expect(planNavalTactics(snapshotGame(game),"player",{version:"v8",memory:createAiPolicyMemory()}).some(command=>command.type==="board")).toBe(false);
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
    game.units.push({ ...game.units.find((unit) => unit.id === "w1")!, id: "ferry", kind: "transport", ...at(11, 3), order: { type: "idle" }, radius: 30 });
    const board = planNavalTactics(snapshotGame(game), "player", options).find((command) => command.type === "board");
    expect(board).toMatchObject({ type: "board", transportId: "ferry" });
    if (board?.type !== "board") throw new Error("no boarding");
    expect(board.unitIds).toEqual(expect.arrayContaining(["f1","f2","f3"]));
    expect(board.unitIds.filter(id=>id.startsWith("w"))).toHaveLength(1);
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
    expect(projectedSupplyUsed(snapshotGame(game), "player")).toBe(6 + 1);
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

  it("raises no shipyard on water an enemy's warship sails, where the ship would sink the site, but under a tower of its own", () => {
    const options = { version: "v8" as const, memory: createAiPolicyMemory() };
    const game = lakeGame();
    game.units.push({ ...game.units.find((unit) => unit.id === "we")!, id: "gun", kind: "warship", ...at(18, 16), order: { type: "idle" }, hp: 180, maxHp: 180, attackDamage: 20, attackRange: 390 });
    expect(navalWant(snapshotGame(game), "player", options)?.issue(new Set())).not.toMatchObject({ buildingKind: "shipyard" });
    // A tower of its own by the west shore covers it (see @@@coast-tower).
    game.buildings.push({ ...game.buildings.find((building) => building.id === "hall-a")!, id: "tower", kind: "defenseTower", ...at(5, 9), radius: 30, complete: true });
    expect(navalWant(snapshotGame(game), "player", options)?.issue(new Set())).toMatchObject({ type: "build", buildingKind: "shipyard" });
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
  it("ships workers away from a depleted island to a live owned mine", () => {
    const game = islandGame();
    game.scriptedVictory = true;
    for (const mine of game.resources) if (mine.id !== "island") mine.amount = 0;
    game.buildings.push({ ...game.buildings[0]!, id: "rich-hall", ...at(23, 11) });
    for (const worker of game.units) worker.order = { type: "idle" };
    const boat = createUnit("ferry", "player", "transport", at(10, 9).x, at(10, 9).y);
    game.units.push(boat);
    const options = { version: "v8" as const, memory: createAiPolicyMemory(), teams: game.teams };
    let boarded = false;
    for (let tick = 0; tick < 1600; tick++) {
      if (tick % 30 === 0) for (const command of planNavalTactics(snapshotGame(game), "player", options)) {
        boarded ||= command.type === "board";
        issuePlayerCommand(game, "player", command);
      }
      stepGame(game);
    }
    expect(boarded).toBe(true);
    const richMine = game.resources.find(mine => mine.id === "island")!;
    expect(game.units.filter(unit => unit.kind === "worker" && sameGround(game.map, unit, richMine))).toHaveLength(6);
    expect(options.memory.naval?.ferries?.ferry?.purpose).not.toBe("settle");
  });

  it("keeps the hall budget while settlers sail, and a ferry budget before local gold runs out", () => {
    const game = islandGame();
    const memory = createAiPolicyMemory();
    memory.naval = { ferries: { ferry: { purpose: "settle", targetId: "island", from: at(9,9), to: at(20,9), phase: "sailing", crewIds: [], sinceTick: 0 } } };
    expect(navalBudgetReserve(snapshotGame(game), "player", { memory })).toBe(400);
    for (const mine of game.resources) if (mine.id !== "island") mine.amount = 0;
    expect(navalBudgetReserve(snapshotGame(game), "player", { memory })).toBe(560);
  });

});


describe("naval strategic choices", () => {
  it("develops an unclaimed reachable mainland mine before buying an overseas expedition", () => {
    const sim=islandGame();
    sim.buildings=sim.buildings.filter(b=>b.id!=="hall-b");
    sim.players.player!.supplyUsed=25;
    const want = navalWant(snapshotGame(sim),"player",{version:"v7",memory:createAiPolicyMemory()});
    expect(want?.issue(new Set())).toMatchObject({type:"build",buildingKind:"townHall"});
  });

  it("keeps a weak loaded landing force offshore until the mine guards are cleared", () => {
    const sim=islandGame();
    const mine=sim.resources.find(m=>m.id==="island")!;
    const boat=createUnit("ferry","player","transport",at(9,9).x,at(9,9).y);
    boat.cargo=[createUnit("builder","player","worker",0,0),createUnit("soldier","player","footman",0,0)];
    sim.units=[boat,createUnit("guard","neutral","redDragon",mine.x,mine.y)];
    const memory=createAiPolicyMemory();
    memory.naval={ferries:{ferry:{purpose:"settle",targetId:mine.id,from:at(9,9),to:at(19,9),phase:"loading",crewIds:[],sinceTick:0}}};
    const options={version:"v7" as const,memory};
    expect(planNavalTactics(snapshotGame(sim),"player",options).some(c=>c.type==="unload")).toBe(false);
    sim.units=sim.units.filter(u=>u.id!=="guard");
    expect(planNavalTactics(snapshotGame(sim),"player",options).some(c=>c.type==="unload")).toBe(true);
  });
});
