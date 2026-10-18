// Reading vitest's JSON reporter and comparing two runs. Pure, so the diff rules are unit tested apart from any machine.

export type VitestJson = {
  testResults: {
    name: string;
    status: string;
    message?: string;
    assertionResults: { ancestorTitles: string[]; title: string; fullName?: string; status: string; failureMessages?: string[]; duration?: number | null }[];
  }[];
};

export type TestOutcome = { id: string; file: string; status: "passed" | "failed" | "skipped"; message: string; ms: number };

/** Every test by a stable id (file relative to the copy, then its titles), plus a "(file)" entry when a file fails to load. */
export function outcomes(report: VitestJson, copyDir: string): Map<string, TestOutcome> {
  const result = new Map<string, TestOutcome>();
  for (const file of report.testResults) {
    const relative = file.name.startsWith(copyDir) ? file.name.slice(copyDir.length).replace(/^\/+/, "") : file.name;
    if (file.assertionResults.length === 0 && file.status === "failed") {
      result.set(`${relative} > (file)`, { id: `${relative} > (file)`, file: relative, status: "failed", message: file.message ?? "", ms: 0 });
    }
    for (const test of file.assertionResults) {
      const id = [relative, ...test.ancestorTitles, test.title].join(" > ");
      const status = test.status === "passed" ? "passed" : test.status === "failed" ? "failed" : "skipped";
      result.set(id, { id, file: relative, status, message: (test.failureMessages ?? []).join("\n"), ms: test.duration ?? 0 });
    }
  }
  return result;
}

// A failure that is about wall time, not behavior: a test timeout, a "took longer than" bound, or a timing assertion.
// These are what load on a shared machine (A100 at 40-60, mac1 at 80) turns red at random.
const TIMING = [/Test timed out in \d+ms/, /took longer than \d+ ?ms/, /Hook timed out/, /expected \d+(\.\d+)? to be less than \d+/];

export function looksTimed(message: string) {
  return TIMING.some((pattern) => pattern.test(message));
}

export type Diff = {
  /** Fails on ref, passes on base. */
  newFailures: TestOutcome[];
  /** Passes on ref, fails on base. */
  newPasses: TestOutcome[];
  /** Fails on both: already broken on the base, not this change's doing. */
  baseBroken: TestOutcome[];
  /** Present on ref only and failing (a new test that fails). */
  newTestsFailing: TestOutcome[];
};

export function diff(base: Map<string, TestOutcome>, ref: Map<string, TestOutcome>): Diff {
  const result: Diff = { newFailures: [], newPasses: [], baseBroken: [], newTestsFailing: [] };
  for (const [id, outcome] of ref) {
    const before = base.get(id);
    if (outcome.status === "failed") {
      if (!before) result.newTestsFailing.push(outcome);
      else if (before.status === "failed") result.baseBroken.push(outcome);
      else if (before.status === "passed") result.newFailures.push(outcome);
    } else if (outcome.status === "passed" && before?.status === "failed") result.newPasses.push(outcome);
  }
  return result;
}

/**
 * After the suspects were run again alone, a new failure stands only if it failed again on ref while passing on base.
 * A suspect that passed alone is reported as flaky, marked when its first failure was about time.
 */
export function settle(suspects: TestOutcome[], baseRerun: Map<string, TestOutcome>, refRerun: Map<string, TestOutcome>) {
  const confirmed: TestOutcome[] = [], flaky: (TestOutcome & { timed: boolean })[] = [];
  for (const suspect of suspects) {
    const again = refRerun.get(suspect.id), base = baseRerun.get(suspect.id);
    if (again?.status === "failed" && base?.status !== "failed") confirmed.push(again);
    else flaky.push({ ...suspect, timed: looksTimed(suspect.message) });
  }
  return { confirmed, flaky };
}
