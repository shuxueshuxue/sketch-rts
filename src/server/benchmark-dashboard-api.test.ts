import { describe, expect, it } from "vitest";
import { benchmarkDashboardPageOptionsFromQuery } from "./benchmark-dashboard-api";

describe("benchmark dashboard API helpers", () => {
  it("parses backend pagination query parameters", () => {
    expect(benchmarkDashboardPageOptionsFromQuery({ page: "3", pageSize: "48", matchPage: "4", matchPageSize: "12", tag: "melee" })).toEqual({
      page: 3,
      pageSize: 48,
      matchPage: 4,
      matchPageSize: 12,
      tag: "melee",
    });
  });

  it("drops non-finite pagination query values", () => {
    expect(benchmarkDashboardPageOptionsFromQuery({ page: "wat", pageSize: "-1", tag: "" })).toEqual({});
  });
});
