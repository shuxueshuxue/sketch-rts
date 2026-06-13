import { describe, expect, it } from "vitest";
import { applySelectionPick, selectInScreenBox, selectNearbySameKindUnits } from "./selection-controls";
import type { Building, GameSnapshot, PlayerState, Unit } from "../shared/types";

const player: PlayerState = {
  race: "grove",
  gold: 500,
  supplyUsed: 0,
  supplyCap: 10,
  upgrades: { weaponTraining: 0, reinforcedPlating: 0, buildingDurability: 0, speedTraining: 0, rangeTraining: 0, leadership: 0 },
};

describe("selection controls", () => {
  it("box-selects units before buildings when both are inside the rectangle", () => {
    const snapshot = snapshotWith({
      units: [unit("worker-1", 100, 100), unit("archer-1", 130, 110)],
      buildings: [building("barracks-1", 110, 120)],
    });

    const result = selectInScreenBox(snapshot, "player", rect(60, 60, 180, 180), (point) => point, emptySelection(), false);

    expect([...result.selectedIds]).toEqual(["worker-1", "archer-1"]);
    expect(result.focusedSelectionId).toBe("worker-1");
  });

  it("box-selects only one building when no units are inside the rectangle", () => {
    const snapshot = snapshotWith({
      buildings: [building("townhall-1", 100, 100, "townHall"), building("barracks-1", 140, 100)],
    });

    const result = selectInScreenBox(snapshot, "player", rect(60, 60, 180, 180), (point) => point, emptySelection(), false);

    expect([...result.selectedIds]).toEqual(["townhall-1"]);
    expect(result.focusedSelectionId).toBe("townhall-1");
  });

  it("shift-adds a picked unit or building into the current selection", () => {
    const previous = { selectedIds: new Set(["worker-1"]), focusedSelectionId: "worker-1" };

    const result = applySelectionPick(previous, ["barracks-1"], true);

    expect([...result.selectedIds]).toEqual(["worker-1", "barracks-1"]);
    expect(result.focusedSelectionId).toBe("barracks-1");
  });

  it("double-click selects nearby same-kind friendly units around the clicked unit", () => {
    const snapshot = snapshotWith({
      units: [
        unit("anchor", 1000, 1000, "player", "footman"),
        unit("near-footman", 1300, 1000, "player", "footman"),
        unit("far-footman", 2200, 1000, "player", "footman"),
        unit("near-archer", 1100, 1000, "player", "archer"),
        unit("enemy-footman", 1050, 1000, "enemy", "footman"),
      ],
    });

    const result = selectNearbySameKindUnits(snapshot, "player", "anchor", 900, emptySelection(), false);

    expect([...result.selectedIds]).toEqual(["anchor", "near-footman"]);
    expect(result.focusedSelectionId).toBe("anchor");
  });
});

function emptySelection() {
  return { selectedIds: new Set<string>(), focusedSelectionId: undefined };
}

function rect(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom };
}

function snapshotWith(input: { units?: Unit[]; buildings?: Building[] }): GameSnapshot {
  return {
    tick: 0,
    map: { id: "bareDuel", name: "Bare Duel", width: 4096, height: 4096, landmarks: [] },
    players: { player, enemy: { ...player, race: "ember" }, enemy2: { ...player, race: "ember" } },
    units: input.units ?? [],
    buildings: input.buildings ?? [],
    resources: [],
    mercenaryCamps: [],
    items: [],
    projectiles: [],
    effects: [],
    match: {
      winner: null,
      endedAtTick: null,
      stats: {
        unitsKilled: ownerStats(),
        unitsLost: ownerStats(),
        buildingsDestroyed: playerStats(),
        nonBaseBuildingsDestroyed: playerStats(),
        neutralUnitsKilled: playerStats(),
        unitsKilledByNeutral: playerStats(),
        mercenaryKills: playerStats(),
        goldSpent: playerStats(),
      },
    },
  };
}

function ownerStats() {
  return { player: 0, enemy: 0, enemy2: 0, neutral: 0 };
}

function playerStats() {
  return { player: 0, enemy: 0, enemy2: 0 };
}

function unit(id: string, x: number, y: number, owner: Unit["owner"] = "player", kind: Unit["kind"] = "worker"): Unit {
  return {
    id,
    owner,
    kind,
    x,
    y,
    hp: 100,
    maxHp: 100,
    speed: 3,
    attackDamage: 10,
    attackRange: 50,
    attackCooldown: 10,
    cooldown: 0,
    radius: 15,
    carryingGold: 0,
    kills: 0,
    xp: 0,
    level: 0,
    effects: [],
    order: { type: "idle" },
  };
}

function building(id: string, x: number, y: number, kind: Building["kind"] = "barracks"): Building {
  return {
    id,
    owner: "player",
    kind,
    x,
    y,
    hp: 100,
    maxHp: 100,
    radius: 30,
    buildProgress: 1,
    buildTime: 1,
    complete: true,
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 1,
    cooldown: 0,
    rallyX: x,
    rallyY: y,
    queue: [],
    researchQueue: [],
  };
}
