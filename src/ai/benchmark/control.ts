import { RICH_SCORE_MAP_IDS } from "../../shared/map";
import type { MapId, PlayerId } from "../../shared/types";
import type { BenchmarkInput, BenchmarkMatchReport, BenchmarkReport } from "../../sdk/benchmark/core";
import { runBenchmark } from "../../sdk/benchmark/core";
import { runBenchmarkParallel } from "../../sdk/benchmark/parallel";
import type { ArmyBalanceStats } from "./army-balance-stats";
import type { AiCommandStats } from "./command-stats";
import type { ExpansionClaimTimelineStats } from "./expansion-claim-timeline";
import type { WoundedMoonWellStats } from "./wounded-moonwell-stats";
import type { AiGameAgent } from "../game-runner";
import { createAiMeleeControlMatches, selectGauntletRichScoreMaps, serializableAiBenchmarkInput, type AiVersionBenchmarkOptions, type GauntletMapSelection } from "./presets";

export type AiMeleeControlBenchmarkInput = {
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
  const filtered = filterAiMeleeControlBenchmarkInput(input, filter);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(filtered), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiMeleeControlBenchmarkDetails({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
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
