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

  it("does not pull retreat-claimed fighters back into focus fire", () => {
    const game = sketchScene("spell-tactics-focus-respects-retreat-claims")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 150, 800)
      .townHall("v1", 1450, 800)
      .unit("v2", "footman", 660, 780, { id: "healthy-footman" })
      .unit("v2", "archer", 650, 830, { id: "healthy-archer" })
      .unit("v2", "lancer", 690, 805, { id: "retreat-lancer", hp: 58 })
      .unit("v1", "archer", 735, 805, { id: "target", hp: 35 })
      .build()
      .createGame();
    const memory = createAiPolicyMemory();
    memory.unitClaims["retreat-lancer"] = { kind: "retreat", targetId: "retreat", x: 150, y: 200, sinceTick: 0, expiresTick: 900 };

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams, policyMode: "combat", memory })).toEqual({
      type: "attack",
      unitIds: ["healthy-footman", "healthy-archer"],
      targetId: "target",
    });
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

  it("drops a remembered focus target when only a small tail can still fight it", () => {
    const scene = sketchScene("spell-tactics-drop-stale-focus-tail")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 150, 800)
      .townHall("v1", 1450, 800)
      .unit("v2", "raider", 1340, 800, { id: "tail-raider-a" })
      .unit("v2", "lancer", 1360, 830, { id: "tail-lancer-b" })
      .unit("v1", "raider", 1480, 810, { id: "remembered-runner", hp: 24 })
      .unit("v1", "archer", 760, 790, { id: "front-archer", hp: 55 });
    for (let index = 0; index < 10; index += 1) scene.unit("v2", index % 3 === 0 ? "archer" : "footman", 680 + index * 8, 730 + index * 12, { id: `front-fighter-${index + 1}` });
    const game = scene.build().createGame();
    const memory = createAiPolicyMemory();
    memory.strategicPlan = { focusTargetOwner: "v1", focusTargetId: "remembered-runner", focusTargetSinceTick: 0, focusTargetUpdatedTick: 120 };

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams, policyMode: "combat", memory })).toEqual({
      type: "attack",
      unitIds: Array.from({ length: 10 }, (_, index) => `front-fighter-${index + 1}`),
      targetId: "front-archer",
    });
  });

  it("targets high-value combat casters before ordinary front-line damage dealers", () => {
    const game = sketchScene("spell-tactics-caster-focus-priority")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 150, 800)
      .townHall("v1", 1450, 800)
      .unit("v2", "knight", 680, 760, { id: "knight" })
      .unit("v2", "golem", 700, 800, { id: "golem" })
      .unit("v2", "archer", 680, 840, { id: "archer" })
      .unit("v1", "lancer", 760, 800, { id: "front-lancer" })
      .unit("v1", "summoner", 790, 820, { id: "summoner" })
      .unit("v1", "priest", 810, 780, { id: "priest" })
      .build()
      .createGame();

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams, policyMode: "combat" })).toEqual({
      type: "attack",
      unitIds: ["knight", "golem", "archer"],
      targetId: "summoner",
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

  it("lets a small nearby group pick off a critically wounded target", () => {
    const game = sketchScene("spell-tactics-critical-pickoff")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .unit("v2", "archer", 760, 790, { id: "archer" })
      .unit("v2", "contractArcher", 780, 820, { id: "contract-archer" })
      .unit("v2", "fieldMedic", 820, 800, { id: "field-medic" })
      .unit("v1", "archer", 930, 805, { id: "critical-archer", hp: 8 })
      .unit("v1", "mercenary", 960, 820)
      .unit("v1", "footman", 990, 850)
      .unit("v1", "fieldMedic", 1020, 880)
      .build()
      .createGame();

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toEqual({
      type: "attack",
      unitIds: ["archer", "contract-archer", "field-medic"],
      targetId: "critical-archer",
    });
  });

  it("lets one ranged survivor finish a killable target already in range", () => {
    const game = sketchScene("spell-tactics-solo-finisher")
      .map("bareDuel")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 500, 500)
      .unit("v2", "archer", 660, 720, { id: "last-archer" })
      .unit("v1", "summoner", 940, 760, { id: "killable-summoner", hp: 6 })
      .unit("v1", "contractArcher", 900, 720, { id: "healthy-archer", hp: 95 })
      .unit("v1", "priest", 910, 780, { id: "wounded-priest", hp: 40 })
      .build()
      .createGame();

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toEqual({
      type: "attack",
      unitIds: ["last-archer"],
      targetId: "killable-summoner",
    });
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

  it("keeps a medium squad focused on a wounded target while outnumbered in every lane", () => {
    const scene = sketchScene("spell-tactics-combat-medium-group-focus")
      .map("combatArena")
      .replaceDefaults()
      .player("v2", { team: "north" })
      .player("v1", { team: "south" })
      .townHall("v2", 150, 800)
      .townHall("v1", 1450, 800)
      .unit("v1", "archer", 790, 790, { id: "wounded-archer", hp: 30 });
    for (let index = 0; index < 6; index += 1) scene.unit("v2", index % 2 === 0 ? "archer" : "footman", 680 + index * 12, 740 + index * 18, { id: `v2-fighter-${index + 1}` });
    for (let index = 0; index < 10; index += 1) scene.unit("v1", index % 3 === 0 ? "archer" : "footman", 820 + index * 8, 760 + index * 12, { id: `v1-guard-${index + 1}` });
    const game = scene.build().createGame();

    const expected = {
      type: "attack",
      unitIds: Array.from({ length: 6 }, (_, index) => `v2-fighter-${index + 1}`),
      targetId: "wounded-archer",
    };

    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams })).toEqual(expected);
    expect(planFocusFireCommand(snapshotGame(game), "v2", { version: "v2", teams: game.teams, policyMode: "combat" })).toEqual(expected);
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
