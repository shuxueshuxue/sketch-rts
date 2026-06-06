import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AI version gauntlet runner boundary", () => {
  it("routes gauntlet matches through the canonical AI-aware runner", () => {
    const source = readFileSync("scripts/ai-version-gauntlet.ts", "utf8");

    expect(source).toContain('from "../src/ai/game-runner"');
    expect(source).toContain("runAiGame");
    expect(source).not.toMatch(/import\s+\{[^}]*\brunGame\b/);
    expect(source).not.toMatch(/\brunGame\s*\(/);
  });
});
