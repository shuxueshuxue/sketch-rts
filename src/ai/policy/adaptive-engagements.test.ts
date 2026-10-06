import { describe, expect, it } from "vitest";
import { sketchScene } from "../../sdk/scene";
import { issuePlayerCommand, snapshotGame, stepGame } from "../../shared/sim";
import { createAiPolicyMemory } from "../memory";
import { planPresetAiCommandEntries } from "./core";
import { engagementTargets } from "./engagements";
import { adaptiveArmyWants } from "./adaptive-army";
import { planCombatReadiness, readinessUnitIds } from "./combat-readiness";
import { trainingChoice } from "./training-choice";
import type { AiScriptVersion } from "../../shared/types";

function scene(name: string, race: "grove" | "ember" = "grove") {
  return sketchScene(name).map("bareDuel").replaceDefaults()
    .player("us", { team: "a", race }).player("enemy", { team: "b", race: "grove" })
    .townHall("us", 300, 300).townHall("enemy", 3_400, 3_400);
}
function context(version: AiScriptVersion) {
  return { version: "v2" as const, requestedVersion: version, memory: createAiPolicyMemory() };
}

describe("shared threat assessment in AI decisions", () => {
  it.each(["v5", "v7", "v8"] as const)("%s responds to reinforcements through the whole script stack and continues fighting them", version => {
    let field = scene(`respond-${version}`).building("enemy", "farm", 1_100, 1_000, { id: "objective" });
    for (let i = 0; i < 4; i++) field = field.unit("us", "footman", 1_025, 980 + i * 30, { id: `fighter-${i}`, order: { type: "attack", targetId: "objective" } });
    field = field.unit("enemy", "footman", 1_040, 1_100, { id: "reinforcement", order: { type: "attack", targetId: "fighter-3" } });
    const game = field.build().createGame();
    const options = context(version);
    const original = game.units.find(unit => unit.id === "reinforcement")!.hp;
    for (let tick = 0; tick < 90; tick++) {
      if (tick % 15 === 0) {
        const entries = planPresetAiCommandEntries(snapshotGame(game), "us", { ...options, version });
        if (tick === 0) expect(entries.some(entry => entry.scriptId === "battlefield" && entry.command.type === "attack" && entry.command.targetId === "reinforcement")).toBe(true);
        for (const { command } of entries) issuePlayerCommand(game, "us", command);
      }
      stepGame(game);
    }
    expect(game.units.find(unit => unit.id === "reinforcement")?.hp ?? 0).toBeLessThan(original);
  });

  it("uses the same reassessment for a harmless unit target and keeps a meaningful combat target", () => {
    const game = scene("general-target-reassessment")
      .worker("enemy", 1_040, 1_000, { id: "decoy", order: { type: "hold", x: 1_040, y: 1_000 } })
      .unit("us", "knight", 1_000, 1_000, { id: "fighter", order: { type: "attack", targetId: "decoy" } })
      .unit("enemy", "footman", 1_000, 1_080, { id: "threat", order: { type: "attack", targetId: "fighter" } })
      .build().createGame();
    const options = context("v8");
    expect(engagementTargets(snapshotGame(game), "us", options).get("fighter")?.id).toBe("threat");
    game.units.find(unit => unit.id === "fighter")!.order = { type: "attack", targetId: "threat" };
    expect(engagementTargets(snapshotGame(game), "us", options).get("fighter")?.id).toBe("threat");
  });

  it("keeps protected artillery on its assignment but responds when the artillery itself is threatened", () => {
    let field = scene("siege-screen", "ember").building("enemy", "farm", 1_400, 1_000, { id: "objective" })
      .unit("us", "catapult", 1_000, 1_000, { id: "gun", order: { type: "attack", targetId: "objective" } });
    for (let i = 0; i < 4; i++) field = field.unit("us", "emberRavager", 1_040, 940 + i * 40, { id: `screen-${i}` });
    const game = field.unit("enemy", "footman", 1_190, 1_000, { id: "enemy-front", order: { type: "attack", targetId: "screen-2" } }).build().createGame();
    const options = context("v8");
    expect(engagementTargets(snapshotGame(game), "us", options).get("gun")?.id).toBe("objective");
    const enemy = game.units.find(unit => unit.id === "enemy-front")!;
    enemy.x = 1_080;
    enemy.order = { type: "attack", targetId: "gun" };
    expect(engagementTargets(snapshotGame(game), "us", options).get("gun")?.id).toBe("enemy-front");
  });
});

describe("situational army roles", () => {
  it("gives V7 mobile shooters against a melee force, while V8 retains its melee doctrine", () => {
    let field = scene("mobile-role");
    for (let i = 0; i < 8; i++) field = field.unit("us", "footman", 800 + i * 20, 800).unit("enemy", "footman", 1_800 + i * 20, 800);
    const snapshot = snapshotGame(field.build().createGame());
    expect(adaptiveArmyWants(snapshot, "us", context("v7"))).toContainEqual({ unit: "horseArcher", count: 1, priority: 66 });
    expect(adaptiveArmyWants(snapshot, "us", context("v8")).some(want => "unit" in want && want.unit === "horseArcher")).toBe(false);
  });
  it("adds a golem to a caster front and wardens to an Ember support army", () => {
    for (const race of ["grove", "ember"] as const) {
      let field = scene(`screen-role-${race}`, race);
      for (let i = 0; i < 10; i++) field = field.unit("us", race === "grove" ? "priest" : "emberAcolyte", 800 + i * 20, 800);
      const snapshot = snapshotGame(field.build().createGame());
      expect(adaptiveArmyWants(snapshot, "us", context("v8"))).toContainEqual({ unit: race === "grove" ? "golem" : "ashWarden", count: 1, priority: race === "grove" ? 68 : 69 });
    }
  });
  it("lets V5 replenish a small melee screen when opponents reach its shooter line", () => {
    let field = scene("v5-screen").building("us", "barracks", 500, 500, { id: "barracks" }).building("us", "archeryRange", 650, 500);
    for (let i = 0; i < 6; i++) field = field.unit("us", "archer", 1_000 + i * 20, 1_000);
    const game = field.unit("enemy", "footman", 1_000, 1_180).build().createGame();
    expect(trainingChoice(snapshotGame(game), "us", game.buildings.find(building => building.id === "barracks")!, context("v5"))).toBe("footman");
  });
});

describe("preparing a defensive fight", () => {
  it("pre-aims within range without walking off its post and keeps the assignment while the aim settles", () => {
    const game = scene("prepare-fire").unit("us", "archer", 1_000, 1_000, { id: "shooter" }).unit("enemy", "footman", 1_430, 1_000).build().createGame();
    const options = context("v7");
    options.memory.v6 = { general: { mode: "guard", target: { x: 1_000, y: 1_000 }, leash: 450 } };
    const [command] = planCombatReadiness(snapshotGame(game), "us", options);
    expect(command?.type).toBe("aim");
    if (command?.type !== "aim") throw new Error("missing aim");
    expect(Math.hypot(command.x - 1_000, command.y - 1_000)).toBeLessThan(game.units[0]!.attackRange);
    issuePlayerCommand(game, "us", command);
    for (let tick = 0; tick < 20; tick++) stepGame(game);
    expect(game.units.find(unit => unit.id === "shooter")!.x).toBe(1_000);
    expect(readinessUnitIds(snapshotGame(game), "us", options).has("shooter")).toBe(true);
  });
  it("braces a screen protecting a caster, then restores pursuit when contact ends", () => {
    const game = scene("brace-screen").unit("us", "footman", 1_000, 1_000, { id: "front" }).unit("us", "priest", 980, 1_000)
      .unit("enemy", "footman", 1_040, 1_000, { id: "enemy-front" }).build().createGame();
    const options = context("v8");
    const commands = planCombatReadiness(snapshotGame(game), "us", options);
    expect(commands).toContainEqual({ type: "setStance", unitIds: ["front"], stance: "brace" });
    for (const command of commands) issuePlayerCommand(game, "us", command);
    game.units.find(unit => unit.id === "enemy-front")!.x = 2_000;
    expect(planCombatReadiness(snapshotGame(game), "us", options)).toContainEqual({ type: "setStance", unitIds: ["front"], stance: "pursue" });
  });
});
