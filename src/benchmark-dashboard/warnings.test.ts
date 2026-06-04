import { describe, expect, it } from "vitest";
import type { BenchmarkMatchReport, BenchmarkPlayerResult } from "../sdk/benchmark";
import { matchWarnings } from "./warnings";

describe("benchmark dashboard warnings", () => {
  it("flags wins with no enemy fight and opponents killed only by neutrals", () => {
    const match = matchWithPlayers({
      v2: player({ team: "north", firstEnemyEngagementSecond: null, unitsLost: 0, unitsKilledByNeutral: 0 }),
      v1: player({ team: "south", firstEnemyEngagementSecond: null, unitsLost: 4, unitsKilledByNeutral: 4 }),
    });

    expect(matchWarnings(match)).toEqual(["winner no first fight", "opponent neutral deaths"]);
  });

  it("stays quiet for ordinary combat wins", () => {
    const match = matchWithPlayers({
      v2: player({ team: "north", firstEnemyEngagementSecond: 42, unitsLost: 2, unitsKilledByNeutral: 0 }),
      v1: player({ team: "south", firstEnemyEngagementSecond: 42, unitsLost: 4, unitsKilledByNeutral: 1 }),
    });

    expect(matchWarnings(match)).toEqual([]);
  });
});

function matchWithPlayers(players: Record<string, BenchmarkPlayerResult>): BenchmarkMatchReport {
  return {
    name: "warning fixture",
    elapsedMs: 0,
    cpuMs: 0,
    setup: {} as BenchmarkMatchReport["setup"],
    result: {
      tick: 0,
      gameSecond: 0,
      winner: "v2",
      winnerTeam: "north",
      timeout: false,
      players,
      trackers: {},
    },
  };
}

function player(overrides: Partial<BenchmarkPlayerResult>): BenchmarkPlayerResult {
  return {
    team: "north",
    race: "grove",
    aiVersion: "v2",
    firstExpansionMiningSecond: null,
    upgradeSeconds: {},
    starUnitCounts: {},
    firstEnemyEngagementSecond: null,
    firstEnemyExpansionAttackSecond: null,
    firstOwnExpansionAttackedSecond: null,
    baseBuildCount: 1,
    neutralUnitKills: 0,
    enemyUnitKills: 0,
    unitsLost: 0,
    unitsKilledByNeutral: 0,
    defenseTowerBuildCount: 0,
    moonWellBuildCount: 0,
    moonWellHealingEvents: 0,
    moonWellHealingHp: 0,
    itemPickupCount: 0,
    itemUseCount: 0,
    peakSupply: 0,
    finalSupply: 0,
    finalBuildingCount: 0,
    goldMineIncome: 0,
    creepBountyIncome: 0,
    totalGoldIncome: 0,
    unitTrainingGoldSpent: 0,
    buildingGoldSpent: 0,
    totalGoldSpent: 0,
    ...overrides,
  };
}
