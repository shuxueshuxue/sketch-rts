import type { BenchmarkDashboardRunDetailPageOptions, BenchmarkDashboardRunPageOptions } from "../ai/benchmark/dashboard-store";

export function benchmarkDashboardPageOptionsFromQuery(query: Record<string, unknown>): Pick<BenchmarkDashboardRunPageOptions & BenchmarkDashboardRunDetailPageOptions, "page" | "pageSize" | "matchPage" | "matchPageSize" | "tag"> {
  const page = positiveIntegerQuery(query.page);
  const pageSize = positiveIntegerQuery(query.pageSize);
  const matchPage = positiveIntegerQuery(query.matchPage);
  const matchPageSize = positiveIntegerQuery(query.matchPageSize);
  const tag = typeof query.tag === "string" && query.tag.length > 0 ? query.tag : undefined;
  return {
    ...(page !== undefined ? { page } : {}),
    ...(pageSize !== undefined ? { pageSize } : {}),
    ...(matchPage !== undefined ? { matchPage } : {}),
    ...(matchPageSize !== undefined ? { matchPageSize } : {}),
    ...(tag !== undefined ? { tag } : {}),
  };
}

function positiveIntegerQuery(value: unknown) {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}
