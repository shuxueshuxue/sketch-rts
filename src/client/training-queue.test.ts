import { describe, expect, it } from "vitest";
import { trainingProgressButtonsForSelection, trainingQueueCountText } from "./training-queue";
import type { Building } from "../shared/types";

describe("training queue presentation", () => {
  it("shows a stack count only when a building has multiple queued jobs", () => {
    expect(trainingQueueCountText(0)).toBe("");
    expect(trainingQueueCountText(1)).toBe("");
    expect(trainingQueueCountText(5)).toBe("x5");
  });

  it("reports the active and queued production jobs for selected buildings", () => {
    expect(trainingProgressButtonsForSelection([building()])).toMatchObject([
      { buildingId: "barracks-1", unitKind: "footman", status: "training", progress: expect.any(Number) },
      { buildingId: "barracks-1", unitKind: "lancer", status: "queued", progress: 0 },
    ]);
  });
});

function building(): Building {
  return {
    id: "barracks-1",
    owner: "player",
    kind: "barracks",
    x: 0,
    y: 0,
    hp: 620,
    maxHp: 620,
    radius: 40,
    complete: true,
    buildProgress: 0,
    buildTime: 0,
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 1,
    cooldown: 0,
    rallyX: 0,
    rallyY: 0,
    queue: [
      { unitKind: "footman", remaining: 80 },
      { unitKind: "lancer", remaining: 140 },
    ],
    researchQueue: [],
  };
}
