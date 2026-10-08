import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, snapshotGame, restoreSnapshotIntoGame, stepGame } from "./sim";
import { buildingPlacementBlocker } from "./build-placement";
import { miningHallSite } from "./mining-site";
import { MAP_POOL } from "./map-pool";
import { seconds } from "./time";
import type { MapId } from "./types";

function miningGame(map: MapId, count: number) {
  const game = createGame(map, { aiPlayers: [], ...(map === "grandEstuary" ? {players:["player","enemy","enemy2","enemy3","enemy4","enemy5","enemy6","enemy7"]} : {}) });
  const hall = game.buildings.find(building => building.owner === "player" && building.kind === "townHall")!;
  const mine = game.resources.reduce((best, resource) => Math.hypot(resource.x - hall.x, resource.y - hall.y) < Math.hypot(best.x - hall.x, best.y - hall.y) ? resource : best);
  game.units = [];
  game.players.player!.gold = 0;
  mine.amount = 100000;
  const workers = Array.from({ length: count }, (_, i) => game.spawnUnit("player", "worker", mine.x + i * 3, mine.y + i * 3));
  issuePlayerCommand(game, "player", { type: "mine", unitIds: workers.map(worker => worker.id), resourceId: mine.id });
  return { game, hall, mine, workers };
}

describe("gold haul cycles", () => {
  it.each(["bareDuel", "loneMarket", "grandEstuary"] as const)("saturates %s at five workers through admission and travel timing", map => {
    const income = (count: number) => {
      const { game } = miningGame(map, count);
      for (let tick = 0; tick < seconds(30); tick++) stepGame(game);
      const gold = game.players.player!.gold;
      for (let tick = 0; tick < seconds(60); tick++) stepGame(game);
      expect(game.units.filter(unit => unit.mineSlot)).toHaveLength(count);
      return game.players.player!.gold - gold;
    };
    const five = income(5);
    expect(five).toBeGreaterThan(income(4));
    expect(Math.abs(income(8) - five)).toBeLessThanOrEqual(10);
    expect(five).toBeGreaterThanOrEqual(390);
  });
  it("allows more than five workers to improve income on a genuinely longer hauling route", () => {
    const income = (count: number) => {
      const {game, mine, hall} = miningGame("bareDuel", count);
      mine.x = hall.x + 600;
      mine.y = hall.y;
      for (let tick = 0; tick < seconds(60); tick++) stepGame(game);
      const gold = game.players.player!.gold;
      for (let tick = 0; tick < seconds(60); tick++) stepGame(game);
      return game.players.player!.gold - gold;
    };
    expect(income(8)).toBeGreaterThan(income(5) + 80);
  });
  it("banks only delivered gold and conserves the mine, carried loads and income", () => {
    const {game, mine, workers} = miningGame("loneMarket", 8);
    const delivered = new Set<string>();
    let totalDeliveries = 0;
    for (let tick = 0; tick < seconds(60); tick++) {
      const returning = workers.filter(worker => worker.carryingGold > 0).map(worker => worker.id);
      stepGame(game);
      for (const worker of workers) if (returning.includes(worker.id) && worker.carryingGold === 0) {
        delivered.add(worker.id);
        totalDeliveries += 10;
      }
      expect(game.players.player!.gold).toBe(totalDeliveries);
      expect(mine.amount + workers.reduce((sum, worker) => sum + worker.carryingGold, 0) + totalDeliveries).toBe(100000);
    }
    expect(delivered.size).toBe(8);
  });
  it("delivers the final batch after depletion and releases assignments when orders change", () => {
    const { game, mine, workers } = miningGame("bareDuel", 6);
    mine.amount = 7;
    for (let tick = 0; tick < seconds(20); tick++) stepGame(game);
    expect(game.players.player!.gold).toBe(7);
    expect(mine.amount).toBe(0);
    expect(workers.every(worker => worker.carryingGold === 0)).toBe(true);
    mine.amount = 10000;
    issuePlayerCommand(game, "player", { type: "mine", unitIds: workers.map(worker => worker.id), resourceId: mine.id });
    for (let tick = 0; tick < seconds(5); tick++) stepGame(game);
    const occupied = workers.find(worker => worker.mineSlot)!;
    issuePlayerCommand(game, "player", { type: "move", unitIds: [occupied.id], x:mine.x-200, y:mine.y-200 });
    stepGame(game);
    expect(occupied.mineSlot).toBeUndefined();
    for (let tick = 0; tick < seconds(20); tick++) stepGame(game);
    expect(workers.filter(worker => worker.mineSlot)).toHaveLength(5);
  });
  it("preserves queue order and delivery through snapshot restoration", () => {
    const {game}=miningGame("loneMarket",6);
    for(let tick=0;tick<seconds(10);tick++)stepGame(game);
    const restored=createGame("loneMarket",{aiPlayers:[]});
    restoreSnapshotIntoGame(restored,snapshotGame(game),game.nextId);
    for(let tick=0;tick<seconds(10);tick++){stepGame(game);stepGame(restored);}
    expect(snapshotGame(restored)).toEqual(snapshotGame(game));
  });
  it("keeps the mine body clear and reserves a hauling lane around new town halls", () => {
    const {game,mine}=miningGame("bareDuel",0);
    game.buildings=[];
    expect(buildingPlacementBlocker(game,"townHall",{x:mine.x+100,y:mine.y})).toBe(mine);
    expect(buildingPlacementBlocker(game,"townHall",{x:mine.x+230,y:mine.y})).toBe(mine);
    expect(buildingPlacementBlocker(game,"townHall",{x:mine.x+279,y:mine.y})).toBe(mine);
    expect(buildingPlacementBlocker(game,"townHall",{x:mine.x+280,y:mine.y})).toBeUndefined();
    expect(buildingPlacementBlocker(game,"farm",mine)).toBe(mine);
  });
  it("enforces the hauling distance on actual town hall build commands", () => {
    const {game, mine, workers} = miningGame("bareDuel", 1);
    game.buildings = [];
    game.players.player!.gold = 1000;
    const command = {type: "build", unitId: workers[0]!.id, buildingKind: "townHall", x: mine.x + 279, y: mine.y} as const;
    expect(() => issuePlayerCommand(game, "player", command)).toThrow("goldMine");
    issuePlayerCommand(game, "player", {...command, x: mine.x + 280});
    expect(workers[0]!.order).toMatchObject({type: "build", buildingKind: "townHall", x: mine.x + 280});
  });
  it("leaves every formal main and expansion mine room for a legal hauling base", () => {
    for (const map of MAP_POOL) {
      const players = Array.from({length: map.players}, (_, i) => `seat${i}`);
      const game = createGame(map.id, {players, aiPlayers: []});
      for (const mine of game.resources) {
        if (mine.id.endsWith("-main")) {
          const owner = mine.id.slice(5, -5);
          const hall = game.buildings.find(building => building.owner === owner)!;
          expect(buildingPlacementBlocker({...game, buildings: []}, "townHall", hall), `${map.id}: ${mine.id}`).toBeUndefined();
        } else expect(miningHallSite(game, mine), `${map.id}: ${mine.id}`).toBeDefined();
      }
    }
  });
});
