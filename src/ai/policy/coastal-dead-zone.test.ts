import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { workingWeaponGeometry } from '../../shared/combat-fire-geometry';
import { installedWeapons } from '../../shared/ship-equipment';
import { setBuildingBodies } from '../../shared/terrain';
import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { coastalDeadZoneThreats, outmatchingCoast } from './coastal-risk';
import { planNavalTactics } from './naval';

function actual(tick = 232380) {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/coastal-mortar-dead-zone-${tick}.json.gz`, import.meta.url))).toString());
  const snapshot: GameSnapshot = frame.snapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  beginShipCollisionFrame(snapshot.units, snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  const ship = snapshot.units.find(unit => unit.id === 'unit-p0-bombardShip-50739')!;
  const enemy = snapshot.units.find(unit => unit.id === 'unit-p2-spirit-146880')!;
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_summoner', { memory: frame.memories.p0, ...(snapshot.teams ? { teams: snapshot.teams } : {}) });
  return { snapshot, ship, enemy, options };
}

describe('actual coastal mortar dead zone', () => {
  it('separates a real min-range failure from the original favorable fleet odds', () => {
    const { snapshot, ship, enemy, options } = actual();
    const original = JSON.stringify(snapshot);
    const shot = workingWeaponGeometry(snapshot, ship, enemy)[0]!;
    expect(shot.kind).toBe('shipMortar');
    expect(shot.gap).toBeCloseTo(127.433, 2);
    expect(shot.minimum).toBe(180);
    expect(shot.withinRange).toBe(false);
    expect(shot.withinArc).toBe(true);
    expect(shot.clearLane).toBe(true);
    expect(shot.covers).toBe(false);
    expect(workingWeaponGeometry(snapshot, enemy, ship).some(weapon => weapon.covers)).toBe(true);
    expect(outmatchingCoast(snapshot, 'p0', ship, ship, options)).toEqual([]);
    expect(coastalDeadZoneThreats(snapshot, 'p0', ship, options).map(unit => unit.id)).toEqual([enemy.id]);
    expect(JSON.stringify(snapshot)).toBe(original);
  });

  it('keeps far legal mortar shots separate from an uncovered close attacker', () => {
    const { snapshot, ship, options } = actual(232590);
    const far = snapshot.units.find(unit => unit.id === 'unit-p2-spirit-146908')!;
    const close = snapshot.units.find(unit => unit.id === 'unit-p2-spirit-147249')!;
    expect(workingWeaponGeometry(snapshot, ship, far).some(weapon => weapon.covers)).toBe(true);
    expect(workingWeaponGeometry(snapshot, ship, close).some(weapon => weapon.covers)).toBe(false);
    expect(coastalDeadZoneThreats(snapshot, 'p0', ship, options).map(unit => unit.id)).toContain(close.id);
  });

  it('does not remove a legal working gun while it is reloading', () => {
    const { snapshot, ship } = actual(232590);
    const far = snapshot.units.find(unit => unit.id === 'unit-p2-spirit-146908')!;
    const before = workingWeaponGeometry(snapshot, ship, far);
    expect(installedWeapons(snapshot, ship)[0]!.cooldownRemaining).toBeGreaterThan(0);
    installedWeapons(snapshot, ship)[0]!.cooldownRemaining = 1000;
    ship.cooldown = 1000;
    expect(workingWeaponGeometry(snapshot, ship, far)).toEqual(before);
    expect(before.some(weapon => weapon.covers)).toBe(true);
  });

  it('retains intrinsic cutter fire without an installed gun', () => {
    const { snapshot, ship, enemy, options } = actual();
    const cutter = snapshot.units.find(unit => unit.kind === 'cutter' && unit.owner === 'p0')!;
    expect(installedWeapons(snapshot, cutter)).toEqual([]);
    // Counterfactual pose only, to isolate the existing intrinsic weapon.
    cutter.x = ship.x; cutter.y = ship.y;
    expect(workingWeaponGeometry(snapshot, cutter, enemy)).toContainEqual(expect.objectContaining({ kind: 'intrinsic', minimum: 0, covers: true }));
    expect(coastalDeadZoneThreats(snapshot, 'p0', cutter, options)).toEqual([]);
  });

  it('does not call an empty or destroyed weapon list a mortar dead zone', () => {
    const { snapshot, ship, enemy, options } = actual();
    installedWeapons(snapshot, ship)[0]!.durability = 0;
    expect(workingWeaponGeometry(snapshot, ship, enemy)).toEqual([]);
    expect(coastalDeadZoneThreats(snapshot, 'p0', ship, options)).toEqual([]);
  });

  it('does not turn a temporary arc obstruction into minimum range', () => {
    const { snapshot, ship, enemy, options } = actual();
    // A cannon is accepted by this bow fitting; its close range is functional.
    installedWeapons(snapshot, ship)[0]!.kind = 'shipCannon';
    expect(workingWeaponGeometry(snapshot, ship, enemy)[0]!.covers).toBe(true);
    ship.sailing!.heading += Math.PI;
    const shot = workingWeaponGeometry(snapshot, ship, enemy)[0]!;
    expect(shot.withinArc).toBe(false);
    expect(shot.gap).toBeGreaterThanOrEqual(shot.minimum);
    expect(coastalDeadZoneThreats(snapshot, 'p0', ship, options)).toEqual([]);
  });

  it('reports an allied hull in the firing lane without calling it minimum range', () => {
    const { snapshot, ship, enemy, options } = actual();
    installedWeapons(snapshot, ship)[0]!.kind = 'shipCannon';
    expect(workingWeaponGeometry(snapshot, ship, enemy)[0]!.clearLane).toBe(true);
    // Counterfactual blocker pose isolates the native allied-hull lane query.
    const blocker = snapshot.units.find(unit => unit.kind === 'cutter' && unit.owner === 'p0')!;
    blocker.x = ship.x + (enemy.x - ship.x) * .75;
    blocker.y = ship.y + (enemy.y - ship.y) * .75;
    const shot = workingWeaponGeometry(snapshot, ship, enemy)[0]!;
    expect(shot.withinRange).toBe(true);
    expect(shot.clearLane).toBe(false);
    expect(shot.covers).toBe(false);
    expect(coastalDeadZoneThreats(snapshot, 'p0', ship, options)).toEqual([]);
  });

  it('hands a real blind engagement to the original retreat owner using public movement', () => {
    const { snapshot, ship, options } = actual();
    const before = JSON.stringify(snapshot);
    const commands = planNavalTactics(snapshot, 'p0', options);
    expect(commands).toContainEqual(expect.objectContaining({ type: 'move', unitIds: [ship.id] }));
    expect(options.memory!.naval!.coastalRetreat![ship.id]).toBeDefined();
    expect(commands.some(command => command.type === 'attackMove' && command.unitIds.includes(ship.id))).toBe(false);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('does not claim boarders or distant inland soldiers as this shore range-control task', () => {
    const { snapshot, ship, enemy, options } = actual();
    enemy.deck = { shipId: ship.id, x: 0, y: 0 };
    expect(coastalDeadZoneThreats(snapshot, 'p0', ship, options)).toEqual([]);
    delete enemy.deck;
    enemy.x -= 1000;
    expect(coastalDeadZoneThreats(snapshot, 'p0', ship, options)).toEqual([]);
  });
});
