import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { issueCommandFrame } from "../../sdk/commands/frame";
import { snapshotGame, stepGame } from "../../shared/sim";
import { planMechanicalRepair } from "./mechanical-repair";
import { planAiOwnerCommandEntries } from "../planner-context";
import { AI_SCRIPT_VERSIONS, type AiScriptVersion } from "../policy";

function repairScene() {
  return sketchScene("ai-mechanical-repair").map("bareDuel").replaceDefaults()
    .player("player", { race: "grove" }).player("enemy", { race: "ember" })
    .playerState("player", { gold: 100 })
    .townHall("player", 500, 500).townHall("enemy", 3400, 3400)
    .unit("player", "worker", 700, 500, { id: "repairer" })
    .unit("player", "golem", 750, 500, { id: "machine", hpRatio: .5 })
    .unit("player", "footman", 750, 550, { id: "wounded", hpRatio: .2 }).build().createGame();
}

describe("AI mechanical repair", () => {
  it.each(Object.keys(AI_SCRIPT_VERSIONS) as AiScriptVersion[])("%s uses its real controller to issue paid repair with a nearby idle worker", version => {
    const game = repairScene();
    const target = game.units.find(unit => unit.id === "machine")!;
    const hp = target.hp;
    const gold = game.players.player!.gold;
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: "player", version });
    expect(entries.some(entry => entry.command.type === "repairUnit" && entry.command.targetId === target.id)).toBe(true);
    issueCommandFrame(game, entries);
    for (let i = 0; i < 20; i++) stepGame(game);
    expect(target.hp).toBeGreaterThan(hp);
    expect(game.players.player!.gold).toBeLessThan(gold);
    expect(planMechanicalRepair(snapshotGame(game), "player", {})).toBeUndefined();
  });

  it("leaves active miners, builders, unfunded armies and exposed repairs alone", () => {
    const game = repairScene();
    const worker = game.units.find(unit => unit.id === "repairer")!;
    expect(planMechanicalRepair(snapshotGame(game), "player", {})).toEqual({ type: "repairUnit", unitIds: [worker.id], targetId: "machine" });
    worker.order = { type: "mine", resourceId: "mine", phase: "toMine", timer: 0 };
    expect(planMechanicalRepair(snapshotGame(game), "player", {})).toBeUndefined();
    worker.order = { type: "build", buildingKind: "farm", x: 500, y: 800 };
    expect(planMechanicalRepair(snapshotGame(game), "player", {})).toBeUndefined();
    worker.order = { type: "idle" };
    game.players.player!.gold = 24;
    expect(planMechanicalRepair(snapshotGame(game), "player", {})).toBeUndefined();
    game.players.player!.gold = 100;
    game.spawnUnit("enemy", "footman", 900, 500);
    expect(planMechanicalRepair(snapshotGame(game), "player", {})).toBeUndefined();
  });
});
