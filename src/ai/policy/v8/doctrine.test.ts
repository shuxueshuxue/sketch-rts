import { describe, expect, it } from "vitest";
import { V8_STRATEGIES } from "./doctrine";

describe("v8 doctrine", () => {
  it("raises two towers at the main before the second base, in both lines", () => {
    for (const strategy of V8_STRATEGIES) {
      const wants = strategy.phases[0]!.wants;
      const towers = wants.find((want) => "towers" in want && want.towers === "main" && want.count === 2);
      const bases = wants.find((want) => "bases" in want && want.bases === 2);
      expect(towers, strategy.id).toBeDefined();
      expect(towers!.priority, strategy.id).toBeGreaterThan(bases!.priority);
    }
  });

  it("strikes rising halls in the ravager line only", () => {
    expect(Object.fromEntries(V8_STRATEGIES.map((strategy) => [strategy.id, strategy.risingStrike ?? false]))).toEqual({ "grove-cavalry-line": false, "ember-ravager-line": true });
  });
});
