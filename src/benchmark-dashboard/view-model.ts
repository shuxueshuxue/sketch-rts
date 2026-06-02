import type { BenchmarkDashboardRun, BenchmarkDashboardRunSummary } from "../ai/benchmark/dashboard-store";
import type { BenchmarkEvaluationSummary } from "../ai/benchmark/presets";

type ProbeCarrier = {
  probeSummaries?: BenchmarkEvaluationSummary[];
  combatSummaries?: BenchmarkEvaluationSummary[];
} & Record<string, unknown>;

export function probeSummariesFor(run: ProbeCarrier) {
  return Array.isArray(run.probeSummaries) ? run.probeSummaries : [];
}

export function combatSummariesFor(run: ProbeCarrier) {
  return Array.isArray(run.combatSummaries) ? run.combatSummaries : [];
}

export function runListMeta(run: BenchmarkDashboardRunSummary | BenchmarkDashboardRun) {
  const probes = probeSummariesFor(run)
    .map((summary) => `${summary.wins}/${summary.matchCount} ${summary.name.replace(/\s*probe$/i, "")}`)
    .join(" · ");
  const combats = combatSummariesFor(run)
    .map((summary) => `${summary.wins}/${summary.matchCount} ${summary.name.replace(/\s*mixed combat$/i, "")}`)
    .join(" · ");
  return [probes, combats, `${run.sanitySummary.wins}/${run.sanitySummary.matchCount} sanity`, `${run.selectedRichScoreMapIds.length}/${run.mapPoolSize} maps`]
    .filter(Boolean)
    .join(" · ");
}

export function campRoleSummary(camps: { freeCamps: number; guardedCamps: number }) {
  return `${camps.freeCamps} route / ${camps.guardedCamps} guarded`;
}
