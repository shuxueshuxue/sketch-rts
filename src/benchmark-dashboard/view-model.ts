import type { BenchmarkDashboardRun, BenchmarkDashboardRunSummary } from "../ai/benchmark/dashboard-store";
import type { BenchmarkEvaluationSummary } from "../ai/benchmark/presets";
import type { BenchmarkMatchReport } from "../sdk/benchmark";

export function runListMeta(run: BenchmarkDashboardRunSummary | BenchmarkDashboardRun) {
  const controls = `${run.scoreControlSummary.wins}/${run.scoreControlSummary.matchCount} 1v1 maps`;
  const probes = run.probeSummaries
    .map((summary) => `${summary.wins}/${summary.matchCount} ${summary.name.replace(/\s*probe$/i, "")}`)
    .join(" · ");
  const combats = run.combatSummaries
    .map((summary) => `${summary.wins}/${summary.matchCount} ${summary.name.replace(/\s*mixed combat$/i, "")}`)
    .join(" · ");
  return [controls, probes, combats, `${run.selectedRichScoreMapIds.length}/${run.mapPoolSize} maps`].filter(Boolean).join(" · ");
}

export function campRoleSummary(camps: { freeCamps: number; guardedCamps: number }) {
  return `${camps.freeCamps} route / ${camps.guardedCamps} guarded`;
}

export function scoreControlGameSummary(run: BenchmarkDashboardRun): BenchmarkEvaluationSummary | undefined {
  const evaluation = run.report.evaluations.find((candidate) => candidate.name === "1v1 score control");
  if (!evaluation) return undefined;
  const wins = evaluation.matches.filter(v2WonControlGame).length;
  const losses = evaluation.matches.length - wins;
  return {
    name: "1v1 control games",
    ...(evaluation.tag ? { tag: evaluation.tag } : {}),
    wins,
    losses,
    failures: losses,
    successRate: evaluation.matches.length === 0 ? 0 : wins / evaluation.matches.length,
    matchCount: evaluation.matches.length,
  };
}

function v2WonControlGame(match: BenchmarkMatchReport) {
  return match.result.winner === "v2" && (match.result.players.v2?.enemyUnitKills ?? 0) > 0 && opponentWasNotOnlyNeutralKilled(match);
}

function opponentWasNotOnlyNeutralKilled(match: BenchmarkMatchReport) {
  return Object.entries(match.result.players)
    .filter(([owner]) => owner !== "v2")
    .some(([, player]) => player.unitsLost > 0 && player.unitsKilledByNeutral < player.unitsLost);
}
