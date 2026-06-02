import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { planAbilityCommands, planFocusFireCommand } from "./spell-tactics";

describe("AI spell and focus tactics", () => {
  it("casts heal on a nearby wounded allied unit", () => {
    const game = sketchScene("spell-tactics-heal")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .townHall("v2", 500, 500)
      .unit("v2", "priest", 540, 500, { id: "priest" })
      .unit("v2", "footman", 570, 500, { id: "wounded", hp: 30 })
      .build()
      .createGame();

    expect(planAbilityCommands(snapshotGame(game), "v2", { version: "v2" })[0]).toEqual({ type: "cast", unitId: "priest", ability: "heal", targetId: "wounded" });
  });

  it("focuses nearby v2 fighters onto one enemy target", () => {
    const game = sketchScene("spell-tactics-focus")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .unit("v2", "footman", 540, 500, { id: "footman" })
      .unit("v2", "archer", 560, 500, { id: "archer" })
      .unit("v1", "lancer", 620, 500, { id: "target", hp: 20 })
      .build()
      .createGame();

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toEqual({ type: "attack", unitIds: ["footman", "archer"], targetId: "target" });
  });

  it("does not pin a small ranged group into a stronger local enemy squad", () => {
    const game = sketchScene("spell-tactics-no-disadvantaged-ranged-focus")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .unit("v2", "contractArcher", 820, 760, { id: "archer-a" })
      .unit("v2", "contractArcher", 850, 780, { id: "archer-b" })
      .unit("v2", "contractArcher", 880, 800, { id: "archer-c" })
      .unit("v1", "mercenary", 930, 820, { id: "target", hp: 95 })
      .unit("v1", "mercenary", 960, 850)
      .unit("v1", "footman", 990, 880)
      .unit("v1", "fieldMedic", 1020, 910)
      .build()
      .createGame();

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toBeUndefined();
  });

  it("uses focus fire in combat mode even when the local enemy army is larger", () => {
    const game = sketchScene("spell-tactics-combat-focus")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 150, 800)
      .unit("v2", "footman", 700, 760, { id: "front-a" })
      .unit("v2", "lancer", 700, 800, { id: "front-b" })
      .unit("v2", "archer", 680, 840, { id: "back-a" })
      .townHall("v1", 1450, 800)
      .unit("v1", "mercenary", 760, 760, { id: "wounded-target", hp: 40 })
      .unit("v1", "footman", 790, 800)
      .unit("v1", "fieldMedic", 810, 840)
      .unit("v1", "archer", 830, 880)
      .unit("v1", "raider", 850, 920)
      .build()
      .createGame();

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams, policyMode: "combat" })).toEqual({
      type: "attack",
      unitIds: ["front-a", "front-b", "back-a"],
      targetId: "wounded-target",
    });
  });
});
