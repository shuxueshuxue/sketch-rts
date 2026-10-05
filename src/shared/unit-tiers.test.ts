import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, TIER_SUPPLY_CAP, UNIT_DEFS, requiredSupplyCap } from "./catalog";
import { createBuilding } from "./map";
import { createGame, issueCommand, snapshotGame } from "./sim";
import { checkCommandLegality } from "./sim/command-validation";
import type { TrainableUnitKind } from "./types";

function groveGame(farms: number) {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [], races: { player: "grove" } });
  game.players.player!.gold = 5_000;
  const sanctum = createBuilding("building-player-tier-sanctum", "player", "sanctum", 760, 680, true);
  const stables = createBuilding("building-player-tier-stables", "player", "stables", 860, 680, true);
  game.buildings.push(sanctum, stables);
  for (let index = 0; index < farms; index += 1) game.buildings.push(createBuilding(`building-player-tier-farm-${index}`, "player", "farm", 400 + index * 64, 1_000, true));
  // Buildings placed by hand are counted on the next recount (a building finishing, a unit dying); count them now.
  game.players.player!.supplyCap += farms * BUILDING_DEFS.farm.supplyProvided;
  return { game, sanctum, stables };
}

// The fewest farms beside the one hall that reach a cap.
function farmsFor(cap: number) {
  return Math.ceil((cap - BUILDING_DEFS.townHall.supplyProvided) / BUILDING_DEFS.farm.supplyProvided);
}

describe("unit tiers", () => {
  it("puts the casters and raiders behind the advanced bar and the heavies behind the elite bar; the basic line needs none", () => {
    const tiers = (cap: number) => (Object.keys(UNIT_DEFS) as TrainableUnitKind[]).filter((kind) => requiredSupplyCap(kind) === cap).sort();
    expect(TIER_SUPPLY_CAP[3]).toBeGreaterThan(TIER_SUPPLY_CAP[2]);
    expect(tiers(TIER_SUPPLY_CAP[2])).toEqual(["ashHexer", "emberAcolyte", "priest", "pyreCaller", "raider", "summoner", "witch"]);
    expect(tiers(TIER_SUPPLY_CAP[3])).toEqual(["ashChieftain", "cinderRevenant", "golem", "knight"]);
    for (const kind of ["worker", "footman", "lancer", "groveWarden", "archer", "emberRavager", "cinderRunner", "sparkArcher", "contractArcher"] as const) expect(requiredSupplyCap(kind)).toBe(0);
  });

  it("refuses to train a locked unit until farms lift the cap, and tells a planner to wait rather than give up", () => {
    const [advanced, elite] = [TIER_SUPPLY_CAP[2], TIER_SUPPLY_CAP[3]];
    const early = groveGame(farmsFor(advanced) - 1);
    expect(early.game.players.player!.supplyCap).toBeLessThan(advanced);
    const command = { type: "train", buildingId: early.sanctum.id, unitKind: "summoner" } as const;
    expect(checkCommandLegality(snapshotGame(early.game), "player", command)).toEqual({ message: `Need a supply cap of ${advanced} to train summoner`, transient: true });
    expect(() => issueCommand(early.game, command)).toThrow(`Need a supply cap of ${advanced} to train summoner`);

    const teched = groveGame(farmsFor(advanced));
    expect(teched.game.players.player!.supplyCap).toBeGreaterThanOrEqual(advanced);
    expect(teched.game.players.player!.supplyCap).toBeLessThan(elite);
    issueCommand(teched.game, { type: "train", buildingId: teched.sanctum.id, unitKind: "summoner" });
    expect(teched.sanctum.queue.map((job) => job.unitKind)).toEqual(["summoner"]);
    expect(() => issueCommand(teched.game, { type: "train", buildingId: teched.stables.id, unitKind: "knight" })).toThrow(`Need a supply cap of ${elite} to train knight`);
  });
});
