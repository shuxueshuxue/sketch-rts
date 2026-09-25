import { RICH_SCORE_MAP_IDS } from "../../shared/map";
import type { MapId, RaceId } from "../../shared/types";
import type { BenchmarkInput, BenchmarkMatchInput, BenchmarkMatchReport, BenchmarkReport } from "../../sdk/benchmark/core";
import { runBenchmarkParallel } from "../../sdk/benchmark/parallel";
import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";
import { SHOOTER_UNIT_KINDS } from "../policy/versions";
import { DEFAULT_AI_THINK_INTERVAL } from "../runtime";
import { filterBenchmarkInput, hashCoin, summarizeAiMeleeControlBenchmarkDetails, v3RaceForMatch, type AiMeleeControlMatchDetailsResult } from "./control";
import { selectGauntletRichScoreMaps, serializableAiBenchmarkInput, type AiVersionBenchmarkOptions, type GauntletMapSelection } from "./presets";
import type { UnitRosterStats } from "./unit-roster-stats";

// @@@v6-gauntlet - V6 alone against V3 and the shooter V5 on one team, side-balanced on the rich score maps. V6 may never
// train or hire a shooter (archer, spark archer, contract archer); every game is checked for it.

export type AiV6GauntletBenchmarkOptions = Pick<AiVersionBenchmarkOptions, "seed" | "mapCount" | "full" | "maxTicks" | "thinkInterval" | "controller" | "workers">;

export type AiV6GauntletBenchmarkInput = {
  input: BenchmarkInput<AiGameAgent>;
  selection: GauntletMapSelection<MapId>;
};

type Tally = { wins: number; matches: number; winRate: number };

export type AiV6GauntletBenchmarkResult = {
  seed: string;
  selectedMapIds: string[];
  v6Wins: number;
  rawMatches: number;
  winRate: number;
  lossesTo: { v3: number; v5: number; timeout: number };
  shooterViolations: string[];
  elapsedMs: number;
  cpuMs: number;
  workers?: number;
  byV6Race: Record<RaceId, Tally>;
  byV5Race: Record<RaceId, Tally>;
  byV3Race: Record<RaceId, Tally>;
  byMap: { mapId: string; northWinner: string | null; southWinner: string | null; wins: number }[];
};

export function createAiV6GauntletBenchmarkInput(options: AiV6GauntletBenchmarkOptions = {}): AiV6GauntletBenchmarkInput {
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], {
    ...(options.seed !== undefined ? { AI_GAUNTLET_SEED: options.seed } : {}),
    ...(options.mapCount !== undefined ? { AI_GAUNTLET_MAP_COUNT: String(options.mapCount) } : {}),
    ...(options.full ? { AI_GAUNTLET_FULL: "1" } : {}),
  });
  return {
    selection,
    input: {
      name: "AI V6 vs V3 plus V5 Benchmark",
      evaluations: [
        {
          name: "v6 1v2 vs v3 plus v5",
          tag: "melee",
          matches: selection.mapIds.flatMap((mapId, index) => createAiV6GauntletMatches(mapId, index, { ...options, seed: selection.seed })),
        },
      ],
    },
  };
}

function createAiV6GauntletMatches(mapId: MapId, index: number, options: AiV6GauntletBenchmarkOptions & { seed: string }): BenchmarkMatchInput<AiGameAgent>[] {
  const controller = options.controller ?? "external-agent";
  const match = (name: string, v6Team: string, opponentTeam: string, sideIndex: number): BenchmarkMatchInput<AiGameAgent> => {
    const key = `${options.seed}:${mapId}:${index}:${sideIndex}`;
    const v6Race: RaceId = hashCoin(`v6:${key}`) ? "grove" : "ember";
    const v5Race: RaceId = hashCoin(`v6-ally-v5:${key}`) ? "grove" : "ember";
    const v3Race = v3RaceForMatch(options.seed, mapId, index, sideIndex);
    const v6: AiGameAgent = { controller, team: v6Team, race: v6Race, version: "v6", policyVersion: "v6", versionLabel: `v6 ${v6Race}` };
    const v3: AiGameAgent = { controller, team: opponentTeam, race: v3Race, version: "v3", policyVersion: v3Race === "ember" ? "v3-ember" : "v3-grove", versionLabel: `v3 ${v3Race}` };
    const v5: AiGameAgent = { controller, team: opponentTeam, race: v5Race, version: "v5", policyVersion: "v5", versionLabel: `v5 ${v5Race}` };
    return {
      name,
      mapId,
      agents: hashCoin(`v6-opponents:${key}`) ? { v6, v5, v3 } : { v6, v3, v5 },
      commandPlanner: createAiGameCommandPlanner(),
      maxTicks: options.maxTicks ?? 48_000,
      thinkInterval: options.thinkInterval ?? DEFAULT_AI_THINK_INTERVAL,
    };
  };
  return [match(`${mapId} v6 north`, "north", "south", 0), match(`${mapId} v6 south`, "south", "north", 1)];
}

export async function runAiV6GauntletBenchmarkParallel(options: AiV6GauntletBenchmarkOptions = {}): Promise<AiV6GauntletBenchmarkResult> {
  const { input, selection } = createAiV6GauntletBenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiV6GauntletBenchmark({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function runAiV6GauntletBenchmarkDetailsParallel(options: AiV6GauntletBenchmarkOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  const { input, selection } = createAiV6GauntletBenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(filterBenchmarkInput(input, filter)), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiMeleeControlBenchmarkDetails({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export function summarizeAiV6GauntletBenchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiV6GauntletBenchmarkResult {
  const evaluation = input.report.evaluations[0];
  if (!evaluation) throw new Error("AI V6 gauntlet report must include an evaluation");
  const byName = new Map(evaluation.matches.map((match) => [match.name, match]));
  const rows = evaluation.matches.map((match) => ({
    won: match.result.winner === "v6",
    winner: match.result.winner,
    v6Race: raceOf(match, "v6"),
    v5Race: raceOf(match, "v5"),
    v3Race: raceOf(match, "v3"),
  }));
  const v6Wins = rows.filter((row) => row.won).length;
  const tally = (subset: typeof rows): Tally => {
    const wins = subset.filter((row) => row.won).length;
    return { wins, matches: subset.length, winRate: subset.length > 0 ? wins / subset.length : 0 };
  };
  const byRace = (race: (row: (typeof rows)[number]) => RaceId) => ({ grove: tally(rows.filter((row) => race(row) === "grove")), ember: tally(rows.filter((row) => race(row) === "ember")) });
  return {
    seed: input.seed,
    selectedMapIds: [...input.selectedMapIds],
    v6Wins,
    rawMatches: rows.length,
    winRate: rows.length > 0 ? v6Wins / rows.length : 0,
    lossesTo: {
      v3: rows.filter((row) => row.winner === "v3").length,
      v5: rows.filter((row) => row.winner === "v5").length,
      timeout: rows.filter((row) => !row.won && row.winner !== "v3" && row.winner !== "v5").length,
    },
    shooterViolations: evaluation.matches.filter(v6FieldedShooter).map((match) => match.name),
    elapsedMs: input.report.elapsedMs,
    cpuMs: input.report.cpuMs,
    ...(input.workers !== undefined ? { workers: input.workers } : {}),
    byV6Race: byRace((row) => row.v6Race),
    byV5Race: byRace((row) => row.v5Race),
    byV3Race: byRace((row) => row.v3Race),
    byMap: input.selectedMapIds.map((mapId) => {
      const north = byName.get(`${mapId} v6 north`);
      const south = byName.get(`${mapId} v6 south`);
      if (!north || !south) throw new Error(`Missing side-balanced V6 matches for ${mapId}`);
      return { mapId, northWinner: north.result.winner, southWinner: south.result.winner, wins: Number(north.result.winner === "v6") + Number(south.result.winner === "v6") };
    }),
  };
}

function raceOf(match: BenchmarkMatchReport, owner: string): RaceId {
  return match.result.players[owner]?.race === "ember" ? "ember" : "grove";
}

function v6FieldedShooter(match: BenchmarkMatchReport) {
  const roster = (match.result.trackers.unitRosterStats as UnitRosterStats | undefined)?.owners.v6;
  if (!roster) throw new Error(`V6 match ${match.name} has no unit roster to check for shooters`);
  return [...SHOOTER_UNIT_KINDS].some((kind) => (roster.orderedByKind[kind] ?? 0) > 0 || (roster.peakByKind[kind] ?? 0) > 0);
}
