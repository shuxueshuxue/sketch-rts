import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createUnit, withUnitShape } from "./map";
import { boardUnit, deckPointFits } from "./decks";
import { bodyMass } from "./physical-body";
import { DEFAULT_SHIP_SCALE, SHIP_KINDS, SHIP_SIZE_MULTIPLIER, localToWorld, worldToLocal, hullContact, migrateShipSizes, shipProfile, shipScale } from "./ship-geometry";
import { UNIT_DEFS } from "./catalog";
import { buildNavigationMasks } from "./navigation-masks";
import { mountedWeaponPose, shipMounts, SHIP_WEAPONS } from "./ship-equipment";
import { createGame, restoreSnapshotIntoGame, snapshotGame } from "./sim";
import geometry from "./generated/ship-geometry.json";
import preparedMasks from "./generated/ship-navigation-masks.json";

describe("shared ship model geometry", () => {
  it("was exported from the current authored ship definitions", () => {
    expect(geometry.sourceSha256).toBe(createHash("sha256").update(readFileSync("assets/naval/ships.json")).digest("hex"));
  });
  it.each(SHIP_KINDS)("enlarges %s hulls, decks, fittings and selection radii by twenty percent", kind => {
    const ship = createUnit(kind, 'player', kind, 1000, 1000), raw = geometry.ships[kind], profile = shipProfile(ship)!;
    expect(shipScale(ship)).toBeCloseTo(1.1 * 1.2);
    expect(ship.radius).toBeCloseTo(UNIT_DEFS[kind].radius * 1.2);
    expect(profile.length / (raw.length * 1.1)).toBeCloseTo(1.2);
    expect(profile.beam / (raw.beam * 1.1)).toBeCloseTo(1.2);
    expect(profile.deckHeight / (raw.deckHeight * 1.1)).toBeCloseTo(1.2);
    expect(profile.mastHeight / (raw.mastHeight * 1.1)).toBeCloseTo(1.2);
    for (const [index, [x, y]] of raw.hull.entries()) expect(profile.hull[index]).toEqual({ x: x! * DEFAULT_SHIP_SCALE, y: y! * DEFAULT_SHIP_SCALE });
    for (const [index, [x, y]] of raw.deck.entries()) expect(profile.deck[index]).toEqual({ x: x! * DEFAULT_SHIP_SCALE, y: y! * DEFAULT_SHIP_SCALE });
    expect(profile.hullMass / (raw.hullMass * 1.1 ** 3)).toBeCloseTo(1.2 ** 3);
    expect(profile.loadCapacity / (raw.loadCapacity * 1.1 ** 2)).toBeCloseTo(1.2 ** 2);
    const mount = shipMounts(ship)[0]!;
    ship.fittings = [{ ...mount, id: 'gun' }];
    const fitting = shipProfile(ship)!.obstacles.find(obstacle => obstacle.type === 'weapon')!;
    expect(fitting.x).toBe(mount.x); expect(fitting.y).toBe(mount.y); expect(fitting.radius).toBe(mount.radius);
  });
  it.each(SHIP_KINDS)("keeps generated navigation masks current for enlarged %s geometry", kind => {
    expect(preparedMasks[kind]).toEqual(buildNavigationMasks(shipProfile(createUnit(kind, 'player', kind, 0, 0))!.hull, 32));
  });
  it.each(SHIP_KINDS)("creates %s with the enlarged radius after game upgrades and equipment initialization", kind => {
    const game = createGame('bareDuel', { aiPlayers: [] }); game.units = [];
    const ship = game.spawnUnit('player', kind, 1000, 1000);
    expect(ship.radius).toBeCloseTo(UNIT_DEFS[kind].radius * 1.2);
    expect(ship.shipSizeVersion).toBe(1);
    for (const fitting of ship.fittings ?? []) {
      const matching = shipMounts(ship).find(mount => mount.x === fitting.x && mount.y === fitting.y)!;
      expect(matching).toBeDefined(); expect(fitting.radius).toBe(matching.radius);
    }
  });
  it('applies the global multiplier to authored scales and older cargo-defined hulls once', () => {
    const ship = createUnit('campaign', 'player', 'carrier', 0, 0);
    ship.deckScale = 2.5; ship.cargoCapacity = 96;
    expect(shipScale(ship)).toBe(3);
    delete ship.deckScale; expect(shipScale(ship)).toBe(2.4);
    ship.kind = 'transport'; expect(shipScale(ship)).toBeCloseTo(Math.sqrt(96 / 8) * 1.2);
    expect(shipScale(createUnit('ordinary', 'player', 'carrier', 0, 0))).toBe(DEFAULT_SHIP_SCALE);
  });
  it('restores older physical fittings, crew, local destinations and aim anchors once', () => {
    const source = createGame('bareDuel', { aiPlayers: [] }); source.units = []; source.items = [];
    const ship = source.spawnUnit('player', 'warship', 1000, 1000);
    ship.deckScale = 2;
    ship.fittings = [{ ...shipMounts(ship)[0]!, id: 'mounted-campaign' }];
    const crew = createUnit('crew', 'player', 'archer', 0, 0); source.units.push(crew);
    expect(boardUnit(ship, crew, source.units)).toBe(true);
    crew.aim = { x: 1500, y: 1200, anchorX: crew.x, anchorY: crew.y, tracking: false, updatedTick: 0, anchorDeckX: crew.deck!.x, anchorDeckY: crew.deck!.y };
    crew.order = { type: 'move', x: 1030, y: 1000, deckPoint: { x: 30, y: 12 }, deckShipId: ship.id };
    crew.orderQueue = [{ type: 'board', transportId: ship.id, deckPoint: { x: -30, y: -12 } }];
    const expected = snapshotGame(source), older = structuredClone(expected);
    const oldShip = older.units[0]!, oldCrew = older.units[1]!;
    delete oldShip.shipSizeVersion; oldShip.radius /= SHIP_SIZE_MULTIPLIER;
    if (oldShip.bodyRadius !== undefined) oldShip.bodyRadius /= SHIP_SIZE_MULTIPLIER;
    for (const fitting of oldShip.fittings!) { fitting.x /= SHIP_SIZE_MULTIPLIER; fitting.y /= SHIP_SIZE_MULTIPLIER; fitting.radius /= SHIP_SIZE_MULTIPLIER; }
    oldCrew.deck!.x /= SHIP_SIZE_MULTIPLIER; oldCrew.deck!.y /= SHIP_SIZE_MULTIPLIER;
    oldCrew.aim!.anchorDeckX! /= SHIP_SIZE_MULTIPLIER; oldCrew.aim!.anchorDeckY! /= SHIP_SIZE_MULTIPLIER;
    if (oldCrew.order.type === 'move') { oldCrew.order.deckPoint!.x /= SHIP_SIZE_MULTIPLIER; oldCrew.order.deckPoint!.y /= SHIP_SIZE_MULTIPLIER; }
    const queued = oldCrew.orderQueue![0]!;
    if (queued.type === 'board') { queued.deckPoint!.x /= SHIP_SIZE_MULTIPLIER; queued.deckPoint!.y /= SHIP_SIZE_MULTIPLIER; }
    expect(withUnitShape(oldShip).shipSizeVersion).toBeUndefined();
    const restored = createGame('bareDuel', { aiPlayers: [] }); restoreSnapshotIntoGame(restored, older, source.nextId);
    const current = snapshotGame(restored);
    expect(current.units[0]!.deckScale).toBe(2);
    expect(current.units[0]!.radius).toBeCloseTo(expected.units[0]!.radius);
    expect(current.units[0]!.fittings).toEqual(expected.units[0]!.fittings);
    expect(current.units[1]!.deck!.shipId).toBe(expected.units[1]!.deck!.shipId);
    expect(current.units[1]!.deck!.x).toBeCloseTo(expected.units[1]!.deck!.x, 10);
    expect(current.units[1]!.deck!.y).toBeCloseTo(expected.units[1]!.deck!.y, 10);
    expect(current.units[1]!.aim).toMatchObject({ x: 1500, y: 1200, anchorX: crew.x, anchorY: crew.y, tracking: false, updatedTick: 0 });
    expect(current.units[1]!.aim!.anchorDeckX).toBeCloseTo(expected.units[1]!.aim!.anchorDeckX!, 10);
    expect(current.units[1]!.aim!.anchorDeckY).toBeCloseTo(expected.units[1]!.aim!.anchorDeckY!, 10);
    expect(current.units[1]!.order).toEqual(expected.units[1]!.order);
    expect(current.units[1]!.orderQueue).toEqual(expected.units[1]!.orderQueue);
    expect(deckPointFits(restored.units[0]!, restored.units[1]!, restored.units[1]!.deck!, restored.units)).toBe(true);
    restoreSnapshotIntoGame(restored, current, source.nextId); expect(snapshotGame(restored)).toEqual(current);
    expect(older.units[0]!.shipSizeVersion).toBeUndefined();
  });
  it('discards smaller-hull routes and boarding berths while preserving commands during migration', () => {
    const ship = createUnit('older', 'player', 'transport', 0, 0); delete ship.shipSizeVersion;
    ship.sailing = { heading: 0, speed: 0, load: 0, balance: 0, route: { goalX: 1000, goalY: 500, points: [], end: { x: 1000, y: 500 } } };
    const crew = createUnit('crew', 'player', 'worker', 0, 0);
    crew.order = { type: 'board', transportId: ship.id, deckPoint: { x: 20, y: 10 }, berth: { x: 100, y: 100 } };
    migrateShipSizes([ship, crew]);
    expect(ship.sailing.route).toBeUndefined(); expect(ship.shipSizeVersion).toBe(1);
    expect(crew.order).toEqual({ type: 'board', transportId: ship.id, deckPoint: { x: 24, y: 12 } });
    const once = structuredClone([ship, crew]); migrateShipSizes([ship, crew]); expect([ship, crew]).toEqual(once);
  });
  it.each(['shipCannon', 'shipMortar', 'flameProjector'] as const)('keeps portable %s muzzle geometry aligned with the scaled rendered model', kind => {
    const ship = createUnit('portable', 'player', 'carrier', 1000, 1000);
    const weapon = { id: 'gun', kind, x: ship.x, y: ship.y, shipId: ship.id, mountId: 'bow', cooldownRemaining: 0 };
    const pose = mountedWeaponPose(ship, weapon)!, model = geometry.ships[SHIP_WEAPONS[kind].art];
    expect(pose.pivotHeight).toBeCloseTo(shipProfile(ship)!.deckHeight + 2 * shipScale(ship));
    expect(pose.height - pose.pivotHeight).toBeCloseTo((model.weaponMount[2]! - model.weaponPivot[2]!) * shipScale(ship));
    expect(Math.hypot(pose.muzzle.x - pose.pivot.x, pose.muzzle.y - pose.pivot.y)).toBeCloseTo((model.weaponMount[0]! - model.weaponPivot[0]!) * shipScale(ship));
  });
  it("transforms local deck coordinates reversibly for every rendered heading", () => {
    const ship = createUnit("hull", "player", "transport", 1000, 1000);
    for (let frame = 0; frame < geometry.camera.directions; frame++) {
      ship.sailing = { heading: frame * Math.PI * 2 / geometry.camera.directions, speed: 0, load: 0, balance: 0 };
      const point = worldToLocal(ship, localToWorld(ship, { x: 21, y: -13 }));
      expect(point.x).toBeCloseTo(21, 5); expect(point.y).toBeCloseTo(-13, 5);
    }
  });
  it("uses rotated convex hulls rather than center radii for ship contact", () => {
    const a = createUnit("a", "player", "warship", 1000, 1000);
    const b = createUnit("b", "enemy", "warship", 1110, 1000);
    expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeGreaterThan(a.radius+b.radius);
    expect(hullContact(a,b)?.overlap).toBeGreaterThan(0);
    b.y += 140; expect(hullContact(a,b)).toBeUndefined();
  });
  it("fits a healer and shooter around a warship's actual fittings", () => {
    const ship = createUnit("hull", "player", "warship", 0, 0);
    const crew = [createUnit("priest", "player", "priest", 0, 0), createUnit("archer", "player", "archer", 0, 0)];
    for (const unit of crew) expect(boardUnit(ship,unit,crew)).toBe(true);
    for (const unit of crew) expect(deckPointFits(ship,unit,unit.deck!,crew)).toBe(true);
  });
  it("derives variant mass and mission capacity from their physical scale", () => {
    const soldier = createUnit("soldier", "player", "footman", 0, 0);
    expect(bodyMass({ ...soldier, radius: soldier.radius*2 })).toBe(bodyMass(soldier)*8);
    const ship = {...createUnit("hull", "player", "carrier", 0, 0),deckScale:1};
    const scaled = shipProfile({ ...ship, deckScale: 2 })!;
    expect(scaled.loadCapacity).toBe(shipProfile(ship)!.loadCapacity*4);
    expect(scaled.hullMass).toBe(shipProfile(ship)!.hullMass*8);
  });
});
