import { describe, expect, it } from "vitest";
import { createExpansionClaimTimelineTracker } from "./expansion-claim-timeline";

describe("expansion claim timeline tracker", () => {
  it("samples expansion attack-move groups with health, orders, moon well distance, and nearby enemies", () => {
    const tracker = createExpansionClaimTimelineTracker();
    const state = tracker.create?.({ players: ["v2", "v1a"], match: { agents: { v2: { team: "north" }, v1a: { team: "south" } } } } as never);
    if (!state) throw new Error("missing tracker state");

    tracker.onCommand?.(state, commandContext(40, "v2", { type: "attackMove", unitIds: ["a", "b"], x: 1200, y: 900 }));
    tracker.afterStep?.(
      state,
      stepContext(140, [
        unit("v2", "a", 1180, 900, 42, { type: "attackMove", x: 1200, y: 900 }),
        unit("v2", "b", 1220, 900, 80, { type: "idle" }),
        unit("neutral", "guard", 1210, 910, 100, { type: "idle" }),
        unit("v1a", "enemy", 1230, 920, 100, { type: "attackMove", x: 1200, y: 900 }),
      ]),
    );

    const result = tracker.finish(state, {} as never);

    expect(result.owners.v2!.commands).toEqual([{ second: 2, unitCount: 2, x: 1200, y: 900 }]);
    expect(result.owners.v2!.samples[0]).toMatchObject({
      second: 7,
      alive: 2,
      lowHp: 1,
      orderCounts: { attackMove: 1, idle: 1 },
      neutralGuardsNearTarget: 1,
      enemyCombatNearGroup: 1,
    });
    expect(result.owners.v2!.samples[0]!.avgDistanceToTarget).toBe(20);
    expect(result.owners.v2!.samples[0]!.avgDistanceToMoonWell).toBeNull();
  });

  it("does not reset the sample interval for repeated expansion commands to the same target", () => {
    const tracker = createExpansionClaimTimelineTracker();
    const state = tracker.create?.({ players: ["v2"], match: { agents: { v2: { team: "north" } } } } as never);
    if (!state) throw new Error("missing tracker state");

    tracker.onCommand?.(state, commandContext(40, "v2", { type: "attackMove", unitIds: ["a"], x: 1200, y: 900 }));
    tracker.afterStep?.(state, stepContext(140, [unit("v2", "a", 1200, 900, 100, { type: "attackMove", x: 1200, y: 900 })]));
    tracker.onCommand?.(state, commandContext(150, "v2", { type: "attackMove", unitIds: ["a"], x: 1200, y: 900 }));
    tracker.afterStep?.(state, stepContext(160, [unit("v2", "a", 1200, 900, 100, { type: "attackMove", x: 1200, y: 900 })]));

    const result = tracker.finish(state, {} as never);

    expect(result.owners.v2!.samples.map((sample) => sample.second)).toEqual([7]);
  });
});

function commandContext(tick: number, owner: string, command: unknown) {
  return {
    tick,
    owner,
    scriptId: "expansion",
    command,
  } as never;
}

function stepContext(tick: number, units: unknown[]) {
  return {
    after: {
      tick,
      units,
      buildings: [{ owner: "v2", kind: "moonWell", complete: false, hp: 300, x: 500, y: 500 }],
    },
  } as never;
}

function unit(owner: string, id: string, x: number, y: number, hp: number, order: unknown) {
  return {
    id,
    owner,
    kind: "footman",
    x,
    y,
    hp,
    maxHp: 100,
    order,
  };
}
