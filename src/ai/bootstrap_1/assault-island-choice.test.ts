import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { sameGround, setBuildingBodies } from '../../shared/terrain';
import { unitMover } from '../../shared/catalog';
import { assaultExpedition, planNavalTacticsWithAssignments } from '../policy/naval';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';

function saved(name = 'choice-285600') {
  return JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/assault-island-${name}.json.gz`, import.meta.url))).toString());
}
function select(frame: ReturnType<typeof saved>, version: typeof BOOTSTRAP_VERSIONS[number], refresh = true) {
  const snapshot = frame.snapshot as GameSnapshot, memory = frame.memories.p0;
  // Constructed cache-expiry boundary over unchanged actual forces/terrain;
  // this does not claim the world naturally remained still for400 ticks.
  if (refresh && memory.naval.assault) memory.naval.assault.tick = snapshot.tick - 400;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...(snapshot.obstacles ?? [])]);
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory, teams: snapshot.teams! });
  const before = JSON.stringify(snapshot), otherMemories = JSON.stringify([frame.memories.p1, frame.memories.p2]);
  planNavalTacticsWithAssignments(snapshot, 'p0', options, { orderCrew: units => units,
    settlementEscort: 'always',
    mineEligible: () => true, targetAvailable: () => true, transportReady: () => false, troopAvailable: () => false });
  expect(JSON.stringify(snapshot)).toBe(before);
  expect(JSON.stringify([frame.memories.p1, frame.memories.p2])).toBe(otherMemories);
  const targetId = memory.naval.assault?.plan?.targetId;
  return { target: snapshot.buildings.find(building => building.id === targetId), memory, options };
}

it.each(BOOTSTRAP_VERSIONS)('%s preserves the real unexpired285600 target until its normal retry', version => {
  const frame = saved(), prior = structuredClone(frame.memories.p0.naval.assault);
  select(frame, version, false);
  expect(frame.memories.p0.naval.assault).toEqual(prior);
});
it.each(BOOTSTRAP_VERSIONS)('%s considers the ready farther island when the actual285600 objective refreshes', version => {
  const frame = saved(), snapshot = frame.snapshot as GameSnapshot;
  const options = bootstrapPolicyContext(snapshot, 'p0', version, { memory: frame.memories.p0, teams: snapshot.teams! });
  const oldTarget = snapshot.buildings.find(building => building.id === frame.memories.p0.naval.assault.plan.targetId)!;
  const hall = snapshot.buildings.find(building => building.id === 'building-p1-townhall')!;
  setBuildingBodies(snapshot.map, snapshot.buildings);
  expect(assaultExpedition(snapshot, 'p0', options, oldTarget).ready).toBe(false);
  expect(assaultExpedition(snapshot, 'p0', options, hall).ready).toBe(true);
  expect(select(frame, version).target?.owner).toBe('p1');
});
it.each(BOOTSTRAP_VERSIONS)('%s can choose a ready island with no previously cached objective', version => {
  const frame = saved(); delete frame.memories.p0.naval.assault;
  expect(select(frame, version).target?.owner).toBe('p1');
});
it.each(BOOTSTRAP_VERSIONS)('%s keeps its actual250185 loaded invasion on its committed island', version => {
  const frame = saved('committed-250185'), oldId = frame.memories.p0.naval.ferries['unit-p0-carrier-25442'].targetId;
  expect(frame.snapshot.units.some((unit: any) => unit.owner === 'p0' && unit.deck?.shipId === 'unit-p0-carrier-25442'
    && unit.kind !== 'worker' && unit.expiresTick === undefined)).toBe(true);
  const target = select(frame, version).target!, oldTarget = frame.snapshot.buildings.find((building: any) => building.id === oldId);
  expect(sameGround(frame.snapshot.map, target, oldTarget)).toBe(true);
});
it.each(BOOTSTRAP_VERSIONS)('%s keeps its actual258600 boarding rendezvous on the committed island', version => {
  const frame = saved('boarding-258600'), oldId = frame.memories.p0.naval.ferries['unit-p0-carrier-25442'].targetId;
  expect(frame.snapshot.units.some((unit: any) => unit.owner === 'p0' && unit.kind !== 'worker' && unit.expiresTick === undefined
    && unit.order.type === 'board' && unit.order.transportId === 'unit-p0-carrier-25442')).toBe(true);
  const target = select(frame, version).target!, oldTarget = frame.snapshot.buildings.find((building: any) => building.id === oldId);
  expect(sameGround(frame.snapshot.map, target, oldTarget)).toBe(true);
});
it.each(BOOTSTRAP_VERSIONS)('%s retains its nearest ordinary objective when no island meets the force estimate', version => {
  const frame = saved();
  // Constructed no-army boundary, not a modified-opponent match.
  frame.snapshot.units = frame.snapshot.units.filter((unit: any) => unit.owner !== 'p0' || unit.kind === 'worker' || unitMover(unit.kind) !== 'land');
  expect(select(frame, version).target?.id).toBe('building-p2-farm-1409');
});
it.each(BOOTSTRAP_VERSIONS)('%s clears an ended enemy objective without inventing a replacement island', version => {
  const frame = saved(); frame.snapshot.buildings = frame.snapshot.buildings.filter((building: any) => building.owner === 'p0');
  expect(select(frame, version).target).toBeUndefined();
  expect(frame.memories.p0.naval.assault.plan).toBeUndefined();
});
