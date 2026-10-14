import { describe, expect, it } from "vitest";
import type { Unit } from "../shared/types";
import { createGame, issuePlayerCommand } from "../shared/sim";
import { abilityCommandState, autocastToggle } from "./command-button-state";
import { learnVeteranSkillCommand, nextVeteranStudent, veteranStudent } from "./veteran-controls";

describe("veteran learning selection", () => {
  it("takes one selected soldier from a choice through the real simulation to casting and autocast controls", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const first = unit("first", { hp: 40 });
    const second = unit("second", { x: 30, hp: 40 });
    game.units = [first, second];
    const offers = [...first.veteranSkillChoices!];
    const student = veteranStudent(game.units, first.id)!;
    issuePlayerCommand(game, "player", learnVeteranSkillCommand(student, "veteranHealingWave")!);
    expect(first.veteranSkill).toBe("veteranHealingWave");
    expect(second.veteranSkill).toBeUndefined();
    expect(first.veteranSkillChoices).toEqual(offers);
    expect(nextVeteranStudent(game.units, first.id)?.id).toBe(second.id);
    expect(abilityCommandState([first], "veteranHealingWave", game.units)).toMatchObject({ enabled: true, autocast: "on" });
    const toggle = autocastToggle(game.units, "veteranHealingWave")!;
    issuePlayerCommand(game, "player", { type: "setAutocast", ability: "veteranHealingWave", ...toggle });
    expect(abilityCommandState([first], "veteranHealingWave", game.units).autocast).toBe("off");
    issuePlayerCommand(game, "player", { type: "cast", unitId: first.id, ability: "veteranHealingWave" });
    expect(second.hp).toBeGreaterThan(40);
    expect(abilityCommandState([first], "veteranHealingWave", game.units)).toMatchObject({ enabled: false, reason: "cooldown" });
  });

  it("keeps learning reachable behind an untrained or already trained group representative", () => {
    const rookie = unit("rookie", { level: 0 });
    delete rookie.veteranSkillChoices;
    const trained = unit("trained", { veteranSkill: "veteranResilience" });
    const veteran = unit("veteran");
    const selected = [rookie, trained, veteran];
    expect(veteranStudent(selected, rookie.id)?.id).toBe(veteran.id);
    expect(veteranStudent(selected, trained.id)?.id).toBe(veteran.id);
    expect(veteranStudent(selected, veteran.id)?.id).toBe(veteran.id);
  });

  it("cycles only selected eligible peers, skipping pending choices and campaign variants", () => {
    const first = unit("first");
    const second = unit("second");
    const selected = [first, unit("other-kind", { kind: "archer" }), unit("other-variant", { variant: "captain" }),
      unit("learned", { veteranSkill: "veteranResilience" }), unit("dead", { hp: 0 }), second];
    expect(nextVeteranStudent(selected, first.id)?.id).toBe(second.id);
    expect(nextVeteranStudent(selected, second.id)?.id).toBe(first.id);
    expect(nextVeteranStudent(selected, second.id, new Set([first.id]))).toBeUndefined();
    expect(veteranStudent(selected, "not-selected")).toBeUndefined();
    expect(veteranStudent(selected, first.id, new Set([first.id, second.id]))).toBeUndefined();
  });

  it("binds a choice to one soldier and rejects absent, stale or unoffered choices", () => {
    const veteran = unit("second-priest");
    expect(learnVeteranSkillCommand(veteran, "veteranHealingWave")).toEqual({
      type: "learnVeteranSkill", unitId: "second-priest", skill: "veteranHealingWave",
    });
    expect(learnVeteranSkillCommand(veteran, "veteranRally")).toBeUndefined();
    expect(learnVeteranSkillCommand({ ...veteran, veteranSkill: "veteranResilience" }, "veteranHealingWave")).toBeUndefined();
    expect(learnVeteranSkillCommand({ ...veteran, level: 2 }, "veteranHealingWave")).toBeUndefined();
    expect(learnVeteranSkillCommand(undefined, "veteranHealingWave")).toBeUndefined();
  });
});

function unit(id: string, patch: Partial<Unit> = {}): Unit {
  return {
    id, kind: "priest", owner: "player", x: 0, y: 0, hp: 100, maxHp: 100, radius: 15,
    speed: 3, attackDamage: 10, attackRange: 50, attackCooldown: 10, cooldown: 0,
    carryingGold: 0, kills: 0, xp: 500, level: 3, effects: [], order: { type: "idle" },
    veteranSkillChoices: ["veteranResilience", "veteranHealingWave", "veteranInnerFire"], ...patch,
  };
}
