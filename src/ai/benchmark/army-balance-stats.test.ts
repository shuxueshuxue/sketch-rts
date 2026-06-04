import { describe, expect, it } from "vitest";
import { createArmyBalanceStatsTracker } from "./army-balance-stats";

describe("army balance stats tracker", () => {
  it("records power lead extrema and first local combat timing by owner", () => {
    const tracker = createArmyBalanceStatsTracker();
    const state = tracker.create?.({ players: ["v2", "v1a"], match: { agents: { v2: { team: "north" }, v1a: { team: "south" } } } } as never);
    if (!state) throw new Error("missing tracker state");

    tracker.afterStep?.(state, stepContext(20, [unit("v2", "v2-a", 100, 100, 10), unit("v1a", "v1a-a", 2000, 2000, 14)]));
    tracker.afterStep?.(state, stepContext(40, [unit("v2", "v2-a", 100, 100, 18), unit("v2", "v2-b", 120, 100, 10), unit("v1a", "v1a-a", 600, 100, 14)]));
    tracker.afterStep?.(state, stepContext(60, [unit("v2", "v2-a", 100, 100, 8), unit("v1a", "v1a-a", 130, 100, 20), unit("v1a", "v1a-b", 160, 100, 10)]));

    const result = tracker.finish(state, {} as never);

    expect(result.owners.v2).toMatchObject({
      samples: 3,
      minPowerLeadSecond: 3,
      maxPowerLeadSecond: 2,
      firstPositivePowerLeadSecond: 2,
      firstLocalCombatSecond: 2,
    });
    expect(result.owners.v2!.maxPowerLead).toBeGreaterThan(0);
    expect(result.owners.v2!.minPowerLead).toBeLessThan(0);
  });
});

function stepContext(tick: number, units: unknown[]) {
  return {
    after: { tick, units },
  } as never;
}

function unit(owner: string, id: string, x: number, y: number, attackDamage: number) {
  return {
    id,
    owner,
    kind: "footman",
    x,
    y,
    hp: 100,
    maxHp: 100,
    attackDamage,
    attackRange: 80,
  };
}
