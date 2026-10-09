import { describe, expect, it } from "vitest";
import { ABILITY_DEFS, resolveVariant } from "../catalog";
import { createGame, snapshotGame } from "../sim";
import { checkCommandLegality, narrowFrameCommandToLiveOperands } from "./command-validation";
import { isGameCommand } from "../command-schema";
import type { GameCommand, UnitKind } from "../types";

const mechanicalKinds: UnitKind[] = ["golem", "rubbleGolem", "rockGolem", "graniteGolem", "siegeRam", "ballista", "catapult", "organGun", "transport", "warship", "shipOfTheLine", "cutter", "bombardShip", "fireShip", "carrier"];

describe("mechanical command legality", () => {
  it.each(mechanicalKinds)("rejects medical healing and accepts worker repairs for %s", kind => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.spawnUnit("player", "worker", 900, 900);
    const priest = game.spawnUnit("player", "priest", 950, 900);
    const target = game.spawnUnit("player", kind, 1000, 900);
    target.hp /= 2;
    const snapshot = snapshotGame(game);
    expect(checkCommandLegality(snapshot, "player", { type: "cast", unitId: priest.id, ability: "heal", targetId: target.id }))
      .toEqual({ message: "Healing cannot restore mechanical units", transient: false });
    expect(checkCommandLegality(snapshot, "player", { type: "repairUnit", unitIds: [worker.id], targetId: target.id })).toBeUndefined();
  });

  it("requires an own damaged mechanical target and workers, with stale frame operands safely ignored", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const worker = game.spawnUnit("player", "worker", 900, 900);
    const target = game.spawnUnit("player", "golem", 1000, 900);
    const soldier = game.spawnUnit("player", "footman", 1100, 900);
    const command: GameCommand = { type: "repairUnit", unitIds: [worker.id], targetId: target.id };
    expect(isGameCommand(command)).toBe(true);
    expect(isGameCommand({ ...command, targetId: 1 })).toBe(false);
    expect(isGameCommand({ ...command, unitIds: worker.id })).toBe(false);
    expect(checkCommandLegality(game, "player", command)?.message).toMatch(/fully repaired/);
    target.hp -= 100;
    game.players.player!.gold = 0;
    expect(checkCommandLegality(game, "player", command)).toBeUndefined();
    expect(checkCommandLegality(game, "player", { ...command, unitIds: [soldier.id] })?.message).toMatch(/requires a worker/);
    expect(checkCommandLegality(game, "player", { ...command, targetId: soldier.id })?.message).toMatch(/Only mechanical/);
    expect(checkCommandLegality(game, "player", { ...command, type: "repairShip" })?.message).toMatch(/Unknown player ship/);
    target.owner = "enemy";
    expect(checkCommandLegality(game, "player", command)?.transient).toBe(true);
    expect(narrowFrameCommandToLiveOperands(game, "player", command)).toBeUndefined();
    target.owner = "player";
    target.hp = 0;
    expect(narrowFrameCommandToLiveOperands(game, "player", command)).toBeUndefined();
  });

  it("uses campaign classification for medical targets, repair and passive skill learning", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const priest = game.spawnUnit("player", "priest", 900, 900);
    const worker = game.spawnUnit("player", "worker", 950, 900);
    const target = game.spawnUnit("player", "footman", 1000, 900);
    game.variants = { automaton: resolveVariant({ base: "footman", unitClass: "mechanical" }) };
    target.variant = "automaton";
    target.hp /= 2;
    target.level = 3;
    target.veteranSkillChoices = ["veteranEndurance", "veteranRenewal", "veteranInnerFire"];
    expect(checkCommandLegality(game, "player", { type: "cast", unitId: priest.id, ability: "heal", targetId: target.id })?.message).toBe("Healing cannot restore mechanical units");
    expect(checkCommandLegality(game, "player", { type: "repairUnit", unitIds: [worker.id], targetId: target.id })).toBeUndefined();
    expect(checkCommandLegality(game, "player", { type: "learnVeteranSkill", unitId: target.id, skill: "veteranEndurance" })?.message).toMatch(/unit class/);
    for (const skill of ["veteranRenewal", "veteranInnerFire"] as const) expect(checkCommandLegality(game, "player", { type: "learnVeteranSkill", unitId: target.id, skill })).toBeUndefined();
  });

  it("applies an ability's declarative class filter to non-healing targets", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const caster = game.spawnUnit("player", "witch", 900, 900);
    const mechanical = game.spawnUnit("enemy", "golem", 1000, 900);
    const flesh = game.spawnUnit("enemy", "footman", 1100, 900);
    const previous = ABILITY_DEFS.curse.targets;
    ABILITY_DEFS.curse.targets = { unitClasses: ["nonMechanical"] };
    try {
      expect(checkCommandLegality(game, "player", { type: "cast", unitId: caster.id, ability: "curse", targetId: mechanical.id })?.message).toMatch(/unit class/);
      expect(checkCommandLegality(game, "player", { type: "cast", unitId: caster.id, ability: "curse", targetId: flesh.id })).toBeUndefined();
    } finally {
      if (previous) ABILITY_DEFS.curse.targets = previous;
      else delete ABILITY_DEFS.curse.targets;
    }
  });
});
