import { describe, expect, it } from "vitest";
import { pruneControlGroups, recallControlGroup, replaceControlGroup, type ControlGroups } from "./control-groups";

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
});
