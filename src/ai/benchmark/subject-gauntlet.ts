import { RICH_SCORE_MAP_IDS } from "../../shared/map";
import type { MapId, RaceId, UnitKind } from "../../shared/types";
import type { BenchmarkInput, BenchmarkMatchInput, BenchmarkMatchReport, BenchmarkReport } from "../../sdk/benchmark/core";
import { runBenchmarkParallel } from "../../sdk/benchmark/parallel";
import { createAiGameCommandPlanner, type AiGameAgent } from "../game-runner";
import { DEFAULT_AI_THINK_INTERVAL } from "../runtime";
import { filterBenchmarkInput, hashCoin, summarizeAiMeleeControlBenchmarkDetails, type AiMeleeControlMatchDetailsResult } from "./control";
import { selectGauntletRichScoreMaps, serializableAiBenchmarkInput, type AiVersionBenchmarkOptions, type GauntletMapSelection } from "./presets";
import type { AiCommandStats } from "./command-stats";
import type { UnitRosterStats } from "./unit-roster-stats";
import type { V6DoctrineStats } from "./v6-doctrine-stats";

// @@@subject-gauntlet - One version (the subject) alone against a pair of others, on the rich score maps. Every map is
// played twice, once with the subject as each race, against different pairs; which side of the map it starts on is drawn
// per game. The opponents play under neutral ids (p1, p2), shuffled per game, so nothing on the board (owners, unit and
// building ids, team keys) names their version: the subject has to read what it faces from what their armies do. The
// report maps the ids back through each player's version label, which only the benchmark sees. V7's gauntlet and V8's
// are the same procedure with a different subject and pool; every draw is keyed by the subject's name, so a gauntlet's
// games never change when another subject is added.

export type SubjectVersion = "v7" | "v8";
export type OpponentVersion = "v3" | "v5" | "v6" | "v7";

export type SubjectGauntlet = {
  subject: SubjectVersion;
  pairs: readonly (readonly [OpponentVersion, OpponentVersion])[];
  // A tracker whose state names the strategy the subject drew (see v6-doctrine-stats).
  doctrineTracker: string;
  // Kinds whose fielding the report counts per game (shooters for V7, summoners for V8): allowed or not, it shows the style.
  watchedKinds: ReadonlySet<UnitKind>;
  // The benchmark's and its evaluation's names in reports.
  name: string;
  evaluationName: string;
};

export type SubjectGauntletOptions = Pick<AiVersionBenchmarkOptions, "seed" | "mapCount" | "full" | "maxTicks" | "thinkInterval" | "controller" | "workers">;

export type SubjectGauntletInput = {
  input: BenchmarkInput<AiGameAgent>;
  selection: GauntletMapSelection<MapId>;
};

type Tally = { wins: number; matches: number; winRate: number };

export type SubjectGauntletResult = {
  seed: string;
  selectedMapIds: string[];
  subject: SubjectVersion;
  wins: number;
  rawMatches: number;
  winRate: number;
  lossesTo: Record<string, number>;
  byPair: Record<string, Tally>;
  byRace: Record<RaceId, Tally>;
  byStrategy: Record<string, Tally>;
  plays: Record<string, { won: number; lost: number }>;
  // Games in which the subject trained, hired or fielded one of the watched kinds.
  watchedGames: number;
  elapsedMs: number;
  cpuMs: number;
  workers?: number;
  byMap: { mapId: string; grove: { pair: string; winner: string | null }; ember: { pair: string; winner: string | null }; wins: number }[];
};

const RACES: readonly RaceId[] = ["grove", "ember"];

export function createSubjectGauntletInput(gauntlet: SubjectGauntlet, options: SubjectGauntletOptions = {}): SubjectGauntletInput {
  const selection = selectGauntletRichScoreMaps([...RICH_SCORE_MAP_IDS], {
    ...(options.seed !== undefined ? { AI_GAUNTLET_SEED: options.seed } : {}),
    ...(options.mapCount !== undefined ? { AI_GAUNTLET_MAP_COUNT: String(options.mapCount) } : {}),
    ...(options.full ? { AI_GAUNTLET_FULL: "1" } : {}),
  });
  return {
    selection,
    input: {
      name: gauntlet.name,
      evaluations: [
        {
          name: gauntlet.evaluationName,
          tag: "melee",
          matches: selection.mapIds.flatMap((mapId, index) => createSubjectMatches(gauntlet, mapId, index, { ...options, seed: selection.seed })),
        },
      ],
    },
  };
}

function createSubjectMatches(gauntlet: SubjectGauntlet, mapId: MapId, index: number, options: SubjectGauntletOptions & { seed: string }): BenchmarkMatchInput<AiGameAgent>[] {
  const controller = options.controller ?? "external-agent";
  const subject = gauntlet.subject;
  // The map's two games face different pairs; over the maps every pair meets both of the subject's races equally often.
  const pairOffset = hashIndex(`${subject}-pair:${options.seed}:${mapId}:${index}`, gauntlet.pairs.length);
  return RACES.map((race, raceIndex) => {
    const key = `${options.seed}:${mapId}:${index}:${race}`;
    const pair = gauntlet.pairs[(pairOffset + raceIndex) % gauntlet.pairs.length]!;
    const [first, second] = hashCoin(`${subject}-ids:${key}`) ? pair : [pair[1], pair[0]];
    const subjectFirstSide = hashCoin(`${subject}-side:${key}`);
    const self: AiGameAgent = { controller, team: `${subject}-side`, race, version: subject, policyVersion: subject, versionLabel: `${subject} ${race}` };
    const p1 = opponent(first, "rivals", `${subject}-p1:${key}`, controller);
    const p2 = opponent(second, "rivals", `${subject}-p2:${key}`, controller);
    return {
      name: `${mapId} ${subject} ${race}`,
      mapId,
      agents: subjectFirstSide ? { [subject]: self, p1, p2 } : { p1, p2, [subject]: self },
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

export async function runSubjectGauntletParallel(gauntlet: SubjectGauntlet, options: SubjectGauntletOptions = {}): Promise<SubjectGauntletResult> {
  const { input, selection } = createSubjectGauntletInput(gauntlet, options);
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput(input), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  return summarizeSubjectGauntlet(gauntlet, { seed: selection.seed, selectedMapIds: selection.mapIds, report, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
}

// The whole pool of a several-seed run: its wall time, the games' CPU, how many games, how many workers.
export type SubjectGauntletPool = {
  seeds: string[];
  games: number;
  elapsedMs: number;
  cpuMs: number;
  workers?: number;
};

// @@@gauntlet-seed-pool - Several seeds' games in one worker pool. A seed alone pays the pool's start-up and then waits
// on its slowest games with most workers idle; pooled, the workers stay busy until the last seed's games run out. A game
// is the same input as in its own seed's run, and nothing a game reads survives it in a worker, so each seed's result is
// the one its own run gives, apart from the timings: a seed's elapsedMs is its longest game, and the pool's wall is
// reported apart.
export async function runSubjectGauntletSeedsParallel(
  gauntlet: SubjectGauntlet,
  options: SubjectGauntletOptions,
  seeds: readonly string[],
): Promise<{ results: SubjectGauntletResult[]; pool: SubjectGauntletPool }> {
  const bundles = seeds.map((seed) => createSubjectGauntletInput(gauntlet, { ...options, seed }));
  const report = await runBenchmarkParallel(serializableAiBenchmarkInput({ name: gauntlet.name, evaluations: bundles.map((bundle) => bundle.input.evaluations[0]!) }), {
    workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
    ...(options.workers !== undefined ? { workers: options.workers } : {}),
  });
  const results = bundles.map((bundle, index) => {
    const evaluation = report.evaluations[index]!;
    const seedReport: BenchmarkReport = { ...report, evaluationCount: 1, matchCount: evaluation.matchCount, elapsedMs: evaluation.elapsedMs, cpuMs: evaluation.cpuMs, evaluations: [evaluation] };
    return summarizeSubjectGauntlet(gauntlet, { seed: bundle.selection.seed, selectedMapIds: bundle.selection.mapIds, report: seedReport, ...(options.workers !== undefined ? { workers: options.workers } : {}) });
  });
  return {
    results,
    pool: {
      seeds: bundles.map((bundle) => bundle.selection.seed),
      games: report.matchCount,
      elapsedMs: report.elapsedMs,
      cpuMs: report.cpuMs,
      ...(options.workers !== undefined ? { workers: options.workers } : {}),
    },
  };
}

export async function runSubjectGauntletDetailsParallel(gauntlet: SubjectGauntlet, options: SubjectGauntletOptions = {}, filter: { mapIds?: readonly string[]; matchNames?: readonly string[] } = {}): Promise<AiMeleeControlMatchDetailsResult> {
  const { input, selection } = createSubjectGauntletInput(gauntlet, options);
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

function pairOf(match: BenchmarkMatchReport, subject: SubjectVersion): string {
  return Object.keys(match.result.players)
    .filter((owner) => owner !== subject)
    .map((owner) => versionOf(match, owner))
    .sort()
    .join("+");
}

export function summarizeSubjectGauntlet(gauntlet: SubjectGauntlet, input: { seed: string; selectedMapIds: readonly string[]; report: BenchmarkReport; workers?: number }): SubjectGauntletResult {
  const subject = gauntlet.subject;
  const evaluation = input.report.evaluations[0];
  if (!evaluation) throw new Error(`AI ${subject} gauntlet report must include an evaluation`);
  const byName = new Map(evaluation.matches.map((match) => [match.name, match]));
  const rows = evaluation.matches.map((match) => ({
    match,
    won: match.result.winner === subject,
    winner: versionOf(match, match.result.winner),
    pair: pairOf(match, subject),
    race: (match.result.players[subject]?.race === "ember" ? "ember" : "grove") as RaceId,
  }));
  const tally = (subset: typeof rows): Tally => {
    const wins = subset.filter((row) => row.won).length;
    return { wins, matches: subset.length, winRate: subset.length > 0 ? wins / subset.length : 0 };
  };
  const wins = rows.filter((row) => row.won).length;
  const opponents = [...new Set(gauntlet.pairs.flat())].sort();
  return {
    seed: input.seed,
    selectedMapIds: [...input.selectedMapIds],
    subject,
    wins,
    rawMatches: rows.length,
    winRate: rows.length > 0 ? wins / rows.length : 0,
    lossesTo: { ...Object.fromEntries(opponents.map((version) => [version, rows.filter((row) => row.winner === version).length])), timeout: rows.filter((row) => !row.won && row.winner === null).length },
    byPair: Object.fromEntries(gauntlet.pairs.map((pair) => [...pair].sort().join("+")).map((pair) => [pair, tally(rows.filter((row) => row.pair === pair))])),
    byRace: { grove: tally(rows.filter((row) => row.race === "grove")), ember: tally(rows.filter((row) => row.race === "ember")) },
    byStrategy: tallyByStrategy(rows.map((row) => row.match), gauntlet),
    plays: subjectPlays(evaluation.matches, subject),
    watchedGames: evaluation.matches.filter((match) => fielded(match, subject, gauntlet.watchedKinds)).length,
    elapsedMs: input.report.elapsedMs,
    cpuMs: input.report.cpuMs,
    ...(input.workers !== undefined ? { workers: input.workers } : {}),
    byMap: input.selectedMapIds.map((mapId) => {
      const grove = byName.get(`${mapId} ${subject} grove`);
      const ember = byName.get(`${mapId} ${subject} ember`);
      if (!grove || !ember) throw new Error(`Missing ${subject} matches for ${mapId}`);
      return {
        mapId,
        grove: { pair: pairOf(grove, subject), winner: versionOf(grove, grove.result.winner) },
        ember: { pair: pairOf(ember, subject), winner: versionOf(ember, ember.result.winner) },
        wins: Number(grove.result.winner === subject) + Number(ember.result.winner === subject),
      };
    }),
  };
}

// Which of the subject's own scripts (V6's machinery and after) gave commands, in won and lost games.
function subjectPlays(matches: BenchmarkMatchReport[], subject: SubjectVersion) {
  const plays: Record<string, { won: number; lost: number }> = {};
  for (const match of matches) {
    const scripts = (match.result.trackers.aiCommandStats as AiCommandStats | undefined)?.owners[subject]?.scripts ?? {};
    for (const [scriptId, stats] of Object.entries(scripts)) {
      if (!/^v[6-9]/.test(scriptId) || stats.commands === 0) continue;
      const tally = (plays[scriptId] ??= { won: 0, lost: 0 });
      if (match.result.winner === subject) tally.won += 1;
      else tally.lost += 1;
    }
  }
  return plays;
}

function tallyByStrategy(matches: BenchmarkMatchReport[], gauntlet: SubjectGauntlet): Record<string, Tally> {
  const groups: Record<string, Tally> = {};
  for (const match of matches) {
    const doctrine = match.result.trackers[gauntlet.doctrineTracker] as V6DoctrineStats | undefined;
    if (!doctrine) continue;
    const tally = (groups[doctrine.strategyId] ??= { wins: 0, matches: 0, winRate: 0 });
    tally.matches += 1;
    if (match.result.winner === gauntlet.subject) tally.wins += 1;
    tally.winRate = tally.wins / tally.matches;
  }
  return groups;
}

function fielded(match: BenchmarkMatchReport, subject: SubjectVersion, kinds: ReadonlySet<UnitKind>) {
  const roster = (match.result.trackers.unitRosterStats as UnitRosterStats | undefined)?.owners[subject];
  if (!roster) return false;
  return [...kinds].some((kind) => (roster.orderedByKind[kind] ?? 0) > 0 || (roster.peakByKind[kind] ?? 0) > 0);
}
