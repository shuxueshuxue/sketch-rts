import { describe, expect, it } from "vitest";
import { UNIT_DEFS } from "./catalog";
import { analyzeMapObjectives } from "../sdk/map-analysis";
import { createGame } from "./sim";
import type { MapId, PlayerId } from "./types";

// Fixed maps whose camps are laid out for objective-control AI tests (the ladder map's camps are its generator's; see
// generated-map.test).
const EVALUATION_MAPS: MapId[] = ["verdantCrossroads", "campRush", "grandThirty"];
// The maps a game with creeps is played on: the ladder map (on the layout the seed "ladder" draws, and on others) and the
// fixed maps with camps.
const CREEP_MAPS: { mapId: MapId; layout?: { seed: string } }[] = [
  { mapId: "verdantCrossroads" },
  { mapId: "campRush" },
  { mapId: "ladder" },
  { mapId: "ladder", layout: { seed: "objectives-a" } },
  { mapId: "ladder", layout: { seed: "objectives-b" } },
];
const LADDER_LAYOUTS = CREEP_MAPS.filter((map) => map.mapId === "ladder");
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
    for (const { mapId, layout } of CREEP_MAPS) {
      const game = createGame(mapId, { players, aiPlayers: [], teams, ...(layout ? { layout } : {}) });
      const neutrals = game.units.filter((unit) => unit.owner === "neutral" && (UNIT_DEFS[unit.kind].creepFoodPower ?? 0) > 0);
      for (const owner of players) {
        const mine = game.resources.find((resource) => resource.id === `gold-${owner}-main`)!;
        const nearest = Math.min(...neutrals.map((unit) => Math.hypot(unit.x - mine.x, unit.y - mine.y)));
        expect(nearest, `${mapId}${layout ? `/${layout.seed}` : ""}:${owner} main mine`).toBeGreaterThanOrEqual(430);
      }
    }
  });

  it("keeps sampled 1v1 sanity starts outside accidental neutral aggro range", () => {
    const players = ["v2", "v1a"];
    const teams = { v2: "north", v1a: "south" };
    for (const { mapId, layout } of CREEP_MAPS) {
      const game = createGame(mapId, { players, aiPlayers: [], teams, ...(layout ? { layout } : {}) });
      const neutrals = game.units.filter((unit) => unit.owner === "neutral" && (UNIT_DEFS[unit.kind].creepFoodPower ?? 0) > 0);
      for (const owner of players) {
        const base = game.buildings.find((building) => building.owner === owner && building.kind === "townHall")!;
        const mine = game.resources.find((resource) => resource.id === `gold-${owner}-main`)!;
        const nearestBase = Math.min(...neutrals.map((unit) => Math.hypot(unit.x - base.x, unit.y - base.y)));
        const nearestMine = Math.min(...neutrals.map((unit) => Math.hypot(unit.x - mine.x, unit.y - mine.y)));

        expect(nearestBase, `${mapId}${layout ? `/${layout.seed}` : ""}:${owner} main base`).toBeGreaterThanOrEqual(430);
        expect(nearestMine, `${mapId}${layout ? `/${layout.seed}` : ""}:${owner} main mine`).toBeGreaterThanOrEqual(430);
      }
    }
  });

  it("keeps the first expansion and the first contested economy objective as near to one 1v1 start as to the other on ladder maps", () => {
    const players = ["v2", "v1a"];
    const teams = { v2: "north", v1a: "south" };
    for (const { layout } of LADDER_LAYOUTS) {
      const game = createGame("ladder", { players, aiPlayers: [], teams, ...(layout ? { layout } : {}) });
      const distances = players.map((owner) => {
        const base = game.buildings.find((building) => building.owner === owner && building.kind === "townHall")!;
        return Math.min(...game.resources.filter((resource) => resource.kind === "goldMine" && !resource.id.endsWith("-main")).map((resource) => Math.hypot(resource.x - base.x, resource.y - base.y)));
      });

      expect(Math.min(...distances), `${layout?.seed ?? "ladder"} should not have a nearly free expansion`).toBeGreaterThanOrEqual(480);
      expect(Math.abs(distances[0]! - distances[1]!), `${layout?.seed ?? "ladder"} should keep the first expansion's distance the same from both starts`).toBeLessThanOrEqual(160);
    }
  });

  it("keeps guarded mercenary camps inside the AI guard radius", () => {
    for (const { mapId, layout } of CREEP_MAPS) {
      const options = { players: ["v2", "v1a"], aiPlayers: [], teams: { v2: "north", v1a: "south" }, ...(layout ? { layout } : {}) };
      const game = createGame(mapId, options);
      const report = analyzeMapObjectives(mapId, options);
      const guardedMercenaryIds = new Set(report.camps.flatMap((camp) => camp.guardedObjectiveIds.filter((id) => game.mercenaryCamps.some((candidate) => candidate.id === id))));

      for (const camp of game.mercenaryCamps.filter((candidate) => guardedMercenaryIds.has(candidate.id))) {
        expect(neutralCreepsNear(game.units, camp, 260), `${mapId}:${camp.id} should not be reported as guarded while AI sees it as free`).not.toEqual([]);
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

  it("attaches every ladder map's treasure to a camp that is on the map", () => {
    for (const { layout } of LADDER_LAYOUTS) {
      const game = createGame("ladder", { aiPlayers: [], ...(layout ? { layout } : {}) });
      const unitIds = new Set(game.units.map((unit) => unit.id));

      expect(game.items.length, `${layout?.seed ?? "ladder"} should carry treasure`).toBeGreaterThan(0);
      expect(game.items.filter((item) => item.carrierId && !unitIds.has(item.carrierId)), `${layout?.seed ?? "ladder"} should not have treasure attached to missing camps`).toEqual([]);
    }
  });
});

function analyzeEvaluationMap(mapId: MapId) {
  if (mapId !== "grandThirty") return analyzeMapObjectives(mapId);
  const teams = Object.fromEntries(GRAND_PLAYERS.map((owner, index) => [owner, index < 15 ? "north" : "south"]));
  return analyzeMapObjectives(mapId, { players: GRAND_PLAYERS, teams: teams as Record<PlayerId, string> });
}

function neutralCreepsNear(units: ReturnType<typeof createGame>["units"], point: { x: number; y: number }, range: number) {
  return units.filter((unit) => unit.owner === "neutral" && (UNIT_DEFS[unit.kind].creepFoodPower ?? 0) > 0 && Math.hypot(unit.x - point.x, unit.y - point.y) <= range);
}
