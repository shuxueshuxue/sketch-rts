import { describe, expect, it } from "vitest";
import { createGame, snapshotGame } from "../../shared/sim";
import { resolveSdkCommandIntent } from "./intent";

describe("SDK command intents", () => {
  it("builds expansion and creep commands from snapshot-level intent", () => {
    const game = createGame("combatArena", {
      players: ["v2", "v1a"],
      teams: { v2: "north", v1a: "south" },
      scenario: {
        replaceDefaultUnits: true,
        replaceDefaultBuildings: true,
        replaceDefaultResources: true,
        replaceDefaultMercenaryCamps: true,
        addUnits: [
          { id: "v2-worker", owner: "v2", kind: "worker", x: 260, y: 280 },
          { id: "v2-footman", owner: "v2", kind: "footman", x: 320, y: 300 },
          { id: "wild-camp-1", owner: "neutral", kind: "wildling", x: 900, y: 920 },
        ],
        addBuildings: [{ id: "v2-main", owner: "v2", kind: "townHall", x: 230, y: 260 }],
        addResources: [
          { id: "gold-v2-main", kind: "goldMine", x: 260, y: 260, amount: 6000 },
          { id: "gold-natural", kind: "goldMine", x: 760, y: 760, amount: 6000 },
        ],
        addMercenaryCamps: [{ id: "camp-natural", x: 900, y: 900, radius: 54, hireKind: "mercenary", cost: 160, stock: 1, cooldown: 90, cooldownRemaining: 0 }],
      },
    });

    expect(resolveSdkCommandIntent(snapshotGame(game), "v2", { type: "expand", resourceId: "gold-natural" })).toEqual({
      type: "build",
      unitId: "v2-worker",
      buildingKind: "townHall",
      x: 760,
      y: 760,
    });
    expect(resolveSdkCommandIntent(snapshotGame(game), "v2", { type: "creepCamp", campId: "camp-natural", unitIds: "combat" })).toEqual({
      type: "attackMove",
      unitIds: ["v2-footman"],
      x: 900,
      y: 900,
    });
  });

  it("fails loudly when selector intent resolves to no units", () => {
    const game = createGame("combatArena", {
      players: ["v2"],
      teams: { v2: "north" },
      scenario: { replaceDefaultUnits: true, replaceDefaultBuildings: true, replaceDefaultResources: true },
    });

    expect(() => resolveSdkCommandIntent(snapshotGame(game), "v2", { type: "attackMove", unitIds: "combat", x: 800, y: 800 })).toThrow("No v2 units match selector combat");
  });
});
