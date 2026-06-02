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

  it("resolves economy and tech intents through the shared SDK command surface", () => {
    const game = createGame("combatArena", {
      players: ["v2"],
      teams: { v2: "north" },
      scenario: {
        replaceDefaultUnits: true,
        replaceDefaultBuildings: true,
        replaceDefaultResources: true,
        replaceDefaultMercenaryCamps: true,
        addUnits: [{ id: "v2-worker", owner: "v2", kind: "worker", x: 260, y: 280 }],
        addBuildings: [
          { id: "v2-main", owner: "v2", kind: "townHall", x: 230, y: 260 },
          { id: "v2-barracks", owner: "v2", kind: "barracks", x: 330, y: 260 },
        ],
        addResources: [{ id: "gold-v2-main", kind: "goldMine", x: 260, y: 260, amount: 6000 }],
        addMercenaryCamps: [{ id: "camp-main", x: 420, y: 300, radius: 54, hireKind: "mercenary", cost: 160, stock: 1, cooldown: 90, cooldownRemaining: 0 }],
      },
    });
    const snapshot = snapshotGame(game);

    expect(resolveSdkCommandIntent(snapshot, "v2", { type: "mine", unitIds: ["v2-worker"], resourceId: "gold-v2-main" })).toEqual({
      type: "mine",
      unitIds: ["v2-worker"],
      resourceId: "gold-v2-main",
    });
    expect(resolveSdkCommandIntent(snapshot, "v2", { type: "repair", unitIds: ["v2-worker"], buildingId: "v2-main" })).toEqual({
      type: "repair",
      unitIds: ["v2-worker"],
      buildingId: "v2-main",
    });
    expect(resolveSdkCommandIntent(snapshot, "v2", { type: "build", unitId: "v2-worker", buildingKind: "farm", x: 320, y: 320 })).toEqual({
      type: "build",
      unitId: "v2-worker",
      buildingKind: "farm",
      x: 320,
      y: 320,
    });
    expect(resolveSdkCommandIntent(snapshot, "v2", { type: "train", buildingId: "v2-barracks", unitKind: "footman" })).toEqual({
      type: "train",
      buildingId: "v2-barracks",
      unitKind: "footman",
    });
    expect(resolveSdkCommandIntent(snapshot, "v2", { type: "research", buildingId: "v2-barracks", upgradeKind: "weaponTraining" })).toEqual({
      type: "research",
      buildingId: "v2-barracks",
      upgradeKind: "weaponTraining",
    });
    expect(resolveSdkCommandIntent(snapshot, "v2", { type: "hire", campId: "camp-main" })).toEqual({
      type: "hire",
      campId: "camp-main",
    });
  });

  it("does not steal a worker already assigned by a previous high-level build intent", () => {
    const game = createGame("combatArena", {
      players: ["v2"],
      teams: { v2: "north" },
      scenario: {
        replaceDefaultUnits: true,
        replaceDefaultBuildings: true,
        replaceDefaultResources: true,
        addUnits: [
          { id: "builder-in-flight", owner: "v2", kind: "worker", x: 330, y: 320, order: { type: "move", x: 360, y: 320 } },
          { id: "available-miner", owner: "v2", kind: "worker", x: 260, y: 280, order: { type: "mine", resourceId: "gold-v2-main", phase: "toMine", timer: 0 } },
        ],
        addBuildings: [{ id: "v2-main", owner: "v2", kind: "townHall", x: 230, y: 260 }],
        addResources: [{ id: "gold-v2-main", kind: "goldMine", x: 260, y: 260, amount: 6000 }],
      },
    });

    expect(resolveSdkCommandIntent(snapshotGame(game), "v2", { type: "build", buildingKind: "farm", x: 370, y: 320 })).toEqual({
      type: "build",
      unitId: "available-miner",
      buildingKind: "farm",
      x: 370,
      y: 320,
    });
  });

  it("resolves retreat-wounded intent to only pull low-health combat units", () => {
    const game = createGame("combatArena", {
      players: ["v2"],
      teams: { v2: "north" },
      scenario: {
        replaceDefaultUnits: true,
        replaceDefaultBuildings: true,
        replaceDefaultResources: true,
        addUnits: [
          { id: "hurt-archer", owner: "v2", kind: "archer", x: 500, y: 500, hp: 30 },
          { id: "healthy-footman", owner: "v2", kind: "footman", x: 520, y: 500 },
          { id: "hurt-worker", owner: "v2", kind: "worker", x: 540, y: 500, hp: 10 },
        ],
        addBuildings: [{ id: "v2-main", owner: "v2", kind: "townHall", x: 200, y: 200 }],
      },
    });

    expect(resolveSdkCommandIntent(snapshotGame(game), "v2", { type: "retreatWounded", hpRatio: 0.5 })).toEqual({
      type: "move",
      unitIds: ["hurt-archer"],
      x: 200,
      y: 200,
    });
  });

  it("resolves item and ability intents through the shared SDK command surface", () => {
    const game = createGame("combatArena", {
      players: ["v2"],
      teams: { v2: "north" },
      scenario: {
        replaceDefaultUnits: true,
        replaceDefaultBuildings: true,
        replaceDefaultResources: true,
        addUnits: [
          { id: "v2-priest", owner: "v2", kind: "priest", x: 260, y: 280 },
          { id: "v2-footman", owner: "v2", kind: "footman", x: 300, y: 280 },
        ],
        addBuildings: [{ id: "v2-main", owner: "v2", kind: "townHall", x: 230, y: 260 }],
        addItems: [{ id: "book", kind: "experienceBook", x: 300, y: 280, cooldownRemaining: 0 }],
      },
    });
    const snapshot = snapshotGame(game);

    expect(resolveSdkCommandIntent(snapshot, "v2", { type: "pickupItem", unitId: "v2-footman", itemId: "book" })).toEqual({
      type: "pickupItem",
      unitId: "v2-footman",
      itemId: "book",
    });
    expect(resolveSdkCommandIntent(snapshot, "v2", { type: "cast", unitId: "v2-priest", ability: "heal", targetId: "v2-footman" })).toEqual({
      type: "cast",
      unitId: "v2-priest",
      ability: "heal",
      targetId: "v2-footman",
    });
    expect(resolveSdkCommandIntent(snapshot, "v2", { type: "useItem", unitId: "v2-footman", itemId: "book" })).toEqual({
      type: "useItem",
      unitId: "v2-footman",
      itemId: "book",
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
