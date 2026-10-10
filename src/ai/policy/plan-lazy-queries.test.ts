import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import { issuePlayerCommand, snapshotGame } from "../../shared/sim";
import { AI_SCRIPT_LIBRARY, createAiPolicyMemory } from "../policy";
import { engineeringWant } from "./engineering";
import { shipsAfloat } from "./ground";
import { navalServices } from "./naval-services";

describe("affordable planning work", () => {
  it.each(["grove", "ember"] as const)("keeps the unpurchased %s support-weapon goal while the script waits for gold", race => {
    const scene = sketchScene("unfunded-engineering-goal").map("openClaims").replaceDefaults()
      .player("us", { race, team: "north" }).player("foe", { team: "south" })
      .playerState("us", { gold: 0 })
      .townHall("us", 500, 500).townHall("foe", 3_300, 3_300)
      .farmsPastTiers("us", 600, 1_200)
      .building("us", "workshop", 700, 800, { id: "workshop" });
    for (let index = 0; index < 12; index++) scene.unit("us", race === "grove" ? "footman" : "cinderRunner", 1_000 + index * 25, 1_000);
    const game = scene.build().createGame(), snapshot = snapshotGame(game), before = structuredClone(snapshot);
    const options = { version: "v2" as const, requestedVersion: "v6" as const, teams: game.teams, memory: createAiPolicyMemory() };
    const beforeMemory = structuredClone(options.memory);
    const kind = race === "grove" ? "ballista" : "siegeRam";
    expect(engineeringWant(snapshot, "us", options)).toMatchObject({ id: `engineering:${kind}`, cost: UNIT_DEFS[kind].cost });
    expect(AI_SCRIPT_LIBRARY.engineering.run(snapshot, "us", options)).toBeUndefined();
    expect(snapshot).toEqual(before);
    expect(options.memory).toEqual(beforeMemory);

    game.players.us!.gold = UNIT_DEFS[kind].cost;
    const command = AI_SCRIPT_LIBRARY.engineering.run(snapshotGame(game), "us", options);
    expect(command).toEqual({ type: "train", buildingId: "workshop", unitKind: kind });
    if (!command || Array.isArray(command)) throw new Error("Expected one support-weapon command");
    issuePlayerCommand(game, "us", command);
    expect(game.buildings.find(building => building.id === "workshop")!.queue.map(job => job.unitKind)).toEqual([kind]);
    expect(game.players.us!.gold).toBe(0);
  });

  it("keeps the workshop goal below its price and issues the build at the exact price", () => {
    const scene = sketchScene("engineering-workshop-budget").map("openClaims").replaceDefaults()
      .player("us", { race: "grove" }).player("foe", { race: "ember" })
      .playerState("us", { gold: BUILDING_DEFS.workshop.cost - 1 })
      .townHall("us", 500, 500).townHall("foe", 3_300, 3_300)
      .farmsPastTiers("us", 600, 1_200).worker("us", 650, 650, { id: "builder" });
    for (let index = 0; index < 8; index++) scene.unit("us", "footman", 1_000 + index * 25, 1_000);
    const game = scene.build().createGame(), options = { version: "v2" as const, memory: createAiPolicyMemory() };
    expect(engineeringWant(snapshotGame(game), "us", options)).toMatchObject({ id: "engineering:workshop" });
    expect(AI_SCRIPT_LIBRARY.engineering.run(snapshotGame(game), "us", options)).toBeUndefined();
    game.players.us!.gold = BUILDING_DEFS.workshop.cost;
    expect(AI_SCRIPT_LIBRARY.engineering.run(snapshotGame(game), "us", options)).toMatchObject({ type: "build", buildingKind: "workshop", unitId: "builder" });
  });

  it.each(["gold", "supply"] as const)("retains producer order when the first training command uses the remaining $0", limit => {
    const scene = sketchScene("training-budget-consumption").map("openClaims").replaceDefaults()
      .player("us", { race: "grove" }).player("foe", { race: "ember" })
      .playerState("us", { gold: limit === "gold" ? UNIT_DEFS.footman.cost : 1_000 })
      .townHall("us", 500, 500).townHall("foe", 3_300, 3_300)
      .building("us", "barracks", 600, 650, { id: "first" })
      .building("us", "barracks", 700, 650, { id: "second" })
      .building("us", "archeryRange", 800, 650)
      .building("us", "stables", 900, 650)
      .building("us", "sanctum", 1_000, 650);
    for (let index = 0; index < 6; index++) scene.worker("us", 500 + index * 25, 750);
    if (limit === "gold") scene.farmsPastTiers("us", 600, 1_200);
    const game = scene.build().createGame(), snapshot = snapshotGame(game), before = structuredClone(snapshot);
    const options = { version: "v1" as const, memory: createAiPolicyMemory() }, beforeMemory = structuredClone(options.memory);
    const commands = AI_SCRIPT_LIBRARY.training.run(snapshot, "us", options);
    expect(commands).toEqual([{ type: "train", buildingId: "first", unitKind: "footman" }]);
    expect(snapshot).toEqual(before);
    expect(options.memory).toEqual(beforeMemory);
    if (!Array.isArray(commands)) throw new Error("Expected training commands");
    for (const command of commands) issuePlayerCommand(game, "us", command);
    expect(game.buildings.find(building => building.id === "first")!.queue.map(job => job.unitKind)).toEqual(["footman"]);
    expect(game.buildings.find(building => building.id === "second")!.queue).toEqual([]);
    if (limit === "gold") expect(game.players.us!.gold).toBe(0);
    else expect(game.players.us!.supplyUsed).toBe(game.players.us!.supplyCap);
  });
});

function localArmyScene(enemyCount: number) {
  const scene = sketchScene("local-army-range-selection").map("openClaims").replaceDefaults()
    .player("us", { race: "grove", team: "north" }).player("foe", { race: "grove", team: "south" })
    .townHall("us", 500, 500).townHall("foe", 3_300, 3_300)
    .worker("foe", 3_350, 3_350)
    .unit("foe", "fieldMedic", 2_500, 1_020, { id: "first-medic" })
    .unit("foe", "fieldMedic", 2_500, 980, { id: "second-medic" });
  const ownIds: string[] = [];
  for (let index = 0; index < 40; index++) {
    const id = `soldier-${index}`;
    ownIds.push(id);
    scene.unit("us", "footman", 2_200, 1_000, { id });
  }
  for (let index = 2; index < enemyCount; index++) scene.unit("foe", "footman", 3_000 + index * 5, 3_000);
  return { game: scene.build().createGame(), ownIds };
}

describe("local opponent power queries", () => {
  it.each([6, 35])("preserves source-order target ties with %i enemies", enemyCount => {
    const { game, ownIds } = localArmyScene(enemyCount);
    const snapshot = snapshotGame(game), before = structuredClone(snapshot);
    const options = { version: "v2" as const, teams: game.teams, memory: createAiPolicyMemory() }, beforeMemory = structuredClone(options.memory);
    const command = AI_SCRIPT_LIBRARY.attackWave.run(snapshot, "us", options);
    expect(command).toEqual({ type: "attack", unitIds: ownIds, targetId: "first-medic" });
    expect(snapshot).toEqual(before);
    expect(options.memory).toEqual(beforeMemory);
    if (!command || Array.isArray(command)) throw new Error("Expected one army command");
    issuePlayerCommand(game, "us", command);
    for (const id of ownIds) expect(game.units.find(unit => unit.id === id)!.order).toMatchObject({ type: "attack", targetId: "first-medic" });
  });

  it("ignores off-grid opponents without changing the chosen local target", () => {
    const { game, ownIds } = localArmyScene(35);
    for (const [x, y] of [[NaN, 1_000], [Infinity, 1_000], [1_000, -Infinity], [Number.MAX_VALUE, 1_000]]) game.spawnUnit("foe", "footman", x!, y!);
    const snapshot = snapshotGame(game), before = structuredClone(snapshot);
    expect(AI_SCRIPT_LIBRARY.attackWave.run(snapshot, "us", { version: "v2", teams: game.teams, memory: createAiPolicyMemory() })).toEqual({
      type: "attack", unitIds: ownIds, targetId: "first-medic",
    });
    expect(snapshot).toEqual(before);
  });

  it("keeps target selection at very large finite coordinates using the original scan", () => {
    const { game, ownIds } = localArmyScene(35);
    const snapshot = snapshotGame(game);
    delete snapshot.map.terrain;
    for (const entity of [...snapshot.units, ...snapshot.buildings]) entity.x += 2 ** 41;
    const before = structuredClone(snapshot);
    expect(AI_SCRIPT_LIBRARY.attackWave.run(snapshot, "us", { version: "v2", teams: game.teams, memory: createAiPolicyMemory() })).toEqual({
      type: "attack", unitIds: ownIds, targetId: "first-medic",
    });
    expect(snapshot).toEqual(before);
  });
});

describe("naval work without a hull", () => {
  it("reads a hull added after the no-hull query but before its first service plan", () => {
    const game = sketchScene("boarding-after-hull-query").replaceDefaults()
      .player("us", { race: "grove" }).player("foe", { race: "ember" })
      .townHall("us", 500, 500).townHall("foe", 3_300, 3_300)
      .worker("us", 800, 800, { id: "boarder" }).build().createGame();
    const snapshot = snapshotGame(game);
    expect(shipsAfloat(snapshot)).toBe(false);
    const ship = game.spawnUnit("us", "transport", 1_200, 800);
    ship.order = { type: "move", x: 1_600, y: 800 };
    snapshot.units.push(structuredClone(ship));
    const crew = snapshot.units.find(unit => unit.id === "boarder")!;
    crew.deck = { shipId: "departed-source", x: 0, y: 0 };
    crew.order = { type: "board", transportId: ship.id };
    const before = structuredClone(snapshot);
    const options = { version: "v5" as const, memory: createAiPolicyMemory() }, beforeMemory = structuredClone(options.memory);
    const service = navalServices(snapshot, "us", options);
    expect(service.reserved).toEqual(new Set(["boarder", "departed-source", ship.id]));
    expect(service.commands).toEqual([{ type: "stop", unitIds: [ship.id] }]);
    expect(snapshot).toEqual(before);
    expect(options.memory).toEqual(beforeMemory);
  });

  it("keeps orphaned boarding reservations, then stops the destination on the next snapshot when a hull appears", () => {
    const game = sketchScene("boarding-without-hull").replaceDefaults()
      .player("us", { race: "grove" }).player("foe", { race: "ember" })
      .townHall("us", 500, 500).townHall("foe", 3_300, 3_300)
      .worker("us", 800, 800, { id: "boarder" }).build().createGame();
    const crew = game.units.find(unit => unit.id === "boarder")!;
    crew.deck = { shipId: "departed-source", x: 0, y: 0 };
    crew.order = { type: "board", transportId: "missing-destination" };
    const options = { version: "v5" as const, memory: createAiPolicyMemory() }, beforeMemory = structuredClone(options.memory);
    const emptySnapshot = snapshotGame(game), beforeEmpty = structuredClone(emptySnapshot);
    const emptyService = navalServices(emptySnapshot, "us", options);
    expect(emptyService.commands).toEqual([]);
    expect(emptyService.reserved).toEqual(new Set(["boarder", "departed-source", "missing-destination"]));
    expect(emptySnapshot).toEqual(beforeEmpty);
    expect(options.memory).toEqual(beforeMemory);

    const ship = game.spawnUnit("us", "transport", 1_200, 800);
    ship.order = { type: "move", x: 1_600, y: 800 };
    crew.order = { type: "board", transportId: ship.id };
    const sailingSnapshot = snapshotGame(game), beforeSailing = structuredClone(sailingSnapshot);
    const service = navalServices(sailingSnapshot, "us", options);
    expect(service.reserved).toEqual(new Set(["boarder", "departed-source", ship.id]));
    expect(service.commands).toEqual([{ type: "stop", unitIds: [ship.id] }]);
    expect(sailingSnapshot).toEqual(beforeSailing);
    expect(options.memory).toEqual(beforeMemory);
  });
});
