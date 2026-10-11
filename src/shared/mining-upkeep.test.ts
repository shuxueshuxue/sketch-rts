import { describe, expect, it } from "vitest";
import { miningIncomeRate, upkeepGoldIncome } from "./mining";
import { addGold, roundGold } from "./gold";
import { createGame, issuePlayerCommand, snapshotGame, restoreSnapshotIntoGame, stepGame } from "./sim";
import { createBuilding } from "./map";
import { UNIT_DEFS } from "./catalog";
import { checksumGame } from "./sim/checksum";
import { createSaveGameRecord, restoreGameFromSave } from "./savegame";
import { createRoom } from "./rooms";

function scene() {
  const game = createGame("bareDuel", { aiPlayers: [] });
  game.scriptedVictory = true;
  const hall = game.buildings.find(b => b.owner === "player" && b.kind === "townHall")!;
  const worker = game.units.find(u => u.owner === "player" && u.kind === "worker")!;
  const mine = game.resources[0]!;
  function deliver(supply: number, carried = 10) {
    game.players.player.supplyUsed = supply;
    worker.x = hall.x; worker.y = hall.y;
    worker.carryingGold = carried;
    worker.order = { type: "mine", resourceId: mine.id, phase: "return", timer: 0 };
    stepGame(game);
  }
  return { game, hall, worker, deliver };
}

describe("mining upkeep and cent settlement", () => {
  it.each([[0, 1], [39, 1], [40, 1], [55, 2 / 3], [70, 1 / 2], [85, 2 / 5], [100, 1 / 3], [115, 2 / 7], [130, 1 / 4]])("population %s retains %s", (supply, rate) => {
    expect(miningIncomeRate(supply)).toBeCloseTo(rate, 14);
  });
  it("interpolates equivalent mine demand continuously with no high-population floor", () => {
    for (let supply = 40; supply <= 10000; supply += 7.25) {
      const mines = 1 + (supply - 40) / 30;
      expect(mines * miningIncomeRate(supply)).toBeCloseTo(1, 14);
      expect(miningIncomeRate(supply + 0.1)).toBeLessThan(miningIncomeRate(supply));
    }
    for (const anchor of [40, 70, 100, 130]) {
      expect(miningIncomeRate(anchor - 1e-7)).toBeCloseTo(miningIncomeRate(anchor + 1e-7), 7);
    }
    expect(miningIncomeRate(1e12)).toBeGreaterThan(0);
    expect(miningIncomeRate(1e12)).toBeLessThan(1e-9);
    expect(upkeepGoldIncome(10, 1e12)).toBe(0);
  });
  it("normalizes scenario starting funds to cents", () => {
    const game = createGame("bareDuel", { aiPlayers: [], scenario: { players: { player: { gold: 50.126 } } } });
    expect(game.players.player.gold).toBe(50.13);
  });
  it("rounds deliveries to cents and adds cents without accumulated floating error", () => {
    expect(upkeepGoldIncome(10, 100)).toBe(3.33);
    expect(upkeepGoldIncome(10, 55)).toBe(6.67);
    expect(upkeepGoldIncome(1, 130)).toBe(0.25);
    expect(upkeepGoldIncome(0, 100)).toBe(0);
    expect(roundGold(0.125)).toBe(0.13);
    let balance = 0;
    for (let i = 0; i < 1000; i++) balance = addGold(balance, upkeepGoldIncome(10, 100));
    expect(balance).toBe(3330);
    expect(addGold(0.29, -0.28)).toBe(0.01);
  });
  it("delivers fractional final loads and changes tax at the next delivery", () => {
    const { game, deliver } = scene(); game.players.player.gold = 0;
    deliver(100); deliver(55); deliver(130, 1);
    expect(game.players.player.gold).toBe(10.25);
    deliver(40);
    expect(game.players.player.gold).toBe(20.25);
  });
  it("preserves fractional funds across affordability, spending, refund, JSON saves and checkpoints", () => {
    const { game, hall, deliver } = scene(); game.players.player.gold = UNIT_DEFS.worker.cost - 0.01;
    expect(() => issuePlayerCommand(game, "player", { type: "train", buildingId: hall.id, unitKind: "worker" })).toThrow();
    deliver(100);
    const balance = game.players.player.gold;
    issuePlayerCommand(game, "player", { type: "train", buildingId: hall.id, unitKind: "worker" });
    expect(game.players.player.gold).toBe(3.32);
    const jobId = hall.queue[0]!.id!;
    const room = { ...createRoom({ id: "upkeep", host: { id: "host", name: "Host" }, mapId: "bareDuel" }), status: "inMatch" as const };
    const saved = JSON.parse(JSON.stringify(createSaveGameRecord(game, room, { id: "upkeep" })));
    const restored = restoreGameFromSave(saved);
    expect(restored.players.player.gold).toBe(3.32);
    expect(checksumGame(restored)).toBe(checksumGame(game));
    const checkpoint = createGame("bareDuel", { aiPlayers: [] });
    restoreSnapshotIntoGame(checkpoint, JSON.parse(JSON.stringify(snapshotGame(game))), game.nextId);
    expect(checksumGame(checkpoint)).toBe(checksumGame(game));
    for (const instance of [game, restored, checkpoint]) {
      issuePlayerCommand(instance, "player", { type: "cancelTraining", buildingId: hall.id, jobId });
      expect(instance.players.player.gold).toBe(balance);
      stepGame(instance);
    }
    expect(checksumGame(restored)).toBe(checksumGame(game));
    expect(checksumGame(checkpoint)).toBe(checksumGame(game));
    restored.players.player.gold = addGold(restored.players.player.gold, 0.01);
    expect(checksumGame(restored)).not.toBe(checksumGame(game));
  });
  it("keeps building capacity uncapped and charges full population including queued units", () => {
    const { game, hall } = scene();
    for (let i = 0; i < 40; i++) game.buildings.push(createBuilding(`farm-${i}`, "player", "farm", 500, 500, true));
    const before = game.players.player.supplyUsed;
    issuePlayerCommand(game, "player", { type: "train", buildingId: hall.id, unitKind: "worker" });
    expect(game.players.player.supplyUsed).toBe(before + UNIT_DEFS.worker.supplyUsed);
    expect(game.players.player.supplyCap).toBeGreaterThan(130);
    for (let i = 0; i < 131; i++) game.spawnUnit("player", "worker", 500, 3000);
    issuePlayerCommand(game, "player", { type: "train", buildingId: hall.id, unitKind: "worker" });
    expect(game.players.player.supplyUsed).toBeGreaterThan(130);
    expect(hall.queue).toHaveLength(2);
  });
  it("pays an untaxed neutral bounty at high population and retains the fractional balance", () => {
    const { game } = scene();
    game.units = []; game.resources = [];
    game.players.player.gold = 3.33;
    for (let i = 0; i < 131; i++) game.spawnUnit("player", "worker", 500, 3000);
    const tower = createBuilding("bounty-tower", "player", "defenseTower", 800, 800, true);
    game.buildings.push(tower);
    const creep = game.spawnUnit("neutral", "mossGnawer", 1000, 800);
    creep.hp = 1; creep.order = { type: "hold", x: creep.x, y: creep.y };
    for (let i = 0; i < 15; i++) stepGame(game);
    expect(game.players.player.supplyUsed).toBeGreaterThan(130);
    expect(game.players.player.gold).toBe(23.33);
    expect(game.effects.filter(e => e.type === "goldBounty")).toEqual([expect.objectContaining({ amount: 20 })]);
  });
});
