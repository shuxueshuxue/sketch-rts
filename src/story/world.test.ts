import { describe, expect, it } from "vitest";
import { createGame, stepGame } from "../shared/sim";
import { defineUnit, enlist } from "./cast";
import { Stage } from "./stage";
import { instant } from "./time";
import { World } from "./world";

it("takes up the new scene's guard station on explicit story placement, leaving AI guard state absent", () => {
  const game = createGame("bareDuel", { aiPlayers: ["enemy"] });
  game.units = [];
  const world = new World(game, new Stage(game, () => instant(game.tick)), {}, () => .5);
  const hero = world.spawn("footman", "player", { x: 1000, y: 1000 });
  const npc = world.spawn("footman", "enemy", { x: 1000, y: 2000 });
  world.place(hero, { x: 3000, y: 1000 });
  world.place(npc, { x: 3000, y: 2000 });
  stepGame(game);
  expect(hero.guardPosition).toEqual({ x: 3000, y: 1000 });
  expect(npc.guardPosition).toBeUndefined();
});

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

 it("settles story gold in cents without taxing rewards or losing fractional balances", () => {
   const game = createGame("bareDuel", { aiPlayers: [] });
   const world = new World(game, new Stage(game, () => instant(game.tick)), {}, () => .5);
   game.players.player.gold = 0.29;
   game.players.player.supplyUsed = 130;
   world.gold("player", -0.28);
   expect(game.players.player.gold).toBe(0.01);
   world.gold("player", 20.126);
   expect(game.players.player.gold).toBe(20.14);
   world.gold("player", -100);
   expect(game.players.player.gold).toBe(0);
 });
