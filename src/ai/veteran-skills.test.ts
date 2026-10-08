import { describe, expect, it } from "vitest";
import { resolveVariant, UNIT_DEFS } from "../shared/catalog";
import { createGame, snapshotGame } from "../shared/sim";
import { planAiOwnerCommandEntries } from "./planner-context";
import { planAiCommandFrameFromSnapshot } from "./runtime";
import { issueCommandFrame } from "../sdk/commands/frame";
import { planVeteranSkillCommands } from "./veteran-skills";
import { AI_SCRIPT_VERSIONS, type AiScript, type AiScriptVersion } from "./policy";
import { xpStarThresholds } from "../shared/unit-value";

describe("AI veteran learning", () => {
  it("skips an obsolete personal healing offer on a mechanical unit and learns a usable passive", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const unit = game.spawnUnit("player", "golem", 900, 900);
    unit.level = 3;
    unit.veteranSkillChoices = ["veteranEndurance", "veteranMobility", "veteranResilience"];
    const commands = planVeteranSkillCommands(snapshotGame(game), "player");
    expect(commands).toEqual([{ type: "learnVeteranSkill", unitId: unit.id, skill: "veteranResilience" }]);
    expect(() => issueCommandFrame(game, commands.map(command => ({ playerId: "player", scriptId: "veteranSkills", command })))).not.toThrow();
    expect(unit.veteranSkill).toBe("veteranResilience");
  });
  it.each([...new Set([...Object.keys(AI_SCRIPT_VERSIONS), "v2-prod"])] as AiScriptVersion[])("%s learns natural offers through its complete controller and does not repeat learning", version => {
    const game = createGame("bareDuel", { aiPlayers: [], scenario: {
      addUnits: ["footman", "priest", "archer"].map((kind, index) => {
        const unitKind = kind as "footman" | "priest" | "archer";
        return { id: `veteran-${index}`, owner: "player", kind: unitKind, x: 800 + index * 45, y: 900, xp: xpStarThresholds(UNIT_DEFS[unitKind])[2]! };
      }),
    } });
    const snapshot = snapshotGame(game);
    const before = JSON.stringify(snapshot);
    const entries = planAiOwnerCommandEntries(snapshot, { playerId: "player", version });
    expect(JSON.stringify(snapshot)).toBe(before);
    const learns = entries.filter(entry => entry.command.type === "learnVeteranSkill");
    expect(learns).toHaveLength(3);
    expect(() => issueCommandFrame(game, entries)).not.toThrow();
    for (const id of ["veteran-0", "veteran-1", "veteran-2"]) {
      const unit = game.units.find(candidate => candidate.id === id)!;
      expect(unit.veteranSkillChoices).toContain(unit.veteranSkill);
    }
    expect(planAiOwnerCommandEntries(snapshotGame(game), { playerId: "player", version })
      .some(entry => entry.command.type === "learnVeteranSkill")).toBe(false);
  });

  it("chooses deterministically from saved offers through both runtime and SDK without mutating state", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const priest = game.spawnUnit("player", "priest", 900, 900);
    priest.level = 3;
    priest.veteranSkillChoices = ["veteranResilience", "veteranHealingWave", "veteranInnerFire"];
    const before = snapshotGame(game);
    const sdk = planAiOwnerCommandEntries(before, { playerId: "player", source: "test", scripts: [] });
    const runtime = planAiCommandFrameFromSnapshot(before, [{ playerId: "player", source: "test", scripts: [] }]);
    expect(runtime.commands).toEqual(sdk);
    expect(sdk).toEqual([{ playerId: "player", source: "test", scriptId: "veteranSkills", command: { type: "learnVeteranSkill", unitId: priest.id, skill: "veteranHealingWave" } }]);
    expect(snapshotGame(game)).toEqual(before);
    expect(planVeteranSkillCommands(before, "player")).toEqual(planVeteranSkillCommands(before, "player"));
    issueCommandFrame(game, sdk);
    expect(priest.veteranSkill).toBe("veteranHealingWave");
    expect(planVeteranSkillCommands(snapshotGame(game), "player")).toEqual([]);
  });

  it("avoids duplicated auras and excludes heroes, summons, enemies and lower ranks", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const candidates = Array.from({ length: 6 }, () => game.spawnUnit("player", "footman", 900, 900));
    for (const unit of candidates) {
      unit.level = 3;
      unit.veteranSkillChoices = ["veteranResilience", "veteranCommand", "veteranVigilance"];
    }
    candidates[2]!.expiresTick = 100;
    candidates[3]!.level = 2;
    game.variants = { hero: resolveVariant({ base: "footman", heroic: true }) };
    candidates[4]!.variant = "hero";
    candidates[5]!.owner = "enemy";
    expect(planVeteranSkillCommands(snapshotGame(game), "player")).toEqual([
      { type: "learnVeteranSkill", unitId: candidates[0]!.id, skill: "veteranCommand" },
      { type: "learnVeteranSkill", unitId: candidates[1]!.id, skill: "veteranVigilance" },
    ]);
  });

  it("respects a custom controller's own choice for the same unit", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    const unit = game.spawnUnit("player", "footman", 900, 900);
    unit.level = 3;
    unit.veteranSkillChoices = ["veteranResilience", "veteranCommand", "veteranVigilance"];
    const script: AiScript = { id: "custom-choice", phase: "tactics", run: () => ({ type: "learnVeteranSkill", unitId: unit.id, skill: "veteranResilience" }) };
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: "player", scripts: [script] });
    expect(entries.filter(entry => entry.command.type === "learnVeteranSkill")).toEqual([{ playerId: "player", scriptId: "custom-choice", command: { type: "learnVeteranSkill", unitId: unit.id, skill: "veteranResilience" } }]);
  });
});
