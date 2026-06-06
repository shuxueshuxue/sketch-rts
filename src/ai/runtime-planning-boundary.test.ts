import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI runtime planning boundary", () => {
  it("keeps direct AI command issuing out of the product runtime module", () => {
    const runtimeSource = readFileSync("src/ai/runtime.ts", "utf8");

    expect(runtimeSource).not.toContain("issueCommandFrame");
    expect(runtimeSource).not.toContain("runPresetAiRuntime");
    expect(runtimeSource).not.toContain("issueAiCommandFrame");
    expect(runtimeSource).toContain("planPresetAiRuntimeCommands");
    expect(runtimeSource).toContain("createPresetAiRuntimeFramePlanner");
  });

  it("keeps direct issue helpers explicitly test scoped", () => {
    const helperSource = readFileSync("src/ai/runtime-test-helpers.ts", "utf8");

    expect(helperSource).toContain("runPresetAiRuntimeForTest");
    expect(helperSource).toContain("issueAiCommandFrameForTest");
    expect(helperSource).toContain("issueCommandFrame");
  });

  it("prevents runtime test helpers from being imported by product modules", () => {
    const offenders = sourceFiles("src")
      .filter((file) => !file.endsWith(".test.ts") && file !== "src/ai/runtime-test-helpers.ts")
      .filter((file) => readFileSync(file, "utf8").includes("runtime-test-helpers"));

    expect(offenders).toEqual([]);
  });
});

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}
