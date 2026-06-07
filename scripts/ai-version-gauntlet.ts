import {
  AI_GAUNTLET_V1A,
  AI_GAUNTLET_V2,
  createAiGauntletCatalogFromEnv,
  type AiGauntletMatch,
} from "../src/ai/benchmark/gauntlet";
import { runAiGame } from "../src/ai/game-runner";

const catalog = createAiGauntletCatalogFromEnv(process.env);

if (process.env.AI_GAUNTLET_RUNNER_PROBE === "1") {
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
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: commandCounts[AI_GAUNTLET_V2] > 0 && commandCounts[AI_GAUNTLET_V1A] > 0,
        gauntletMode: catalog.selection.mode,
        mapSelectionSeed: catalog.selection.seed,
        mapId: report.mapId,
        controllerCase: report.controllerCase,
        tick: report.tick,
        commandCounts,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(commandCounts[AI_GAUNTLET_V2] > 0 && commandCounts[AI_GAUNTLET_V1A] > 0 ? 0 : 1);
}

const started = performance.now();
const cpuStarted = process.cpuUsage();
const scoreReports = catalog.matches.filter((match) => match.lane === "score").map((match) => runGauntletMatch(match));
const oneVThreeReports = catalog.matches.filter((match) => match.lane === "1v3").map((match) => runGauntletMatch(match));
const twoVThreeReports = catalog.matches.filter((match) => match.lane === "2v3").map((match) => runGauntletMatch(match));
const robustnessReports = catalog.matches.filter((match) => match.lane === "robustness").map((match) => runGauntletMatch(match));
const reports = [...scoreReports, ...oneVThreeReports, ...twoVThreeReports, ...robustnessReports];
const cpu = process.cpuUsage(cpuStarted);
const controllerCaseNames = [...new Set(catalog.matches.map((match) => match.controllerCase))];
const summaries = controllerCaseNames.map((controllerCase) => {
  const relevant = scoreReports.filter((report) => report.controllerCase === controllerCase);
  return {
    controllerCase,
    wins: relevant.filter((report) => report.winnerTeam === "north").length,
    losses: relevant.filter((report) => report.winnerTeam === "south").length,
    failures: relevant.filter((report) => report.failed).length,
    successRate: relevant.filter((report) => !report.failed).length / relevant.length,
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
