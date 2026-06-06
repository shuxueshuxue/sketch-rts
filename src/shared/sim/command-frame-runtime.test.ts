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
});
