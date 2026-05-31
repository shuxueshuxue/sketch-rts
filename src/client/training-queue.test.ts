import { describe, expect, it } from "vitest";
import { trainingQueueCountText } from "./training-queue";

describe("training queue presentation", () => {
  it("shows a stack count only when a building has multiple queued jobs", () => {
    expect(trainingQueueCountText(0)).toBe("");
    expect(trainingQueueCountText(1)).toBe("");
    expect(trainingQueueCountText(5)).toBe("x5");
  });
});
