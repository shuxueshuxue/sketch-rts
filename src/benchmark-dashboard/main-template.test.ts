import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("benchmark dashboard template", () => {
  it("renders one match pager without reusing the run pager class", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source.match(/matchPager\(run\.matchPage/g) ?? []).toHaveLength(1);
    expect(source).not.toContain('class="run-pager match-pager"');
  });

  it("keeps run and match pagers identifiable as separate dashboard controls", () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

    expect(source.match(/runPager\(state\.runPage/g) ?? []).toHaveLength(1);
    expect(source).toContain('data-dashboard-pager="runs"');
    expect(source).toContain('data-dashboard-pager="matches"');
  });
});
