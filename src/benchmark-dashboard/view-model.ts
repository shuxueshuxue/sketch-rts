import type { BenchmarkDashboardRun, BenchmarkDashboardRunSummary } from "../ai/benchmark/dashboard-store";

export function runListMeta(run: BenchmarkDashboardRunSummary | BenchmarkDashboardRun) {
  const controls = `${run.scoreControlSummary.wins}/${run.scoreControlSummary.matchCount} 1v1 control`;
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
