import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "./sim";
import { createMapPresentation, projectWorldToRect } from "./presentation";

describe("map presentation model", () => {
  it("projects gameplay objects through one semantic model for main map and minimap", () => {
    const game = createGame("verdantCrossroads");
    const snapshot = snapshotGame(game);

    const marks = createMapPresentation(snapshot);

    expect(marks.some((mark) => mark.category === "terrain" && mark.kind === "road")).toBe(true);
    expect(marks.some((mark) => mark.category === "goldMine" && mark.sourceIds.includes("gold-player-main"))).toBe(true);
    expect(marks.some((mark) => mark.category === "mercenaryCamp" && mark.sourceIds.includes("merc-camp-crossroad"))).toBe(true);
    expect(marks.some((mark) => mark.category === "building" && mark.owner === "player")).toBe(true);
    expect(marks.some((mark) => mark.category === "unit" && mark.owner === "player")).toBe(true);

    const mine = marks.find((mark) => mark.category === "goldMine" && mark.sourceIds.includes("gold-player-main"));
    expect(mine).toBeDefined();
    expect(projectWorldToRect(mine!, snapshot.map, { x: 800, y: 600, width: 200, height: 200 })).toEqual({
      x: 800 + (mine!.x / snapshot.map.width) * 200,
      y: 600 + (mine!.y / snapshot.map.height) * 200,
    });
  });

  it("summarizes wildling camp power into green orange and red bands for both renderers", () => {
    const green = snapshotGame(createGame("verdantCrossroads"));
    const orange = snapshotGame(
      createGame("verdantCrossroads", {
        scenario: {
          addUnits: [
            { id: "orange-brute-1", owner: "neutral", kind: "stonebackBrute", x: 2100, y: 2100 },
            { id: "orange-brute-2", owner: "neutral", kind: "stonebackBrute", x: 2160, y: 2110 },
            { id: "orange-witch-1", owner: "neutral", kind: "gladeWitch", x: 2125, y: 2160 },
            { id: "orange-slinger-1", owner: "neutral", kind: "thornSlinger", x: 2185, y: 2185 },
          ],
        },
      }),
    );
    const red = snapshotGame(createGame("grandThirty", { players: ["human-1", "ai-1"], aiPlayers: ["ai-1"], teams: { "human-1": "north", "ai-1": "south" } }));

    expect(createMapPresentation(green).some((mark) => mark.category === "wildlingCamp" && mark.powerBand === "green")).toBe(true);
    expect(createMapPresentation(orange).some((mark) => mark.category === "wildlingCamp" && mark.powerBand === "orange" && (mark.power ?? 0) >= 10)).toBe(true);
    expect(createMapPresentation(red).some((mark) => mark.category === "wildlingCamp" && mark.powerBand === "red" && (mark.power ?? 0) >= 20)).toBe(true);
  });
});
