import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("command frame runtime boundary", () => {
  it("keeps local and hosted adapters from re-owning frame validation application or stepping", () => {
    const adapterFiles = ["src/client/net/local-adapter.ts", "src/server/room-host.ts"];
    const forbidden = ["commandValidationError", "commandWithCurrentIssuers", "applyCommandFrame", "stepGame", "planPresetAiRuntimeCommands"];
    const offenders = adapterFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbidden.filter((needle) => source.includes(needle)).map((needle) => `${file}: ${needle}`);
    });

    expect(offenders).toEqual([]);
  });

  it("keeps offline SDK command frames on the shared runtime instead of a second apply path", () => {
    const source = readFileSync("src/sdk/commands/frame.ts", "utf8");
    const forbidden = ["commandValidationError", "applyCommandFrame"];
    const offenders = forbidden.filter((needle) => source.includes(needle));

    expect(offenders).toEqual([]);
    expect(source).toContain("CommandFrameRuntime");
  });

  it("keeps offline SDK and AI diagnostic runners from owning raw apply or step loops", () => {
    const runnerFiles = ["src/sdk/game-runner.ts", "src/sdk/playtest.ts", "src/ai/playtest.ts", "src/ai/ab-test.ts", "scripts/ai-matrix.ts"];
    const forbidden = ["stepGame", "issuePlayerCommand", "applyCommandFrame", "runPresetAiRuntime"];
    const offenders = runnerFiles.flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbidden.filter((needle) => source.includes(needle)).map((needle) => `${file}: ${needle}`);
    });

    expect(offenders).toEqual([]);
  });
});
