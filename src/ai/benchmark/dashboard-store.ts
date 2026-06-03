import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MapId } from "../../shared/types";
import type { AiVersionBenchmarkDashboardReport, AiVersionBenchmarkOptions, BenchmarkEvaluationSummary } from "./presets";
import { runAiVersionBenchmark, runAiVersionBenchmarkParallel, summarizeMeleeControlEvaluation, summarizePairedScoreEvaluation } from "./presets";

export type BenchmarkDashboardRun = AiVersionBenchmarkDashboardReport & {
  id: string;
  kind: "ai-version-benchmark";
  createdAt: string;
  seed: string;
  mapCount: number;
  full: boolean;
};

export type BenchmarkDashboardRunSummary = {
  id: string;
  kind: BenchmarkDashboardRun["kind"];
  createdAt: string;
  seed: string;
  name: string;
  tags: string[];
  mapPoolSize: number;
  selectedRichScoreMapIds: MapId[];
  scoreSummary: BenchmarkEvaluationSummary;
  scoreControlSummary: BenchmarkEvaluationSummary;
  probeSummaries: BenchmarkEvaluationSummary[];
  combatSummaries: BenchmarkEvaluationSummary[];
  elapsedMs: number;
  cpuMs?: number;
  matchCount: number;
};

export type BenchmarkDashboardStoreOptions = {
  rootDir?: string;
  now?: () => Date;
};

const BENCHMARK_DASHBOARD_RUN_CONTRACT = "run-contract-v2";

export async function recordAiVersionBenchmarkDashboardRun(
  options: AiVersionBenchmarkOptions = {},
  storeOptions: BenchmarkDashboardStoreOptions = {},
): Promise<BenchmarkDashboardRun> {
  const now = storeOptions.now?.() ?? new Date();
  const report = options.workers && options.workers > 1 ? await runAiVersionBenchmarkParallel(options) : runAiVersionBenchmark(options);
  const run: BenchmarkDashboardRun = {
    ...report,
    id: runId(now, report.seed),
    kind: "ai-version-benchmark",
    createdAt: now.toISOString(),
    seed: report.seed,
    mapCount: report.selectedRichScoreMapIds.length,
    full: options.full === true,
  };
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
      .map(async (file) => summarizeBenchmarkDashboardRun(assertCurrentBenchmarkDashboardRun(JSON.parse(await readFile(path.join(dir, file), "utf8")) as BenchmarkDashboardRun))),
  );
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readBenchmarkDashboardRun(id: string, options: BenchmarkDashboardStoreOptions = {}): Promise<BenchmarkDashboardRun> {
  return assertCurrentBenchmarkDashboardRun(JSON.parse(await readFile(path.join(benchmarkDashboardRunsDir(options), `${id}.json`), "utf8")) as BenchmarkDashboardRun);
}

function assertCurrentBenchmarkDashboardRun(run: BenchmarkDashboardRun): BenchmarkDashboardRun {
  if (!run.scoreControlSummary || !Array.isArray(run.probeSummaries) || !Array.isArray(run.combatSummaries)) {
    throw new Error("Benchmark dashboard run does not use the current benchmark dashboard run contract");
  }
  const [score, scoreControl] = run.report.evaluations;
  if (!score || !scoreControl) throw new Error("Benchmark dashboard run does not use the current benchmark dashboard run contract");
  return {
    ...run,
    scoreSummary: summarizePairedScoreEvaluation(score, scoreControl),
    scoreControlSummary: summarizeMeleeControlEvaluation(scoreControl),
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
    scoreSummary: run.scoreSummary,
    scoreControlSummary: run.scoreControlSummary,
    probeSummaries: run.probeSummaries,
    combatSummaries: run.combatSummaries,
    elapsedMs: run.report.elapsedMs,
    cpuMs: run.report.cpuMs,
    matchCount: run.report.matchCount,
  };
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
  const lines = [
    `${run.report.name}`,
    `id: ${run.id}`,
    `createdAt: ${run.createdAt}`,
    `seed: ${run.seed}`,
    `score: ${run.scoreSummary.wins}/${run.scoreSummary.matchCount} (${Math.round(run.scoreSummary.successRate * 100)}%)`,
    `score control: ${run.scoreControlSummary.wins}/${run.scoreControlSummary.matchCount} (${Math.round(run.scoreControlSummary.successRate * 100)}%)`,
    ...run.probeSummaries.map((summary) => `${summary.name}: ${summary.wins}/${summary.matchCount} (${Math.round(summary.successRate * 100)}%)`),
    ...run.combatSummaries.map((summary) => `${summary.name}: ${summary.wins}/${summary.matchCount} (${Math.round(summary.successRate * 100)}%)`),
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

function formatSecond(value: number | null) {
  return value === null ? "none" : `${value}s`;
}

function formatMs(value: number | undefined) {
  return value === undefined ? "n/a" : `${value}ms`;
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
