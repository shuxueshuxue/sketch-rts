import {
  AI_GAUNTLET_V1A,
  AI_GAUNTLET_V2,
  createAiGauntletCatalog,
  type AiGauntletMatch,
} from "../src/ai/benchmark/gauntlet";
import { runAiGame } from "../src/ai/game-runner";
import { benchmarkFilterFromArgs, boolFlag, commonAiBenchmarkOptionsFromArgs, printJson } from "./benchmark-cli";

const args = process.argv.slice(2);
if (boolFlag(args, "help") || boolFlag(args, "h")) {
  console.log(`Usage:
  npx tsx scripts/ai-version-gauntlet.ts --seed gauntlet-18 --map-count 18 --dry-run
  npx tsx scripts/ai-version-gauntlet.ts --seed gauntlet-18 --map-count 18 --runner-probe
  npx tsx scripts/ai-version-gauntlet.ts --full`);
  process.exit(0);
}

const catalog = createAiGauntletCatalog(gauntletOptionsFromSources(args, process.env));
const selectedMatches = gauntletMatchesFromArgs(catalog.matches, args);

if (boolFlag(args, "dry-run")) {
  printJson(gauntletDryRunManifest(catalog, selectedMatches));
  process.exit(0);
}

if (boolFlag(args, "runner-probe") || process.env.AI_GAUNTLET_RUNNER_PROBE === "1") {
  const probeMatch = {
    name: "runner probe",
    lane: "robustness",
    controllerCase: "internal-only",
    mapId: catalog.selectedRichScoreMapIds[0] ?? "bareDuel",
    agents: {
      v2: { controller: "internal-ai", team: "north", race: "grove", version: "v2" },
      v1a: { controller: "internal-ai", team: "south", race: "grove", version: "v1" },
      v1b: { controller: "internal-ai", team: "south", race: "grove", version: "v1" },
    },
    maxTicks: 1,
    thinkInterval: 45,
    sampleInterval: 1_200,
  } satisfies AiGauntletMatch;
  const report = runGauntletMatch(probeMatch);
  const commandCounts = {
    [AI_GAUNTLET_V2]: report.commandsByOwner[AI_GAUNTLET_V2] ?? 0,
    [AI_GAUNTLET_V1A]: report.commandsByOwner[AI_GAUNTLET_V1A] ?? 0,
  };
  printJson({
    ok: commandCounts[AI_GAUNTLET_V2] > 0 && commandCounts[AI_GAUNTLET_V1A] > 0,
    gauntletMode: catalog.selection.mode,
    mapSelectionSeed: catalog.selection.seed,
    mapId: report.mapId,
    controllerCase: report.controllerCase,
    tick: report.tick,
    commandCounts,
  });
  process.exit(commandCounts[AI_GAUNTLET_V2] > 0 && commandCounts[AI_GAUNTLET_V1A] > 0 ? 0 : 1);
}

const started = performance.now();
const cpuStarted = process.cpuUsage();
const scoreReports = selectedMatches.filter((match) => match.lane === "score").map((match) => runGauntletMatch(match));
const oneVThreeReports = selectedMatches.filter((match) => match.lane === "1v3").map((match) => runGauntletMatch(match));
const twoVThreeReports = selectedMatches.filter((match) => match.lane === "2v3").map((match) => runGauntletMatch(match));
const robustnessReports = selectedMatches.filter((match) => match.lane === "robustness").map((match) => runGauntletMatch(match));
const reports = [...scoreReports, ...oneVThreeReports, ...twoVThreeReports, ...robustnessReports];
const cpu = process.cpuUsage(cpuStarted);
const controllerCaseNames = [...new Set(selectedMatches.map((match) => match.controllerCase))];
const summaries = controllerCaseNames.map((controllerCase) => {
  const relevant = scoreReports.filter((report) => report.controllerCase === controllerCase);
  return {
    controllerCase,
    wins: relevant.filter((report) => report.winnerTeam === "north").length,
    losses: relevant.filter((report) => report.winnerTeam === "south").length,
    failures: relevant.filter((report) => report.failed).length,
    successRate: relevant.filter((report) => !report.failed).length / Math.max(1, relevant.length),
  };
});
const robustnessSummaries = controllerCaseNames.map((controllerCase) => {
  const relevant = robustnessReports.filter((report) => report.controllerCase === controllerCase);
  return {
    controllerCase,
    cases: relevant.length,
    failures: relevant.filter((report) => report.failed).length,
    successRate: relevant.filter((report) => !report.failed).length / relevant.length,
  };
});
const scoreOk = summaries.every((summary) => summary.successRate >= 1);
const oneVThreeOk = oneVThreeReports.every((report) => !report.failed);
const twoVThreeOk = twoVThreeReports.every((report) => !report.failed);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: scoreOk && oneVThreeOk && twoVThreeOk,
      totalElapsedMs: Number((performance.now() - started).toFixed(3)),
      totalCpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
      gauntletMode: catalog.selection.mode,
      mapSelectionSeed: catalog.selection.seed,
      selectedRichScoreMapIds: catalog.selectedRichScoreMapIds,
      scoreCaseCount: catalog.scoreCaseCount,
      oneVThreeCaseCount: catalog.oneVThreeCaseCount,
      twoVThreeCaseCount: catalog.twoVThreeCaseCount,
      robustnessCaseCount: catalog.robustnessCaseCount,
      summaries,
      oneVThreeSummary: summarizeReports(oneVThreeReports),
      twoVThreeSummary: summarizeReports(twoVThreeReports),
      robustnessSummaries,
      reports,
    },
    null,
    2,
  )}\n`,
);

if (!scoreOk || !oneVThreeOk || !twoVThreeOk) {
  throw new Error("AI version gauntlet failed: v2 did not satisfy the 1v2 score, 1v3 probe, and 2v3 probe gates in every controller class");
}

function runGauntletMatch(match: AiGauntletMatch) {
  const report = runAiGame({
    name: match.name,
    mapId: match.mapId,
    agents: match.agents,
    ...(match.options ? { options: match.options } : {}),
    maxTicks: match.maxTicks,
    thinkInterval: match.thinkInterval,
    sampleInterval: match.sampleInterval,
  });
  return {
    ...report,
    controllerCase: match.controllerCase,
    failed: match.lane === "robustness" ? robustnessFailed(report) : report.winnerTeam !== "north",
    lane: match.lane,
    playtestName: match.name,
    snapshot: undefined,
  };
}

function summarizeReports(reports: Array<{ failed: boolean }>) {
  return {
    cases: reports.length,
    failures: reports.filter((report) => report.failed).length,
    successRate: reports.filter((report) => !report.failed).length / Math.max(1, reports.length),
  };
}

function robustnessFailed(report: ReturnType<typeof runAiGame>) {
  return (report.commandsByOwner[AI_GAUNTLET_V2] ?? 0) === 0 || (report.goldSpent[AI_GAUNTLET_V2] ?? 0) === 0;
}

function gauntletOptionsFromSources(args: readonly string[], env: NodeJS.ProcessEnv) {
  const cli = commonAiBenchmarkOptionsFromArgs(args);
  return {
    ...(env.AI_GAUNTLET_SEED ? { seed: env.AI_GAUNTLET_SEED } : {}),
    ...(env.AI_GAUNTLET_MAP_COUNT ? { mapCount: positiveIntegerEnv(env.AI_GAUNTLET_MAP_COUNT, "AI_GAUNTLET_MAP_COUNT") } : {}),
    ...(env.AI_GAUNTLET_FULL === "1" ? { full: true } : {}),
    ...withoutBenchmarkOnlyOptions(cli),
  };
}

function withoutBenchmarkOnlyOptions(options: ReturnType<typeof commonAiBenchmarkOptionsFromArgs>) {
  const { workers: _workers, maxTicks: _maxTicks, thinkInterval: _thinkInterval, ...rest } = options;
  return rest;
}

function positiveIntegerEnv(raw: string, name: string) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function gauntletMatchesFromArgs(matches: AiGauntletMatch[], args: readonly string[]) {
  const filter = benchmarkFilterFromArgs(args);
  const selected = matches.filter((match) => {
    if (filter.matchNames && !filter.matchNames.includes(match.name)) return false;
    if (filter.mapIds && !filter.mapIds.includes(match.mapId)) return false;
    return true;
  });
  if (filter.matchNames && selected.length !== filter.matchNames.length) {
    const missing = filter.matchNames.filter((name) => !matches.some((match) => match.name === name));
    throw new Error(`Unknown gauntlet match ${missing.join(", ")}`);
  }
  return selected;
}

function gauntletDryRunManifest(catalog: typeof catalog, matches: AiGauntletMatch[]) {
  return {
    name: "AI Version Gauntlet",
    gauntletMode: catalog.selection.mode,
    mapSelectionSeed: catalog.selection.seed,
    selectedRichScoreMapIds: catalog.selectedRichScoreMapIds,
    scoreCaseCount: catalog.scoreCaseCount,
    oneVThreeCaseCount: catalog.oneVThreeCaseCount,
    twoVThreeCaseCount: catalog.twoVThreeCaseCount,
    robustnessCaseCount: catalog.robustnessCaseCount,
    matchCount: matches.length,
    matches: matches.map((match) => ({
      name: match.name,
      lane: match.lane,
      controllerCase: match.controllerCase,
      mapId: match.mapId,
      players: Object.keys(match.agents),
      agents: Object.fromEntries(
        Object.entries(match.agents).map(([playerId, agent]) => [
          playerId,
          {
            controller: agent.controller,
            team: agent.team,
            race: agent.race,
            aiVersion: agent.version,
            ...(agent.disabledBehaviors ? { disabledBehaviors: agent.disabledBehaviors } : {}),
          },
        ]),
      ),
    })),
  };
}
