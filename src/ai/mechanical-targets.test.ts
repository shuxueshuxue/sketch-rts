import { describe, expect, it } from "vitest";
import { sketchScene } from "../sdk/scene";
import { ABILITY_DEFS, resolveVariant } from "../shared/catalog";
import { snapshotGame } from "../shared/sim";
import { isMechanicalUnit } from "../shared/unit-targeting";
import { CommandFrameRuntime } from "../shared/sim/command-frame-runtime";
import { AI_SCRIPT_VERSIONS, type AiScriptVersion } from "./policy";
import { createAiRuntime, createPresetAiRuntimeFramePlanner } from "./runtime";
import { planAbilityCommands } from "./policy/spell-tactics";
import { planAbilityCommands as planFrozenAbilityCommands } from "./policy-v2prod/spell-tactics";

describe("mechanical target compatibility across AI versions", () => {
  it.each([...Object.keys(AI_SCRIPT_VERSIONS), "v2-prod"] as AiScriptVersion[])("%s runs mixed armies without issuing illegal healing", version => {
    const game = sketchScene(`mechanical-${version}`).map("bareDuel").replaceDefaults()
      .player("player", { race: "grove" }).player("enemy", { race: "ember" })
      .townHall("player", 500, 500).townHall("enemy", 3400, 3400)
      .unit("player", "golem", 950, 900, { id: "golem", hpRatio: .15 })
      .unit("player", "ballista", 910, 950, { id: "ballista", hpRatio: .15 })
      .unit("player", "footman", 970, 930, { id: "automaton", hpRatio: .15 })
      .unit("player", "footman", 1030, 900, { id: "patient", hpRatio: .4 })
      .unit("player", "priest", 900, 900, { id: "healer" }).build().createGame();
    game.variants = { automaton: resolveVariant({ base: "footman", unitClass: "mechanical" }) };
    game.units.find(unit => unit.id === "automaton")!.variant = "automaton";
    const patient = game.units.find(unit => unit.id === "patient")!;
    const startingHp = patient.hp;
    const mechanicalHp = new Map(game.units.filter(unit => isMechanicalUnit(unit, game)).map(unit => [unit.id, unit.hp]));
    const ai = createAiRuntime(["player"], { version, policyMode: "combat" });
    const runtime = new CommandFrameRuntime({ game, roomId: "mechanical-targets", rejectionLabel: version, aiPlanner: createPresetAiRuntimeFramePlanner(game, ai) });
    for (let tick = 0; tick < 45; tick++) runtime.tick([], { onFrame(frame) {
      for (const { command } of frame.commands) if (command.type === "cast" && ABILITY_DEFS[command.ability].behavior === "heal") {
        const target = game.units.find(unit => unit.id === command.targetId)!;
        expect(isMechanicalUnit(target, game)).toBe(false);
      }
    } });
    expect(patient.hp).toBeGreaterThan(startingHp);
    for (const unit of game.units) if (mechanicalHp.has(unit.id)) expect(unit.hp).toBe(mechanicalHp.get(unit.id));
  });

  it.each([planAbilityCommands, planFrozenAbilityCommands])("reads declarative targets for curse candidate selection", planner => {
    const game = sketchScene("filtered-curse").map("bareDuel").replaceDefaults()
      .player("player", { race: "grove" }).player("enemy", { race: "ember" })
      .townHall("player", 500, 500).townHall("enemy", 3400, 3400)
      .unit("player", "witch", 900, 900, { id: "caster" })
      .unit("enemy", "golem", 980, 900, { id: "mechanical" })
      .unit("enemy", "footman", 1080, 900, { id: "valid" }).build().createGame();
    const previous = ABILITY_DEFS.curse.targets;
    ABILITY_DEFS.curse.targets = { unitClasses: ["nonMechanical"] };
    try {
      expect(planner(snapshotGame(game), "player", { version: "v2" })).toContainEqual({ type: "cast", unitId: "caster", ability: "curse", targetId: "valid" });
    } finally {
      if (previous) ABILITY_DEFS.curse.targets = previous;
      else delete ABILITY_DEFS.curse.targets;
    }
  });
});
