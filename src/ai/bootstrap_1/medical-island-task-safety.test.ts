import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { sameGround, setBuildingBodies } from '../../shared/terrain';
import { groundSteeringRoute } from '../../shared/route-selection';
import { pointSegmentDistanceSquared } from '../../shared/navigation-math';
import type { GameSnapshot } from '../../shared/types';
import { planAiOwnerCommandEntries } from '../planner-context';
import { armedFoes } from './safe-land-route';
import { mountedThreatReach } from './mounted-micro';

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)('%s returns rejected island healing to its existing naval backline owner', version => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-landed-before-think-100650.json.gz', import.meta.url))).toString());
  const snapshot = saved.snapshot as GameSnapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const healer = snapshot.units.find(unit => unit.id === 'unit-p0-priest-7778')!;
  const patient = snapshot.units.find(unit => unit.id === 'unit-p0-archer-2411')!;
  const home = snapshot.buildings.find(building => building.id === 'building-p0-townhall')!;
  expect(sameGround(snapshot.map, healer, home)).toBe(false);
  expect(sameGround(snapshot.map, healer, patient)).toBe(true);
  // Explicit counterfactual task on a complete historical island battle:
  // retain the actual positions, ordinary enemies and cooldown104, but make
  // this nearby soldier critical and leave a stale heal cast on his medic.
  patient.hp = 20;
  healer.order = { type: 'cast', ability: 'heal', targetId: patient.id };
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory: saved.memories.p0 }, { teams: snapshot.teams! });
  const movement = entries.filter(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(healer.id));
  expect(movement).toHaveLength(1);
  expect(movement[0]!.scriptId).toBe('naval');
  const command = movement[0]!.command;
  expect(command.type).toBe('move');
  if (command.type !== 'move') return;
  expect(command.queued).not.toBe(true);
  expect(sameGround(snapshot.map, healer, command)).toBe(true);
  expect(entries.some(entry => entry.command.type === 'board' && entry.command.unitIds.includes(healer.id))).toBe(false);
  expect(entries.some(entry => entry.scriptId === 'medicalRecovery' && ('unitId' in entry.command && entry.command.unitId === healer.id))).toBe(false);
  const road = groundSteeringRoute(snapshot.map, healer, command);
  const disks = armedFoes(snapshot, 'p0', { teams: snapshot.teams! }).map(foe => ({ ...foe,
    radius: mountedThreatReach(snapshot, foe, healer, 15 + healer.cooldown) + ('speed' in foe ? foe.speed * 15 / 20 : 0) }));
  const start = Math.min(...disks.map(disk => Math.hypot(healer.x - disk.x, healer.y - disk.y) - disk.radius));
  for (let index = 1; index < road.length; index++) for (const disk of disks) {
    expect(Math.sqrt(pointSegmentDistanceSquared(disk, road[index - 1]!, road[index]!)) - disk.radius,
      JSON.stringify({ version, command, threat: disk.id, start })).toBeGreaterThanOrEqual(Math.min(0, start) - 1e-9);
  }
});
