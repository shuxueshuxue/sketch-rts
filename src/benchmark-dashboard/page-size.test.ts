import { describe, expect, it } from "vitest";
import { DEFAULT_MATCHES_PER_PAGE, DEFAULT_RUNS_PER_PAGE } from "./page-size";

describe("benchmark dashboard page size", () => {
  it("keeps dashboard pages small enough for the remote benchmark store", () => {
    expect(DEFAULT_RUNS_PER_PAGE).toBe(5);
    expect(DEFAULT_MATCHES_PER_PAGE).toBe(5);
  });
});
