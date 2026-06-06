import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AI_MATRIX_CASES } from "../src/ai/benchmark/matrix";

const localRunner = "scripts/ai-matrix.ts";
const sdkRunner = "scripts/sdk-ai-matrix.ts";

describe("AI matrix runner manifest boundary", () => {
  it("keeps local and SDK matrix runners on one shared case manifest and assertion module", () => {
    const forbidden = ["const cases", "function assertCase", "function createExpansionProof", "function sampleExpansionProof", "function expansionTeamsWithMining"];
    const offenders = [localRunner, sdkRunner].flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbidden.filter((needle) => source.includes(needle)).map((needle) => `${file}: ${needle}`);
    });

    expect(offenders).toEqual([]);
  });

  it("keeps both runners importing the shared AI matrix contract", () => {
    for (const file of [localRunner, sdkRunner]) {
      const source = readFileSync(file, "utf8");

      expect(source).toContain("../src/ai/benchmark/matrix");
      expect(source).toContain("AI_MATRIX_CASES");
      expect(source).toContain("assertAiMatrixCase");
      expect(source).toContain("runner:");
    }
  });

  it("defines the matrix cases once for both adapters", () => {
    expect(AI_MATRIX_CASES.map((testCase) => testCase.name)).toEqual([
      "1v1 no-expansion no-neutral",
      "1v1 expansion no-neutral",
      "1v1 no-expansion neutral",
      "1v2 expansion neutral",
      "1v1v1 expansion neutral",
    ]);
  });
});
