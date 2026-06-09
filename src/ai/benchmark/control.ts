import { RICH_SCORE_MAP_IDS } from "../../shared/map";
import type { MapId, PlayerId, RaceId } from "../../shared/types";
import type { BenchmarkInput, BenchmarkMatchInput, BenchmarkMatchReport, BenchmarkReport } from "../../sdk/benchmark/core";
import { runBenchmark } from "../../sdk/benchmark/core";
import { runBenchmarkParallel } from "../../sdk/benchmark/parallel";
import type { ArmyBalanceStats } from "./army-balance-stats";
import type { AiCommandStats } from "./command-stats";
import type { ExpansionClaimTimelineStats } from "./expansion-claim-timeline";
import type { WoundedMoonWellStats } from "./wounded-moonwell-stats";
import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";
import { DEFAULT_AI_THINK_INTERVAL } from "../runtime";
import { recordBenchmarkDashboardReportRun, type BenchmarkDashboardStoreOptions, type SpecializedBenchmarkDashboardRun } from "./dashboard-store";
import { createAiMeleeControlMatches, selectGauntletRichScoreMaps, serializableAiBenchmarkInput, type AiVersionBenchmarkOptions, type GauntletMapSelection } from "./presets";

export type AiMeleeControlBenchmarkInput = {
  input: BenchmarkInput<AiGameAgent>;
  selection: GauntletMapSelection<MapId>;
};

export type AiCrossRaceBenchmarkInput = {
  input: BenchmarkInput<AiGameAgent>;
  selection: GauntletMapSelection<MapId>;
};

export type AiV3VsProdV2BenchmarkInput = {
  input: BenchmarkInput<AiGameAgent>;
  selection: GauntletMapSelection<MapId>;
};

export type AiV4TrVsV3BenchmarkInput = {
  input: BenchmarkInput<AiGameAgent>;
  selection: GauntletMapSelection<MapId>;
};

export type AiV5VsHybridBenchmarkInput = {
  input: BenchmarkInput<AiGameAgent>;
  selection: GauntletMapSelection<MapId>;
};

export type AiMeleeControlBenchmarkResult = {
  seed: string;
  selectedMapIds: string[];
  rawWins: number;
  rawMatches: number;
  bothSideMapWins: number;
  split: number;
  bothSideLosses: number;
  elapsedMs: number;
  cpuMs?: number;
  workers?: number;
  byMap: AiMeleeControlMapResult[];
};

export type AiMeleeControlMapResult = {
  mapId: string;
  northWinner: PlayerId | null;
  southWinner: PlayerId | null;
  wins: number;
};

export type AiMeleeControlMatchDetailsResult = {
  seed: string;
  selectedMapIds: string[];
  matchCount: number;
  elapsedMs: number;
  cpuMs?: number;
  workers?: number;
  matches: AiMeleeControlMatchDetail[];
};

export type AiMeleeControlMatchDetail = {
  name: string;
  mapId: string;
  winner: PlayerId | null;
  winnerTeam: string;
  gameSecond: number;
  timeout: boolean;
  players: Record<PlayerId, AiMeleeControlPlayerDetail>;
  aiCommandStats?: AiCommandStats;
  woundedMoonWellStats?: WoundedMoonWellStats;
  armyBalanceStats?: ArmyBalanceStats;
  expansionClaimTimeline?: ExpansionClaimTimelineStats;
};

export type AiMeleeControlPlayerDetail = {
  team: string;
  race: string;
  aiVersion: string;
  firstExpansionMiningSecond: number | null;
  firstEnemyEngagementSecond: number | null;
  firstEnemyExpansionAttackSecond: number | null;
  firstOwnExpansionAttackedSecond: number | null;
  baseBuildCount: number;
  defenseTowerBuildCount: number;
  moonWellBuildCount: number;
  moonWellHealingEvents: number;
  moonWellHealingHp: number;
  neutralUnitKills: number;
  enemyUnitKills: number;
  unitsLost: number;
  unitsKilledByNeutral: number;
  itemPickupCount: number;
  itemUseCount: number;
  peakSupply: number;
  finalSupply: number;
  finalBuildingCount: number;
  goldMineIncome: number;
  creepBountyIncome: number;
  totalGoldIncome: number;
  unitTrainingGoldSpent: number;
  buildingGoldSpent: number;
  totalGoldSpent: number;
};

export type AiMeleeControlBenchmarkOptions = Pick<AiVersionBenchmarkOptions, "seed" | "mapCount" | "full" | "maxTicks" | "thinkInterval" | "controller" | "workers" | "workerHarassment">;
export type AiCrossRaceBenchmarkOptions = Pick<AiVersionBenchmarkOptions, "seed" | "mapCount" | "full" | "maxTicks" | "thinkInterval" | "controller" | "workers">;
export type AiV3VsProdV2BenchmarkOptions = Pick<AiVersionBenchmarkOptions, "seed" | "mapCount" | "full" | "maxTicks" | "thinkInterval" | "controller" | "workers">;
export type AiV4TrVsV3BenchmarkOptions = Pick<AiVersionBenchmarkOptions, "seed" | "mapCount" | "full" | "maxTicks" | "thinkInterval" | "controller" | "workers">;
export type AiV5VsHybridBenchmarkOptions = Pick<AiVersionBenchmarkOptions, "seed" | "mapCount" | "full" | "maxTicks" | "thinkInterval" | "controller" | "workers">;

export type AiCrossRaceBenchmarkResult = {
  seed: string;
  selectedMapIds: string[];
  emberWins: number;
  rawMatches: number;
  winRate: number;
  elapsedMs: number;
  cpuMs?: number;
  workers?: number;
  byMap: { mapId: string; northWinner: PlayerId | null; southWinner: PlayerId | null; wins: number }[];
};

export type AiV3VsProdV2BenchmarkResult = {
  seed: string;
  selectedMapIds: string[];
  v3Wins: number;
  rawMatches: number;
  winRate: number;
  elapsedMs: number;
  cpuMs?: number;
  workers?: number;
  frozenBaselineRevision: string;
  byV3Race: Record<RaceId, AiV3RaceBreakdown>;
  byMatchup: Record<string, AiV3RaceBreakdown>;
  byMap: AiV3VsProdV2MapResult[];
};

export type AiV4TrVsV3BenchmarkResult = {
  seed: string;
  selectedMapIds: string[];
  v4TrWins: number;
  rawMatches: number;
  winRate: number;
  elapsedMs: number;
  cpuMs?: number;
  workers?: number;
  byV3Race: Record<RaceId, AiV3RaceBreakdown>;
  byMap: AiV4TrVsV3MapResult[];
};

export type AiV5VsHybridBenchmarkResult = {
  seed: string;
  selectedMapIds: string[];
  v5Wins: number;
  rawMatches: number;
  winRate: number;
  elapsedMs: number;
  cpuMs?: number;
  workers?: number;
  byV5Race: Record<RaceId, AiV3RaceBreakdown>;
  byV3Race: Record<RaceId, AiV3RaceBreakdown>;
  byOpponentOrder: Record<string, AiV3RaceBreakdown>;
  byMap: AiV5VsHybridMapResult[];
};

export type AiV3RaceBreakdown = {
  wins: number;
  matches: number;
  winRate: number;
};

export type AiV3VsProdV2MapResult = {
  mapId: string;
  northWinner: PlayerId | null;
  northV3Race: RaceId;
  southWinner: PlayerId | null;
  southV3Race: RaceId;
  wins: number;
};

export type AiV4TrVsV3MapResult = {
  mapId: string;
  northWinner: PlayerId | null;
  northV3Race: RaceId;
  southWinner: PlayerId | null;
  southV3Race: RaceId;
  wins: number;
};

export type AiV5VsHybridMapResult = {
  mapId: string;
  northWinner: PlayerId | null;
  northV5Race: RaceId;
  northV3Race: RaceId;
  southWinner: PlayerId | null;
  southV5Race: RaceId;
  southV3Race: RaceId;
  wins: number;
};

const FROZEN_PROD_V2_REVISION = "2521715";

export function createAiV3VsProdV2BenchmarkInput(options: AiV3VsProdV2BenchmarkOptions = {}): AiV3VsProdV2BenchmarkInput {
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], {
    ...(options.seed !== undefined ? { AI_GAUNTLET_SEED: options.seed } : {}),
    ...(options.mapCount !== undefined ? { AI_GAUNTLET_MAP_COUNT: String(options.mapCount) } : {}),
    ...(options.full ? { AI_GAUNTLET_FULL: "1" } : {}),
  });
  const controller = options.controller ?? "external-agent";
  const matchOptions = {
    controller,
    seed: selection.seed,
    ...(options.maxTicks !== undefined ? { maxTicks: options.maxTicks } : {}),
    ...(options.thinkInterval !== undefined ? { thinkInterval: options.thinkInterval } : {}),
  };
  return {
    selection,
    input: {
      name: "AI V3 vs Frozen Production V2 Benchmark",
      evaluations: [
        {
          name: "v3 race-aware vs v2-prod grove",
          tag: "melee",
          matches: selection.mapIds.flatMap((mapId, index) => createAiV3VsProdV2Matches(mapId, index, matchOptions)),
        },
      ],
    },
  };
}

export function createAiV4TrVsV3BenchmarkInput(options: AiV4TrVsV3BenchmarkOptions = {}): AiV4TrVsV3BenchmarkInput {
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], {
    ...(options.seed !== undefined ? { AI_GAUNTLET_SEED: options.seed } : {}),
    ...(options.mapCount !== undefined ? { AI_GAUNTLET_MAP_COUNT: String(options.mapCount) } : {}),
    ...(options.full ? { AI_GAUNTLET_FULL: "1" } : {}),
  });
  const controller = options.controller ?? "external-agent";
  const matchOptions = {
    controller,
    seed: selection.seed,
    ...(options.maxTicks !== undefined ? { maxTicks: options.maxTicks } : {}),
    ...(options.thinkInterval !== undefined ? { thinkInterval: options.thinkInterval } : {}),
  };
  return {
    selection,
    input: {
      name: "AI V4-TR vs V3 Benchmark",
      evaluations: [
        {
          name: "v4-tr tower merc vs v3 random race",
          tag: "melee",
          matches: selection.mapIds.flatMap((mapId, index) => createAiV4TrVsV3Matches(mapId, index, matchOptions)),
        },
      ],
    },
  };
}

export function createAiV5VsHybridBenchmarkInput(options: AiV5VsHybridBenchmarkOptions = {}): AiV5VsHybridBenchmarkInput {
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], {
    ...(options.seed !== undefined ? { AI_GAUNTLET_SEED: options.seed } : {}),
    ...(options.mapCount !== undefined ? { AI_GAUNTLET_MAP_COUNT: String(options.mapCount) } : {}),
    ...(options.full ? { AI_GAUNTLET_FULL: "1" } : {}),
  });
  const controller = options.controller ?? "external-agent";
  const matchOptions = {
    controller,
    seed: selection.seed,
    ...(options.maxTicks !== undefined ? { maxTicks: options.maxTicks } : {}),
    ...(options.thinkInterval !== undefined ? { thinkInterval: options.thinkInterval } : {}),
  };
  return {
    selection,
    input: {
      name: "AI V5 vs Hybrid V3 plus V4-TR Benchmark",
      evaluations: [
        {
          name: "v5 hybrid 1v2 vs v3 plus v4-tr",
          tag: "melee",
          matches: selection.mapIds.flatMap((mapId, index) => createAiV5VsHybridMatches(mapId, index, matchOptions)),
        },
      ],
    },
  };
}

export function createAiCrossRaceBenchmarkInput(options: AiCrossRaceBenchmarkOptions = {}): AiCrossRaceBenchmarkInput {
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], {
    ...(options.seed !== undefined ? { AI_GAUNTLET_SEED: options.seed } : {}),
    ...(options.mapCount !== undefined ? { AI_GAUNTLET_MAP_COUNT: String(options.mapCount) } : {}),
    ...(options.full ? { AI_GAUNTLET_FULL: "1" } : {}),
  });
  const controller = options.controller ?? "external-agent";
  const matchOptions = {
    controller,
    ...(options.maxTicks !== undefined ? { maxTicks: options.maxTicks } : {}),
    ...(options.thinkInterval !== undefined ? { thinkInterval: options.thinkInterval } : {}),
  };
  return {
    selection,
    input: {
      name: "AI Cross-Race Benchmark",
      evaluations: [
        {
          name: "v2 ember vs v2 grove",
          tag: "melee",
          matches: selection.mapIds.flatMap((mapId) => createAiCrossRaceMatches(mapId, matchOptions)),
        },
      ],
    },
  };
}

export function createAiMeleeControlBenchmarkInput(options: AiMeleeControlBenchmarkOptions = {}): AiMeleeControlBenchmarkInput {
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], {
    ...(options.seed !== undefined ? { AI_GAUNTLET_SEED: options.seed } : {}),
    ...(options.mapCount !== undefined ? { AI_GAUNTLET_MAP_COUNT: String(options.mapCount) } : {}),
    ...(options.full ? { AI_GAUNTLET_FULL: "1" } : {}),
  });
  return {
    selection,
    input: {
      name: "AI 1v1 Control Benchmark",
      evaluations: [
        {
          name: "1v1 score control",
          tag: "melee",
          matches: selection.mapIds.flatMap((mapId, index) => createAiMeleeControlMatches(mapId, index, options)),
        },
      ],
    },
  };
}

export function runAiMeleeControlBenchmark(options: AiMeleeControlBenchmarkOptions = {}): AiMeleeControlBenchmarkResult {
  const { input, selection } = createAiMeleeControlBenchmarkInput(options);
  return summarizeAiMeleeControlBenchmark({ seed: selection.seed, selectedMapIds: selection.mapIds, report: runBenchmark(input), ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function runAiMeleeControlBenchmarkParallel(options: AiMeleeControlBenchmarkOptions = {}): Promise<AiMeleeControlBenchmarkResult> {
  const { input, selection } = createAiMeleeControlBenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiMeleeControlBenchmark({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function runAiMeleeControlBenchmarkDetailsParallel(options: AiMeleeControlBenchmarkOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  const { input, selection } = createAiMeleeControlBenchmarkInput(options);
  const filtered = filterBenchmarkInput(input, filter);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(filtered), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiMeleeControlBenchmarkDetails({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function runAiCrossRaceBenchmarkParallel(options: AiCrossRaceBenchmarkOptions = {}): Promise<AiCrossRaceBenchmarkResult> {
  const { input, selection } = createAiCrossRaceBenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiCrossRaceBenchmark({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function runAiV3VsProdV2BenchmarkParallel(options: AiV3VsProdV2BenchmarkOptions = {}): Promise<AiV3VsProdV2BenchmarkResult> {
  const { input, selection } = createAiV3VsProdV2BenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiV3VsProdV2Benchmark({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function runAiV4TrVsV3BenchmarkParallel(options: AiV4TrVsV3BenchmarkOptions = {}): Promise<AiV4TrVsV3BenchmarkResult> {
  const { input, selection } = createAiV4TrVsV3BenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiV4TrVsV3Benchmark({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function runAiV5VsHybridBenchmarkParallel(options: AiV5VsHybridBenchmarkOptions = {}): Promise<AiV5VsHybridBenchmarkResult> {
  const { input, selection } = createAiV5VsHybridBenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiV5VsHybridBenchmark({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function recordAiV3VsProdV2BenchmarkDashboardRun(options: AiV3VsProdV2BenchmarkOptions = {}, storeOptions: BenchmarkDashboardStoreOptions = {}): Promise<SpecializedBenchmarkDashboardRun> {
  const { input, selection } = createAiV3VsProdV2BenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return recordBenchmarkDashboardReportRun(
    {
      kind: "ai-specialized-benchmark",
      seed: selection.seed,
      mapPoolSize: RICH_SCORE_MAP_IDS.length,
      selectedRichScoreMapIds: selection.mapIds,
      targetPlayerId: "v3",
      report,
      full: options.full === true,
    },
    storeOptions,
  );
}

export async function recordAiV4TrVsV3BenchmarkDashboardRun(options: AiV4TrVsV3BenchmarkOptions = {}, storeOptions: BenchmarkDashboardStoreOptions = {}): Promise<SpecializedBenchmarkDashboardRun> {
  const { input, selection } = createAiV4TrVsV3BenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return recordBenchmarkDashboardReportRun(
    {
      kind: "ai-specialized-benchmark",
      seed: selection.seed,
      mapPoolSize: RICH_SCORE_MAP_IDS.length,
      selectedRichScoreMapIds: selection.mapIds,
      targetPlayerId: "v4-tr",
      report,
      full: options.full === true,
    },
    storeOptions,
  );
}

export async function recordAiV5VsHybridBenchmarkDashboardRun(options: AiV5VsHybridBenchmarkOptions = {}, storeOptions: BenchmarkDashboardStoreOptions = {}): Promise<SpecializedBenchmarkDashboardRun> {
  const { input, selection } = createAiV5VsHybridBenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return recordBenchmarkDashboardReportRun(
    {
      kind: "ai-specialized-benchmark",
      seed: selection.seed,
      mapPoolSize: RICH_SCORE_MAP_IDS.length,
      selectedRichScoreMapIds: selection.mapIds,
      targetPlayerId: "v5",
      report,
      full: options.full === true,
    },
    storeOptions,
  );
}

export async function runAiV3VsProdV2BenchmarkDetailsParallel(options: AiV3VsProdV2BenchmarkOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  const { input, selection } = createAiV3VsProdV2BenchmarkInput(options);
  const filtered = filterBenchmarkInput(input, filter);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(filtered), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiMeleeControlBenchmarkDetails({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function runAiV4TrVsV3BenchmarkDetailsParallel(options: AiV4TrVsV3BenchmarkOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  const { input, selection } = createAiV4TrVsV3BenchmarkInput(options);
  const filtered = filterBenchmarkInput(input, filter);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(filtered), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiMeleeControlBenchmarkDetails({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function runAiV5VsHybridBenchmarkDetailsParallel(options: AiV5VsHybridBenchmarkOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  const { input, selection } = createAiV5VsHybridBenchmarkInput(options);
  const filtered = filterBenchmarkInput(input, filter);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(filtered), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiMeleeControlBenchmarkDetails({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export function summarizeAiCrossRaceBenchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiCrossRaceBenchmarkResult {
  const evaluation = input.report.evaluations[0];
  if (!evaluation) throw new Error("AI cross-race benchmark report must include a cross-race evaluation");
  const matchesByName = new Map(evaluation.matches.map((match) => [match.name, match]));
  const byMap = input.selectedMapIds.map((mapId) => {
    const north = matchesByName.get(`${mapId} ember north`);
    const south = matchesByName.get(`${mapId} ember south`);
    if (!north || !south) throw new Error(`Missing side-balanced cross-race matches for ${mapId}`);
    const northWinner = north.result.winner;
    const southWinner = south.result.winner;
    return {
      mapId,
      northWinner,
      southWinner,
      wins: (northWinner === "ember" ? 1 : 0) + (southWinner === "ember" ? 1 : 0),
    };
  });
  const emberWins = byMap.reduce((total, row) => total + row.wins, 0);
  const rawMatches = byMap.length * 2;
  return {
    seed: input.seed,
    selectedMapIds: [...input.selectedMapIds],
    emberWins,
    rawMatches,
    winRate: rawMatches > 0 ? emberWins / rawMatches : 0,
    elapsedMs: input.report.elapsedMs,
    cpuMs: input.report.cpuMs,
    ...(input.workers !== undefined ? { workers: input.workers } : {}),
    byMap,
  };
}

export function summarizeAiV3VsProdV2Benchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiV3VsProdV2BenchmarkResult {
  const evaluation = input.report.evaluations[0];
  if (!evaluation) throw new Error("AI V3 versus frozen production V2 benchmark report must include an evaluation");
  const matchesByName = new Map(evaluation.matches.map((match) => [match.name, match]));
  const byMap = input.selectedMapIds.map((mapId) => {
    const north = matchesByName.get(`${mapId} v3 north`);
    const south = matchesByName.get(`${mapId} v3 south`);
    if (!north || !south) throw new Error(`Missing side-balanced V3 versus frozen V2 matches for ${mapId}`);
    const northV3Race = v3RaceFromMatch(north);
    const southV3Race = v3RaceFromMatch(south);
    return {
      mapId,
      northWinner: north.result.winner,
      northV3Race,
      southWinner: south.result.winner,
      southV3Race,
      wins: (north.result.winner === "v3" ? 1 : 0) + (south.result.winner === "v3" ? 1 : 0),
    };
  });
  const matchRows = evaluation.matches.map((match) => ({ race: v3RaceFromMatch(match), matchup: `${v3RaceFromMatch(match)}-vs-grove`, won: match.result.winner === "v3" }));
  const v3Wins = matchRows.filter((row) => row.won).length;
  const rawMatches = matchRows.length;
  return {
    seed: input.seed,
    selectedMapIds: [...input.selectedMapIds],
    v3Wins,
    rawMatches,
    winRate: rawMatches > 0 ? v3Wins / rawMatches : 0,
    elapsedMs: input.report.elapsedMs,
    cpuMs: input.report.cpuMs,
    ...(input.workers !== undefined ? { workers: input.workers } : {}),
    frozenBaselineRevision: FROZEN_PROD_V2_REVISION,
    byV3Race: {
      grove: summarizeV3Rows(matchRows.filter((row) => row.race === "grove")),
      ember: summarizeV3Rows(matchRows.filter((row) => row.race === "ember")),
    },
    byMatchup: Object.fromEntries([...new Set(matchRows.map((row) => row.matchup))].map((matchup) => [matchup, summarizeV3Rows(matchRows.filter((row) => row.matchup === matchup))])),
    byMap,
  };
}

export function summarizeAiV4TrVsV3Benchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiV4TrVsV3BenchmarkResult {
  const evaluation = input.report.evaluations[0];
  if (!evaluation) throw new Error("AI V4-TR versus V3 benchmark report must include an evaluation");
  const matchesByName = new Map(evaluation.matches.map((match) => [match.name, match]));
  const byMap = input.selectedMapIds.map((mapId) => {
    const north = matchesByName.get(`${mapId} v4-tr north`);
    const south = matchesByName.get(`${mapId} v4-tr south`);
    if (!north || !south) throw new Error(`Missing side-balanced V4-TR versus V3 matches for ${mapId}`);
    const northV3Race = v3RaceFromMatch(north);
    const southV3Race = v3RaceFromMatch(south);
    return {
      mapId,
      northWinner: north.result.winner,
      northV3Race,
      southWinner: south.result.winner,
      southV3Race,
      wins: (north.result.winner === "v4-tr" ? 1 : 0) + (south.result.winner === "v4-tr" ? 1 : 0),
    };
  });
  const matchRows = evaluation.matches.map((match) => ({ race: v3RaceFromMatch(match), won: match.result.winner === "v4-tr" }));
  const v4TrWins = matchRows.filter((row) => row.won).length;
  const rawMatches = matchRows.length;
  return {
    seed: input.seed,
    selectedMapIds: [...input.selectedMapIds],
    v4TrWins,
    rawMatches,
    winRate: rawMatches > 0 ? v4TrWins / rawMatches : 0,
    elapsedMs: input.report.elapsedMs,
    cpuMs: input.report.cpuMs,
    ...(input.workers !== undefined ? { workers: input.workers } : {}),
    byV3Race: {
      grove: summarizeV3Rows(matchRows.filter((row) => row.race === "grove")),
      ember: summarizeV3Rows(matchRows.filter((row) => row.race === "ember")),
    },
    byMap,
  };
}

export function summarizeAiV5VsHybridBenchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiV5VsHybridBenchmarkResult {
  const evaluation = input.report.evaluations[0];
  if (!evaluation) throw new Error("AI V5 versus hybrid V3 plus V4-TR benchmark report must include an evaluation");
  const matchesByName = new Map(evaluation.matches.map((match) => [match.name, match]));
  const byMap = input.selectedMapIds.map((mapId) => {
    const north = matchesByName.get(`${mapId} v5 north`);
    const south = matchesByName.get(`${mapId} v5 south`);
    if (!north || !south) throw new Error(`Missing side-balanced V5 versus hybrid matches for ${mapId}`);
    return {
      mapId,
      northWinner: north.result.winner,
      northV5Race: v5RaceFromMatch(north),
      northV3Race: v3RaceFromMatch(north),
      southWinner: south.result.winner,
      southV5Race: v5RaceFromMatch(south),
      southV3Race: v3RaceFromMatch(south),
      wins: (north.result.winner === "v5" ? 1 : 0) + (south.result.winner === "v5" ? 1 : 0),
    };
  });
  const matchRows = evaluation.matches.map((match) => ({ v5Race: v5RaceFromMatch(match), v3Race: v3RaceFromMatch(match), opponentOrder: opponentOrderFromMatch(match), won: match.result.winner === "v5" }));
  const v5Wins = matchRows.filter((row) => row.won).length;
  const rawMatches = matchRows.length;
  return {
    seed: input.seed,
    selectedMapIds: [...input.selectedMapIds],
    v5Wins,
    rawMatches,
    winRate: rawMatches > 0 ? v5Wins / rawMatches : 0,
    elapsedMs: input.report.elapsedMs,
    cpuMs: input.report.cpuMs,
    ...(input.workers !== undefined ? { workers: input.workers } : {}),
    byV5Race: {
      grove: summarizeV3Rows(matchRows.filter((row) => row.v5Race === "grove")),
      ember: summarizeV3Rows(matchRows.filter((row) => row.v5Race === "ember")),
    },
    byV3Race: {
      grove: summarizeV3Rows(matchRows.filter((row) => row.v3Race === "grove")),
      ember: summarizeV3Rows(matchRows.filter((row) => row.v3Race === "ember")),
    },
    byOpponentOrder: Object.fromEntries([...new Set(matchRows.map((row) => row.opponentOrder))].sort().map((order) => [order, summarizeV3Rows(matchRows.filter((row) => row.opponentOrder === order))])),
    byMap,
  };
}

function createAiCrossRaceMatches(mapId: MapId, options: Pick<AiVersionBenchmarkOptions, "controller" | "maxTicks" | "thinkInterval"> = {}) {
  const controller = options.controller ?? "external-agent";
  const maxTicks = options.maxTicks ?? 48_000;
  const thinkInterval = options.thinkInterval ?? DEFAULT_AI_THINK_INTERVAL;
  const match = (name: string, teams: { ember: string; grove: string }): BenchmarkMatchInput<AiGameAgent> => ({
    name,
    mapId,
    agents: {
      ember: { controller, team: teams.ember, race: "ember", version: "v2", versionLabel: "v2 ember" },
      grove: { controller, team: teams.grove, race: "grove", version: "v2", versionLabel: "v2 grove" },
    },
    commandPlanner: createAiGameCommandPlanner(),
    maxTicks,
    thinkInterval,
  });
  return [match(`${mapId} ember north`, { ember: "north", grove: "south" }), match(`${mapId} ember south`, { ember: "south", grove: "north" })];
}

function createAiV3VsProdV2Matches(mapId: MapId, index: number, options: Pick<AiVersionBenchmarkOptions, "controller" | "maxTicks" | "thinkInterval"> & { seed: string }) {
  const controller = options.controller ?? "external-agent";
  const maxTicks = options.maxTicks ?? 48_000;
  const thinkInterval = options.thinkInterval ?? DEFAULT_AI_THINK_INTERVAL;
  const match = (name: string, v3Team: string, prodTeam: string, sideIndex: number): BenchmarkMatchInput<AiGameAgent> => {
    const v3Race = v3RaceForMatch(options.seed, mapId, index, sideIndex);
    return {
      name,
      mapId,
      agents: {
        v3: { controller, team: v3Team, race: v3Race, version: "v3", policyVersion: v3Race === "ember" ? "v3-ember" : "v3-grove", versionLabel: `v3 ${v3Race}` },
        "v2-prod": { controller, team: prodTeam, race: "grove", version: "v2-prod", policyVersion: "v2-prod", versionLabel: "v2-prod grove" },
      },
      commandPlanner: createAiGameCommandPlanner(),
      maxTicks,
      thinkInterval,
    };
  };
  return [match(`${mapId} v3 north`, "north", "south", 0), match(`${mapId} v3 south`, "south", "north", 1)];
}

function createAiV4TrVsV3Matches(mapId: MapId, index: number, options: Pick<AiVersionBenchmarkOptions, "controller" | "maxTicks" | "thinkInterval"> & { seed: string }) {
  const controller = options.controller ?? "external-agent";
  const maxTicks = options.maxTicks ?? 48_000;
  const thinkInterval = options.thinkInterval ?? DEFAULT_AI_THINK_INTERVAL;
  const match = (name: string, v4Team: string, v3Team: string, sideIndex: number): BenchmarkMatchInput<AiGameAgent> => {
    const v3Race = v3RaceForMatch(options.seed, mapId, index, sideIndex);
    return {
      name,
      mapId,
      agents: {
        "v4-tr": { controller, team: v4Team, race: "grove", version: "v4-tr", policyVersion: "v4-tr", versionLabel: "v4-tr" },
        v3: { controller, team: v3Team, race: v3Race, version: "v3", policyVersion: v3Race === "ember" ? "v3-ember" : "v3-grove", versionLabel: `v3 ${v3Race}` },
      },
      commandPlanner: createAiGameCommandPlanner(),
      maxTicks,
      thinkInterval,
    };
  };
  return [match(`${mapId} v4-tr north`, "north", "south", 0), match(`${mapId} v4-tr south`, "south", "north", 1)];
}

function createAiV5VsHybridMatches(mapId: MapId, index: number, options: Pick<AiVersionBenchmarkOptions, "controller" | "maxTicks" | "thinkInterval"> & { seed: string }) {
  const controller = options.controller ?? "external-agent";
  const maxTicks = options.maxTicks ?? 48_000;
  const thinkInterval = options.thinkInterval ?? DEFAULT_AI_THINK_INTERVAL;
  const match = (name: string, v5Team: string, opponentTeam: string, sideIndex: number): BenchmarkMatchInput<AiGameAgent> => {
    const v5Race = v5RaceForMatch(options.seed, mapId, index, sideIndex);
    const v3Race = v3RaceForMatch(options.seed, mapId, index, sideIndex);
    const v5Agent: AiGameAgent & { policyVersion: string } = { controller, team: v5Team, race: v5Race, version: "v5", policyVersion: "v5", versionLabel: `v5 ${v5Race}` };
    const v3Agent: AiGameAgent & { policyVersion: string } = {
      controller,
      team: opponentTeam,
      race: v3Race,
      version: "v3",
      policyVersion: v3Race === "ember" ? "v3-ember" : "v3-grove",
      versionLabel: `v3 ${v3Race}`,
    };
    const v4TrAgent: AiGameAgent & { policyVersion: string } = { controller, team: opponentTeam, race: "grove", version: "v4-tr", policyVersion: "v4-tr", versionLabel: "v4-tr" };
    const opponentAgents = v4TrBeforeV3ForMatch(options.seed, mapId, index, sideIndex) ? { "v4-tr": v4TrAgent, v3: v3Agent } : { v3: v3Agent, "v4-tr": v4TrAgent };
    return {
      name,
      mapId,
      agents: {
        v5: v5Agent,
        ...opponentAgents,
      },
      commandPlanner: createAiGameCommandPlanner(),
      maxTicks,
      thinkInterval,
    };
  };
  return [match(`${mapId} v5 north`, "north", "south", 0), match(`${mapId} v5 south`, "south", "north", 1)];
}

function v3RaceForMatch(seed: string, mapId: string, mapIndex: number, sideIndex: number): RaceId {
  return hashString(`${seed}:${mapId}:${mapIndex}:${sideIndex}`) % 2 === 0 ? "grove" : "ember";
}

function v5RaceForMatch(seed: string, mapId: string, mapIndex: number, sideIndex: number): RaceId {
  return hashCoin(`v5:${seed}:${mapId}:${mapIndex}:${sideIndex}`) ? "grove" : "ember";
}

function v4TrBeforeV3ForMatch(seed: string, mapId: string, mapIndex: number, sideIndex: number): boolean {
  return hashCoin(`v5-opponents:${seed}:${mapId}:${mapIndex}:${sideIndex}`);
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashCoin(value: string) {
  const hash = hashString(value);
  // @@@hash-coin - Race sampling must not use only FNV's lowest bit, because fixed string prefixes can deterministically flip it.
  return ((hash ^ (hash >>> 16)) & 1) === 0;
}

function v3RaceFromMatch(match: BenchmarkMatchReport): RaceId {
  const race = match.result.players.v3?.race;
  return race === "ember" ? "ember" : "grove";
}

function v5RaceFromMatch(match: BenchmarkMatchReport): RaceId {
  const race = match.result.players.v5?.race;
  return race === "ember" ? "ember" : "grove";
}

function opponentOrderFromMatch(match: BenchmarkMatchReport) {
  const order = Object.keys(match.setup.players).filter((owner) => owner === "v3" || owner === "v4-tr");
  if (order.length !== 2) throw new Error(`V5 hybrid match ${match.name} must include v3 and v4-tr opponents`);
  return order.join(",");
}

function summarizeV3Rows(rows: { won: boolean }[]): AiV3RaceBreakdown {
  const wins = rows.filter((row) => row.won).length;
  return { wins, matches: rows.length, winRate: rows.length > 0 ? wins / rows.length : 0 };
}

export function summarizeAiMeleeControlBenchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiMeleeControlBenchmarkResult {
  const evaluation = input.report.evaluations[0];
  if (!evaluation) throw new Error("AI melee control benchmark report must include a control evaluation");
  const matchesByName = new Map(evaluation.matches.map((match) => [match.name, match]));
  const byMap = input.selectedMapIds.map((mapId): AiMeleeControlMapResult => {
    const north = matchesByName.get(`${mapId} 1v1 control north`);
    const south = matchesByName.get(`${mapId} 1v1 control south`);
    if (!north || !south) throw new Error(`Missing side-balanced control matches for ${mapId}`);
    const northWinner = north.result.winner;
    const southWinner = south.result.winner;
    return {
      mapId,
      northWinner,
      southWinner,
      wins: (northWinner === "v2" ? 1 : 0) + (southWinner === "v2" ? 1 : 0),
    };
  });
  const rawWins = byMap.reduce((total, row) => total + row.wins, 0);
  return {
    seed: input.seed,
    selectedMapIds: [...input.selectedMapIds],
    rawWins,
    rawMatches: byMap.length * 2,
    bothSideMapWins: byMap.filter((row) => row.wins === 2).length,
    split: byMap.filter((row) => row.wins === 1).length,
    bothSideLosses: byMap.filter((row) => row.wins === 0).length,
    elapsedMs: input.report.elapsedMs,
    cpuMs: input.report.cpuMs,
    ...(input.workers !== undefined ? { workers: input.workers } : {}),
    byMap,
  };
}

export function filterAiMeleeControlBenchmarkInput(input: BenchmarkInput<AiGameAgent>, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): BenchmarkInput<AiGameAgent> {
  return filterBenchmarkInput(input, filter);
}

export function filterBenchmarkInput<TAgent extends AiGameAgent>(input: BenchmarkInput<TAgent>, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): BenchmarkInput<TAgent> {
  const mapIds = filter.mapIds ? new Set(filter.mapIds) : undefined;
  const matchNames = filter.matchNames ? new Set(filter.matchNames) : undefined;
  if (!mapIds && !matchNames) return input;
  return {
    ...input,
    evaluations: input.evaluations.map((evaluation) => ({
      ...evaluation,
      matches: evaluation.matches.filter((match) => {
        const mapMatches = !mapIds || (match.mapId !== undefined && mapIds.has(match.mapId));
        const nameMatches = !matchNames || matchNames.has(match.name);
        return mapMatches && nameMatches;
      }),
    })),
  };
}

export function summarizeAiMeleeControlBenchmarkDetails(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiMeleeControlMatchDetailsResult {
  const matches = input.report.evaluations.flatMap((evaluation) => evaluation.matches).map(controlMatchDetail);
  return {
    seed: input.seed,
    selectedMapIds: [...input.selectedMapIds],
    matchCount: matches.length,
    elapsedMs: input.report.elapsedMs,
    cpuMs: input.report.cpuMs,
    ...(input.workers !== undefined ? { workers: input.workers } : {}),
    matches,
  };
}

function controlMatchDetail(match: BenchmarkMatchReport): AiMeleeControlMatchDetail {
  const mapId = match.setup.map.id;
  return {
    name: match.name,
    mapId,
    winner: match.result.winner,
    winnerTeam: match.result.winnerTeam,
    gameSecond: match.result.gameSecond,
    timeout: match.result.timeout,
    players: Object.fromEntries(Object.entries(match.result.players).map(([owner, player]) => [owner, { ...player }])) as Record<PlayerId, AiMeleeControlPlayerDetail>,
    ...(match.result.trackers.aiCommandStats ? { aiCommandStats: match.result.trackers.aiCommandStats as AiCommandStats } : {}),
    ...(match.result.trackers.woundedMoonWellStats ? { woundedMoonWellStats: match.result.trackers.woundedMoonWellStats as WoundedMoonWellStats } : {}),
    ...(match.result.trackers.armyBalanceStats ? { armyBalanceStats: match.result.trackers.armyBalanceStats as ArmyBalanceStats } : {}),
    ...(match.result.trackers.expansionClaimTimeline ? { expansionClaimTimeline: match.result.trackers.expansionClaimTimeline as ExpansionClaimTimelineStats } : {}),
  };
}
