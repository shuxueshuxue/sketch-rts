import { describe, expect, it } from "vitest";
import {
  controlGroupCenter,
  controlGroupRecallTap,
  pruneControlGroups,
  recallControlGroup,
  replaceControlGroup,
  type ControlGroupRecallTap,
  type ControlGroups,
} from "./control-groups";

describe("control groups", () => {
  it("replaces a slot with the current selected ids", () => {
    const groups: ControlGroups = {};

    replaceControlGroup(groups, 1, new Set(["worker-1", "archer-1"]));

    expect(groups[1]).toEqual(["worker-1", "archer-1"]);
  });

  it("recalls and prunes only live ids", () => {
    const groups: ControlGroups = { 3: ["worker-1", "dead-1", "barracks-1"] };
    const liveIds = new Set(["worker-1", "barracks-1"]);

    expect(recallControlGroup(groups, 3, liveIds)).toEqual(["worker-1", "barracks-1"]);
    pruneControlGroups(groups, liveIds);

    expect(groups[3]).toEqual(["worker-1", "barracks-1"]);
  });

  it("treats a quick second recall of the same slot as a camera jump", () => {
    let tap: ControlGroupRecallTap | undefined;

    let result = controlGroupRecallTap(tap, 1, 1000);
    expect(result.shouldCenterCamera).toBe(false);
    tap = result.nextTap;

    result = controlGroupRecallTap(tap, 1, 1300);
    expect(result.shouldCenterCamera).toBe(true);
    tap = result.nextTap;

    result = controlGroupRecallTap(tap, 2, 1350);
    expect(result.shouldCenterCamera).toBe(false);
    tap = result.nextTap;

    result = controlGroupRecallTap(tap, 1, 1400);
    expect(result.shouldCenterCamera).toBe(false);
    tap = result.nextTap;

    result = controlGroupRecallTap(tap, 1, 1800);
    expect(result.shouldCenterCamera).toBe(true);
    tap = result.nextTap;

    result = controlGroupRecallTap(tap, 1, 2300);
    expect(result.shouldCenterCamera).toBe(false);
  });

  it("centers a recalled group on the average position of its live entities", () => {
    const center = controlGroupCenter(["worker-1", "barracks-1"], [
      { id: "worker-1", x: 20, y: 60 },
      { id: "barracks-1", x: 100, y: 140 },
      { id: "enemy-1", x: 1000, y: 1000 },
    ]);

    expect(center).toEqual({ x: 60, y: 100 });
    expect(controlGroupCenter(["missing"], [{ id: "worker-1", x: 20, y: 60 }])).toBeUndefined();
  });
});
