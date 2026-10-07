import { describe, expect, it } from "vitest";
import { createGame, issuePlayerCommand, snapshotGame, restoreSnapshotIntoGame, stepGame } from "./sim";
import { buildingPlacementBlocker } from "./build-placement";
import { GOLD_MINE_RULES } from "./mining";
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
  it.each(["bareDuel", "loneMarket", "grandEstuary"] as const)("saturates %s at five workstations, including travel back to the hall", map => {
    const income = (count: number) => {
      const { game } = miningGame(map, count);
      for (let tick = 0; tick < seconds(110); tick++) stepGame(game);
      expect(game.units.filter(unit => unit.mineSlot).length).toBeLessThanOrEqual(GOLD_MINE_RULES.workstations);
      return game.players.player!.gold;
    };
    expect(income(8)).toBeLessThanOrEqual(income(5));
  });
  it("delivers the final batch after depletion and releases a workstation when orders change", () => {
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
  it("preserves workstation reservations and delivery through snapshot restoration", () => {
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
    expect(buildingPlacementBlocker(game,"townHall",{x:mine.x+170,y:mine.y})).toBeUndefined();
    expect(buildingPlacementBlocker(game,"farm",mine)).toBe(mine);
  });
});
