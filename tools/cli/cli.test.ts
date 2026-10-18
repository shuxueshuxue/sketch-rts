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
