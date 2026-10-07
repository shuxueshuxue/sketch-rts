import { describe, expect, it } from "vitest";
import { buildSelectionGroups, cycleFocusedSelectionId, focusedSelectionEntities, inventoryUnitsForCommandCard, isUnitCommandPage, resolveFocusedSelectionId, selectedCargoTransports } from "./hud-model";
import type { Building, GameSnapshot, PlayerState, Unit } from "../shared/types";

const player: PlayerState = {
  race: "grove",
  gold: 500,
  supplyUsed: 0,
  supplyCap: 10,
  upgrades: { weaponTraining: 0, reinforcedPlating: 0, buildingDurability: 0, speedTraining: 0, rangeTraining: 0, leadership: 0 },
};

describe("hud selection model", () => {
  it("keeps inventory on the focused own unit card and restores it only after leaving a submenu or site", () => {
    const snapshot = snapshotWith({ units: [unit("worker-1", "worker"), unit("buyer", "archer"), unit("enemy-1", "worker", "enemy")] });
    const main = { paletteOpen: false, targeting: false, siteSelected: false };
    const inventory = (context: typeof main, focusedId = "worker-1") => inventoryUnitsForCommandCard(snapshot, focusedId, "player", context).map(unit => unit.id);
    expect(inventory(main)).toEqual(["worker-1"]);
    for (const context of [{ ...main, paletteOpen: true }, { ...main, siteSelected: true }, { ...main, targeting: true }]) {
      expect(isUnitCommandPage(context)).toBe(false);
      expect(inventory(context)).toEqual([]);
    }
    expect(inventory(main, "enemy-1")).toEqual([]);
    expect(inventory(main, "buyer")).toEqual(["buyer"]);
  });

  it("shows every selected own transport's cargo, including campaign capacity, without exposing enemy cargo", () => {
    const ferry = { ...unit("ferry", "transport"), cargo: [unit("aboard", "archer")] };
    const carrier = { ...unit("carrier", "carrier"), cargo: [unit("aboard-2", "footman")] };
    const campaign = { ...unit("campaign", "warship"), cargoCapacity: 30, cargo: [unit("aboard-3", "worker")] };
    const enemy = { ...unit("enemy-ferry", "transport", "enemy"), cargo: [unit("enemy-cargo", "archer", "enemy")] };
    const snapshot = snapshotWith({ units: [ferry, carrier, campaign, enemy, unit("unselected", "transport"), unit("soldier", "footman")] });
    expect(selectedCargoTransports(snapshot, new Set(["ferry", "carrier", "campaign", "enemy-ferry", "soldier"]), "player")).toEqual([ferry, carrier, campaign]);
    expect(selectedCargoTransports(snapshot, new Set(["enemy-ferry"]), "player")).toEqual([]);
  });
  it("groups selected units by model and marks the current focus group", () => {
    const snapshot = snapshotWith({
      units: [
        unit("worker-1", "worker"),
        unit("worker-2", "worker"),
        unit("archer-1", "archer"),
        unit("enemy-1", "worker", "enemy"),
      ],
    });
    const selectedIds = new Set(["worker-1", "worker-2", "archer-1", "enemy-1"]);

    expect(buildSelectionGroups(snapshot, selectedIds, "archer-1", "player")).toEqual([
      { id: "unit:worker", entityType: "unit", kind: "worker", count: 2, ids: ["worker-1", "worker-2"], focused: false },
      { id: "unit:archer", entityType: "unit", kind: "archer", count: 1, ids: ["archer-1"], focused: true },
    ]);
  });

  it("keeps focus on a selected live entity and falls back when it disappears", () => {
    const snapshot = snapshotWith({
      units: [unit("worker-1", "worker"), unit("archer-1", "archer")],
      buildings: [building("barracks-1", "barracks")],
    });

    expect(resolveFocusedSelectionId(snapshot, new Set(["worker-1", "archer-1"]), "archer-1", "player")).toBe("archer-1");
    expect(resolveFocusedSelectionId(snapshot, new Set(["worker-1", "archer-1"]), "dead-unit", "player")).toBe("worker-1");
    expect(resolveFocusedSelectionId(snapshot, new Set(["barracks-1"]), undefined, "player")).toBe("barracks-1");
  });

  it("returns commands and items from the focused entity rather than the whole selection", () => {
    const snapshot = snapshotWith({
      units: [unit("worker-1", "worker"), unit("archer-1", "archer")],
      buildings: [building("barracks-1", "barracks")],
    });

    expect(focusedSelectionEntities(snapshot, "worker-1", "player").units.map((candidate) => candidate.id)).toEqual(["worker-1"]);
    expect(focusedSelectionEntities(snapshot, "barracks-1", "player").buildings.map((candidate) => candidate.id)).toEqual(["barracks-1"]);
    expect(focusedSelectionEntities(snapshot, "archer-1", "enemy").units).toEqual([]);
  });

  it("cycles the focused selection group forward and backward like RTS tab selection", () => {
    const snapshot = snapshotWith({
      units: [unit("worker-1", "worker"), unit("worker-2", "worker"), unit("archer-1", "archer")],
      buildings: [building("barracks-1", "barracks")],
    });
    const selectedIds = new Set(["worker-1", "worker-2", "archer-1", "barracks-1"]);

    expect(cycleFocusedSelectionId(snapshot, selectedIds, "worker-1", "player", 1)).toBe("archer-1");
    expect(cycleFocusedSelectionId(snapshot, selectedIds, "archer-1", "player", 1)).toBe("barracks-1");
    expect(cycleFocusedSelectionId(snapshot, selectedIds, "worker-1", "player", -1)).toBe("barracks-1");
  });
});

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

function unit(id: string, kind: Unit["kind"], owner: Unit["owner"] = "player"): Unit {
  return {
    id,
    owner,
    kind,
    x: 0,
    y: 0,
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

function building(id: string, kind: Building["kind"]): Building {
  return {
    id,
    owner: "player",
    kind,
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    radius: 30,
    complete: true,
    buildProgress: 0,
    buildTime: 100,
    attackDamage: 0,
    attackRange: 0,
    attackCooldown: 1,
    cooldown: 0,
    rallyX: 0,
    rallyY: 0,
    queue: [],
    researchQueue: [],
  };
}

it('inspects a foreign entity while keeping its command authority empty', () => {
  const snapshot=snapshotWith({units:[unit('enemy','knight','enemy')]});
  const selected=new Set(['enemy']);
  expect(resolveFocusedSelectionId(snapshot,selected,undefined,'player')).toBe('enemy');
  expect(buildSelectionGroups(snapshot,selected,'enemy','player')[0]?.kind).toBe('knight');
  expect(focusedSelectionEntities(snapshot,'enemy','player')).toEqual({units:[],buildings:[]});
});
