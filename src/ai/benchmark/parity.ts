import { describeBenchmarkInput, type BenchmarkInputManifest } from "../../sdk/benchmark/manifest";
import { runBenchmark, type BenchmarkInput, type BenchmarkMatchReport, type BenchmarkReport } from "../../sdk/benchmark/core";
import { runBenchmarkParallel } from "../../sdk/benchmark/parallel";
import { runGame, type SdkGameRunReport } from "../../sdk/game-runner";
import type { AiGameAgent } from "../game-runner";
import { serializableAiBenchmarkInput } from "./presets";

export type AiBenchmarkRunnerParityProof = {
  serialManifest: BenchmarkInputManifest;
  parallelManifest: BenchmarkInputManifest;
  serialReport: NormalizedBenchmarkReport;
  parallelReport: NormalizedBenchmarkReport;
  directReport: NormalizedDirectBenchmarkReport;
  probes: AiBenchmarkRunnerParityMatchProof[];
  setupEqual: boolean;
  coreResultEqual: boolean;
  directResultEqual: boolean;
};

export type NormalizedBenchmarkReport = {
  name: string;
  evaluationCount: number;
  matchCount: number;
  evaluations: NormalizedBenchmarkEvaluationReport[];
};

export type NormalizedBenchmarkEvaluationReport = {
  name: string;
  tag?: string;
  matchCount: number;
  matches: NormalizedBenchmarkMatchReport[];
};

export type NormalizedBenchmarkMatchReport = Pick<BenchmarkMatchReport, "name" | "setup"> & {
  result: Omit<BenchmarkMatchReport["result"], "trackers">;
};

export type NormalizedDirectBenchmarkReport = {
  name: string;
  evaluationCount: number;
  matchCount: number;
  evaluations: NormalizedDirectEvaluationReport[];
};

export type NormalizedDirectEvaluationReport = {
  name: string;
  tag?: string;
  matchCount: number;
  matches: NormalizedDirectMatchReport[];
};

export type NormalizedDirectMatchReport = {
  name: string;
  map: string;
  result: BenchmarkCoreMatchResult;
};

export type BenchmarkCoreMatchResult = {
  tick: number;
  winner: string | null;
  winnerTeam: string;
  timeout: boolean;
  players: Record<
    string,
    {
      team: string;
      race?: string;
      aiVersion: string;
      finalSupply: number;
      finalBuildingCount: number;
      enemyUnitKills: number;
      neutralUnitKills: number;
      unitsLost: number;
      unitsKilledByNeutral: number;
      totalGoldSpent: number;
    }
  >;
};

export type AiBenchmarkRunnerParityMatchProof = {
  evaluationName: string;
  tag?: string;
  matchName: string;
  matchIndex: number;
  serialManifest: BenchmarkInputManifest["evaluations"][number]["matches"][number];
  parallelManifest: BenchmarkInputManifest["evaluations"][number]["matches"][number];
  setupEqual: boolean;
  coreResultEqual: boolean;
  directResultEqual: boolean;
  serial: { map: string; players: NormalizedBenchmarkMatchReport["setup"]["players"]; result: BenchmarkCoreMatchResult };
  parallel: { map: string; players: NormalizedBenchmarkMatchReport["setup"]["players"]; result: BenchmarkCoreMatchResult };
  direct: { map: string; result: BenchmarkCoreMatchResult };
};

export async function runAiBenchmarkRunnerParityProbe(input: BenchmarkInput<AiGameAgent>): Promise<AiBenchmarkRunnerParityProof> {
  const serialManifest = describeBenchmarkInput(input);
  const parallelInput = serializableAiBenchmarkInput(input);
  const parallelManifest = describeBenchmarkInput(parallelInput);
  const serialReport = normalizeBenchmarkReport(runBenchmark(input));
  const parallelReport = normalizeBenchmarkReport(
    await runBenchmarkParallel(parallelInput, {
      workerModule: new URL("./parallel-worker.ts", import.meta.url).href,
      workers: 1,
    }),
  );
  const directReport = normalizeDirectBenchmarkReport(input);

  return {
    serialManifest,
    parallelManifest,
    serialReport,
    parallelReport,
    directReport,
    probes: parityMatchProofs(serialManifest, parallelManifest, serialReport, parallelReport, directReport),
    setupEqual: sameJson(reportSetups(serialReport), reportSetups(parallelReport)),
    coreResultEqual: sameJson(reportResults(serialReport), reportResults(parallelReport)),
    directResultEqual: sameJson(reportCoreResults(serialReport), reportDirectCoreResults(directReport)),
  };
}

function normalizeBenchmarkReport(report: BenchmarkReport): NormalizedBenchmarkReport {
  return {
    name: report.name,
    evaluationCount: report.evaluationCount,
    matchCount: report.matchCount,
    evaluations: report.evaluations.map((evaluation) => ({
      name: evaluation.name,
      ...(evaluation.tag ? { tag: evaluation.tag } : {}),
      matchCount: evaluation.matchCount,
      matches: evaluation.matches.map((match) => {
        const { trackers: _trackers, ...result } = match.result;
        return {
          name: match.name,
          setup: match.setup,
          result,
        };
      }),
    })),
  };
}

function normalizeDirectBenchmarkReport(input: BenchmarkInput<AiGameAgent>): NormalizedDirectBenchmarkReport {
  return {
    name: input.name,
    evaluationCount: input.evaluations.length,
    matchCount: input.evaluations.reduce((total, evaluation) => total + evaluation.matches.length, 0),
    evaluations: input.evaluations.map((evaluation) => ({
      name: evaluation.name,
      ...(evaluation.tag ? { tag: evaluation.tag } : {}),
      matchCount: evaluation.matches.length,
      matches: evaluation.matches.map((match) => normalizeDirectMatchReport(match, runGame(match))),
    })),
  };
}

function normalizeDirectMatchReport(match: BenchmarkInput<AiGameAgent>["evaluations"][number]["matches"][number], report: SdkGameRunReport): NormalizedDirectMatchReport {
  const owners = Object.keys(match.agents);
  return {
    name: report.name,
    map: report.mapId,
    result: {
      tick: report.tick,
      winner: report.winner,
      winnerTeam: report.winnerTeam,
      timeout: report.timeout,
      players: Object.fromEntries(
        owners.map((owner) => {
          const agent = match.agents[owner]!;
          const totalKills = report.unitsKilled[owner] ?? 0;
          const neutralKills = report.neutralUnitsKilled[owner] ?? 0;
          return [
            owner,
            {
              team: agent.team,
              ...(agent.race ? { race: agent.race } : {}),
              aiVersion: agent.versionLabel ?? "unknown",
              finalSupply: report.snapshot.players[owner]?.supplyUsed ?? 0,
              finalBuildingCount: report.snapshot.buildings.filter((building) => building.owner === owner).length,
              enemyUnitKills: Math.max(0, totalKills - neutralKills),
              neutralUnitKills: neutralKills,
              unitsLost: report.unitsLost[owner] ?? 0,
              unitsKilledByNeutral: report.unitsKilledByNeutral[owner] ?? 0,
              totalGoldSpent: report.goldSpent[owner] ?? 0,
            },
          ];
        }),
      ),
    },
  };
}

function reportSetups(report: NormalizedBenchmarkReport) {
  return report.evaluations.map((evaluation) => evaluation.matches.map((match) => match.setup));
}

function reportResults(report: NormalizedBenchmarkReport) {
  return report.evaluations.map((evaluation) => evaluation.matches.map((match) => match.result));
}

function reportCoreResults(report: NormalizedBenchmarkReport) {
  return report.evaluations.map((evaluation) => evaluation.matches.map((match) => benchmarkCoreResult(match.result)));
}

function reportDirectCoreResults(report: NormalizedDirectBenchmarkReport) {
  return report.evaluations.map((evaluation) => evaluation.matches.map((match) => match.result));
}

function benchmarkCoreResult(result: NormalizedBenchmarkMatchReport["result"]): BenchmarkCoreMatchResult {
  return {
    tick: result.tick,
    winner: result.winner,
    winnerTeam: result.winnerTeam,
    timeout: result.timeout,
    players: Object.fromEntries(
      Object.entries(result.players).map(([owner, player]) => [
        owner,
        {
          team: player.team,
          race: player.race,
          aiVersion: player.aiVersion,
          finalSupply: player.finalSupply,
          finalBuildingCount: player.finalBuildingCount,
          enemyUnitKills: player.enemyUnitKills,
          neutralUnitKills: player.neutralUnitKills,
          unitsLost: player.unitsLost,
          unitsKilledByNeutral: player.unitsKilledByNeutral,
          totalGoldSpent: player.totalGoldSpent,
        },
      ]),
    ),
  };
}

function parityMatchProofs(
  serialManifest: BenchmarkInputManifest,
  parallelManifest: BenchmarkInputManifest,
  serialReport: NormalizedBenchmarkReport,
  parallelReport: NormalizedBenchmarkReport,
  directReport: NormalizedDirectBenchmarkReport,
): AiBenchmarkRunnerParityMatchProof[] {
  return serialReport.evaluations.flatMap((evaluation, evaluationIndex) =>
    evaluation.matches.map((match, matchIndex) => {
      const parallelMatch = parallelReport.evaluations[evaluationIndex]?.matches[matchIndex];
      const directMatch = directReport.evaluations[evaluationIndex]?.matches[matchIndex];
      const serialManifestMatch = serialManifest.evaluations[evaluationIndex]?.matches[matchIndex];
      const parallelManifestMatch = parallelManifest.evaluations[evaluationIndex]?.matches[matchIndex];
      if (!parallelMatch || !directMatch || !serialManifestMatch || !parallelManifestMatch) throw new Error(`Parity probe missing match ${evaluation.name}[${matchIndex}]`);
      const serialCore = benchmarkCoreResult(match.result);
      const parallelCore = benchmarkCoreResult(parallelMatch.result);
      return {
        evaluationName: evaluation.name,
        ...(evaluation.tag ? { tag: evaluation.tag } : {}),
        matchName: match.name,
        matchIndex,
        serialManifest: serialManifestMatch,
        parallelManifest: parallelManifestMatch,
        setupEqual: sameJson(match.setup, parallelMatch.setup),
        coreResultEqual: sameJson(serialCore, parallelCore),
        directResultEqual: sameJson(serialCore, directMatch.result),
        serial: { map: match.setup.map.id, players: match.setup.players, result: serialCore },
        parallel: { map: parallelMatch.setup.map.id, players: parallelMatch.setup.players, result: parallelCore },
        direct: { map: directMatch.map, result: directMatch.result },
      };
    }),
  );
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
