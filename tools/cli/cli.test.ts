import { describe, expect, it } from "vitest";
import { parseArgs, UsageError, type CommandSpec } from "./args";
import { audit } from "./lib/audit";
import { diff, looksTimed, outcomes, settle, type VitestJson } from "./lib/vitest-report";

const spec: CommandSpec = { name: "demo", summary: "", usage: "demo", options: [
  { name: "base", description: "", default: "origin/main" }, { name: "json", description: "", boolean: true }] };

describe("sketch argument parsing", () => {
  it("reads values, inline values, booleans, defaults and positionals", () => {
    expect(parseArgs(spec, ["a.test.ts", "--json", "--base=abc", "b"])).toEqual({ positionals: ["a.test.ts", "b"], options: { json: true, base: "abc" } });
    expect(parseArgs(spec, []).options.base).toBe("origin/main");
  });
  it("refuses an unknown option or a missing value instead of ignoring it", () => {
    expect(() => parseArgs(spec, ["--bsae", "x"])).toThrow(UsageError);
    expect(() => parseArgs(spec, ["--base"])).toThrow(UsageError);
    expect(() => parseArgs(spec, ["--json=1"])).toThrow(UsageError);
  });
});

const report = (tests: [string, string, string?][], loadError?: string): VitestJson => ({ testResults: [
  { name: "/copy/src/a.test.ts", status: tests.some(([, status]) => status === "failed") ? "failed" : "passed",
    assertionResults: tests.map(([title, status, message]) => ({ ancestorTitles: ["suite"], title, status, failureMessages: message ? [message] : [] })) },
  ...(loadError ? [{ name: "/copy/src/b.test.ts", status: "failed", message: loadError, assertionResults: [] }] : []),
] });

describe("sketch test diff rules", () => {
  it("separates new failures, fixes, base-broken tests and failing new tests", () => {
    const base = outcomes(report([["keeps", "passed"], ["breaks", "passed"], ["fixed", "failed"], ["old", "failed"]]), "/copy");
    const ref = outcomes(report([["keeps", "passed"], ["breaks", "failed", "boom"], ["fixed", "passed"], ["old", "failed"], ["fresh", "failed"]], "SyntaxError"), "/copy");
    const result = diff(base, ref);
    expect(result.newFailures.map(({ id }) => id)).toEqual(["src/a.test.ts > suite > breaks"]);
    expect(result.newPasses.map(({ id }) => id)).toEqual(["src/a.test.ts > suite > fixed"]);
    expect(result.baseBroken.map(({ id }) => id)).toEqual(["src/a.test.ts > suite > old"]);
    expect(result.newTestsFailing.map(({ id }) => id).sort()).toEqual(["src/a.test.ts > suite > fresh", "src/b.test.ts > (file)"]);
  });
  it("keeps a new failure only if it fails again alone while the base passes", () => {
    const suspects = [...outcomes(report([["timed", "failed", "Test timed out in 5000ms."], ["real", "failed", "expected 1 to be 2"]]), "/copy").values()];
    const refAgain = outcomes(report([["timed", "passed"], ["real", "failed", "expected 1 to be 2"]]), "/copy");
    const baseAgain = outcomes(report([["timed", "passed"], ["real", "passed"]]), "/copy");
    const { confirmed, flaky } = settle(suspects, baseAgain, refAgain);
    expect(confirmed.map(({ id }) => id)).toEqual(["src/a.test.ts > suite > real"]);
    expect(flaky.map(({ id, timed }) => [id, timed])).toEqual([["src/a.test.ts > suite > timed", true]]);
  });
  it("recognises wall-time failures", () => {
    for (const message of ["Test timed out in 15000ms.", "AI think due on tick 3 took longer than 30000 ms", "expected 2186.3 to be less than 2000"]) expect(looksTimed(message)).toBe(true);
    expect(looksTimed("expected [ 'a' ] to deeply equal []")).toBe(false);
  });
});

describe("sketch scripts audit", () => {
  it("follows package.json and code into scripts, and scripts into the scripts they name", () => {
    const entries = audit({
      scripts: [
        { name: "run.ts", text: "import { helper } from './helper';" }, { name: "helper.ts", text: "" },
        { name: "old-proof.mjs", text: "import './old-fixture.js'" }, { name: "old-fixture.js", text: "" },
        { name: "tool.test.ts", text: "" }, { name: "runner-v2.ts", text: "" },
      ],
      roots: [{ label: "package.json", text: `"x": "tsx scripts/run.ts"` }, { label: "code", text: `"scripts/runner.ts"` }],
    });
    expect(Object.fromEntries(entries.map(({ name, live }) => [name, live]))).toEqual({
      "run.ts": true, "helper.ts": true, "tool.test.ts": true, "old-proof.mjs": false, "old-fixture.js": false, "runner-v2.ts": false });
  });
});

import { cells, metricSummary, type RoomResult } from "./lib/bench-summary";

describe("sketch bench room comparison", () => {
  const result = (winners: [string | null, string | null], metrics?: RoomResult["metrics"]): RoomResult => ({ subject: "v9_knight", seed: "s", wins: winners.filter((w) => w === "v9_knight").length, rawMatches: 2,
    byMap: [{ mapId: "ladder-01", grove: { winner: winners[0] }, ember: { winner: winners[1] } }], ...(metrics ? { metrics } : {}) });
  it("counts wins per cell and lists the games whose winner changed", () => {
    const compared = cells(new Map([["v9_knight|v9", [result(["v9_knight", "v9"])]]]), new Map([["v9_knight|v9", [result(["v9_knight", "v9_knight"])]]]));
    expect(compared).toEqual([{ subject: "v9_knight", rival: "v9", base: { wins: 1, games: 2 }, ref: { wins: 2, games: 2 }, flips: ["s ladder-01 ember: v9 -> v9_knight"] }]);
  });
  it("averages a metric per side and reads trade as the rival's losses over the subject's", () => {
    const measured = [result(["v9", "v9"], {
      a: { "bases@4": { v9_knight: 2, p1: 1 }, "trade@15": { v9_knight: 300, p1: 600 }, clear: { v9_knight: null, p1: 3 } },
      b: { "bases@4": { v9_knight: 1, p1: 1 }, "trade@15": { v9_knight: 100, p1: 200 }, clear: { v9_knight: 2.5, p1: 2 } },
    })];
    expect(metricSummary(measured, "v9_knight", "bases@4")).toEqual({ own: 1.5, rival: 1, missing: 0 });
    expect(metricSummary(measured, "v9_knight", "trade@15")).toEqual({ own: 2, rival: 0.5, missing: 0 });
    expect(metricSummary(measured, "v9_knight", "clear")).toEqual({ own: 2.5, rival: 2.5, missing: 1 });
    expect(metricSummary([result(["v9", "v9"])], "v9_knight", "clear")).toBeUndefined();
  });
});
