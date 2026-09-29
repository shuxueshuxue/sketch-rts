import { describe, expect, it } from "vitest";
import { V6_STRATEGIES, v7OpeningPhase } from "../v6/doctrine";
import { V8_STRATEGIES } from "./doctrine";

describe("v8 doctrine", () => {
  it("raises one tower at the main before the second base, and one at the second base ahead of the army, in both lines", () => {
    for (const strategy of V8_STRATEGIES) {
      const wants = strategy.phases[0]!.wants;
      const main = wants.find((want) => "towers" in want && want.towers === "main");
      const natural = wants.find((want) => "towers" in want && want.towers === "outposts");
      const bases = wants.find((want) => "bases" in want && want.bases === 2);
      const army = Math.max(...wants.filter((want) => "unit" in want && want.count > 2).map((want) => want.priority));
      expect(main && "count" in main ? main.count : undefined, strategy.id).toBe(1);
      expect(natural && "count" in natural ? natural.count : undefined, strategy.id).toBe(1);
      expect(main!.priority, strategy.id).toBeGreaterThan(bases!.priority);
      expect(natural!.priority, strategy.id).toBeGreaterThan(army);
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

  it("strikes rising halls in both lines", () => {
    expect(Object.fromEntries(V8_STRATEGIES.map((strategy) => [strategy.id, strategy.risingStrike ?? false]))).toEqual({ "grove-cavalry-line": true, "ember-ravager-line": true });
  });
});
