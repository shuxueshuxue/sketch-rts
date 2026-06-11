import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MapId, PlayerId } from "../../shared/types";
import type { BenchmarkEvaluationReport, BenchmarkReport } from "../../sdk/benchmark/core";
import type { AiVersionBenchmarkDashboardReport, AiVersionBenchmarkOptions, BenchmarkEvaluationSummary } from "./presets";
import { runAiVersionBenchmark, runAiVersionBenchmarkParallel, summarizeCombatEvaluation, summarizeMeleeControlEvaluation, summarizePairedScoreEvaluation } from "./presets";

export type BenchmarkDashboardRunKind = "ai-version-benchmark" | "ai-specialized-benchmark";

export type BenchmarkRaceSummary = {
  wins: number;
  losses: number;
  matches: number;
  winRate: number;
};

export type BenchmarkPlayerRaceSummaries = Record<PlayerId, Record<string, BenchmarkRaceSummary>>;

type BenchmarkDashboardRunBase = {
  id: string;
  kind: BenchmarkDashboardRunKind;
  createdAt: string;
  seed: string;
  mapPoolSize: number;
  selectedRichScoreMapIds: MapId[];
  mapCount: number;
  full: boolean;
  report: BenchmarkReport;
  primarySummary: BenchmarkEvaluationSummary;
  evaluationSummaries: BenchmarkEvaluationSummary[];
  scoreSummary?: BenchmarkEvaluationSummary;
  scoreControlSummary?: BenchmarkEvaluationSummary;
  probeSummaries?: BenchmarkEvaluationSummary[];
  combatSummaries?: BenchmarkEvaluationSummary[];
  playerRaceSummaries?: BenchmarkPlayerRaceSummaries;
};

export type AiVersionBenchmarkDashboardRun = AiVersionBenchmarkDashboardReport &
  BenchmarkDashboardRunBase & {
    kind: "ai-version-benchmark";
  };

export type SpecializedBenchmarkDashboardRun = BenchmarkDashboardRunBase & {
  kind: "ai-specialized-benchmark";
  targetPlayerId: PlayerId;
};

export type BenchmarkDashboardRun = AiVersionBenchmarkDashboardRun | SpecializedBenchmarkDashboardRun;

export type BenchmarkDashboardRunSummary = {
  id: string;
  kind: BenchmarkDashboardRun["kind"];
  createdAt: string;
  seed: string;
  name: string;
  tags: string[];
  mapPoolSize: number;
  selectedRichScoreMapIds: MapId[];
  primarySummary: BenchmarkEvaluationSummary;
  evaluationSummaries: BenchmarkEvaluationSummary[];
  scoreSummary?: BenchmarkEvaluationSummary;
  scoreControlSummary?: BenchmarkEvaluationSummary;
  probeSummaries?: BenchmarkEvaluationSummary[];
  combatSummaries?: BenchmarkEvaluationSummary[];
  playerRaceSummaries?: BenchmarkPlayerRaceSummaries;
  elapsedMs: number;
  cpuMs?: number;
  matchCount: number;
};

export type BenchmarkDashboardStoreOptions = {
  rootDir?: string;
  now?: () => Date;
};

export type BenchmarkDashboardRunPage = {
  runs: BenchmarkDashboardRunSummary[];
  page: number;
  pageSize: number;
  totalRuns: number;
  totalPages: number;
  tags: string[];
};

export type BenchmarkDashboardRunPageOptions = BenchmarkDashboardStoreOptions & {
  page?: number;
  pageSize?: number;
  tag?: string;
};

export type BenchmarkDashboardRunDetailPage = BenchmarkDashboardRun & {
  matchPage: number;
  matchPageSize: number;
  totalMatches: number;
  totalMatchPages: number;
};

export type BenchmarkDashboardRunDetailPageOptions = BenchmarkDashboardStoreOptions & {
  matchPage?: number;
  matchPageSize?: number;
  tag?: string;
};

const BENCHMARK_DASHBOARD_RUN_CONTRACT = "run-contract-v2";

export async function recordAiVersionBenchmarkDashboardRun(
  options: AiVersionBenchmarkOptions = {},
  storeOptions: BenchmarkDashboardStoreOptions = {},
): Promise<AiVersionBenchmarkDashboardRun> {
  const now = storeOptions.now?.() ?? new Date();
  const report = options.workers && options.workers > 1 ? await runAiVersionBenchmarkParallel(options) : runAiVersionBenchmark(options);
  const run = normalizeBenchmarkDashboardRun({
    ...report,
    id: runId(now, report.seed),
    kind: "ai-version-benchmark",
    createdAt: now.toISOString(),
    seed: report.seed,
    mapCount: report.selectedRichScoreMapIds.length,
    full: options.full === true,
  } as BenchmarkDashboardRun) as AiVersionBenchmarkDashboardRun;
  await writeBenchmarkDashboardRun(run, storeOptions);
  await writeBenchmarkDashboardRunLog(run, storeOptions);
  return run;
}

export async function recordBenchmarkDashboardReportRun(
  input: {
    kind: "ai-specialized-benchmark";
    seed: string;
    mapPoolSize: number;
    selectedRichScoreMapIds: MapId[];
    targetPlayerId: PlayerId;
    report: BenchmarkReport;
    full?: boolean;
  },
  storeOptions: BenchmarkDashboardStoreOptions = {},
): Promise<SpecializedBenchmarkDashboardRun> {
  const now = storeOptions.now?.() ?? new Date();
  const run = normalizeBenchmarkDashboardRun({
    id: runId(now, input.seed),
    kind: input.kind,
    createdAt: now.toISOString(),
    seed: input.seed,
    mapPoolSize: input.mapPoolSize,
    selectedRichScoreMapIds: input.selectedRichScoreMapIds,
    mapCount: input.selectedRichScoreMapIds.length,
    full: input.full === true,
    targetPlayerId: input.targetPlayerId,
    report: input.report,
  } as BenchmarkDashboardRun) as SpecializedBenchmarkDashboardRun;
  await writeBenchmarkDashboardRun(run, storeOptions);
  await writeBenchmarkDashboardRunLog(run, storeOptions);
  return run;
}

export async function writeBenchmarkDashboardRun(run: BenchmarkDashboardRun, options: BenchmarkDashboardStoreOptions = {}) {
  const dir = benchmarkDashboardRunsDir(options);
  await mkdir(dir, { recursive: true });
  await writeAtomic(path.join(dir, `${run.id}.json`), `${JSON.stringify(run, null, 2)}\n`);
}

export async function writeBenchmarkDashboardRunLog(run: BenchmarkDashboardRun, options: BenchmarkDashboardStoreOptions = {}) {
  const dir = benchmarkDashboardLogsDir(options);
  await mkdir(dir, { recursive: true });
  await writeAtomic(path.join(dir, `${run.id}.log`), benchmarkDashboardRunLog(run));
}

export async function listBenchmarkDashboardRuns(options: BenchmarkDashboardStoreOptions = {}): Promise<BenchmarkDashboardRunSummary[]> {
  const dir = benchmarkDashboardRunsDir(options);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  const runs = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => summarizeBenchmarkDashboardRun(normalizeBenchmarkDashboardRun(JSON.parse(await readFile(path.join(dir, file), "utf8")) as BenchmarkDashboardRun))),
  );
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listBenchmarkDashboardRunsPage(options: BenchmarkDashboardRunPageOptions = {}): Promise<BenchmarkDashboardRunPage> {
  const runs = await listBenchmarkDashboardRuns(options);
  const tags = [...new Set(runs.flatMap((run) => run.tags))].sort();
  const filtered = options.tag && options.tag !== "all" ? runs.filter((run) => run.tags.includes(options.tag!)) : runs;
  const pageSize = clampInteger(options.pageSize, 24, 1, 100);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = clampInteger(options.page, 1, 1, totalPages);
  const start = (page - 1) * pageSize;
  return {
    runs: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    totalRuns: filtered.length,
    totalPages,
    tags,
  };
}

export async function readBenchmarkDashboardRun(id: string, options: BenchmarkDashboardStoreOptions = {}): Promise<BenchmarkDashboardRun> {
  return normalizeBenchmarkDashboardRun(JSON.parse(await readFile(path.join(benchmarkDashboardRunsDir(options), `${id}.json`), "utf8")) as BenchmarkDashboardRun);
}

export async function readBenchmarkDashboardRunPage(id: string, options: BenchmarkDashboardRunDetailPageOptions = {}): Promise<BenchmarkDashboardRunDetailPage> {
  const run = await readBenchmarkDashboardRun(id, options);
  const visibleEvaluations = options.tag && options.tag !== "all" ? run.report.evaluations.filter((evaluation) => (evaluation.tag ?? "untagged") === options.tag) : run.report.evaluations;
  const totalMatches = visibleEvaluations.reduce((total, evaluation) => total + evaluation.matches.length, 0);
  const matchPageSize = clampInteger(options.matchPageSize, 24, 1, 100);
  const totalMatchPages = Math.max(1, Math.ceil(totalMatches / matchPageSize));
  const matchPage = clampInteger(options.matchPage, 1, 1, totalMatchPages);
  const start = (matchPage - 1) * matchPageSize;
  const end = start + matchPageSize;
  const report = {
    ...run.report,
    evaluationCount: visibleEvaluations.length,
    matchCount: totalMatches,
    evaluations: pageEvaluationsByGlobalMatchRange(visibleEvaluations, start, end),
  };
  return { ...run, report, matchPage, matchPageSize, totalMatches, totalMatchPages };
}

function normalizeBenchmarkDashboardRun(run: BenchmarkDashboardRun): BenchmarkDashboardRun {
  if (run.kind === "ai-specialized-benchmark") return normalizeSpecializedBenchmarkDashboardRun(run);
  if (run.kind === "ai-version-benchmark") return normalizeAiVersionBenchmarkDashboardRun(run);
  throw new Error("Benchmark dashboard run does not use the current benchmark dashboard run contract");
}

function pageEvaluationsByGlobalMatchRange(evaluations: BenchmarkEvaluationReport[], start: number, end: number): BenchmarkEvaluationReport[] {
  let cursor = 0;
  const paged: BenchmarkEvaluationReport[] = [];
  for (const evaluation of evaluations) {
    const evaluationStart = cursor;
    const evaluationEnd = cursor + evaluation.matches.length;
    cursor = evaluationEnd;
    const sliceStart = Math.max(start, evaluationStart);
    const sliceEnd = Math.min(end, evaluationEnd);
    if (sliceStart >= sliceEnd) continue;
    paged.push({
      ...evaluation,
      matches: evaluation.matches.slice(sliceStart - evaluationStart, sliceEnd - evaluationStart),
    });
  }
  return paged;
}

function normalizeAiVersionBenchmarkDashboardRun(run: AiVersionBenchmarkDashboardRun): AiVersionBenchmarkDashboardRun {
  if (!run.scoreControlSummary || !Array.isArray(run.probeSummaries) || !Array.isArray(run.combatSummaries)) {
    throw new Error("Benchmark dashboard run does not use the current benchmark dashboard run contract");
  }
  const [score, scoreControl] = run.report.evaluations;
  if (!score || !scoreControl) throw new Error("Benchmark dashboard run does not use the current benchmark dashboard run contract");
  const scoreSummary = summarizePairedScoreEvaluation(score, scoreControl);
  const scoreControlSummary = summarizeMeleeControlEvaluation(scoreControl);
  const probeSummaries = summarizeProbeLaneEvaluations(run.report.evaluations, run.probeSummaries);
  const combatSummaries = summarizeCombatLaneEvaluations(run.report.evaluations, run.combatSummaries);
  const playerRaceSummaries = summarizePlayerRaceSummaries(run.report);
  const { playerRaceSummaries: _storedPlayerRaceSummaries, ...rest } = run;
  return {
    ...rest,
    scoreSummary,
    scoreControlSummary,
    probeSummaries,
    combatSummaries,
    primarySummary: scoreSummary,
    evaluationSummaries: [scoreSummary, scoreControlSummary, ...probeSummaries, ...combatSummaries],
    ...(playerRaceSummaries ? { playerRaceSummaries } : {}),
  };
}

function normalizeSpecializedBenchmarkDashboardRun(run: SpecializedBenchmarkDashboardRun): SpecializedBenchmarkDashboardRun {
  if (!run.targetPlayerId || !Array.isArray(run.report.evaluations)) {
    throw new Error("Benchmark dashboard run does not use the current benchmark dashboard run contract");
  }
  const evaluationSummaries = run.report.evaluations.map((evaluation) => summarizeTargetPlayerEvaluation(evaluation, run.targetPlayerId));
  const playerRaceSummaries = summarizePlayerRaceSummaries(run.report);
  const { playerRaceSummaries: _storedPlayerRaceSummaries, ...rest } = run;
  return {
    ...rest,
    primarySummary: primarySummaryFor(run.targetPlayerId, evaluationSummaries),
    evaluationSummaries,
    ...(playerRaceSummaries ? { playerRaceSummaries } : {}),
  };
}

export function summarizeBenchmarkDashboardRun(run: BenchmarkDashboardRun): BenchmarkDashboardRunSummary {
  return {
    id: run.id,
    kind: run.kind,
    createdAt: run.createdAt,
    seed: run.seed,
    name: run.report.name,
    tags: benchmarkDashboardRunTags(run),
    mapPoolSize: run.mapPoolSize,
    selectedRichScoreMapIds: run.selectedRichScoreMapIds,
    primarySummary: run.primarySummary,
    evaluationSummaries: run.evaluationSummaries,
    ...(run.scoreSummary ? { scoreSummary: run.scoreSummary } : {}),
    ...(run.scoreControlSummary ? { scoreControlSummary: run.scoreControlSummary } : {}),
    ...(run.probeSummaries ? { probeSummaries: run.probeSummaries } : {}),
    ...(run.combatSummaries ? { combatSummaries: run.combatSummaries } : {}),
    ...(run.playerRaceSummaries ? { playerRaceSummaries: run.playerRaceSummaries } : {}),
    elapsedMs: run.report.elapsedMs,
    cpuMs: run.report.cpuMs,
    matchCount: run.report.matchCount,
  };
}

function summarizePlayerRaceSummaries(report: BenchmarkReport): BenchmarkPlayerRaceSummaries | undefined {
  const buckets: Record<PlayerId, Record<string, { wins: number; matches: number }>> = {};
  for (const evaluation of report.evaluations) {
    for (const match of evaluation.matches) {
      for (const [playerId, player] of Object.entries(match.setup.players ?? {})) {
        buckets[playerId] ??= {};
        buckets[playerId]![player.race] ??= { wins: 0, matches: 0 };
        const bucket = buckets[playerId]![player.race]!;
        bucket.matches += 1;
        if (match.result.winner === playerId) bucket.wins += 1;
      }
    }
  }
  const summaries = Object.fromEntries(
    Object.entries(buckets).map(([playerId, races]) => [
      playerId,
      Object.fromEntries(
        Object.entries(races).map(([race, bucket]) => {
          const losses = bucket.matches - bucket.wins;
          return [race, { wins: bucket.wins, losses, matches: bucket.matches, winRate: bucket.matches === 0 ? 0 : bucket.wins / bucket.matches }];
        }),
      ),
    ]),
  ) as BenchmarkPlayerRaceSummaries;
  return Object.keys(summaries).length === 0 ? undefined : summaries;
}

export function benchmarkDashboardRunTags(run: Pick<BenchmarkDashboardRun, "report">) {
  return [...new Set(run.report.evaluations.map((evaluation) => evaluation.tag ?? "untagged"))].sort();
}

export function benchmarkDashboardRunsDir(options: BenchmarkDashboardStoreOptions = {}) {
  return path.join(benchmarkDashboardContractDir(options), "runs");
}

export function benchmarkDashboardLogsDir(options: BenchmarkDashboardStoreOptions = {}) {
  return path.join(benchmarkDashboardContractDir(options), "logs");
}

export function benchmarkDashboardRootDir(options: BenchmarkDashboardStoreOptions = {}) {
  return options.rootDir ?? process.env.AI_BENCHMARK_DASHBOARD_DIR ?? path.join(process.cwd(), ".benchmark-dashboard");
}

function benchmarkDashboardContractDir(options: BenchmarkDashboardStoreOptions = {}) {
  return path.join(benchmarkDashboardRootDir(options), BENCHMARK_DASHBOARD_RUN_CONTRACT);
}

function benchmarkDashboardRunLog(run: BenchmarkDashboardRun) {
  const summaryLines = run.evaluationSummaries.map((summary) => `${summary.name}: ${summary.wins}/${summary.matchCount} (${Math.round(summary.successRate * 100)}%)`);
  const lines = [
    `${run.report.name}`,
    `id: ${run.id}`,
    `createdAt: ${run.createdAt}`,
    `seed: ${run.seed}`,
    `primary: ${run.primarySummary.wins}/${run.primarySummary.matchCount} (${Math.round(run.primarySummary.successRate * 100)}%)`,
    ...summaryLines,
    `wall time: ${run.report.elapsedMs}ms`,
    `cpu time: ${formatMs(run.report.cpuMs)}`,
    `selected maps: ${run.selectedRichScoreMapIds.join(", ")}`,
    "",
  ];
  for (const evaluation of run.report.evaluations) {
    lines.push(`[${evaluation.name}] ${evaluation.matchCount} games, wall=${evaluation.elapsedMs}ms, cpu=${formatMs(evaluation.cpuMs)}`);
    for (const match of evaluation.matches) {
      lines.push(`- ${match.name}: ${match.result.winnerTeam}, ${match.result.gameSecond}s, wall=${formatMs(match.elapsedMs)}, cpu=${formatMs(match.cpuMs)}`);
      for (const [owner, player] of Object.entries(match.result.players)) {
        lines.push(
          `  ${owner}: fight=${formatSecond(player.firstEnemyEngagementSecond)}, expansion=${formatSecond(player.firstExpansionMiningSecond)}, enemyKills=${player.enemyUnitKills}, neutralKills=${player.neutralUnitKills}, losses=${player.unitsLost}, income=${player.totalGoldIncome}`,
        );
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function summarizeProbeLaneEvaluations(evaluations: BenchmarkEvaluationReport[], existing: BenchmarkEvaluationSummary[]) {
  const [oneVThreeProbe, twoVThreeProbe] = evaluations.slice(2, 4);
  if (!oneVThreeProbe || !twoVThreeProbe) return existing;
  return [summarizeWinnerTeamEvaluation(oneVThreeProbe, "north"), summarizeWinnerTeamEvaluation(twoVThreeProbe, "north")];
}

function summarizeCombatLaneEvaluations(evaluations: BenchmarkEvaluationReport[], existing: BenchmarkEvaluationSummary[]) {
  const [combat15v20, combat10v12] = evaluations.slice(4, 6);
  if (!combat15v20 || !combat10v12) return existing;
  return [summarizeCombatEvaluation(combat15v20), summarizeCombatEvaluation(combat10v12)];
}

function summarizeWinnerTeamEvaluation(evaluation: BenchmarkEvaluationReport, expectedWinnerTeam: string): BenchmarkEvaluationSummary {
  const wins = evaluation.matches.filter((match) => match.result.winnerTeam === expectedWinnerTeam).length;
  return evaluationSummary(evaluation, wins);
}

function summarizeTargetPlayerEvaluation(evaluation: BenchmarkEvaluationReport, targetPlayerId: PlayerId): BenchmarkEvaluationSummary {
  const wins = evaluation.matches.filter((match) => match.result.winner === targetPlayerId).length;
  return evaluationSummary(evaluation, wins);
}

function primarySummaryFor(targetPlayerId: PlayerId, evaluationSummaries: BenchmarkEvaluationSummary[]): BenchmarkEvaluationSummary {
  if (evaluationSummaries.length === 1) return evaluationSummaries[0]!;
  const wins = evaluationSummaries.reduce((total, summary) => total + summary.wins, 0);
  const matchCount = evaluationSummaries.reduce((total, summary) => total + summary.matchCount, 0);
  const losses = matchCount - wins;
  return {
    name: `${targetPlayerId} overall`,
    wins,
    losses,
    failures: losses,
    successRate: matchCount === 0 ? 0 : wins / matchCount,
    matchCount,
  };
}

function evaluationSummary(evaluation: BenchmarkEvaluationReport, wins: number): BenchmarkEvaluationSummary {
  const losses = evaluation.matches.length - wins;
  return {
    name: evaluation.name,
    ...(evaluation.tag ? { tag: evaluation.tag } : {}),
    wins,
    losses,
    failures: losses,
    successRate: evaluation.matches.length === 0 ? 0 : wins / evaluation.matches.length,
    matchCount: evaluation.matches.length,
  };
}

function formatSecond(value: number | null) {
  return value === null ? "none" : `${value}s`;
}

function formatMs(value: number | undefined) {
  return value === undefined ? "n/a" : `${value}ms`;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.isFinite(value) ? Math.floor(value!) : fallback;
  return Math.min(Math.max(parsed, min), max);
}

function runId(now: Date, seed: string) {
  return `${now.toISOString().replaceAll(/[:.]/g, "-")}-${hashSeed(seed).toString(36)}`;
}

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function isMissingFileError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function writeAtomic(filePath: string, content: string) {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, content, "utf8");
  await rename(tmpPath, filePath);
}
