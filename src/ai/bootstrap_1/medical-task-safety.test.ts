import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import { pointSegmentDistanceSquared } from '../../shared/navigation-math';
import { groundSteeringRoute, routeClearsDisks } from '../../shared/route-selection';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { armedFoes } from './safe-land-route';
import { mountedThreatReach } from './mounted-micro';
import type { GameSnapshot, Unit } from '../../shared/types';
import { planAiOwnerCommandEntries } from '../planner-context';
import { medicalRecoveryUnitIds, planMedicalRecovery, recoveryPatients } from './medical-recovery';

function actual(tick: number) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/medical-retreat-${tick}.json.gz`, import.meta.url))).toString());
  const snapshot = saved.snapshot as GameSnapshot;
  setBuildingBodies(snapshot.map, snapshot.buildings);
  return { saved, snapshot, healers: snapshot.units.filter(unit => unit.owner === 'p0' && ['priest', 'fieldMedic'].includes(unit.kind)) };
}

it.each([30346, 30600].flatMap(tick => (['v9_archer', 'v9_summoner', 'v9_knight'] as const).map(version => ({ tick, version }))))(
  '$version releases unsafe medical jobs in the actual $tick retreat state', ({ tick, version }) => {
  const { saved, snapshot, healers } = actual(tick);
  // Original critical gate and patients stay intact; this is task admission, not a new retreat policy.
  const patients = recoveryPatients(snapshot, 'p0');
  expect(patients.length).toBeGreaterThan(0);
  expect(patients.every(patient => patient.hp < patient.maxHp * .35)).toBe(true);
  expect(planMedicalRecovery(snapshot, 'p0', patients)).toEqual([]);
  expect([...medicalRecoveryUnitIds(snapshot, 'p0')]).toEqual([]);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory: saved.memories.p0 }, { teams: snapshot.teams! });
  for (const healer of healers) {
    const own = entries.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(healer.id));
    expect(own, healer.id).toHaveLength(1);
    expect(own[0]!.scriptId).toBe('v6Backline');
    expect(['move', 'holdPosition']).toContain(own[0]!.command.type);
    // An explicit current backline order replaces the legacy heal cast/hold.
    // One blocked30346 priest safely waits rather than claiming a fake escape.
    // Safe original screen moves keep their ordinary command semantics.
  }
});

it('does not send either actual 30600 medic down the 1499 tower road to its patient', () => {
  const { snapshot, healers } = actual(30600), tower = snapshot.buildings.find(b => b.id === 'building-p1-defenseTower-1499')!;
  const patient = recoveryPatients(snapshot, 'p0')[0]!;
  for (const medic of healers.filter(unit => unit.kind === 'fieldMedic')) {
    const road = groundSteeringRoute(snapshot.map, medic, patient);
    expect(routeClearsDisks(road, [{ ...tower, radius: tower.attackRange }])).toBe(false);
  }
  expect(planMedicalRecovery(snapshot, 'p0', [patient])).toEqual([]);
});

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s does not deepen attack coverage on the actual30600 replacement road', version => {
  const { saved, snapshot, healers } = actual(30600);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory: saved.memories.p0 }, { teams: snapshot.teams! });
  const foes = armedFoes(snapshot, 'p0', { teams: snapshot.teams! });
  for (const healer of healers) {
    const command = entries.find(entry => entry.scriptId === 'v6Backline' && 'unitIds' in entry.command && entry.command.unitIds.includes(healer.id))?.command;
    expect(command?.type).toBe('move');
    if (!command || command.type !== 'move') continue;
    const road = groundSteeringRoute(snapshot.map, healer, command);
    const disks = foes.map(foe => ({ ...foe, radius: mountedThreatReach(snapshot, foe, healer, 15 + healer.cooldown)
      + ('speed' in foe ? foe.speed * 15 / SIM_TICKS_PER_SECOND : 0) }));
    const margin = Math.min(...disks.map(disk => Math.hypot(healer.x - disk.x, healer.y - disk.y) - disk.radius));
    for (let index = 1; index < road.length; index++) for (const disk of disks) {
      const roadMargin = Math.sqrt(pointSegmentDistanceSquared(disk, road[index - 1]!, road[index]!)) - disk.radius;
      expect(roadMargin, JSON.stringify({ id: healer.id, command, threat: disk.id, margin })).toBeGreaterThanOrEqual(Math.min(0, margin) - 1e-9);
    }
    expect(road[road.length - 1]).not.toEqual(healer);
  }
});

function standoff(cooldown = 0, withinRange = false) {
  const { snapshot, healers } = actual(30600);
  const healer: Unit = { ...healers[0]!, x: 1500, y: 1000, abilityCooldowns: { heal: cooldown }, order: { type: 'idle' as const } };
  const patient = { ...recoveryPatients(snapshot, 'p0')[0]!, x: withinRange ? 1600 : 1900, y: 1000, hp: 20 };
  const tower = { ...snapshot.buildings.find(building => building.id === 'building-p1-defenseTower-1499')!, x: 2300, y: 1000 };
  snapshot.units = [healer, patient]; snapshot.buildings = [tower]; snapshot.effects = [];
  snapshot.map = { ...snapshot.map, terrain: { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) } };
  setBuildingBodies(snapshot.map, snapshot.buildings);
  return { snapshot, healer, patient };
}

it('keeps a ready walk-to-heal whose actual spell-range entry is safe despite the covered patient center', () => {
  const { snapshot, healer, patient } = standoff();
  const tower = snapshot.buildings[0]!;
  expect(Math.hypot(patient.x - tower.x, patient.y - tower.y)).toBeLessThan(tower.attackRange);
  expect(planMedicalRecovery(snapshot, 'p0', [patient])).toEqual([
    { type: 'cast', unitId: healer.id, ability: 'heal', targetId: patient.id },
  ]);
  expect(medicalRecoveryUnitIds(snapshot, 'p0').has(healer.id)).toBe(true);
});

it('does not turn the same covered patient center into a cooldown movement task', () => {
  const { snapshot, patient } = standoff(30);
  expect(planMedicalRecovery(snapshot, 'p0', [patient])).toEqual([]);
  expect([...medicalRecoveryUnitIds(snapshot, 'p0')]).toEqual([]);
});

it('leaves backline ownership available while an in-range healer has no ready spell', () => {
  const { snapshot, patient } = standoff(30, true);
  expect(planMedicalRecovery(snapshot, 'p0', [patient])).toEqual([]);
  expect([...medicalRecoveryUnitIds(snapshot, 'p0')]).toEqual([]);
});

it('keeps an immediate heal while handing unsafe old movement back to the backline', () => {
  const { snapshot, healer, patient } = standoff(0, true);
  healer.order = { type: 'move', x: 2300, y: 1000 } as Unit['order'];
  expect(planMedicalRecovery(snapshot, 'p0', [patient])).toEqual([{ type: 'cast', unitId: healer.id, ability: 'heal', targetId: patient.id }]);
  expect(medicalRecoveryUnitIds(snapshot, 'p0').has(healer.id)).toBe(false);
});

it('does not claim a stunned healer as an executable medical task', () => {
  const { snapshot, healer, patient } = standoff(0, true);
  healer.effects = [{ type: 'stun', remaining: 30 }];
  expect(planMedicalRecovery(snapshot, 'p0', [patient])).toEqual([]);
});

it('does not spend projected healing on stunned healers before allocating the remaining safe healer', () => {
  const { snapshot, healer, patient } = standoff(0, true);
  const unsafe: Unit[] = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(healer), id: `unsafe-${index}`,
    order: { type: 'move', x: 2300, y: 1000 }, effects: [{ type: 'stun', remaining: 30 }] }));
  const safe: Unit = { ...structuredClone(healer), id: 'safe-healer' };
  snapshot.units = [...unsafe, safe, patient];
  expect(planMedicalRecovery(snapshot, 'p0', [patient])).toEqual([
    { type: 'cast', unitId: safe.id, ability: 'heal', targetId: patient.id },
  ]);
  // The one accepted spell consumes projected healing, while stunned casters
  // cannot. An instantaneous spell leaves physical control with the backline.
  expect([...medicalRecoveryUnitIds(snapshot, 'p0')]).toEqual([]);
});


it('preserves an instantaneous critical heal in the native240 range beyond the abilities220 planner range', () => {
  const { snapshot, healer, patient } = standoff(0, true);
  patient.x = healer.x + 230;
  snapshot.buildings[0]!.x = 1850;
  setBuildingBodies(snapshot.map, snapshot.buildings);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory: actual(30600).saved.memories.p0, policyMode: 'combat' }, { teams: snapshot.teams! });
  const casts = entries.filter(entry => entry.command.type === 'cast' && entry.command.unitId === healer.id);
  expect(casts.map(entry => entry.command)).toEqual([{ type: 'cast', unitId: healer.id, ability: 'heal', targetId: patient.id }]);
  expect(medicalRecoveryUnitIds(snapshot, 'p0').has(healer.id)).toBe(false);
  const movement = entries.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(healer.id));
  expect(movement).toHaveLength(1);
  expect(movement[0]!.scriptId).toBe('v6Backline');
  expect(['move', 'holdPosition']).toContain(movement[0]!.command.type);
});

it.each([30660, 30705])('preserves the original critical immediate heal while releasing movement in the actual %i opportunity', tick => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/medical-ready-heal-${tick}.json.gz`, import.meta.url))).toString());
  const snapshot = saved.snapshot as GameSnapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const healerId = tick === 30660 ? 'unit-p0-fieldMedic-1602' : 'unit-p0-fieldMedic-1418';
  const patientId = tick === 30660 ? 'unit-p0-priest-15352' : 'unit-p0-fieldMedic-1602';
  expect(planMedicalRecovery(snapshot, 'p0', recoveryPatients(snapshot, 'p0')).filter(command => command.type === 'cast' && command.unitId === healerId)).toEqual([
    { type: 'cast', unitId: healerId, ability: 'heal', targetId: patientId },
  ]);
  expect(medicalRecoveryUnitIds(snapshot, 'p0').has(healerId)).toBe(false);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version: 'v9_archer', memory: saved.memories.p0 }, { teams: snapshot.teams! });
  const casts = entries.filter(entry => entry.command.type === 'cast' && entry.command.unitId === healerId);
  expect(casts.map(entry => entry.command)).toEqual([{ type: 'cast', unitId: healerId, ability: 'heal', targetId: patientId }]);
  expect(entries.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(healerId)).map(entry => entry.scriptId)).toEqual(['v6Backline']);
});

it('keeps the native-range instantaneous cast without claiming its unchanged legacy order', () => {
  const { snapshot, healer, patient } = standoff(0, true);
  patient.x = healer.x + 230;
  snapshot.buildings[0]!.x = 2000;
  healer.order = { type: 'cast', ability: 'heal', targetId: patient.id };
  setBuildingBodies(snapshot.map, snapshot.buildings);
  // Caster500 from tower, outside its480+16 coverage; patient center is
  // covered, but the native in-range cast never walks to that center.
  expect(planMedicalRecovery(snapshot, 'p0', [patient])).toEqual([
    { type: 'cast', unitId: healer.id, ability: 'heal', targetId: patient.id },
  ]);
  expect(medicalRecoveryUnitIds(snapshot, 'p0').has(healer.id)).toBe(false);
});

it.each((['attack', 'attackMove', 'follow'] as const).flatMap(order =>
  (['v9_archer', 'v9_summoner', 'v9_knight'] as const).map(version => ({ order, version }))))(
  '$version preserves the instant heal and replaces retained $order pursuit toward fire', ({ order, version }) => {
    const { snapshot, healer, patient } = standoff(0, true);
    const tower = snapshot.buildings[0]!;
    const followerTarget: Unit = { ...structuredClone(patient), id: 'healthy-followed-ally', x: 2100, y: 1000, hp: patient.maxHp };
    snapshot.units.push(followerTarget);
    healer.order = order === 'follow' ? { type: 'follow', targetId: followerTarget.id }
      : order === 'attack' ? { type: 'attack', targetId: tower.id }
      : { type: 'attackMove', x: tower.x, y: tower.y, targetId: tower.id };
    // Native immediate healing leaves all three old orders intact. The safe
    // caster must retain its spell while its existing backline owns movement.
    expect(planMedicalRecovery(snapshot, 'p0', [patient])).toEqual([
      { type: 'cast', unitId: healer.id, ability: 'heal', targetId: patient.id },
    ]);
    expect(medicalRecoveryUnitIds(snapshot, 'p0').has(healer.id)).toBe(false);
    const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version,
      memory: actual(30600).saved.memories.p0, policyMode: 'combat' }, { teams: snapshot.teams! });
    const casts = entries.filter(entry => entry.command.type === 'cast' && entry.command.unitId === healer.id);
    expect(casts.map(entry => entry.command)).toEqual([{ type: 'cast', unitId: healer.id, ability: 'heal', targetId: patient.id }]);
    const physical = entries.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(healer.id));
    expect(physical).toHaveLength(1);
    expect(physical[0]!.scriptId).toBe('v6Backline');
    expect(['move', 'holdPosition']).toContain(physical[0]!.command.type);
  });
