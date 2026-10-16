import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { AiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import { setBuildingBodies } from '../../shared/terrain';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import { planBootstrapNaval } from '../bootstrap_1/expedition-recovery';
import { coastalPursuitThreats, outmatchingCoastalPursuers } from './coastal-boarding';
import { coastalFireDisks, coastalFireSegmentClear } from './coastal-voyage';
const T = 'unit-p0-bombardShip-50739';
function actual(version: BootstrapAiVersion = 'v9_summoner') {
  const f = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/coastal-pursuit-actual-234900.json.gz', import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>;
  };
  const snapshot = f.snapshot, memory = f.memories.p0!;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  beginShipCollisionFrame(snapshot.units, snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const ship = snapshot.units.find(u => u.id === T)!;
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory });
  return { snapshot, memory, ship, options };
}
function hasPursuit(memory: AiPolicyMemory) { return !!memory.naval?.coastalRetreat?.[T]?.pursuit; }

describe('public pursuit owns departure before the proximity warning', () => {
  it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s responds to the actual234900 explicit crew target outside warning160', version => {
    // This is one exact normal beforeP0 component input, not three match results.
    // Opponents, terrain, resources, health and ordinary source orders are unchanged.
    const { snapshot, memory, ship, options } = actual(version);
    expect(coastalPursuitThreats(snapshot, ship, options)).toHaveLength(13);
    const here = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
    expect(coastalFireSegmentClear(here, here, coastalFireDisks(snapshot, ship, options))).toBe(true);
    const commands = planBootstrapNaval(snapshot, 'p0', options);
    expect(memory.naval?.coastalRetreat?.[T]).toEqual({ x: 5961.608465576145, y: 7796.224394159084, pursuit: true });
    expect(commands).toContainEqual({ type: 'move', unitIds: [T], x: 5961.608465576145, y: 7796.224394159084, avoidCombat: true });
    expect(ship.hp).toBe(198.3);
  });

  it('keeps ordinary coordinate attack-move outside this owner without a public target identity', () => {
    const { snapshot, memory, ship, options } = actual();
    for (const foe of coastalPursuitThreats(snapshot, ship, options)) foe.order = { type: 'attackMove', x: ship.x, y: ship.y };
    planBootstrapNaval(snapshot, 'p0', options);
    expect(hasPursuit(memory)).toBe(false);
  });

  it('keeps an attack on a different actual deck outside this hull owner', () => {
    const { snapshot, memory, ship, options } = actual();
    const crew = snapshot.units.find(u => u.id === 'unit-p0-emberRavager-23742')!;
    crew.deck!.shipId = snapshot.units.find(u => u.owner === 'p0' && u.sailing && u.id !== T)!.id;
    planBootstrapNaval(snapshot, 'p0', options);
    expect(hasPursuit(memory)).toBe(false);
  });

  it('preserves ordinary strength odds for a sole almost-dead pursuer', () => {
    const { snapshot, memory, ship, options } = actual();
    for (const [i, foe] of coastalPursuitThreats(snapshot, ship, options).entries()) {
      if (i) foe.order = { type: 'idle' }; else foe.hp = 1;
    }
    expect(outmatchingCoastalPursuers(snapshot, ship, options)).toEqual([]);
    planBootstrapNaval(snapshot, 'p0', options);
    expect(hasPursuit(memory)).toBe(false);
  });

  it('does not convert a remote island attack order into this hull departure', () => {
    const { snapshot, memory, ship, options } = actual();
    const other = snapshot.buildings.find(b => b.owner === 'p1' && b.kind === 'townHall')!;
    for (const foe of coastalPursuitThreats(snapshot, ship, options)) { foe.x = other.x; foe.y = other.y; }
    expect(coastalPursuitThreats(snapshot, ship, options)).toEqual([]);
    planBootstrapNaval(snapshot, 'p0', options);
    expect(hasPursuit(memory)).toBe(false);
  });
});
