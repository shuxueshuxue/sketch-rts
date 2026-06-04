import { describe, expect, it } from "vitest";
import { createAiCommandStatsTracker } from "./command-stats";

describe("AI command stats tracker", () => {
  it("records first and last command seconds by script and command type", () => {
    const tracker = createAiCommandStatsTracker();
    const state = tracker.create?.({} as never);
    if (!state) throw new Error("missing tracker state");

    tracker.onCommand?.(state, commandContext(40, "v2", "expansion", { type: "attackMove", unitIds: ["a"], x: 100, y: 100 }));
    tracker.onCommand?.(state, commandContext(100, "v2", "expansion", { type: "build", unitId: "w", buildingKind: "townHall", x: 120, y: 120 }));
    tracker.onCommand?.(state, commandContext(160, "v2", "expansion", { type: "attackMove", unitIds: ["b"], x: 200, y: 200 }));

    const result = tracker.finish(state, {} as never);

    expect(result.owners.v2!.scripts.expansion).toMatchObject({
      commands: 3,
      firstSecond: 2,
      lastSecond: 8,
      byType: { attackMove: 2, build: 1 },
      singleUnitCommands: 2,
      singleUnitByType: { attackMove: 2 },
      timingByType: {
        attackMove: { firstSecond: 2, lastSecond: 8 },
        build: { firstSecond: 5, lastSecond: 5 },
      },
    });
  });
});

function commandContext(tick: number, owner: string, scriptId: string, command: unknown) {
  return {
    tick,
    owner,
    scriptId,
    command,
  } as never;
}
