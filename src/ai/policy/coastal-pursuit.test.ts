import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { AiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import { setBuildingBodies } from '../../shared/terrain';
import { canReach } from '../../shared/naval';
import { isInCabin } from '../../shared/ship-cabin';
import type { GameSnapshot } from '../../shared/types';
import { coastalBoardingThreats, coastalPursuitThreats, outmatchingCoastalPursuers } from './coastal-boarding';
import { outmatchingCoast } from './coastal-risk';
import { coastalFireDisks, coastalFireSegmentClear } from './coastal-voyage';

function actual() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/coastal-pursuit-actual-234990.json.gz', import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>;
  };
  const snapshot = saved.snapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  beginShipCollisionFrame(snapshot.units, snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const ship = snapshot.units.find(unit => unit.id === 'unit-p0-bombardShip-50739')!;
  const crew = snapshot.units.find(unit => unit.id === 'unit-p0-emberRavager-23742')!;
  const options = bootstrapPolicyContext(snapshot, 'p0', 'v9_summoner', { memory: saved.memories.p0! });
  return { snapshot, ship, crew, options };
}

describe('public pursuit of a coastal hull or its actual exposed crew', () => {
  it('sees the real12 pursuers inside the existing warning while the close-coast odds are empty', () => {
    const { snapshot, ship, options } = actual();
    const threats = coastalPursuitThreats(snapshot, ship, options);
    expect(threats).toHaveLength(12);
    expect(coastalBoardingThreats(snapshot, ship, options)).toEqual([]);
    expect(outmatchingCoast(snapshot, 'p0', ship, ship, options)).toEqual([]);
    expect(outmatchingCoastalPursuers(snapshot, ship, options)).toEqual(threats);
    const pose = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
    expect(coastalFireSegmentClear(pose, pose, coastalFireDisks(snapshot, ship, options))).toBe(false);
  });

  it('does not infer pursuit from ordinary attack-move coordinates without a target identity', () => {
    const { snapshot, ship, options } = actual();
    for (const foe of coastalPursuitThreats(snapshot, ship, options)) foe.order = { type: 'attackMove', x: ship.x, y: ship.y };
    expect(coastalPursuitThreats(snapshot, ship, options)).toEqual([]);
  });

  it('does not attach attacks on another deck or a protected cabin occupant to this hull', () => {
    const { snapshot, ship, crew, options } = actual();
    const againstCrew = coastalPursuitThreats(snapshot, ship, options).filter(foe => 'targetId' in foe.order && foe.order.targetId === crew.id);
    expect(againstCrew.length).toBeGreaterThan(0);
    crew.deck!.shipId = 'another-hull';
    expect(coastalPursuitThreats(snapshot, ship, options).some(foe => againstCrew.includes(foe))).toBe(false);
    crew.deck!.shipId = ship.id; crew.cabin = { shipId: ship.id };
    expect(coastalPursuitThreats(snapshot, ship, options).some(foe => againstCrew.includes(foe))).toBe(false);
  });

  it('requires native terrain reach from a public attacker on another island', () => {
    const { snapshot, ship, options } = actual();
    const foe = coastalPursuitThreats(snapshot, ship, options)[0]!;
    const otherHall = snapshot.buildings.find(building => building.owner === 'p1' && building.kind === 'townHall')!;
    foe.x = otherHall.x; foe.y = otherHall.y;
    expect(canReach(snapshot.map, foe, ship, snapshot.units)).toBe(false);
    expect(coastalPursuitThreats(snapshot, ship, options)).not.toContain(foe);
  });

  it('preserves the original strength margin against a sole almost-dead pursuer', () => {
    const { snapshot, ship, options } = actual();
    const threats = coastalPursuitThreats(snapshot, ship, options);
    for (const [index, foe] of threats.entries()) { if (index) foe.order = { type: 'idle' }; else foe.hp = 1; }
    expect(coastalPursuitThreats(snapshot, ship, options)).toHaveLength(1);
    expect(outmatchingCoastalPursuers(snapshot, ship, options)).toEqual([]);
  });

  it('excludes a dead, friendly, attached or sheltered actor even when its old target names the crew', () => {
    const { snapshot, ship, options } = actual();
    const threats = coastalPursuitThreats(snapshot, ship, options);
    for (const [index, foe] of threats.entries()) {
      if (index % 4 === 0) foe.hp = 0;
      else if (index % 4 === 1) foe.owner = ship.owner;
      else if (index % 4 === 2) foe.deck = { shipId: ship.id, x: 0, y: 0 };
      else {
        // Native cabin occupancy requires the matching actual deck; a stale
        // cabin tag on a ground actor does not grant shelter.
        foe.deck = { shipId: ship.id, x: 0, y: 0 };
        foe.cabin = { shipId: ship.id };
        expect(isInCabin(foe)).toBe(true);
      }
    }
    expect(coastalPursuitThreats(snapshot, ship, options)).toEqual([]);
  });
});
