import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { bootstrapPolicyContext } from './policy';
import { planNavalTacticsWithAssignments } from '../policy/naval';
import * as bombardment from '../policy/coastal-bombardment';
import { combatCapability } from '../../shared/combat-capabilities';
import { installedWeapons } from '../../shared/ship-equipment';
import { UNIT_DEFS } from '../../shared/catalog';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';

function actual() {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/coastal-installed-prefix-226650.json.gz', import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>;
  };
  const s = saved.snapshot;
  setBuildingBodies(s.map, [...s.buildings, ...s.obstacles ?? []]);
  const options = bootstrapPolicyContext(s, 'p0', 'v9_summoner', { memory: structuredClone(saved.memories.p0!), teams: s.teams! });
  return { saved, s, options };
}
const assignments: Parameters<typeof planNavalTacticsWithAssignments>[3] = { orderCrew: commands => commands,
  mineEligible: () => true, targetAvailable: () => true, transportReady: () => false, troopAvailable: () => false };
afterEach(() => vi.restoreAllMocks());

it('admits the actual intrinsic cutter to target evaluation without claiming it can reach or kill the recorded guards', () => {
  const { saved, s, options } = actual(), before = JSON.stringify(saved), cutter = s.units.find(u => u.id === 'unit-p0-cutter-140825')!;
  expect(UNIT_DEFS[cutter.kind].intrinsicAttack).toBe(true);
  expect(installedWeapons(s, cutter)).toEqual([]);
  expect(combatCapability(s, cutter)).toEqual({ armed: true, range: 264, dps: 10 * 20 / 26 });
  const selector = vi.spyOn(bombardment, 'coastalBombardment').mockReturnValue(undefined);
  planNavalTacticsWithAssignments(s, 'p0', options, assignments);
  expect(selector.mock.calls.some(args => args[1].id === cutter.id)).toBe(true);
  expect(JSON.stringify(saved)).toBe(before);
});

it('keeps a hull with only destroyed mounted weapons and an actual loaded ferry out of new battery selection', () => {
  const { s, options } = actual(), battery = s.units.find(u => u.id === 'unit-p0-bombardShip-50739')!;
  for (const item of installedWeapons(s, battery)) item.durability = 0;
  expect(combatCapability(s, battery).armed).toBe(false);
  const selector = vi.spyOn(bombardment, 'coastalBombardment').mockReturnValue(undefined);
  planNavalTacticsWithAssignments(s, 'p0', options, assignments);
  expect(selector.mock.calls.some(args => args[1].id === battery.id || args[1].id === 'unit-p0-carrier-25442')).toBe(false);
});

it('preserves a real boarding service owner before considering intrinsic coastal capability', () => {
  const { s, options } = actual(), cutter = s.units.find(u => u.id === 'unit-p0-cutter-140825')!, crew = s.units.find(u => u.owner === 'p0' && !u.deck && u.kind !== 'worker' && !u.sailing)!;
  // Counterfactual native board order only; the service contract, not a
  // hypothetical rescue result, is under test.
  crew.order = { type: 'board', transportId: cutter.id };
  const selector = vi.spyOn(bombardment, 'coastalBombardment').mockReturnValue(undefined);
  planNavalTacticsWithAssignments(s, 'p0', options, assignments);
  expect(selector.mock.calls.some(args => args[1].id === cutter.id)).toBe(false);
});
