import { describe, expect, it } from "vitest";
import { V8_STRATEGIES } from "../v8/doctrine";
import { V9_STRATEGIES } from "./doctrine";

describe("v9 doctrine", () => {
  it("plays V8's lines without the rising strike", () => {
    expect(V9_STRATEGIES.map((strategy) => strategy.id)).toEqual(V8_STRATEGIES.map((strategy) => strategy.id));
    for (const strategy of V9_STRATEGIES) expect(strategy.risingStrike).toBe(false);
  });

  it("researches both forge lines a level per phase from the first, in a second research hall", () => {
    for (const strategy of V9_STRATEGIES) {
      const hall = strategy.race === "grove" ? "barracks" : "emberForge";
      strategy.phases.slice(0, 3).forEach((phase, index) => {
        const upgrades = phase.wants.filter((want) => "upgrade" in want);
        expect(upgrades).toEqual(
          expect.arrayContaining([
            { upgrade: "weaponTraining", level: index + 1, priority: 62 - index },
            { upgrade: "reinforcedPlating", level: index + 1, priority: 62 - index },
          ]),
        );
        expect(upgrades.filter((want) => "upgrade" in want && (want.upgrade === "weaponTraining" || want.upgrade === "reinforcedPlating"))).toHaveLength(2);
        expect(phase.wants).toContainEqual({ building: hall, count: 2, priority: 62 - index });
      });
    }
  });

  it("keeps eight, then ten, of the line's basic soldier in its first two phases", () => {
    for (const strategy of V9_STRATEGIES) {
      expect(strategy.phases[0]!.wants).toContainEqual({ unit: strategy.standIn, count: 8, priority: 59 });
      expect(strategy.phases[1]!.wants).toContainEqual({ unit: strategy.standIn, count: 10, priority: 55 });
    }
  });
});
