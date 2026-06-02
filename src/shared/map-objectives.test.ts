import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "./catalog";
import { analyzeMapObjectives } from "../sdk/map-analysis";
import { RICH_SCORE_MAP_IDS } from "./map";
import { createGame } from "./sim";
import type { MapId, PlayerId } from "./types";

const EVALUATION_MAPS: MapId[] = ["verdantCrossroads", "campRush", "wildMarches", "grandThirty"];
const RICH_SCORE_MAPS: MapId[] = [...RICH_SCORE_MAP_IDS];
const RICH_SCORE_MAP_COUNT = 64;
const GRAND_PLAYERS = Array.from({ length: 30 }, (_, index) => `p${index + 1}`);

describe("map neutral objective layout", () => {
  it("keeps evaluation maps rich enough for objective-control AI tests", () => {
    for (const mapId of EVALUATION_MAPS) {
      const report = analyzeEvaluationMap(mapId);
      const bands = new Set(report.camps.map((camp) => camp.band));

      expect(report.camps.length, `${mapId} should have neutral camps`).toBeGreaterThan(0);
      expect(bands, `${mapId} should have green, yellow/orange, and red camps`).toEqual(new Set(["green", "orange", "red"]));
      expect(report.guardedCamps, `${mapId} should have guarded mine or mercenary objectives`).toBeGreaterThan(0);
      expect(report.freeCamps, `${mapId} should have non-mine/non-merc route camps`).toBeGreaterThan(0);
      expect(report.carriedItems, `${mapId} should have at least one drop-ready carried item per player`).toBeGreaterThanOrEqual(report.players);
    }
  });

  it("keeps multiplayer main mines outside accidental neutral aggro range", () => {
    const players = ["player", "enemy", "enemy2"];
    const teams = { player: "north", enemy: "south", enemy2: "south" };
    for (const mapId of ["verdantCrossroads", "campRush", ...RICH_SCORE_MAPS] as const) {
      const game = createGame(mapId, { players, aiPlayers: [], teams });
      const neutrals = game.units.filter((unit) => unit.owner === "neutral" && (UNIT_DEFS[unit.kind].creepFoodPower ?? 0) > 0);
      for (const owner of players) {
        const mine = game.resources.find((resource) => resource.id === `gold-${owner}-main`)!;
        const nearest = Math.min(...neutrals.map((unit) => Math.hypot(unit.x - mine.x, unit.y - mine.y)));
        expect(nearest, `${mapId}:${owner} main mine`).toBeGreaterThanOrEqual(430);
      }
    }
  });

  it("keeps sampled 1v1 sanity starts outside accidental neutral aggro range", () => {
    const players = ["v2", "v1a"];
    const teams = { v2: "north", v1a: "south" };
    for (const mapId of RICH_SCORE_MAPS) {
      const game = createGame(mapId, { players, aiPlayers: [], teams });
      const neutrals = game.units.filter((unit) => unit.owner === "neutral" && (UNIT_DEFS[unit.kind].creepFoodPower ?? 0) > 0);
      for (const owner of players) {
        const base = game.buildings.find((building) => building.owner === owner && building.kind === "townHall")!;
        const mine = game.resources.find((resource) => resource.id === `gold-${owner}-main`)!;
        const nearestBase = Math.min(...neutrals.map((unit) => Math.hypot(unit.x - base.x, unit.y - base.y)));
        const nearestMine = Math.min(...neutrals.map((unit) => Math.hypot(unit.x - mine.x, unit.y - mine.y)));

        expect(nearestBase, `${mapId}:${owner} main base`).toBeGreaterThanOrEqual(430);
        expect(nearestMine, `${mapId}:${owner} main mine`).toBeGreaterThanOrEqual(430);
      }
    }
  });

  it("makes guarded mines and mercenary camps real strategic objectives", () => {
    for (const mapId of EVALUATION_MAPS) {
      const report = analyzeEvaluationMap(mapId);
      const mineCamps = report.camps.filter((camp) => camp.role === "mine");
      const mercenaryCamps = report.camps.filter((camp) => camp.role === "mercenary");

      for (const camp of mineCamps) {
        expect(camp.power, `${mapId}:${camp.guardedObjectiveIds.join(",")} mine camps should be at least big yellow`).toBeGreaterThanOrEqual(8);
      }
      for (const camp of mercenaryCamps) {
        expect(camp.power, `${mapId}:${camp.guardedObjectiveIds.join(",")} mercenary camps should not be free`).toBeGreaterThanOrEqual(6);
      }
      if (mineCamps.length > 0 && mercenaryCamps.length > 0) {
        expect(
          Math.min(...mineCamps.map((camp) => camp.power)),
          `${mapId} mines should be harder to claim than ordinary mercenary camps`,
        ).toBeGreaterThan(Math.min(...mercenaryCamps.map((camp) => camp.power)));
      }
    }
  });

  it("keeps a broad rich official map family for v2 scoring without turning 1v1 into a neutral-camp sea", () => {
    expect(RICH_SCORE_MAPS.length).toBe(RICH_SCORE_MAP_COUNT);
    for (const mapId of RICH_SCORE_MAPS) {
      const report = analyzeMapObjectives(mapId);
      const game = createGame(mapId, { aiPlayers: [] });
      const mercKinds = new Set(game.mercenaryCamps.map((camp) => camp.hireKind));
      const unitIds = new Set(game.units.map((unit) => unit.id));

      expect(report.players, `${mapId} should be a normal 1v1 scoring map by default`).toBe(2);
      expect(report.camps.length, `${mapId} should have bounded 1v1 camp density`).toBeGreaterThanOrEqual(9);
      expect(report.camps.length, `${mapId} should have bounded 1v1 camp density`).toBeLessThanOrEqual(14);
      expect(report.guardedCamps, `${mapId} should have guarded economy/mercenary objectives`).toBeGreaterThanOrEqual(5);
      expect(report.freeCamps, `${mapId} should leave room for army-vs-army play`).toBeLessThanOrEqual(6);
      expect(report.carriedItems, `${mapId} should have item-routing AI without flooding the map`).toBeGreaterThanOrEqual(6);
      expect(report.bands, `${mapId} should include green camps`).toMatchObject({ green: expect.any(Number) });
      expect(report.bands.green, `${mapId} should include green camps`).toBeGreaterThan(0);
      expect(report.bands.orange, `${mapId} should include yellow/orange camps`).toBeGreaterThan(0);
      expect(report.bands.red, `${mapId} should include red camps`).toBeGreaterThan(0);
      expect(mercKinds, `${mapId} should offer all three mercenary roles`).toEqual(new Set(["mercenary", "contractArcher", "fieldMedic"]));
      expect(game.items.filter((item) => item.carrierId && !unitIds.has(item.carrierId)), `${mapId} should not have treasure attached to removed camps`).toEqual([]);
    }
  });
});

function analyzeEvaluationMap(mapId: MapId) {
  if (mapId !== "grandThirty") return analyzeMapObjectives(mapId);
  const teams = Object.fromEntries(GRAND_PLAYERS.map((owner, index) => [owner, index < 15 ? "north" : "south"]));
  return analyzeMapObjectives(mapId, { players: GRAND_PLAYERS, teams: teams as Record<PlayerId, string> });
}
