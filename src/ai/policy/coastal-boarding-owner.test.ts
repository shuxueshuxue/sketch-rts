import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { AiPolicyMemory } from '../memory';
import type { BootstrapAiVersion, GameSnapshot } from '../../shared/types';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { beginShipCollisionFrame } from '../../shared/ship-collisions';
import { setBuildingBodies } from '../../shared/terrain';
import { bootstrapPolicyContext } from '../bootstrap_1/policy';
import { planBootstrapNaval } from '../bootstrap_1/expedition-recovery';
import { coastalWithdrawalPrefixSafe } from './coastal-risk';
import { coastalFireDisks, coastalFireSegmentClear, coastalLegArrivalSafe } from './coastal-voyage';

const id = 'unit-p0-bombardShip-50739', crewId = 'unit-p0-emberRavager-23742';
function actual(file: string, version: BootstrapAiVersion = 'v9_summoner') {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/' + file, import.meta.url))).toString()) as {
    snapshot: GameSnapshot; memories: Record<string, AiPolicyMemory>;
  };
  const snapshot = saved.snapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  beginShipCollisionFrame(snapshot.units, snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory: structuredClone(saved.memories.p0!) });
  return { snapshot, ship: snapshot.units.find(unit => unit.id === id)!, options };
}

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s uses the same naval owner to leave accessible hostile deck intentions early', version => {
  // Exact d352 normal232740 input, used here as a component input on the new
  // 945f-derived source. This is not a replay or a completed match result.
  const { snapshot, ship, options } = actual('coastal-mortar-boarding-232740.json.gz', version);
  const before = JSON.stringify(snapshot), commands = planBootstrapNaval(snapshot, 'p0', options);
  const move = commands.find(command => command.type === 'move' && command.unitIds.includes(id));
  expect(move?.type).toBe('move');
  if (move?.type !== 'move') throw Error('missing ordinary boarding withdrawal');
  expect(move).toEqual({ type: 'move', unitIds: [id], x: move.x, y: move.y, avoidCombat: true });
  expect(Math.hypot(move.x - ship.x, move.y - ship.y)).toBeGreaterThan(200);
  expect(commands).toContainEqual({ type: 'holdPosition', unitIds: [crewId] });
  expect(options.memory.naval!.coastalRetreat![id]).toEqual({ x: move.x, y: move.y, boarding: true });
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('keeps a real safe final approach inside70px until the native coordinate move finishes', () => {
  // Actual normal d352229410 ordinary leg, used here with this contract's
  // new saved retreat reason. No claim that the old match had that reason.
  const { snapshot, ship, options } = actual('coastal-native-approach-229410.json.gz');
  if (ship.order.type !== 'move') throw Error('actual ordinary move missing');
  const mark = { x: ship.order.x, y: ship.order.y, boarding: true as const };
  const remaining = Math.hypot(ship.x - mark.x, ship.y - mark.y);
  expect(remaining).toBeGreaterThan(MOVE_ORDER_ARRIVAL_RANGE); expect(remaining).toBeLessThan(70);
  expect(coastalWithdrawalPrefixSafe(snapshot,ship,ship.sailing!.route,options)).toBe(true);
  expect(coastalLegArrivalSafe(snapshot,ship,mark,options)).toBe(true);
  (options.memory.naval!.coastalRetreat ??= {})[id] = structuredClone(mark);
  const before = JSON.stringify(snapshot), commands = planBootstrapNaval(snapshot, 'p0', options);
  expect(commands.filter(command => 'unitIds' in command && command.unitIds.includes(id))).toEqual([]);
  expect(options.memory.naval!.coastalRetreat![id]).toEqual(mark);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('reselects the clinical final mark when moving archers now cover it, even while its departure remains outward', () => {
  // Actual historical twoactor clinical233130 rawframe; a safe outward
  // prefix alone does not authorize keeping a newly covered destination.
  const { snapshot, ship, options } = actual('coastal-clinical-withdrawal-233130.json.gz');
  if (ship.order.type !== 'move') throw Error('actual clinical move missing');
  const old = { x: ship.order.x, y: ship.order.y, boarding: true as const };
  (options.memory.naval!.coastalRetreat ??= {})[id] = structuredClone(old);
  expect(coastalWithdrawalPrefixSafe(snapshot,ship,ship.sailing!.route,options)).toBe(true);
  expect(coastalFireSegmentClear({...old,heading:0},{...old,heading:0},coastalFireDisks(snapshot,ship,options,0))).toBe(false);
  expect(coastalLegArrivalSafe(snapshot,ship,old,options)).toBe(false);
  const commands = planBootstrapNaval(snapshot,'p0',options), next = options.memory.naval!.coastalRetreat![id]!;
  expect(next.boarding).toBe(true); expect(next).not.toEqual(old);
  expect(coastalLegArrivalSafe(snapshot,ship,next,options)).toBe(true);
  expect(commands).toContainEqual({type:'move',unitIds:[id],x:next.x,y:next.y,avoidCombat:true});
});
