import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import { createShop } from "../../shared/shop";
import { snapshotGame } from "../../shared/sim";
import { xpStarThresholds } from "../../shared/unit-value";
import type { UnitKind } from "../../shared/types";
import { sketchScene } from "../../sdk/scene";
import { createAiPolicyMemory } from "../memory";
import { shouldReserveForHealingWell } from "./base-defense-model";
import { healingWellPointFor } from "./build-layout";
import { AI_SCRIPT_LIBRARY } from "./core";
import { planItemCommands } from "./item-tactics";
import { planSkirmishPreservation } from "./skirmish-tactics";
import { shouldPrioritizeWoundedPriestTraining } from "./training-choice";
import { shouldReserveForHealingWell as frozenReserve } from "../policy-v2prod/base-defense-model";
import { healingWellPointFor as frozenWellPoint } from "../policy-v2prod/build-layout";
import { AI_SCRIPT_LIBRARY as FROZEN_SCRIPTS } from "../policy-v2prod/core";
import { planItemCommands as frozenItems } from "../policy-v2prod/item-tactics";
import { planSkirmishPreservation as frozenPreservation } from "../policy-v2prod/skirmish-tactics";
import { shouldPrioritizeWoundedPriestTraining as frozenPriest } from "../policy-v2prod/training-choice";
import { v8WantsWell } from "./v8/well";
import { planArmyShopping } from "./v9/shop";

const OPTIONS = { version: "v2" as const };

function scene(name: string) {
  return sketchScene(name).map("bareDuel").replaceDefaults()
    .player("own", { team: "north" }).player("enemy", { team: "south" })
    .townHall("own", 500, 500).townHall("enemy", 3500, 3500)
    .building("own", "barracks", 650, 600).worker("own", 550, 550);
}

const policies = [
  { name: "current", reserve: shouldReserveForHealingWell, wellPoint: healingWellPointFor, well: AI_SCRIPT_LIBRARY.healingWell, items: planItemCommands, preserve: planSkirmishPreservation, priest: shouldPrioritizeWoundedPriestTraining },
  { name: "frozen v2", reserve: frozenReserve, wellPoint: frozenWellPoint, well: FROZEN_SCRIPTS.healingWell, items: frozenItems, preserve: frozenPreservation, priest: frozenPriest },
];

describe.each(policies)("$name mechanical healing policy", policy => {
  it.each(["golem", "ballista", "catapult"] as const)("does not send an idle wounded %s to a healing well, but still retreats it from enemies", kind => {
    const game = scene(`mechanical-retreat-${kind}`)
      .building("own", "moonWell", 500, 700)
      .unit("own", kind, 1100, 500, { id: "hurt", hp: 10 }).build().createGame();
    expect(policy.preserve(snapshotGame(game), "own", OPTIONS)).toEqual([]);
    game.spawnUnit("enemy", "footman", 1130, 500);
    expect(policy.preserve(snapshotGame(game), "own", OPTIONS)).toContainEqual(expect.objectContaining({ type: "move", unitIds: ["hurt"] }));
  });

  it.each(["golem", "footman"] as const)("bases healing infrastructure and priest urgency on healable wounds: %s", kind => {
    const build = scene(`mechanical-well-${kind}`).unit("enemy", "footman", 1000, 500);
    for (let i = 0; i < 3; i++) build.unit("own", kind, 450 + i * 45, 240, { hp: 10 });
    const game = build.build().createGame();
    game.players.own!.gold = BUILDING_DEFS.moonWell.cost - 10;
    const needsHealing = kind === "footman";
    expect(policy.reserve(snapshotGame(game), "own", OPTIONS)).toBe(needsHealing);
    expect(policy.priest(snapshotGame(game), "own", OPTIONS)).toBe(needsHealing);
    const point = policy.wellPoint(snapshotGame(game), "own", { x: 500, y: 500 });
    expect(Math.hypot(point.x - 495, point.y - 240) <= BUILDING_DEFS.moonWell.attackRange).toBe(needsHealing);
    game.players.own!.gold = 1000;
    const command = policy.well.run(snapshotGame(game), "own", { ...OPTIONS, memory: createAiPolicyMemory() });
    if (needsHealing) expect(command).toMatchObject({ type: "build", buildingKind: "moonWell" });
    else expect(command).toBeUndefined();
  });

  it("uses the campaign variant's mechanical class when counting healer demand", () => {
    const build = scene("mechanical-variant-priest");
    for (let i = 0; i < 3; i++) build.unit("own", "footman", 600 + i * 40, 700, { hp: 10 });
    const game = build.build().createGame();
    game.variants = { construct: { ...UNIT_DEFS.footman, base: "footman", unitClass: "mechanical" } };
    for (const unit of game.units.filter(unit => unit.kind === "footman")) unit.variant = "construct";
    expect(policy.priest(snapshotGame(game), "own", OPTIONS)).toBe(false);
  });

  it("gives a regeneration ring to a healable carrier while mechanical units can still carry other items", () => {
    const game = scene("mechanical-ring-carrier")
      .unit("own", "golem", 600, 750, { id: "construct" })
      .unit("own", "footman", 615, 750, { id: "soldier" })
      .item("ring", "regenRing", 600, 750).build().createGame();
    expect(policy.items(snapshotGame(game), "own", OPTIONS)[0]).toMatchObject({ type: "pickupItem", unitId: "soldier", itemId: "ring" });
    game.units = game.units.filter(unit => unit.id !== "soldier");
    expect(policy.items(snapshotGame(game), "own", OPTIONS)).toEqual([]);
    game.items[0]!.kind = "guardianScroll";
    expect(policy.items(snapshotGame(game), "own", OPTIONS)[0]).toMatchObject({ type: "pickupItem", unitId: "construct" });
  });
});

describe("modern AI healing purchases and items", () => {
  it.each(["golem", "footman"] as const)("V5 researches leadership only for veterans that can regenerate: %s", kind => {
    const build = scene(`v5-mechanical-leadership-${kind}`)
      .building("own", "archeryRange", 700, 620).building("own", "stables", 780, 620)
      .building("own", "sanctum", 860, 620, { id: "sanctum" });
    for (let i = 0; i < 2; i++) build.unit("own", kind, 800 + i * 40, 800, { xp: xpStarThresholds(UNIT_DEFS[kind])[2]! });
    const game = build.build().createGame();
    game.players.own!.gold = 2000;
    Object.assign(game.players.own!.upgrades, { weaponTraining: 3, reinforcedPlating: 3, speedTraining: 3, rangeTraining: 3 });
    const command = AI_SCRIPT_LIBRARY.tech.run(snapshotGame(game), "own", { ...OPTIONS, requestedVersion: "v5", memory: createAiPolicyMemory() });
    if (kind === "footman") expect(command).toMatchObject({ type: "research", upgradeKind: "leadership" });
    else expect(command).toBeUndefined();
  });

  it("does not spend a healing scroll on mechanical damage but lets a mechanical carrier heal its living allies", () => {
    const build = scene("mechanical-scroll").unit("own", "golem", 800, 800, { id: "carrier", hp: 10 })
      .item("scroll", "healingScroll", 800, 800, { carrierId: "carrier" });
    for (let i = 0; i < 4; i++) build.unit("own", "golem", 820 + i * 20, 800, { hp: 10 });
    const game = build.build().createGame();
    expect(planItemCommands(snapshotGame(game), "own", OPTIONS)).toEqual([]);
    for (let i = 0; i < 4; i++) {
      const unit = game.spawnUnit("own", "footman", 800 + i * 20, 820);
      unit.hp = 1;
    }
    expect(planItemCommands(snapshotGame(game), "own", OPTIONS)).toContainEqual({ type: "useItem", unitId: "carrier", itemId: "scroll" });
  });

  it.each(["golem", "ballista", "footman"] as const)("V8's well demand counts only healable health: %s", kind => {
    const build = scene(`v8-mechanical-well-${kind}`);
    for (let i = 0; i < 4; i++) build.unit("own", kind, 800 + i * 30, 800, { hp: 1 });
    expect(v8WantsWell(snapshotGame(build.build().createGame()), "own")).toBe(kind === "footman" ? "moonWell" : undefined);
  });

  it.each(["golem", "footman"] as const)("V9 buys healing scrolls for healable armies: %s", (kind: UnitKind) => {
    const build = scene(`v9-mechanical-scroll-${kind}`);
    for (let i = 0; i < 6; i++) build.unit("own", kind, 900 + i * 30, 900, { hp: 10 });
    const game = build.build().createGame();
    const shop = createShop("shop", 1400, 1100);
    shop.goods = shop.goods.filter(good => good.kind === "healingScroll");
    game.shops = [shop];
    game.players.own!.gold = 1000;
    const options = { ...OPTIONS, requestedVersion: "v9" as const, memory: createAiPolicyMemory() };
    const commands = planArmyShopping(snapshotGame(game), "own", options);
    if (kind === "footman") {
      expect(commands[0]).toMatchObject({ type: "move" });
      expect(options.memory.v6?.shop?.kind).toBe("healingScroll");
    } else expect(commands).toEqual([]);
  });
});
