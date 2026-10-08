import { describe, expect, it } from "vitest";
import { createGame } from "../shared/sim";
import { defineUnit, enlist } from "./cast";
import { Stage } from "./stage";
import { instant } from "./time";
import { World } from "./world";

describe("story medical healing", () => {
  it("heals non-mechanical characters while respecting mechanical catalog and campaign variant classifications", () => {
    const game = createGame("bareDuel", { aiPlayers: [] });
    game.units = []; game.items = [];
    const world = new World(game, new Stage(game, () => instant(game.tick)), {}, () => .5);
    const automaton = defineUnit({ id: "test/automaton", name: "Automaton", rules: { base: "footman", unitClass: "mechanical" }, model: { paint: () => undefined } });
    const livingGolem = defineUnit({ id: "test/living-golem", name: "Living Golem", rules: { base: "golem", unitClass: "nonMechanical" }, model: { paint: () => undefined } });
    enlist(game, { automaton, livingGolem });
    const soldier = world.spawn("footman", "player", { x: 1500, y: 1500 });
    const construct = world.spawn(automaton, "player", { x: 1600, y: 1500 });
    const siege = world.spawn("ballista", "player", { x: 1700, y: 1500 });
    const stone = world.spawn("golem", "player", { x: 1800, y: 1500 });
    const living = world.spawn(livingGolem, "player", { x: 1900, y: 1500 });
    for (const unit of [soldier, construct, siege, stone, living]) unit.hp -= 60;
    const before = new Map(game.units.map(unit => [unit.id, unit.hp]));
    for (const unit of [soldier, construct, siege, stone, living]) world.heal(unit, 30);
    for (const unit of [soldier, living]) expect(unit.hp).toBe(before.get(unit.id)! + 30);
    for (const unit of [construct, siege, stone]) expect(unit.hp).toBe(before.get(unit.id));
    expect(game.effects.filter(effect => effect.type === "heal")).toHaveLength(2);
  });
});
