import { describe, expect, it } from "vitest";
import { BUILDING_DEFS, RACE_DEFS, UNIT_DEFS } from "./catalog";
import { createBuilding } from "./map";
import { createGame, issueCommand, stepGame } from "./sim";

function duel() {
  const game = createGame("bareDuel", { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  return game;
}

function stepUntil(game: ReturnType<typeof createGame>, maxTicks: number, predicate: () => boolean) {
  for (let i = 0; i < maxTicks && !predicate(); i += 1) stepGame(game);
  return predicate();
}

describe("heavy units", () => {
  it("halves a shooter's or caster's shot at heavy armor, takes 30% off a tower's, and lets melee land in full", () => {
    const game = duel();
    const knight = game.spawnUnit("enemy", "knight", 900, 500);
    const archer = game.spawnUnit("player", "archer", 600, 500);
    issueCommand(game, { type: "attack", unitIds: [archer.id], targetId: knight.id });
    expect(stepUntil(game, 80, () => knight.hp < knight.maxHp)).toBe(true);
    expect(knight.maxHp - knight.hp).toBe(Math.round(UNIT_DEFS.archer.attackDamage * 0.5));

    const golem = game.spawnUnit("enemy", "golem", 2000, 2000);
    game.buildings.push(createBuilding("player-tower", "player", "defenseTower", 2300, 2000, true));
    expect(stepUntil(game, 80, () => golem.hp < golem.maxHp)).toBe(true);
    expect(golem.maxHp - golem.hp).toBe(Math.round(BUILDING_DEFS.defenseTower.attackDamage * 0.7));

    const struck = game.spawnUnit("enemy", "knight", 1200, 1200);
    const footman = game.spawnUnit("player", "footman", 1240, 1200);
    issueCommand(game, { type: "attack", unitIds: [footman.id], targetId: struck.id });
    expect(stepUntil(game, 40, () => struck.hp < struck.maxHp)).toBe(true);
    expect(struck.maxHp - struck.hp).toBe(UNIT_DEFS.footman.attackDamage);
  });

  it("lets the ash chieftain hit summoned units and casters half again as hard, and nothing else", () => {
    const game = duel();
    const hit = (kind: "spirit" | "summoner" | "footman", x: number) => {
      const target = game.spawnUnit("enemy", kind, x + 45, 500);
      if (kind === "spirit") target.expiresTick = game.tick + 1_000;
      const chieftain = game.spawnUnit("player", "ashChieftain", x, 500);
      issueCommand(game, { type: "attack", unitIds: [chieftain.id], targetId: target.id });
      stepUntil(game, 40, () => target.hp < target.maxHp);
      return target.maxHp - target.hp;
    };
    expect(hit("spirit", 500)).toBe(Math.round(UNIT_DEFS.ashChieftain.attackDamage * 1.5));
    expect(hit("summoner", 1500)).toBe(Math.round(UNIT_DEFS.ashChieftain.attackDamage * 1.5));
    expect(hit("footman", 2500)).toBe(UNIT_DEFS.ashChieftain.attackDamage);
  });

  it("lets the cinder revenant regenerate its wounds on its own", () => {
    const game = duel();
    const revenant = game.spawnUnit("player", "cinderRevenant", 500, 500);
    revenant.hp = 50;
    for (let i = 0; i < 20; i += 1) stepGame(game);
    expect(revenant.hp).toBeCloseTo(50 + UNIT_DEFS.cinderRevenant.regenPerSecond!, 5);
  });

  it("gives ember its own heavy units from the ashen hall, both heavy-armored", () => {
    expect(RACE_DEFS.ember.trainableUnits).toEqual(expect.arrayContaining(["ashChieftain", "cinderRevenant"]));
    expect(BUILDING_DEFS.ashenHall.trains).toEqual(["ashChieftain", "cinderRevenant"]);
    expect(RACE_DEFS.ember.buildableBuildings).toContain("ashenHall");
    for (const kind of ["knight", "golem", "ashChieftain", "cinderRevenant"] as const) expect(UNIT_DEFS[kind].armor).toBe("heavy");
  });
});
