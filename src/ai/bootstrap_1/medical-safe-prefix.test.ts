import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { ABILITY_DEFS } from '../../shared/catalog';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { setBuildingBodies, steerPoint } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import { armedFoes } from './safe-land-route';
import { medicalApproachRoad, medicalRoadIsSafe } from './medical-task-safety';
import { planMedicalRecoveryTasks, recoveryPatients } from './medical-recovery';
import { mountedThreatReach, THINK_TICKS } from './mounted-micro';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';

function actual(tick: number) {
  const full = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/medical-safe-prefix-${tick}.json.gz`, import.meta.url))).toString());
  const snapshot = full.snapshot as GameSnapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  return { full, snapshot, options: { teams: snapshot.teams! } };
}

it.each(['unit-p0-fieldMedic-1418', 'unit-p0-fieldMedic-1602'])(
  'admits the safe first native approach for actual8400 %s without ordering the unsafe remainder', id => {
    const { full, snapshot, options } = actual(8400), before = structuredClone(full);
    const healer = snapshot.units.find(unit => unit.id === id)!;
    const patient = snapshot.units.find(unit => unit.id === 'unit-p0-footman-1070')!;
    const foes = armedFoes(snapshot, 'p0', options), range = ABILITY_DEFS.heal.range;
    expect(recoveryPatients(snapshot, 'p0').map(unit => unit.id)).toEqual([patient.id]);
    expect(medicalRoadIsSafe(snapshot, healer, patient, range, foes)).toBe(false);
    const first = steerPoint(snapshot.map, healer, patient);
    expect(Math.hypot(first.x - healer.x, first.y - healer.y)).toBeGreaterThan(MOVE_ORDER_ARRIVAL_RANGE);
    expect(medicalRoadIsSafe(snapshot, healer, first, 0, foes)).toBe(true);
    const tasks = planMedicalRecoveryTasks(snapshot, 'p0', [patient], options);
    const commands = tasks.commands.filter(command => 'unitIds' in command && command.unitIds.includes(id));
    expect(commands).toEqual([{ type: 'move', unitIds: [id], x: first.x, y: first.y }]);
    expect(tasks.occupied.has(id)).toBe(true);
    expect(tasks.released.has(id)).toBe(false);
    expect(tasks.casting.has(id)).toBe(false);
    expect(tasks.commands.some(command => command.type === 'cast' && command.unitId === id)).toBe(false);
    expect(full).toEqual(before);
  });

it('preserves actual8460 ready walk-to-heal and its original patient when the complete approach is safe', () => {
  const { snapshot, options } = actual(8460), patient = snapshot.units.find(unit => unit.id === 'unit-p0-lancer-1527')!;
  const tasks = planMedicalRecoveryTasks(snapshot, 'p0', recoveryPatients(snapshot, 'p0'), options);
  for (const id of ['unit-p0-fieldMedic-1418', 'unit-p0-fieldMedic-1602']) {
    expect(tasks.commands.filter(command => 'unitId' in command && command.unitId === id)).toEqual([
      { type: 'cast', unitId: id, ability: 'heal', targetId: patient.id },
    ]);
    expect(tasks.occupied.has(id)).toBe(true);
  }
});

it('keeps the original strict35 entry when a safe approach exists', () => {
  const { snapshot, options } = actual(8400), patient = snapshot.units.find(unit => unit.id === 'unit-p0-footman-1070')!;
  patient.hp = patient.maxHp * .35;
  expect(recoveryPatients(snapshot, 'p0')).toEqual([]);
  const tasks = planMedicalRecoveryTasks(snapshot, 'p0', recoveryPatients(snapshot, 'p0'), options);
  expect(tasks.commands).toEqual([]);
  expect([...tasks.occupied]).toEqual([]);
});

it('releases medical ownership when even the first native approach crosses known coverage', () => {
  const { snapshot, options } = actual(8400), healer = snapshot.units.find(unit => unit.id === 'unit-p0-fieldMedic-1418')!;
  const patient = snapshot.units.find(unit => unit.id === 'unit-p0-footman-1070')!;
  const mage = snapshot.units.find(unit => unit.id === 'creep-gen-5-2')!;
  const first = steerPoint(snapshot.map, healer, patient), gap = Math.hypot(first.x - healer.x, first.y - healer.y);
  const reach = mountedThreatReach(snapshot, mage, healer, THINK_TICKS) + mage.speed * THINK_TICKS / SIM_TICKS_PER_SECOND;
  // Keep the healer outside coverage while the first waypoint lies inside it.
  mage.x = first.x + (first.x - healer.x) * (reach - MOVE_ORDER_ARRIVAL_RANGE) / gap;
  mage.y = first.y + (first.y - healer.y) * (reach - MOVE_ORDER_ARRIVAL_RANGE) / gap;
  snapshot.units = [healer, patient, mage];
  expect(Math.hypot(healer.x - mage.x, healer.y - mage.y)).toBeGreaterThan(reach);
  const foes = armedFoes(snapshot, 'p0', options);
  expect(medicalRoadIsSafe(snapshot, healer, first, 0, foes)).toBe(false);
  const tasks = planMedicalRecoveryTasks(snapshot, 'p0', [patient], options);
  expect(tasks.commands).toEqual([]);
  expect([...tasks.occupied]).toEqual([]);
  expect(tasks.released.has(healer.id)).toBe(true);
});


it('does not replace the actual30346 retreat with a safe prefix toward a fixed tower blockade', () => {
  const full = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/medical-retreat-30346.json.gz', import.meta.url))).toString());
  const snapshot = full.snapshot as GameSnapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const healer = snapshot.units.find(unit => unit.id === 'unit-p0-fieldMedic-1418')!;
  const patient = snapshot.units.find(unit => unit.id === 'unit-p0-archer-37530')!;
  const foes = armedFoes(snapshot, 'p0', { teams: snapshot.teams! });
  const first = steerPoint(snapshot.map, healer, patient);
  expect(medicalRoadIsSafe(snapshot, healer, first, 0, foes)).toBe(true);
  expect(medicalRoadIsSafe(snapshot, healer, patient, ABILITY_DEFS.heal.range, snapshot.buildings.filter(building => foes.includes(building)))).toBe(false);
  const tasks = planMedicalRecoveryTasks(snapshot, 'p0', recoveryPatients(snapshot, 'p0'), { teams: snapshot.teams! });
  expect(tasks.commands).toEqual([]);
  expect(tasks.occupied.has(healer.id)).toBe(false);
  expect(tasks.released.has(healer.id)).toBe(true);
});

it('does not approach an active ground-damage barrier merely because the first waypoint is safe', () => {
  const { snapshot, options } = actual(8400), healer = snapshot.units.find(unit => unit.id === 'unit-p0-fieldMedic-1418')!;
  const patient = snapshot.units.find(unit => unit.id === 'unit-p0-footman-1070')!;
  const road = medicalApproachRoad(snapshot, healer, patient, ABILITY_DEFS.heal.range)!;
  const entry = road[road.length - 1]!;
  snapshot.effects.push({ id: 'known-remote-fire', type: 'burningGround', x: entry.x, y: entry.y,
    radius: 64, remaining: 200, duration: 200, owner: 'p1' });
  const first = steerPoint(snapshot.map, healer, patient), foes = armedFoes(snapshot, 'p0', options);
  expect(medicalRoadIsSafe(snapshot, healer, first, 0, foes)).toBe(true);
  expect(medicalRoadIsSafe(snapshot, healer, patient, ABILITY_DEFS.heal.range, [])).toBe(false);
  const tasks = planMedicalRecoveryTasks(snapshot, 'p0', [patient], options);
  expect(tasks.commands.filter(command => 'unitIds' in command && command.unitIds.includes(healer.id))).toEqual([]);
  expect(tasks.occupied.has(healer.id)).toBe(false);
  expect(tasks.released.has(healer.id)).toBe(true);
});
