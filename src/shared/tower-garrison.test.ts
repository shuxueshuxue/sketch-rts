import { afterEach, describe, expect, it } from "vitest";
import { upgradeJob } from "./building-jobs";
import { BUILDING_DEFS, UNIT_DEFS, type BuildingDef } from "./catalog";
import { createBuilding } from "./map";
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame, strikeUnit, transformBuilding, type Game } from "./sim";
import { checksumGame } from "./sim/checksum";
import { checkCommandLegality } from "./sim/command-validation";
import { footprintCells, isOpenGround, openGroundNear, snapToFootprint } from "./terrain";
import { TOWER_GARRISON, towerGarrison } from "./tower-garrison";
import type { Building, BuildingKind, Unit, UnitKind } from "./types";

const FORTIFIED = BUILDING_DEFS.fortifiedTower;

function field(mapId: "bareDuel" | "ladder" = "bareDuel") {
  const game = createGame(mapId, { players: ["player", "enemy"], aiPlayers: [] });
  game.units = [];
  game.scriptedVictory = true;
  game.players.player!.gold = 5000;
  return game;
}

function upgrade(game: Game, building: Building) {
  issuePlayerCommand(game, "player", { type: "upgradeBuilding", buildingId: building.id, to: "fortifiedTower" });
}

function tower(game: Game, x = 1500, y = 1500, fortified = true) {
  // Laid on the grid as a worker lays one (see snapToFootprint).
  const at = snapToFootprint(game.map, BUILDING_DEFS.defenseTower.radius, { x, y });
  const building = createBuilding(`tower-${game.buildings.length}`, "player", "defenseTower", at.x, at.y, true);
  game.buildings.push(building);
  if (fortified) {
    upgrade(game, building);
    for (let tick = 0; tick < FORTIFIED.buildTime; tick++) stepGame(game);
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

// @@@building-upgrade
describe("tower upgrade", () => {
  it("is a job of the tower's work queue: it takes its gold and time, keeps the tower shooting until done, then the tower is a fortified one", () => {
    const game = field();
    const building = tower(game, 1500, 1500, false);
    const enemy = quiet(game.spawnUnit("enemy", "footman", 1500 + 300, 1500));
    const supply = game.players.player!.supplyUsed;
    upgrade(game, building);
    expect(game.players.player!.gold).toBe(5000 - FORTIFIED.cost);
    expect(building.queue).toEqual([{ kind: "upgrade", id: expect.any(String), to: "fortifiedTower", remaining: FORTIFIED.buildTime, paidGold: FORTIFIED.cost }]);
    expect(checkCommandLegality(game, "player", { type: "upgradeBuilding", buildingId: building.id, to: "fortifiedTower" })?.message).toMatch(/already upgrading/);
    // It takes no supply.
    expect(game.players.player!.supplyUsed).toBe(supply);
    for (let tick = 0; tick < FORTIFIED.buildTime - 1; tick++) stepGame(game);
    expect(building.kind).toBe("defenseTower");
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
    stepGame(game);
    expect(building.queue).toEqual([]);
    expect(building.kind).toBe("fortifiedTower");
    expect(building.maxHp).toBe(FORTIFIED.hp);
    expect(building.hp).toBe(building.maxHp);
    expect(building.radius).toBe(FORTIFIED.radius);
    expect(building.attackDamage).toBe(0);
    enemy.hp = enemy.maxHp;
    for (let tick = 0; tick < 200; tick++) stepGame(game);
    expect(enemy.hp).toBe(enemy.maxHp);
    expect(checkCommandLegality(game, "player", { type: "upgradeBuilding", buildingId: building.id, to: "fortifiedTower" })?.message).toMatch(/cannot be upgraded/);
  });

  it("is cancelled by its job id for all its gold back, as a unit in training is", () => {
    const game = field();
    const building = tower(game, 1500, 1500, false);
    upgrade(game, building);
    for (let tick = 0; tick < 40; tick++) stepGame(game);
    issuePlayerCommand(game, "player", { type: "cancelTraining", buildingId: building.id, jobId: upgradeJob(building)!.id });
    expect(game.players.player!.gold).toBe(5000);
    expect(building.queue).toEqual([]);
    for (let tick = 0; tick < FORTIFIED.buildTime; tick++) stepGame(game);
    expect(building.kind).toBe("defenseTower");
  });

  it("keeps the share of health a damaged tower had", () => {
    const game = field();
    const building = tower(game, 1500, 1500, false);
    building.hp = building.maxHp / 2;
    upgrade(game, building);
    for (let tick = 0; tick < FORTIFIED.buildTime; tick++) stepGame(game);
    expect(building.hp).toBe(FORTIFIED.hp / 2);
  });

  it("sets whoever stood where the tower grew outside its new wall", () => {
    const game = field("ladder");
    const site = openGroundNear(game.map, { x: 2600, y: 1500 })!;
    const building = tower(game, site.x, site.y, false);
    // Pressed against the old wall, inside the new one.
    const worker = quiet(game.spawnUnit("player", "worker", site.x + BUILDING_DEFS.defenseTower.radius + 4, site.y));
    upgrade(game, building);
    for (let tick = 0; tick < FORTIFIED.buildTime + 2; tick++) stepGame(game);
    expect(building.kind).toBe("fortifiedTower");
    expect(isOpenGround(game.map, worker.x, worker.y)).toBe(true);
    expect(Math.hypot(worker.x - building.x, worker.y - building.y)).toBeGreaterThan(FORTIFIED.radius);
  });
});

describe("upgraded footprint", () => {
  it("lays the broader tower on the grid like any building: three cells across, centred on its own cell", () => {
    const game = field("ladder");
    const site = openGroundNear(game.map, { x: 2600, y: 1500 })!;
    const plain = tower(game, site.x, site.y, false);
    const at = { x: plain.x, y: plain.y };
    upgrade(game, plain);
    for (let tick = 0; tick < FORTIFIED.buildTime; tick++) stepGame(game);
    const cell = game.map.terrain!.cell, cells = footprintCells(cell, plain.x, plain.y, plain.radius);
    expect([cells.right - cells.left + 1, cells.bottom - cells.top + 1]).toEqual([3, 3]);
    expect(((cells.left + cells.right + 1) / 2) * cell).toBe(plain.x);
    expect(((cells.top + cells.bottom + 1) / 2) * cell).toBe(plain.y);
    expect(Math.abs(plain.x - at.x)).toBe(cell / 2);
  });

  // A real map's troops come at a tower from one side, one behind the other (the browser proof found the second
  // stopping a cell short, against a footprint that sat half a cell off the tower's centre).
  it("takes up two archers walking up from the same side on pineshade", () => {
    const probe = createGame("pineshade", { players: ["player", "enemy"], aiPlayers: [] });
    const hall = probe.buildings.find(building => building.owner === "player" && building.kind === "townHall")!;
    const cx = hall.x, cy = hall.y + 300;
    const game = createGame("pineshade", { players: ["player", "enemy"], aiPlayers: [], scenario: {
      addBuildings: [{ id: "t", owner: "player", kind: "defenseTower", x: cx, y: cy, complete: true }],
      addUnits: [{ id: "a", owner: "player", kind: "archer", x: cx - 160, y: cy + 120 }, { id: "b", owner: "player", kind: "archer", x: cx - 120, y: cy + 120 }],
    } });
    game.players.player!.gold = 1000;
    upgrade(game, game.buildings.find(building => building.id === "t")!);
    for (let tick = 0; tick < FORTIFIED.buildTime; tick++) stepGame(game);
    issuePlayerCommand(game, "player", { type: "garrison", unitIds: ["a", "b"], buildingId: "t" });
    for (let tick = 0; tick < 300; tick++) stepGame(game);
    expect(game.units.filter(unit => unit.garrison?.buildingId === "t").map(unit => unit.id).sort()).toEqual(["a", "b"]);
  });

  it("refuses to upgrade a tower walled in on every side, and refunds one walled in while it was upgrading", () => {
    const game = field("ladder");
    const site = openGroundNear(game.map, { x: 2600, y: 1500 })!;
    const plain = tower(game, site.x, site.y, false);
    const cell = game.map.terrain!.cell;
    const wall = (dx: number, dy: number) => game.buildings.push(createBuilding(`wall-${dx}-${dy}`, "player", "defenseTower", plain.x + dx * cell * 2, plain.y + dy * cell * 2, true));
    upgrade(game, plain);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) wall(dx!, dy!);
    for (let tick = 0; tick < FORTIFIED.buildTime; tick++) stepGame(game);
    expect(plain.kind).toBe("defenseTower");
    expect(plain.queue).toEqual([]);
    expect(game.players.player!.gold).toBe(5000);
    expect(game.effects).toContainEqual(expect.objectContaining({ type: "goldBounty", owner: "player", amount: FORTIFIED.cost }));
    expect(checkCommandLegality(game, "player", { type: "upgradeBuilding", buildingId: plain.id, to: "fortifiedTower" })?.message).toMatch(/No room/);
  });
});

// The transform knows nothing of towers: a made-up kind upgraded from a farm is laid down by the same rules.
describe("transformBuilding", () => {
  const FAKE = "testGranary" as BuildingKind;
  const defs = BUILDING_DEFS as Record<string, BuildingDef>;
  afterEach(() => { delete defs[FAKE]; });

  // Open ground with a grid: bareDuel has none.
  function plain() {
    const game = field();
    game.buildings = [];
    game.map = { ...game.map, terrain: { cell: 32, cols: 128, rows: 128, cells: ".".repeat(128 * 128) } };
    return game;
  }

  function farm(game: Game) {
    const at = snapToFootprint(game.map, BUILDING_DEFS.farm.radius, { x: 1500, y: 1500 });
    const building = createBuilding("farm-1", "player", "farm", at.x, at.y, true);
    game.buildings.push(building);
    return building;
  }

  it("re-lays a building whose new footprint is laid on another grid half a cell off, and one on the same grid where it stood", () => {
    for (const [radius, offset] of [[44, 0.5], [60, 0]] as const) {
      const game = plain();
      const building = farm(game);
      const cell = game.map.terrain!.cell, at = { x: building.x, y: building.y };
      defs[FAKE] = { ...BUILDING_DEFS.farm, upgradeFrom: "farm", hp: 900, radius, cost: 30, buildTime: 20 };
      building.hp = building.maxHp * 0.75;
      issuePlayerCommand(game, "player", { type: "upgradeBuilding", buildingId: building.id, to: FAKE });
      for (let tick = 0; tick < 20; tick++) stepGame(game);
      expect(building.kind).toBe(FAKE);
      expect(building.radius).toBe(radius);
      expect(building.hp).toBe(675);
      expect(Math.abs(building.x - at.x)).toBe(cell * offset);
      expect(snapToFootprint(game.map, radius, building)).toEqual({ x: building.x, y: building.y });
      expect(game.players.player!.gold).toBe(5000 - 30);
    }
  });

  it("changes nothing when the new footprint has no room", () => {
    const game = plain();
    const building = farm(game);
    defs[FAKE] = { ...BUILDING_DEFS.farm, upgradeFrom: "farm", radius: 4000 };
    const before = structuredClone(building);
    expect(transformBuilding(game, building, FAKE)).toBe(false);
    expect(building).toEqual(before);
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

  it("refuses a tower not upgraded", () => {
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

describe("a ranged troop on the tower's top reaches farther", () => {
  it("strikes a mark beyond its own range but within 1.2 times it, and no longer once down", () => {
    const game = field();
    const building = tower(game);
    const [archer] = garrison(game, building, ["archer"]);
    const base = UNIT_DEFS.archer.attackRange;
    expect(archer!.attackRange).toBeCloseTo(base * TOWER_GARRISON.rangeMultiplier, 5);
    const gap = base * 1.08;
    const mark = quiet(game.spawnUnit("enemy", "footman", archer!.x + archer!.radius + 16 + gap, archer!.y));
    mark.radius = 16;
    for (let tick = 0; tick < 100 && mark.hp === mark.maxHp; tick++) stepGame(game);
    expect(mark.hp).toBeLessThan(mark.maxHp);
    issuePlayerCommand(game, "player", { type: "ungarrison", buildingId: building.id });
    expect(archer!.attackRange).toBeCloseTo(base, 5);
    // The same gap on the ground.
    mark.hp = mark.maxHp;
    mark.x = archer!.x + archer!.radius + mark.radius + gap; mark.y = archer!.y;
    quiet(archer!); archer!.attackDamage = 13;
    archer!.order = { type: "hold", x: archer!.x, y: archer!.y };
    for (let tick = 0; tick < 100; tick++) stepGame(game);
    expect(mark.hp).toBe(mark.maxHp);
  });

  it("loses the reach when its tower falls, and a melee troop never gains any", () => {
    const game = field();
    const building = tower(game);
    const [archer, footman] = garrison(game, building, ["archer", "footman"]);
    const blade = footman!.attackRange;
    expect(blade).toBe(game.spawnUnit("player", "footman", 100, 100).attackRange);
    building.hp = 0;
    stepGame(game);
    expect(archer!.attackRange).toBeCloseTo(UNIT_DEFS.archer.attackRange, 5);
    expect(footman!.attackRange).toBe(blade);
  });
});

describe("tower garrison save and replay", () => {
  function scene() {
    const game = field("ladder");
    const site = openGroundNear(game.map, { x: 2600, y: 1500 })!;
    const fortified = tower(game, site.x, site.y);
    garrison(game, fortified, ["footman", "archer"]);
    const second = openGroundNear(game.map, { x: 2600, y: 1900 })!;
    const upgrading = tower(game, second.x, second.y, false);
    upgrade(game, upgrading);
    for (let tick = 0; tick < 40; tick++) stepGame(game);
    const raider = game.spawnUnit("enemy", "archer", site.x + 300, site.y);
    const mark = towerGarrison(game.units, fortified)[0]!;
    issuePlayerCommand(game, "enemy", { type: "attack", unitIds: [raider.id], targetId: mark.id });
    const brute = game.spawnUnit("enemy", "footman", site.x - 200, site.y);
    return { game, fortified, upgrading, mark, brute };
  }

  function restored(game: Game) {
    const snapshot = snapshotGame(game);
    const copy = createGame("ladder", { players: ["player", "enemy"], aiPlayers: [] });
    copy.scriptedVictory = true;
    restoreSnapshotIntoGame(copy, structuredClone(snapshot), game.nextId);
    expect(snapshotGame(copy)).toEqual(snapshot);
    expect(checksumGame(copy)).toBe(checksumGame(game));
    return copy;
  }

  it("restores an upgrade under way and a full garrison, and plays on identically", () => {
    const { game, upgrading } = scene();
    expect(upgradeJob(upgrading)!.remaining).toBeGreaterThan(0);
    expect(towerGarrison(game.units, game.buildings.find(building => building.kind === "fortifiedTower")!).length).toBe(2);
    const copy = restored(game);
    for (let tick = 0; tick < FORTIFIED.buildTime; tick++) { stepGame(game); stepGame(copy); }
    expect(copy.buildings.find(building => building.id === upgrading.id)!.kind).toBe("fortifiedTower");
    expect(checksumGame(copy)).toBe(checksumGame(game));
  });

  it("restores a finished upgrade with a full garrison, and plays on identically", () => {
    const { game, upgrading } = scene();
    for (let tick = 0; tick < FORTIFIED.buildTime; tick++) stepGame(game);
    garrison(game, upgrading, ["archer", "archer"]);
    expect(towerGarrison(game.units, upgrading).length).toBe(2);
    const copy = restored(game);
    for (let tick = 0; tick < 200; tick++) { stepGame(game); stepGame(copy); }
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

  it("reads a save from before upgrades were jobs: a fortified tower, and one being fortified", () => {
    const game = field("ladder");
    const done = tower(game, ...xy(openGroundNear(game.map, { x: 2600, y: 1500 })!), false);
    const doing = tower(game, ...xy(openGroundNear(game.map, { x: 2600, y: 1900 })!), false);
    const snapshot = structuredClone(snapshotGame(game));
    const old = (id: string) => snapshot.buildings.find(building => building.id === id)! as Building & { fortified?: boolean; fortify?: { remaining: number } };
    Object.assign(old(done.id), { fortified: true, radius: 40, maxHp: 400, hp: 100 });
    old(doing.id).fortify = { remaining: 50 };
    const copy = createGame("ladder", { players: ["player", "enemy"], aiPlayers: [] });
    restoreSnapshotIntoGame(copy, snapshot, game.nextId);
    const [a, b] = [done, doing].map(tower => copy.buildings.find(building => building.id === tower.id)!);
    expect(a).toMatchObject({ kind: "fortifiedTower", radius: FORTIFIED.radius, maxHp: FORTIFIED.hp, hp: 100 });
    expect(b!.kind).toBe("defenseTower");
    expect(b!.queue).toEqual([{ kind: "upgrade", id: expect.any(String), to: "fortifiedTower", remaining: 50, paidGold: FORTIFIED.cost }]);
    for (const building of [a!, b!]) expect("fortified" in building || "fortify" in building).toBe(false);
    for (let tick = 0; tick < 50; tick++) stepGame(copy);
    expect(b!.kind).toBe("fortifiedTower");
  });
});

function xy(point: { x: number; y: number }) {
  return [point.x, point.y] as const;
}
