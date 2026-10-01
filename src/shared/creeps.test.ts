import { describe, expect, it } from "vitest";
import { ABILITY_DEFS, POISON_DAMAGE, SLOW_PACE, SPLASH_SHARE, UNIT_DEFS } from "./catalog";
import { createGame, issuePlayerCommand, stepGame, type Game } from "./sim";
import type { ScenarioUnitSeed } from "./types";

function creepGame(units: ScenarioUnitSeed[]): Game {
  return createGame("bareDuel", { players: ["player", "enemy"], scenario: { replaceDefaultUnits: true, replaceDefaultResources: true, replaceDefaultMercenaryCamps: true, addUnits: units } });
}

const unit = (game: Game, id: string) => game.units.find((candidate) => candidate.id === id)!;
const step = (game: Game, ticks: number) => {
  for (let tick = 0; tick < ticks; tick += 1) stepGame(game);
};
const status = (game: Game, id: string, type: string) => unit(game, id).effects.find((effect) => effect.type === type);

// @@@creep-traits and @@@creep-abilities as they play.
describe("the new creeps", () => {
  it("a murloc hunter's net slows what it hits", () => {
    const game = creepGame([
      { id: "hunter", owner: "neutral", kind: "murlocHunter", x: 1_000, y: 1_000 },
      { id: "footman", owner: "player", kind: "footman", x: 1_120, y: 1_000 },
    ]);
    issuePlayerCommand(game, "player", { type: "attack", unitIds: ["footman"], targetId: "hunter" });
    for (let tick = 0; tick < 120 && !status(game, "footman", "slow"); tick += 1) stepGame(game);
    expect(status(game, "footman", "slow")).toBeDefined();
    const before = { ...unit(game, "footman") };
    issuePlayerCommand(game, "player", { type: "move", unitIds: ["footman"], x: 2_000, y: 1_000 });
    step(game, 10);
    expect(unit(game, "footman").x - before.x).toBeCloseTo(UNIT_DEFS.footman.speed * SLOW_PACE * 10, 0);
  });

  it("a venom spider's bite poisons, a second a time, credited to the spider", () => {
    const game = creepGame([
      { id: "spider", owner: "neutral", kind: "venomSpider", x: 1_000, y: 1_000 },
      { id: "footman", owner: "player", kind: "footman", x: 1_040, y: 1_000 },
    ]);
    for (let tick = 0; tick < 120 && !status(game, "footman", "poison"); tick += 1) stepGame(game);
    expect(status(game, "footman", "poison")).toMatchObject({ sourceId: "spider" });
    // The spider out of the way: only the poison bites on.
    game.units = game.units.filter((candidate) => candidate.id !== "spider");
    const hp = unit(game, "footman").hp;
    step(game, 100);
    expect(hp - unit(game, "footman").hp).toBeGreaterThanOrEqual(POISON_DAMAGE * 3);
    expect(hp - unit(game, "footman").hp).toBeLessThanOrEqual(POISON_DAMAGE * 4);
    expect(status(game, "footman", "poison")).toBeUndefined();
  });

  it("a granite golem's stomp stuns every foe close by: they neither walk nor strike", () => {
    const game = creepGame([
      { id: "golem", owner: "neutral", kind: "graniteGolem", x: 1_000, y: 1_000 },
      { id: "a", owner: "player", kind: "footman", x: 1_080, y: 1_000 },
      { id: "b", owner: "player", kind: "footman", x: 1_000, y: 1_100 },
      { id: "far", owner: "player", kind: "archer", x: 1_350, y: 1_000 },
    ]);
    issuePlayerCommand(game, "player", { type: "attack", unitIds: ["a", "b", "far"], targetId: "golem" });
    for (let tick = 0; tick < 40 && !status(game, "a", "stun"); tick += 1) stepGame(game);
    expect(status(game, "a", "stun")).toBeDefined();
    expect(status(game, "b", "stun")).toBeDefined();
    expect(status(game, "far", "stun")).toBeUndefined();
    const golemHp = unit(game, "golem").hp;
    const at = { x: unit(game, "b").x, y: unit(game, "b").y };
    step(game, 20);
    expect({ x: unit(game, "b").x, y: unit(game, "b").y }).toEqual(at);
    // Only the archer out of the stomp's reach struck the golem meanwhile.
    expect(golemHp - unit(game, "golem").hp).toBeLessThanOrEqual(UNIT_DEFS.archer.attackDamage * 2);
    step(game, ABILITY_DEFS.stomp.cooldown);
    expect(unit(game, "golem").abilityCooldowns?.stomp).toBeDefined();
  });

  it("a spider queen's web roots the nearest foe, who still strikes", () => {
    const game = creepGame([
      { id: "queen", owner: "neutral", kind: "spiderQueen", x: 1_000, y: 1_000 },
      { id: "archer", owner: "player", kind: "archer", x: 1_200, y: 1_000 },
    ]);
    issuePlayerCommand(game, "player", { type: "attack", unitIds: ["archer"], targetId: "queen" });
    for (let tick = 0; tick < 40 && !status(game, "archer", "root"); tick += 1) stepGame(game);
    expect(status(game, "archer", "root")).toBeDefined();
    const at = unit(game, "archer").x;
    issuePlayerCommand(game, "player", { type: "move", unitIds: ["archer"], x: 2_000, y: 1_000 });
    step(game, 10);
    expect(unit(game, "archer").x).toBe(at);
  });

  it("an ogre mage's bloodlust quickens a fighting ally's blows", () => {
    const game = creepGame([
      { id: "mage", owner: "neutral", kind: "ogreMage", x: 1_000, y: 1_000 },
      { id: "warrior", owner: "neutral", kind: "ogreWarrior", x: 1_060, y: 1_000 },
      { id: "footman", owner: "player", kind: "footman", x: 1_110, y: 1_000 },
    ]);
    issuePlayerCommand(game, "player", { type: "attack", unitIds: ["footman"], targetId: "warrior" });
    for (let tick = 0; tick < 60 && !status(game, "warrior", "bloodlust") && !status(game, "mage", "bloodlust"); tick += 1) stepGame(game);
    const lusted = status(game, "warrior", "bloodlust") ? "warrior" : "mage";
    expect(status(game, lusted, "bloodlust")).toBeDefined();
    const ogre = unit(game, lusted);
    for (let tick = 0; tick < 80 && ogre.cooldown === 0; tick += 1) stepGame(game);
    expect(ogre.cooldown).toBeLessThanOrEqual(Math.round(ogre.attackCooldown / 1.3));
  });

  it("a red dragon's fire burns the enemies round its target for half the blow", () => {
    const game = creepGame([
      { id: "dragon", owner: "neutral", kind: "redDragon", x: 1_000, y: 1_000 },
      { id: "target", owner: "player", kind: "footman", x: 1_200, y: 1_000 },
      { id: "beside", owner: "player", kind: "footman", x: 1_260, y: 1_000 },
      { id: "apart", owner: "player", kind: "footman", x: 1_200, y: 1_300 },
    ]);
    issuePlayerCommand(game, "player", { type: "attack", unitIds: ["target", "beside", "apart"], targetId: "dragon" });
    for (let tick = 0; tick < 200 && unit(game, "beside").hp === UNIT_DEFS.footman.hp; tick += 1) stepGame(game);
    const hit = UNIT_DEFS.footman.hp - unit(game, "beside").hp;
    expect(hit).toBe(Math.round(UNIT_DEFS.redDragon.attackDamage * SPLASH_SHARE));
  });
});
