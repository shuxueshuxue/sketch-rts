import type { BenchmarkDashboardRun, BenchmarkDashboardRunSummary } from "../ai/benchmark/dashboard-store";
import type { Locale } from "../client/i18n";

const VIEW_MODEL_TEXT = {
  en: {
    control: "1v1 control",
    guarded: "guarded",
    maps: "maps",
    route: "route",
  },
  zh: {
    control: "1v1 控制组",
    guarded: "守卫",
    maps: "地图",
    route: "路线",
  },
} as const;

export function runListMeta(run: BenchmarkDashboardRunSummary | BenchmarkDashboardRun, locale: Locale = "en") {
  const text = VIEW_MODEL_TEXT[locale];
  const controls = `${run.scoreControlSummary.wins}/${run.scoreControlSummary.matchCount} ${text.control}`;
  const probes = run.probeSummaries
    .map((summary) => `${summary.wins}/${summary.matchCount} ${summary.name.replace(/\s*probe$/i, "")}`)
    .join(" · ");
  const combats = run.combatSummaries
    .map((summary) => `${summary.wins}/${summary.matchCount} ${summary.name.replace(/\s*mixed combat$/i, "")}`)
    .join(" · ");
  return [controls, probes, combats, `${run.selectedRichScoreMapIds.length}/${run.mapPoolSize} ${text.maps}`].filter(Boolean).join(" · ");
}

export function campRoleSummary(camps: { freeCamps: number; guardedCamps: number }, locale: Locale = "en") {
  const text = VIEW_MODEL_TEXT[locale];
  return `${camps.freeCamps} ${text.route} / ${camps.guardedCamps} ${text.guarded}`;
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
