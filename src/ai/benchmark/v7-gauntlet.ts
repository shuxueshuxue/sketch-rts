import { RICH_SCORE_MAP_IDS } from "../../shared/map";
import type { MapId, RaceId } from "../../shared/types";
import type { BenchmarkInput, BenchmarkMatchInput, BenchmarkMatchReport, BenchmarkReport } from "../../sdk/benchmark/core";
import { runBenchmarkParallel } from "../../sdk/benchmark/parallel";
import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";
import { SHOOTER_UNIT_KINDS } from "../policy/versions";
import { DEFAULT_AI_THINK_INTERVAL } from "../runtime";
import { filterBenchmarkInput, hashCoin, summarizeAiMeleeControlBenchmarkDetails, type AiMeleeControlMatchDetailsResult } from "./control";
import { selectGauntletRichScoreMaps, serializableAiBenchmarkInput, type AiVersionBenchmarkOptions, type GauntletMapSelection } from "./presets";
import type { AiCommandStats } from "./command-stats";
import type { UnitRosterStats } from "./unit-roster-stats";
import type { V6DoctrineStats } from "./v6-doctrine-stats";

// @@@v7-gauntlet - V7 alone against a pair drawn from V5+V6, V3+V6 and V3+V5, on the rich score maps. Every map is played
// twice, once with V7 as each race, against different pairs; which side of the map V7 starts on is drawn per game.
// The opponents play under neutral ids (p1, p2), shuffled per game, so nothing on the board (owners, unit and building
// ids, team keys) names their version: V7 has to read what it faces from what their armies do. The report maps the ids
// back through each player's version label, which only the benchmark sees.

export type AiV7GauntletBenchmarkOptions = Pick<AiVersionBenchmarkOptions, "seed" | "mapCount" | "full" | "maxTicks" | "thinkInterval" | "controller" | "workers">;

export type AiV7GauntletBenchmarkInput = {
  input: BenchmarkInput<AiGameAgent>;
  selection: GauntletMapSelection<MapId>;
};

type OpponentVersion = "v3" | "v5" | "v6";
type Tally = { wins: number; matches: number; winRate: number };

export const V7_OPPONENT_PAIRS: readonly (readonly [OpponentVersion, OpponentVersion])[] = [
  ["v5", "v6"],
  ["v3", "v6"],
  ["v3", "v5"],
];
const V7_RACES: readonly RaceId[] = ["grove", "ember"];

export type AiV7GauntletBenchmarkResult = {
  seed: string;
  selectedMapIds: string[];
  v7Wins: number;
  rawMatches: number;
  winRate: number;
  lossesTo: { v3: number; v5: number; v6: number; timeout: number };
  byPair: Record<string, Tally>;
  byV7Race: Record<RaceId, Tally>;
  byStrategy: Record<string, Tally>;
  plays: Record<string, { won: number; lost: number }>;
  // Games in which V7 trained, hired or fielded a shooter (allowed; counted to see the style it plays).
  shooterGames: number;
  elapsedMs: number;
  cpuMs: number;
  workers?: number;
  byMap: { mapId: string; grove: { pair: string; winner: string | null }; ember: { pair: string; winner: string | null }; wins: number }[];
};

export function createAiV7GauntletBenchmarkInput(options: AiV7GauntletBenchmarkOptions = {}): AiV7GauntletBenchmarkInput {
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], {
    ...(options.seed !== undefined ? { AI_GAUNTLET_SEED: options.seed } : {}),
    ...(options.mapCount !== undefined ? { AI_GAUNTLET_MAP_COUNT: String(options.mapCount) } : {}),
    ...(options.full ? { AI_GAUNTLET_FULL: "1" } : {}),
  });
  return {
    selection,
    input: {
      name: "AI V7 vs pairs of V3, V5 and V6 Benchmark",
      evaluations: [
        {
          name: "v7 1v2 vs pairs of v3, v5, v6",
          tag: "melee",
          matches: selection.mapIds.flatMap((mapId, index) => createAiV7GauntletMatches(mapId, index, { ...options, seed: selection.seed })),
        },
      ],
    },
  };
}

function createAiV7GauntletMatches(mapId: MapId, index: number, options: AiV7GauntletBenchmarkOptions & { seed: string }): BenchmarkMatchInput<AiGameAgent>[] {
  const controller = options.controller ?? "external-agent";
  // The map's two games face different pairs; over the maps every pair meets both of V7's races equally often.
  const pairOffset = hashIndex(`v7-pair:${options.seed}:${mapId}:${index}`, V7_OPPONENT_PAIRS.length);
  return V7_RACES.map((v7Race, raceIndex) => {
    const key = `${options.seed}:${mapId}:${index}:${v7Race}`;
    const pair = V7_OPPONENT_PAIRS[(pairOffset + raceIndex) % V7_OPPONENT_PAIRS.length]!;
    const [first, second] = hashCoin(`v7-ids:${key}`) ? pair : [pair[1], pair[0]];
    const v7FirstSide = hashCoin(`v7-side:${key}`);
    const v7: AiGameAgent = { controller, team: "v7-side", race: v7Race, version: "v7", policyVersion: "v7", versionLabel: `v7 ${v7Race}` };
    const p1 = opponent(first, "rivals", `v7-p1:${key}`, controller);
    const p2 = opponent(second, "rivals", `v7-p2:${key}`, controller);
    return {
      name: `${mapId} v7 ${v7Race}`,
      mapId,
      agents: v7FirstSide ? { v7, p1, p2 } : { p1, p2, v7 },
      commandPlanner: createAiGameCommandPlanner(),
      maxTicks: options.maxTicks ?? 48_000,
      thinkInterval: options.thinkInterval ?? DEFAULT_AI_THINK_INTERVAL,
    };
  });
}

function opponent(version: OpponentVersion, team: string, raceKey: string, controller: NonNullable<AiGameAgent["controller"]>): AiGameAgent {
  const race: RaceId = hashCoin(raceKey) ? "grove" : "ember";
  const policyVersion = version === "v3" ? (race === "ember" ? "v3-ember" : "v3-grove") : version;
  return { controller, team, race, version, policyVersion, versionLabel: `${version} ${race}` };
}

function hashIndex(value: string, size: number) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash ^ (hash >>> 16)) >>> 0) % size;
}

export async function runAiV7GauntletBenchmarkParallel(options: AiV7GauntletBenchmarkOptions = {}): Promise<AiV7GauntletBenchmarkResult> {
  const { input, selection } = createAiV7GauntletBenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiV7GauntletBenchmark({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

export async function runAiV7GauntletBenchmarkDetailsParallel(options: AiV7GauntletBenchmarkOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  const { input, selection } = createAiV7GauntletBenchmarkInput(options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(filterBenchmarkInput(input, filter)), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeAiMeleeControlBenchmarkDetails({ seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

// The version behind a player id, from the label only the benchmark sees ("v6 grove" -> "v6").
function versionOf(match: BenchmarkMatchReport, owner: string | null): string | null {
  if (owner === null) return null;
  return match.result.players[owner]?.aiVersion.split(" ")[0] ?? null;
}

function pairOf(match: BenchmarkMatchReport): string {
  return Object.keys(match.result.players)
    .filter((owner) => owner !== "v7")
    .map((owner) => versionOf(match, owner))
    .sort()
    .join("+");
}

export function summarizeAiV7GauntletBenchmark(input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): AiV7GauntletBenchmarkResult {
  const evaluation = input.report.evaluations[0];
  if (!evaluation) throw new Error("AI V7 gauntlet report must include an evaluation");
  const byName = new Map(evaluation.matches.map((match) => [match.name, match]));
  const rows = evaluation.matches.map((match) => ({
    match,
    won: match.result.winner === "v7",
    winner: versionOf(match, match.result.winner),
    pair: pairOf(match),
    race: (match.result.players.v7?.race === "ember" ? "ember" : "grove") as RaceId,
  }));
  const tally = (subset: typeof rows): Tally => {
    const wins = subset.filter((row) => row.won).length;
    return { wins, matches: subset.length, winRate: subset.length > 0 ? wins / subset.length : 0 };
  };
  const v7Wins = rows.filter((row) => row.won).length;
  return {
    seed: input.seed,
    selectedMapIds: [...input.selectedMapIds],
    v7Wins,
    rawMatches: rows.length,
    winRate: rows.length > 0 ? v7Wins / rows.length : 0,
    lossesTo: {
      v3: rows.filter((row) => row.winner === "v3").length,
      v5: rows.filter((row) => row.winner === "v5").length,
      v6: rows.filter((row) => row.winner === "v6").length,
      timeout: rows.filter((row) => !row.won && row.winner === null).length,
    },
    byPair: Object.fromEntries(V7_OPPONENT_PAIRS.map((pair) => [...pair].sort().join("+")).map((pair) => [pair, tally(rows.filter((row) => row.pair === pair))])),
    byV7Race: { grove: tally(rows.filter((row) => row.race === "grove")), ember: tally(rows.filter((row) => row.race === "ember")) },
    byStrategy: tallyByStrategy(rows.map((row) => row.match)),
    plays: v7Plays(evaluation.matches),
    shooterGames: evaluation.matches.filter(v7FieldedShooter).length,
    elapsedMs: input.report.elapsedMs,
    cpuMs: input.report.cpuMs,
    ...(input.workers !== undefined ? { workers: input.workers } : {}),
    byMap: input.selectedMapIds.map((mapId) => {
      const grove = byName.get(`${mapId} v7 grove`);
      const ember = byName.get(`${mapId} v7 ember`);
      if (!grove || !ember) throw new Error(`Missing V7 matches for ${mapId}`);
      return {
        mapId,
        grove: { pair: pairOf(grove), winner: versionOf(grove, grove.result.winner) },
        ember: { pair: pairOf(ember), winner: versionOf(ember, ember.result.winner) },
        wins: Number(grove.result.winner === "v7") + Number(ember.result.winner === "v7"),
      };
    }),
  };
}

function v7Plays(matches: BenchmarkMatchReport[]) {
  const plays: Record<string, { won: number; lost: number }> = {};
  for (const match of matches) {
    const scripts = (match.result.trackers.aiCommandStats as AiCommandStats | undefined)?.owners.v7?.scripts ?? {};
    for (const [scriptId, stats] of Object.entries(scripts)) {
      if (!(scriptId.startsWith("v6") || scriptId.startsWith("v7")) || stats.commands === 0) continue;
      const tally = (plays[scriptId] ??= { won: 0, lost: 0 });
      if (match.result.winner === "v7") tally.won += 1;
      else tally.lost += 1;
    }
  }
  return plays;
}

function tallyByStrategy(matches: BenchmarkMatchReport[]): Record<string, Tally> {
  const groups: Record<string, Tally> = {};
  for (const match of matches) {
    const doctrine = match.result.trackers.v7Doctrine as V6DoctrineStats | undefined;
    if (!doctrine) continue;
    const tally = (groups[doctrine.strategyId] ??= { wins: 0, matches: 0, winRate: 0 });
    tally.matches += 1;
    if (match.result.winner === "v7") tally.wins += 1;
    tally.winRate = tally.wins / tally.matches;
  }
  return groups;
}

function v7FieldedShooter(match: BenchmarkMatchReport) {
  const roster = (match.result.trackers.unitRosterStats as UnitRosterStats | undefined)?.owners.v7;
  if (!roster) return false;
  return [...SHOOTER_UNIT_KINDS].some((kind) => (roster.orderedByKind[kind] ?? 0) > 0 || (roster.peakByKind[kind] ?? 0) > 0);
}
