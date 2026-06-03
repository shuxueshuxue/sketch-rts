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

export function dashboardTags(runs: Array<BenchmarkDashboardRunSummary | BenchmarkDashboardRun>): string[] {
  return [...new Set(runs.flatMap((run) => runTags(run)))].sort();
}

export function runTags(run: BenchmarkDashboardRunSummary | BenchmarkDashboardRun): string[] {
  if ("tags" in run) return run.tags;
  if (!("report" in run)) return [];
  return [...new Set(run.report.evaluations.map((evaluation) => evaluation.tag ?? "untagged"))].sort();
}

export function runMatchesTag(run: BenchmarkDashboardRunSummary | BenchmarkDashboardRun, tag: string) {
  return tag === "all" || runTags(run).includes(tag);
}
