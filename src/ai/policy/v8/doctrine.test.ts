import { describe, expect, it } from "vitest";
import { V6_STRATEGIES, v7OpeningPhase } from "../v6/doctrine";
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

  it("reads no game clock: its opening moves on by state and its raids wait on their squad, while V7 keeps its clock", () => {
    for (const strategy of V8_STRATEGIES) {
      expect(v7OpeningPhase(strategy).advanceBy, strategy.id).toBeUndefined();
      expect(strategy.phases.map((phase) => phase.advanceBy), strategy.id).toEqual(strategy.phases.map(() => undefined));
      expect(strategy.raids.map((raid) => raid.minSecond), strategy.id).toEqual(strategy.raids.map(() => undefined));
    }
    for (const strategy of V6_STRATEGIES) expect(v7OpeningPhase(strategy).advanceBy, strategy.id).toBe(300);
  });

  it("strikes rising halls in the ravager line only", () => {
    expect(Object.fromEntries(V8_STRATEGIES.map((strategy) => [strategy.id, strategy.risingStrike ?? false]))).toEqual({ "grove-cavalry-line": false, "ember-ravager-line": true });
  });
});
