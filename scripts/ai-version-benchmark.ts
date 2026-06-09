import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { BUILDING_DEFS, UNIT_DEFS } from "../src/shared/catalog";
import { createAiVersionBenchmarkInput } from "../src/ai/benchmark/presets";
import { runAiBenchmarkRunnerParityProbe } from "../src/ai/benchmark/parity";
import { recordAiVersionBenchmarkDashboardRun } from "../src/ai/benchmark/dashboard-store";
import { describeBenchmarkInput } from "../src/sdk/benchmark/manifest";
import type { BenchmarkInput } from "../src/sdk/benchmark/core";
import type { AiGameAgent } from "../src/ai/game-runner";
import { boolFlag, commonAiBenchmarkOptionsFromArgs, flag, printJson, type CommonAiBenchmarkCliOptions } from "./benchmark-cli";

const SCORE_SUCCESS_GATE = 1;

const args = process.argv.slice(2);
if (boolFlag(args, "help") || boolFlag(args, "h")) {
  console.log(`Usage:
  npm run benchmark:ai -- --seed version-50 --map-count 18 --workers 95
  npm run benchmark:ai -- --seed version-50 --map-count 18 --dry-run
  npm run benchmark:ai -- --seed version-50 --map-count 18 --parity-probe
  npm run benchmark:ai -- --full --workers 95`);
  process.exit(0);
}

const options = aiVersionBenchmarkOptionsFromSources(args, process.env);
const workers = options.workers;

if (boolFlag(args, "dry-run") || process.env.AI_BENCHMARK_DRY_RUN === "1") {
  const { input, selection } = createAiVersionBenchmarkInput(options);
  printJson({
    name: input.name,
    seed: selection.seed,
    selectedRichScoreMapIds: selection.mapIds,
    mapCount: selection.mapIds.length,
    full: options.full === true,
    workers,
    dashboardPath: process.env.AI_BENCHMARK_DASHBOARD_DIR ?? ".benchmark-dashboard",
    manifest: describeBenchmarkInput(input),
  });
  process.exit(0);
}

if (boolFlag(args, "parity-probe") || process.env.AI_BENCHMARK_PARITY_PROBE === "1") {
  const { input, selection } = createAiVersionBenchmarkInput({ ...options, maxTicks: 1 });
  const proofInput = representativeParityInput(input);
  const proof = await runAiBenchmarkRunnerParityProbe(proofInput);
  printJson({
    name: "AI Version Benchmark Runner Parity Probe",
    commit: gitCommit(),
    catalogHash: catalogHash(),
    seed: selection.seed,
    selectedRichScoreMapIds: selection.mapIds,
    mapCount: selection.mapIds.length,
    full: options.full === true,
    workers,
    dashboardPath: process.env.AI_BENCHMARK_DASHBOARD_DIR ?? ".benchmark-dashboard",
    probeCount: proof.probes.length,
    setupEqual: proof.setupEqual,
    coreResultEqual: proof.coreResultEqual,
    directResultEqual: proof.directResultEqual,
    probes: proof.probes.map((probe) => ({
      evaluationName: probe.evaluationName,
      ...(probe.tag ? { tag: probe.tag } : {}),
      matchName: probe.matchName,
      matchIndex: probe.matchIndex,
      setupEqual: probe.setupEqual,
      coreResultEqual: probe.coreResultEqual,
      directResultEqual: probe.directResultEqual,
      serialManifest: probe.serialManifest,
      parallelManifest: probe.parallelManifest,
      serial: probe.serial,
      parallel: probe.parallel,
      direct: probe.direct,
    })),
  });
  process.exit(0);
}

const run = await recordAiVersionBenchmarkDashboardRun(options);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: benchmarkPassed(run.scoreSummary.successRate, [...run.probeSummaries, ...run.combatSummaries].map((summary) => summary.successRate)),
      id: run.id,
      createdAt: run.createdAt,
      seed: run.seed,
      selectedRichScoreMapIds: run.selectedRichScoreMapIds,
      scoreSummary: run.scoreSummary,
      scoreControlSummary: run.scoreControlSummary,
      probeSummaries: run.probeSummaries,
      combatSummaries: run.combatSummaries,
      elapsedMs: run.report.elapsedMs,
      cpuMs: run.report.cpuMs,
      workers,
      dashboardPath: process.env.AI_BENCHMARK_DASHBOARD_DIR ?? ".benchmark-dashboard",
    },
    null,
    2,
  )}\n`,
);

if (!benchmarkPassed(run.scoreSummary.successRate, [...run.probeSummaries, ...run.combatSummaries].map((summary) => summary.successRate))) {
  throw new Error("AI version benchmark failed: v2 did not satisfy the 100% gate across melee score, probes, and combat");
}

function benchmarkPassed(scoreRate: number, laneRates: number[]) {
  return scoreRate >= SCORE_SUCCESS_GATE && laneRates.every((rate) => rate >= SCORE_SUCCESS_GATE);
}

function aiVersionBenchmarkOptionsFromSources(args: readonly string[], env: NodeJS.ProcessEnv): CommonAiBenchmarkCliOptions {
  const cli = commonAiBenchmarkOptionsFromArgs(args);
  const cliWorkers = flag(args, "workers") !== undefined;
  const envWorkers = env.AI_BENCHMARK_WORKERS ? positiveIntegerEnv(env.AI_BENCHMARK_WORKERS, "AI_BENCHMARK_WORKERS") : undefined;
  return {
    ...(env.AI_GAUNTLET_SEED ? { seed: env.AI_GAUNTLET_SEED } : {}),
    ...(env.AI_GAUNTLET_MAP_COUNT ? { mapCount: positiveIntegerEnv(env.AI_GAUNTLET_MAP_COUNT, "AI_GAUNTLET_MAP_COUNT") } : {}),
    ...(env.AI_GAUNTLET_FULL === "1" ? { full: true } : {}),
    ...withoutWorkers(cli),
    workers: cliWorkers ? cli.workers : envWorkers ?? cli.workers,
  };
}

function withoutWorkers(options: CommonAiBenchmarkCliOptions): Omit<CommonAiBenchmarkCliOptions, "workers"> {
  const { workers: _workers, ...rest } = options;
  return rest;
}

function positiveIntegerEnv(raw: string, name: string) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function representativeParityInput(input: BenchmarkInput<AiGameAgent>): BenchmarkInput<AiGameAgent> {
  return {
    name: "AI Version Benchmark Runner Parity Probe",
    evaluations: input.evaluations.flatMap((evaluation) => {
      const match = evaluation.matches[0];
      if (!match) return [];
      return [{ name: evaluation.name, ...(evaluation.tag ? { tag: evaluation.tag } : {}), matches: [match] }];
    }),
  };
}

function gitCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function catalogHash() {
  return createHash("sha256").update(stableJson({ BUILDING_DEFS, UNIT_DEFS })).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
