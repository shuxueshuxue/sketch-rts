import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { UNIT_DEFS } from "../../shared/catalog";
import { createBuilding } from "../../shared/map";
import { issuePlayerCommand, snapshotGame } from "../../shared/sim";
import type { Building, GameCommand, GameSnapshot, RaceId } from "../../shared/types";
import { createAiPolicyMemory } from "../memory";
import { AI_SCRIPT_LIBRARY } from "./core";

function workerDeficit(race: RaceId, gold: number) {
  return sketchScene(`training-affordability-${race}`).map("bareDuel").replaceDefaults()
    .player("us", { race, team: "a" }).player("foe", { race: "grove", team: "b" })
    .playerState("us", { gold }).townHall("us", 500, 500, { id: "hall" })
    .townHall("foe", 3400, 3400).goldMine("mine", 716, 500, 10000)
    .worker("us", 550, 500, { id: "miner", order: { type: "mine", resourceId: "mine", phase: "toMine", timer: 0 } })
    .build().createGame();
}

function policyMemory() {
  const memory = createAiPolicyMemory();
  memory.jobs.push({ id: "miner", kind: "expansion", createdTick: 0, updatedTick: 0 });
  memory.unitClaims.miner = { kind: "expansion", targetId: "mine", x: 716, y: 500, sinceTick: 0, expiresTick: 900 };
  return memory;
}

function plan(snapshot: GameSnapshot, memory = policyMemory()): GameCommand[] {
  const result = AI_SCRIPT_LIBRARY.training.run(snapshot, "us", { version: "v2", ...(snapshot.teams ? { teams: snapshot.teams } : {}), memory });
  return result ? Array.isArray(result) ? result : [result] : [];
}

function expectNoOrders(snapshot: GameSnapshot) {
  const memory = policyMemory(), before = structuredClone(snapshot), beforeMemory = structuredClone(memory);
  expect(plan(snapshot, memory)).toEqual([]);
  expect(snapshot).toEqual(before);
  expect(memory).toEqual(beforeMemory);
}

describe.each(["grove", "ember"] as const)("%s training affordability", race => {
  it("keeps a 74-gold worker deficit unchanged and trains at exactly 75 gold", () => {
    const game = workerDeficit(race, 74);
    expectNoOrders(snapshotGame(game));
    expect(game.buildings.find(building => building.id === "hall")!.queue).toEqual([]);
    game.players.us!.gold = 75;
    const commands = plan(snapshotGame(game));
    expect(commands).toEqual([{ type: "train", buildingId: "hall", unitKind: "worker" }]);
    for (const command of commands) issuePlayerCommand(game, "us", command);
    expect(game.players.us!.gold).toBe(0);
    expect(game.buildings.find(building => building.id === "hall")!.queue.map(job => job.unitKind)).toEqual(["worker"]);
  });

  it("keeps a negative reserved budget from ordering a purchase or changing policy memory", () => {
    const game = workerDeficit(race, 0), budget = snapshotGame(game);
    budget.players.us!.gold = -20;
    expectNoOrders(budget);
    expect(game.players.us!.gold).toBe(0);
  });

  it("waits at the actual population cap and uses one newly available population slot", () => {
    const game = workerDeficit(race, UNIT_DEFS.worker.cost);
    const population = UNIT_DEFS.worker.supplyUsed;
    game.players.us!.supplyCap = population;
    expectNoOrders(snapshotGame(game));
    game.players.us!.supplyCap = population + 1;
    const commands = plan(snapshotGame(game));
    expect(commands).toEqual([{ type: "train", buildingId: "hall", unitKind: "worker" }]);
    for (const command of commands) issuePlayerCommand(game, "us", command);
    expect(game.buildings.find(building => building.id === "hall")!.queue.map(job => job.unitKind)).toEqual(["worker"]);
  });

  it("waits for its occupied producer and resumes after the queued purchase is cancelled", () => {
    const game = workerDeficit(race, UNIT_DEFS.worker.cost * 2);
    issuePlayerCommand(game, "us", { type: "train", buildingId: "hall", unitKind: "worker" });
    const hall = game.buildings.find(building => building.id === "hall")!;
    expect(hall.queue).toHaveLength(1);
    expectNoOrders(snapshotGame(game));
    issuePlayerCommand(game, "us", { type: "cancelTraining", buildingId: "hall", jobId: hall.queue[0]!.id! });
    expect(hall.queue).toEqual([]);
    expect(plan(snapshotGame(game))).toEqual([{ type: "train", buildingId: "hall", unitKind: "worker" }]);
  });

  it("keeps a worker-sized bank when the only idle producer trains more expensive soldiers", () => {
    const game = workerDeficit(race, UNIT_DEFS.worker.cost * 2);
    const producer = createBuilding("military", "us", race === "grove" ? "barracks" : "emberForge", 650, 650, true);
    game.buildings.push(producer);
    issuePlayerCommand(game, "us", { type: "train", buildingId: "hall", unitKind: "worker" });
    expect(game.players.us!.gold).toBe(75);
    expect(producer.queue).toEqual([]);
    expectNoOrders(snapshotGame(game));
    const hall = game.buildings.find(building => building.id === "hall")!;
    issuePlayerCommand(game, "us", { type: "cancelTraining", buildingId: "hall", jobId: hall.queue[0]!.id! });
    expect(plan(snapshotGame(game))).toEqual([{ type: "train", buildingId: "hall", unitKind: "worker" }]);
  });

  it("counts population reserved in another hall's queue even when the displayed used count is stale", () => {
    const game = workerDeficit(race, UNIT_DEFS.worker.cost * 2);
    const other: Building = { ...game.buildings.find(building => building.id === "hall")!, id: "other-hall", x: 950, y: 750,
      queue: [], researchQueue: [] };
    game.buildings.push(other);
    issuePlayerCommand(game, "us", { type: "train", buildingId: "other-hall", unitKind: "worker" });
    expect(other.queue).toHaveLength(1);
    game.players.us!.supplyCap = UNIT_DEFS.worker.supplyUsed * 2;
    game.players.us!.supplyUsed = 0;
    expect(game.buildings.find(building => building.id === "hall")!.queue).toEqual([]);
    expectNoOrders(snapshotGame(game));
    issuePlayerCommand(game, "us", { type: "cancelTraining", buildingId: "other-hall", jobId: other.queue[0]!.id! });
    game.players.us!.supplyCap = UNIT_DEFS.worker.supplyUsed * 2;
    const commands = plan(snapshotGame(game));
    expect(commands).toEqual([{ type: "train", buildingId: "hall", unitKind: "worker" }]);
    for (const command of commands) issuePlayerCommand(game, "us", command);
    expect(game.buildings.find(building => building.id === "hall")!.queue.map(job => job.unitKind)).toEqual(["worker"]);
  });
});
