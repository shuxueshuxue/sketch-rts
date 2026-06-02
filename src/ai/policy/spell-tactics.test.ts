import { describe, expect, it } from "vitest";
import { snapshotGame } from "../../shared/sim";
import { sketchScene } from "../../sdk/scene";
import { createAiPolicyMemory } from "../memory";
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

  it("keeps focusing a remembered live target instead of scattering damage every frame", () => {
    const game = sketchScene("spell-tactics-remembered-focus")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 150, 800)
      .townHall("v1", 1450, 800)
      .unit("v2", "footman", 650, 780, { id: "footman" })
      .unit("v2", "archer", 640, 830, { id: "archer" })
      .unit("v1", "lancer", 720, 800, { id: "remembered-target" })
      .unit("v1", "raider", 700, 760, { id: "fresh-low-target", hp: 20 })
      .build()
      .createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1", focusTargetId: "remembered-target", focusTargetSinceTick: 0, focusTargetUpdatedTick: 0 };

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams, policyMode: "combat", memory })).toEqual({
      type: "attack",
      unitIds: ["footman", "archer"],
      targetId: "remembered-target",
    });
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

  it("does not pin a tiny combat squad into focus fire while it is outnumbered", () => {
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
      .unit("v1", "footman", 810, 840)
      .unit("v1", "archer", 830, 880)
      .unit("v1", "raider", 850, 920)
      .build()
      .createGame();

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams, policyMode: "combat" })).toBeUndefined();
  });

  it("uses focus fire for a full combat group even when the local enemy army is larger", () => {
    const scene = sketchScene("spell-tactics-combat-full-group-focus")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 150, 800)
      .townHall("v1", 1450, 800)
      .unit("v1", "mercenary", 820, 760, { id: "wounded-target", hp: 40 });
    for (let index = 0; index < 12; index += 1) scene.unit("v2", index % 3 === 0 ? "archer" : "footman", 690 + index * 6, 730 + index * 12, { id: `v2-fighter-${index + 1}` });
    for (let index = 0; index < 16; index += 1) scene.unit("v1", index % 4 === 0 ? "fieldMedic" : "footman", 850 + index * 5, 790 + index * 10, { id: `v1-guard-${index + 1}` });
    const game = scene.build().createGame();

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams, policyMode: "combat" })).toEqual({
      type: "attack",
      unitIds: Array.from({ length: 12 }, (_, index) => `v2-fighter-${index + 1}`),
      targetId: "wounded-target",
    });
  });

});
