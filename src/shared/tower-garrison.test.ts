import { describe, expect, it } from "vitest";
import { BUILDING_DEFS } from "./catalog";
import { createBuilding } from "./map";
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame, strikeUnit, type Game } from "./sim";
import { checksumGame } from "./sim/checksum";
import { checkCommandLegality } from "./sim/command-validation";
import { isOpenGround, openGroundNear } from "./terrain";
import { TOWER_GARRISON, towerGarrison } from "./tower-garrison";
import type { Building, Unit, UnitKind } from "./types";

function field(mapId: "bareDuel" | "ladder" = "bareDuel") {
  const game = createGame(mapId, { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  game.scriptedVictory = true;
  game.players.player!.gold = 5000;
  return game;
}

function tower(game: Game, x = 1500, y = 1500, fortified = true) {
  const building = createBuilding(`tower-${game.buildings.length}`, "player", "defenseTower", x, y, true);
  game.buildings.push(building);
  if (fortified) {
    issuePlayerCommand(game, "player", { type: "fortifyTower", buildingId: building.id });
    for (let tick = 0; tick < TOWER_GARRISON.time; tick++) stepGame(game);
  }
  return building;
}

function garrison(game: Game, building: Building, kinds: UnitKind[]) {
  const troops = kinds.map((kind, index) => game.spawnUnit("player", kind, building.x - 120 + index * 40, building.y + 120));
  issuePlayerCommand(game, "player", { type: "garrison", unitIds: troops.map(unit => unit.id), buildingId: building.id });
  for (let tick = 0; tick < 200 && troops.some(unit => unit.order.type === "garrison"); tick++) stepGame(game);
  return troops;
}

// A ground copy of the same unit beside the tower, to compare against the one on its top.
function quiet(unit: Unit) {
  unit.attackDamage = 0;
  unit.order = { type: "hold", x: unit.x, y: unit.y };
  return unit;
}

describe("tower fortification", () => {
  it("costs its gold and time, keeps the tower shooting until done, then doubles health, broadens it and disarms it", () => {
    const game = field();
    const building = tower(game, 1500, 1500, false);
    const enemy = quiet(game.spawnUnit("enemy", "footman", 1500 + 300, 1500));
    issuePlayerCommand(game, "player", { type: "fortifyTower", buildingId: building.id });
    expect(game.players.player!.gold).toBe(5000 - TOWER_GARRISON.cost);
    expect(building.fortify).toEqual({ remaining: TOWER_GARRISON.time });
    expect(checkCommandLegality(game, "player", { type: "fortifyTower", buildingId: building.id })?.message).toMatch(/already fortified/);
    for (let tick = 0; tick < TOWER_GARRISON.time - 1; tick++) stepGame(game);
    expect(building.fortified).toBeUndefined();
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    stepGame(game);
    expect(building.fortify).toBeUndefined();
    expect(building.fortified).toBe(true);
    expect(building.maxHp).toBe(BUILDING_DEFS.defenseTower.hp * 2);
    expect(building.hp).toBe(building.maxHp);
    expect(building.radius).toBe(TOWER_GARRISON.radius);
    expect(building.attackDamage).toBe(0);
    enemy.hp = enemy.maxHp;
    for (let tick = 0; tick < 200; tick++) stepGame(game);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it("sets whoever stood where the tower grew outside its new wall", () => {
    const game = field("ladder");
    const site = openGroundNear(game.map, { x: 2600, y: 1500 })!;
    const building = tower(game, site.x, site.y, false);
    // Pressed against the old wall, inside the new one.
    const worker = quiet(game.spawnUnit("player", "worker", site.x + BUILDING_DEFS.defenseTower.radius + 4, site.y));
    issuePlayerCommand(game, "player", { type: "fortifyTower", buildingId: building.id });
    for (let tick = 0; tick < TOWER_GARRISON.time + 2; tick++) stepGame(game);
    expect(building.fortified).toBe(true);
    expect(isOpenGround(game.map, worker.x, worker.y)).toBe(true);
    expect(Math.hypot(worker.x - building.x, worker.y - building.y)).toBeGreaterThan(TOWER_GARRISON.radius);
  });
});

describe("tower garrison", () => {
  it("holds four supply on the tower's top: two footmen fill it, a third stays below", () => {
    const game = field();
    const building = tower(game);
    const troops = garrison(game, building, ["footman", "footman", "footman"]);
    const top = towerGarrison(game.units, building), below = troops.filter(unit => !top.includes(unit));
    expect(top).toHaveLength(2);
    expect(below).toHaveLength(1);
    expect(below[0]!.order.type).toBe("idle");
    for (const unit of top) expect(Math.hypot(unit.x - building.x, unit.y - building.y)).toBeLessThan(building.radius);
    expect(Math.hypot(below[0]!.x - building.x, below[0]!.y - building.y)).toBeGreaterThan(building.radius);
    const d = game.spawnUnit("player", "archer", building.x, building.y + 200);
    expect(checkCommandLegality(game, "player", { type: "garrison", unitIds: [d.id], buildingId: building.id })?.reason).toBe("position");
  });

  it("counts a troop without supply as one: four spirits fill it", () => {
    const game = field();
    const building = tower(game);
    const troops = garrison(game, building, ["spirit", "spirit", "spirit", "spirit", "spirit"]);
    for (const unit of troops) unit.expiresTick = game.tick + 10_000;
    expect(towerGarrison(game.units, building)).toHaveLength(4);
  });

  it("refuses an unfortified tower", () => {
    const game = field();
    const building = tower(game, 1500, 1500, false);
    const archer = game.spawnUnit("player", "archer", 1500, 1700);
    expect(checkCommandLegality(game, "player", { type: "garrison", unitIds: [archer.id], buildingId: building.id })?.message).toMatch(/fortified/);
  });

  it("is out of an enemy melee blow's reach: no strike, no chase, no automatic pick", () => {
    const game = field();
    const building = tower(game);
    const [archer] = garrison(game, building, ["archer"]);
    archer!.attackDamage = 0;
    const footman = game.spawnUnit("enemy", "footman", building.x + 80, building.y);
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [footman.id], targetId: archer!.id });
    stepGame(game);
    expect(footman.order.type === "attack" && footman.order.targetId === archer!.id).toBe(false);
    for (let tick = 0; tick < 300; tick++) stepGame(game);
    expect(archer!.hp).toBe(archer!.maxHp);
    // Left to itself it takes up the tower, which it can strike, never the troop on it.
    expect(footman.order.type === "attack" ? footman.order.targetId : undefined).not.toBe(archer!.id);
    expect(building.hp).toBeLessThan(building.maxHp);
  });

  it("takes every damage but a melee blow at 0.4: arrows and spells alike", () => {
    const game = field();
    const building = tower(game);
    const [up] = garrison(game, building, ["footman"]);
    const down = game.spawnUnit("player", "footman", building.x, building.y + 400);
    quiet(up!); quiet(down);
    const shooters = [up!, down].map(target => {
      const archer = game.spawnUnit("enemy", "archer", target.x + 250, target.y);
      issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [archer.id], targetId: target.id });
      return archer;
    });
    for (let tick = 0; tick < 200; tick++) stepGame(game);
    for (const archer of shooters) issuePlayerCommand(game, "enemy", { type: "stop", unitIds: [archer.id] });
    for (let tick = 0; tick < 60; tick++) stepGame(game);
    // Real arrows: each lands for less than half (whole-point rounding of a 13-point arrow keeps it off exactly 0.4).
    const lostUp = up!.maxHp - up!.hp, lostDown = down.maxHp - down.hp;
    expect(lostDown).toBeGreaterThan(0);
    expect(lostUp).toBeGreaterThan(0);
    expect(lostUp / lostDown).toBeLessThan(0.5);
    // One blow of each kind, the same on both: a shot and a spell land at 0.4, and so would a melee blow's full weight
    // if one could ever cross (it cannot; see strikeReach).
    const source = { id: "script-caster", owner: "enemy" as const, x: up!.x + 200, y: up!.y };
    for (const style of ["ranged", "spell"] as const) {
      up!.hp = up!.maxHp; down.hp = down.maxHp;
      strikeUnit(game, source, up!, 50, style);
      strikeUnit(game, source, down, 50, style);
      expect(up!.maxHp - up!.hp).toBeCloseTo((down.maxHp - down.hp) * TOWER_GARRISON.damageTaken, 5);
    }
  });

  it("still takes a heal and a curse", () => {
    const game = field();
    const building = tower(game);
    const [footman] = garrison(game, building, ["footman"]);
    quiet(footman!);
    footman!.hp = 50;
    const priest = game.spawnUnit("player", "priest", building.x, building.y + 150);
    issuePlayerCommand(game, "player", { type: "cast", unitId: priest.id, ability: "heal", targetId: footman!.id });
    stepGame(game);
    expect(footman!.hp).toBeGreaterThan(50);
    const witch = game.spawnUnit("enemy", "witch", building.x + 200, building.y);
    issuePlayerCommand(game, "enemy", { type: "cast", unitId: witch.id, ability: "curse", targetId: footman!.id });
    stepGame(game);
    expect(footman!.effects).toContainEqual(expect.objectContaining({ type: "curse" }));
  });

  it("lets a troop on top shoot as from the ground, and keeps a melee troop on top from striking down", () => {
    const game = field();
    const building = tower(game);
    const [archer, footman] = garrison(game, building, ["archer", "footman"]);
    const groundArcher = game.spawnUnit("player", "archer", building.x - 600, building.y);
    const targets = [archer!, groundArcher].map(shooter => {
      const target = quiet(game.spawnUnit("enemy", "footman", shooter.x + 250, shooter.y));
      issuePlayerCommand(game, "player", { type: "attack", unitIds: [shooter.id], targetId: target.id });
      return target;
    });
    const below = quiet(game.spawnUnit("enemy", "footman", building.x - building.radius - 20, building.y - 14));
    for (let tick = 0; tick < 120; tick++) stepGame(game);
    expect(targets[0]!.maxHp - targets[0]!.hp).toBe(targets[1]!.maxHp - targets[1]!.hp);
    expect(targets[0]!.hp).toBeLessThan(targets[0]!.maxHp);
    expect(footman!.garrison).toBeDefined();
    expect(below.hp).toBe(below.maxHp);
  });

  it("comes down for a walk, and all at once at the tower's own order", () => {
    const game = field();
    const building = tower(game);
    const [a, b, c] = garrison(game, building, ["archer", "worker", "worker"]);
    issuePlayerCommand(game, "player", { type: "move", unitIds: [a!.id], x: building.x + 600, y: building.y });
    for (let tick = 0; tick < 40; tick++) stepGame(game);
    expect(a!.garrison).toBeUndefined();
    expect(a!.x).toBeGreaterThan(building.x + building.radius);
    issuePlayerCommand(game, "player", { type: "ungarrison", buildingId: building.id });
    expect([b!, c!].every(unit => !unit.garrison)).toBe(true);
    for (const unit of [b!, c!]) expect(Math.hypot(unit.x - building.x, unit.y - building.y)).toBeGreaterThan(building.radius);
  });

  it("leaves its troops standing where they stood when the tower falls, free to walk", () => {
    const game = field();
    const building = tower(game);
    const troops = garrison(game, building, ["archer", "worker", "worker"]);
    building.hp = 0;
    stepGame(game);
    expect(game.buildings.includes(building)).toBe(false);
    expect(troops.every(unit => unit.hp > 0 && !unit.garrison)).toBe(true);
    const start = { x: troops[0]!.x, y: troops[0]!.y };
    issuePlayerCommand(game, "player", { type: "move", unitIds: [troops[0]!.id], x: start.x + 300, y: start.y });
    for (let tick = 0; tick < 20; tick++) stepGame(game);
    expect(troops[0]!.x).toBeGreaterThan(start.x + 10);
  });
});

describe("tower garrison save and replay", () => {
  function scene() {
    const game = field("ladder");
    const site = openGroundNear(game.map, { x: 2600, y: 1500 })!;
    const fortified = tower(game, site.x, site.y);
    garrison(game, fortified, ["footman", "archer"]);
    const second = openGroundNear(game.map, { x: 2600, y: 1900 })!;
    const fortifying = tower(game, second.x, second.y, false);
    issuePlayerCommand(game, "player", { type: "fortifyTower", buildingId: fortifying.id });
    for (let tick = 0; tick < 40; tick++) stepGame(game);
    const raider = game.spawnUnit("enemy", "archer", site.x + 300, site.y);
    const mark = towerGarrison(game.units, fortified)[0]!;
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [raider.id], targetId: mark.id });
    const brute = game.spawnUnit("enemy", "footman", site.x - 200, site.y);
    return { game, fortified, fortifying, mark, brute };
  }

  it("restores a fortification under way and a full garrison, and plays on identically", () => {
    const { game, fortifying } = scene();
    expect(fortifying.fortify!.remaining).toBeGreaterThan(0);
    expect(towerGarrison(game.units, game.buildings.find(building => building.fortified)!).length).toBe(2);
    const snapshot = snapshotGame(game);
    const copy = createGame("ladder", { players: ["player", "enemy"], aiPlayers: [] });
    copy.scriptedVictory = true;
    restoreSnapshotIntoGame(copy, structuredClone(snapshot), game.nextId);
    expect(snapshotGame(copy)).toEqual(snapshot);
    expect(checksumGame(copy)).toBe(checksumGame(game));
    for (let tick = 0; tick < TOWER_GARRISON.time; tick++) { stepGame(game); stepGame(copy); }
    expect(copy.buildings.find(building => building.id === fortifying.id)!.fortified).toBe(true);
    expect(checksumGame(copy)).toBe(checksumGame(game));
  });

  it("plays the same scene the same way twice, on a map with terrain", () => {
    const first = scene(), two = scene().game, one = first.game;
    for (let tick = 0; tick < 400; tick++) { stepGame(one); stepGame(two); }
    expect(checksumGame(one)).toBe(checksumGame(two));
    // The archer's arrows reach the top across the terrain; the footman's blade never does, and it is not held there.
    expect(first.mark.hp).toBeLessThan(first.mark.maxHp);
    expect(first.brute.order.type === "attack" && towerGarrison(one.units, first.fortified).some(unit => unit.id === (first.brute.order as { targetId: string }).targetId)).toBe(false);
  });
});
