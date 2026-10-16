import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { AiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import { setBuildingBodies } from '../../shared/terrain';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import { planBootstrapNaval } from '../bootstrap_1/expedition-recovery';

const T = 'unit-p0-bombardShip-50739';
function actual(tick: number, version: BootstrapAiVersion = 'v9_summoner') {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/coastal-pursuit-actual-${tick}.json.gz`, import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>;
  };
  const snapshot = saved.snapshot, memory = saved.memories.p0!;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  beginShipCollisionFrame(snapshot.units, snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const ship = snapshot.units.find(unit => unit.id === T)!;
  return { snapshot, memory, ship, options: bootstrapPolicyContext(snapshot, 'p0', version, { memory }) };
}

describe('the existing naval owner leaves a public shore pursuit', () => {
  it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s uses the actual234990 pursuit before the old close-coast trigger and short astern', version => {
    // Exact fixeda6 normal beforeP0, SHA f78f4d5a843f398e4786fa9331ed0c1583e5c023ffd1b7bc0afa41b823836e30.
    // These opponents subsequently sank the hull235255; no enemy or resource is changed here.
    // Each family reads this same component input; these are not three new games.
    const { snapshot, memory, ship, options } = actual(234990, version);
    const commands = planBootstrapNaval(snapshot, 'p0', options);
    const retreat = memory.naval?.coastalRetreat?.[T];
    expect(retreat).toEqual({ x: 5964.727184324538, y: 7798.37915112596, pursuit: true });
    expect(commands).toContainEqual({ type: 'move', unitIds: [T], x: 5964.727184324538, y: 7798.37915112596, avoidCombat: true });
    expect(retreat).not.toHaveProperty('boarding');
    expect(ship.hp).toBe(198.3);
  });

  it('retains a pursuit mark inside70 until the native mover finishes', () => {
    const { snapshot, memory, ship, options } = actual(233505);
    const old = memory.naval!.coastalRetreat![T]!;
    // Counterfactual reason only on an actual moving final-approach frame.
    // This earlier Game really owned a boarding mark, not a pursuit mark.
    const goal = { x: old.x, y: old.y, pursuit: true as const };
    memory.naval!.coastalRetreat![T] = goal;
    expect(Math.hypot(ship.x - goal.x, ship.y - goal.y)).toBeLessThan(70);
    expect(ship.order.type).toBe('move');
    const commands = planBootstrapNaval(snapshot, 'p0', options);
    expect(memory.naval!.coastalRetreat![T]).toEqual(goal);
    expect(commands.filter(command => 'unitIds' in command && command.unitIds.includes(T))).toEqual([]);
  });

  it('releases the same pursuit reason after actual native completion', () => {
    const { snapshot, memory, ship, options } = actual(233520);
    const old = memory.naval!.coastalRetreat![T]!;
    memory.naval!.coastalRetreat![T] = { x: old.x, y: old.y, pursuit: true };
    expect(ship.order.type).toBe('idle');
    expect(ship.sailing!.route!.partial).toBe(false);
    expect(ship.sailing!.route!.points).toEqual([]);
    planBootstrapNaval(snapshot, 'p0', options);
    expect(memory.naval!.coastalRetreat?.[T]).toBeUndefined();
  });
});
