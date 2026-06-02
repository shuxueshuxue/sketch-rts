import { describe, expect, it } from "vitest";
import { researchCommandButtonsForSelection, researchProgressButtonsForSelection } from "./research-controls";
import type { Building, PlayerState } from "../shared/types";

const barracks: Building = {
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
  queue: [],
  researchQueue: [],
};

const townHall: Building = {
  ...barracks,
  id: "townhall-1",
  kind: "townHall",
  hp: 900,
  maxHp: 900,
};

const player: PlayerState = {
  race: "grove",
  gold: 500,
  supplyUsed: 3,
  supplyCap: 10,
  upgrades: { weaponTraining: 0, reinforcedPlating: 0, buildingDurability: 0 },
};

describe("research controls", () => {
  it("shows research buttons for an eligible selected barracks", () => {
    const commands = researchCommandButtonsForSelection([barracks], player);

    expect(commands).toEqual([
      { label: "Weapon Training", icon: "⚔", hotkey: "w", upgradeKind: "weaponTraining", buildingId: "barracks-1" },
      { label: "Reinforced Plating", icon: "▣", hotkey: "p", upgradeKind: "reinforcedPlating", buildingId: "barracks-1" },
    ]);
  });

  it("shows building durability for an eligible selected town hall", () => {
    const commands = researchCommandButtonsForSelection([townHall], player);

    expect(commands).toEqual([
      { label: "Building Durability", icon: "▥", hotkey: "d", upgradeKind: "buildingDurability", buildingId: "townhall-1" },
    ]);
  });

  it("keeps selected building research visible as progress buttons", () => {
    const commands = researchProgressButtonsForSelection([
      {
        ...barracks,
        researchQueue: [
          { upgradeKind: "weaponTraining", targetLevel: 1, remaining: 100 },
          { upgradeKind: "reinforcedPlating", targetLevel: 1, remaining: 810 },
        ],
      },
    ], player);

    expect(commands[0]).toMatchObject({
      label: "Weapon Training",
      upgradeKind: "weaponTraining",
      buildingId: "barracks-1",
      targetLevel: 1,
      status: "researching",
    });
    expect(commands[0]?.progress).toBeGreaterThan(0);
    expect(commands[1]).toMatchObject({
      label: "Reinforced Plating",
      upgradeKind: "reinforcedPlating",
      status: "queued",
      progress: 0,
    });
  });
});
