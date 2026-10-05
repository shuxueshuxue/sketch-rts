import { describe, expect, it } from "vitest";
import { V8_STRATEGIES } from "../v8/doctrine";
import { V9_STRATEGIES } from "./doctrine";

describe("v9 doctrine", () => {
  it("plays V8's lines without the rising strike, its opening moving on at 5:00", () => {
    expect(V9_STRATEGIES.map((strategy) => strategy.id)).toEqual(V8_STRATEGIES.map((strategy) => strategy.id));
    for (const strategy of V9_STRATEGIES) {
      expect(strategy.risingStrike).toBe(false);
      expect(strategy.opensOnState).toBe(false);
    }
  });

  it("holds first: its basic soldier, towers at its natural and main, the natural and then a third and fourth base", () => {
    for (const strategy of V9_STRATEGIES) {
      const fortress = strategy.phases[0]!;
      expect(fortress.wants).toEqual(
        expect.arrayContaining([
          { bases: 2, priority: 66 },
          { bases: 3, priority: 65 },
          { towers: "outposts", count: 6, priority: 64 },
          { unit: strategy.standIn, count: 16, priority: 62 },
          { towers: "main", count: 3, priority: 60 },
        ]),
      );
      expect(fortress.wants.some((want) => "upgrade" in want)).toBe(false);
    }
  });

  it("then plays V8's phases with both forge lines a level per phase, in a second research hall", () => {
    for (const strategy of V9_STRATEGIES) {
      const hall = strategy.race === "grove" ? "barracks" : "emberForge";
      strategy.phases.slice(1, 4).forEach((phase, index) => {
        const upgrades = phase.wants.filter((want) => "upgrade" in want && (want.upgrade === "weaponTraining" || want.upgrade === "reinforcedPlating"));
        expect(upgrades).toEqual([
          { upgrade: "weaponTraining", level: index + 1, priority: 62 - index },
          { upgrade: "reinforcedPlating", level: index + 1, priority: 62 - index },
        ]);
        expect(phase.wants).toContainEqual({ building: hall, count: 2, priority: 62 - index });
      });
    }
  });

  it("wants a third and a fourth base ahead of anything else in every later phase, and keeps eight, then ten, soldiers", () => {
    for (const strategy of V9_STRATEGIES) {
      for (const phase of strategy.phases.slice(1)) {
        expect(phase.wants).toContainEqual({ bases: 3, priority: 65 });
        expect(phase.wants).toContainEqual({ bases: 4, priority: 61 });
        expect(phase.wants.filter((want) => "bases" in want && want.bases >= 3)).toHaveLength(2);
      }
      expect(strategy.phases[1]!.wants).toContainEqual({ unit: strategy.standIn, count: 8, priority: 59 });
      expect(strategy.phases[2]!.wants).toContainEqual({ unit: strategy.standIn, count: 10, priority: 55 });
    }
  });
});
