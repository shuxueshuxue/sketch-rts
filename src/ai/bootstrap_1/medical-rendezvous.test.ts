import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { followStopDistance } from '../../shared/follow-distance';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot, Unit } from '../../shared/types';
import { planBootstrapNaval } from './expedition-recovery';
import { bootstrapPolicyContext } from './policy';

function actual(tick: number) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/medical-expedition-${tick}.json.gz`, import.meta.url))).toString());
  const snapshot = saved.snapshot as GameSnapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  return { saved, snapshot };
}

function issuedCare() {
  const before = actual(390), after = actual(405);
  const options = bootstrapPolicyContext(before.snapshot, 'us', 'v9_archer', { memory: before.saved.memory, teams: before.snapshot.teams! });
  const commands = planBootstrapNaval(before.snapshot, 'us', options);
  const front = after.snapshot.units.find(unit => unit.id === 'front')!;
  const prior = commands.find(command => command.type === 'move' && command.unitIds.includes(front.id));
  expect(prior).toMatchObject({ type: 'move', unitIds: [front.id], x: 1425.9970394999198, y: 1439.0834060573436, avoidCombat: true });
  expect(front.order).toMatchObject({ type: 'move', x: 1425.9970394999198, y: 1439.0834060573436, avoidCombat: true });
  expect(front.hp).toBe(61);
  expect(front.hp).toBeGreaterThan(front.maxHp * .35);
  const healer = after.snapshot.units.find(unit => unit.id === 'healer')!;
  return { snapshot: after.snapshot, options, front, healer };
}

it('finishes the actual405 medical rendezvous after the correct390 heal crosses the35percent entry', () => {
  const { snapshot, options, front } = issuedCare();
  const commands = planBootstrapNaval(snapshot, 'us', options);
  expect(commands.some(command => ['attack', 'attackMove'].includes(command.type) && 'unitIds' in command && command.unitIds.includes(front.id))).toBe(false);
  expect(commands.some(command => 'unitIds' in command && command.unitIds.includes(front.id))).toBe(false);
  expect(front.order).toEqual({ type: 'move', x: 1425.9970394999198, y: 1439.0834060573436, avoidCombat: true });
  expect(options.memory.naval?.medicalRendezvous?.front?.order).toEqual(front.order);
});

it('does not adopt a nonmedical follow order after the entry condition has cleared', () => {
  const { snapshot, saved } = actual(405), front = snapshot.units.find(unit => unit.id === 'front')!;
  front.order = { type: 'follow', targetId: 'healer' };
  const options = bootstrapPolicyContext(snapshot, 'us', 'v9_archer', { memory: saved.memory, teams: snapshot.teams! });
  const commands = planBootstrapNaval(snapshot, 'us', options);
  expect(commands.some(command => ['attack', 'attackMove'].includes(command.type) && 'unitIds' in command && command.unitIds.includes(front.id))).toBe(true);
  expect(options.memory.naval?.medicalRendezvous?.[front.id]).toBeUndefined();
});

it('releases a medical move on its actual native arrival', () => {
  const { snapshot, options, front } = issuedCare();
  if (front.order.type !== 'move') throw Error('Actual fixture must retain the original medical move');
  front.x = front.order.x; front.y = front.order.y;
  const commands = planBootstrapNaval(snapshot, 'us', options);
  expect(options.memory.naval?.medicalRendezvous?.[front.id]).toBeUndefined();
  expect(commands.some(command => ['attack', 'attackMove'].includes(command.type) && 'unitIds' in command && command.unitIds.includes(front.id))).toBe(true);
});

it('releases the medical follow at the exact native stop distance', () => {
  const { snapshot, options, front, healer } = issuedCare();
  front.order = { type: 'follow', targetId: healer.id };
  // Isolate an already issued native follow stage. It stops at the same
  // helper used by updateFollowOrder; it is not regenerated after healing.
  options.memory.naval!.medicalRendezvous = { front: { healerId: healer.id, order: { ...front.order } } };
  front.x = healer.x + followStopDistance(front, healer); front.y = healer.y;
  planBootstrapNaval(snapshot, 'us', options);
  expect(options.memory.naval?.medicalRendezvous?.[front.id]).toBeUndefined();
});

it.each(['fullHealth', 'patientGone', 'healerGone', 'healerBoards', 'patientBoards', 'notHealable', 'changedOrder', 'queuedOrder'] as const)(
  'releases the actual medical task after %s', change => {
    const { snapshot, options, front, healer } = issuedCare();
    if (change === 'fullHealth') front.hp = front.maxHp;
    if (change === 'patientGone') snapshot.units = snapshot.units.filter(unit => unit !== front);
    if (change === 'healerGone') snapshot.units = snapshot.units.filter(unit => unit !== healer);
    if (change === 'healerBoards') healer.order = { type: 'board', transportId: 'new-ferry' };
    if (change === 'patientBoards') front.order = { type: 'board', transportId: 'new-ferry' };
    if (change === 'notHealable') front.kind = 'golem';
    if (change === 'changedOrder') front.order = { type: 'follow', targetId: 'shooter-2' };
    if (change === 'queuedOrder') front.orderQueue = [{ type: 'move', x: 3000, y: 1600 } as Unit['order']];
    planBootstrapNaval(snapshot, 'us', options);
    expect(options.memory.naval?.medicalRendezvous?.[front.id]).toBeUndefined();
  });
