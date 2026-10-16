import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { capsuleClearsBodies } from '../../shared/navigation-math';
import { groundSteeringRoute } from '../../shared/route-selection';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { sameGround } from '../../shared/terrain';
import { distance } from '../policy/spatial';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { planBootstrapNaval } from './expedition-recovery';
import { mountedThreatReach } from './mounted-micro';

function saved(tick: number) {
  return JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/landed-contact-${tick}.json.gz`, import.meta.url))).toString());
}

it.each(BOOTSTRAP_VERSIONS)('%s preserves the actual ready volley behind its front outside native melee coverage', version => {
  const frame = saved(135), snapshot = frame.snapshot, before = JSON.stringify(snapshot);
  const shooter = snapshot.units.find((unit: { id: string }) => unit.id === 'shooter-3')!;
  const brute = snapshot.units.find((unit: { id: string }) => unit.id === 'brute')!;
  const front = snapshot.units.find((unit: { id: string }) => unit.id === 'front')!;
  expect(shooter.cooldown).toBe(0);
  expect(front.hp).toBe(99);
  expect(brute.order.targetId).toBe(front.id);
  expect(distance(shooter, brute)).toBeGreaterThan(mountedThreatReach(snapshot, brute, shooter, 15));
  const options = bootstrapPolicyContext(snapshot, 'us', version, { memory: frame.memory });
  const commands = planBootstrapNaval(snapshot, 'us', options);
  for (const id of ['shooter-0', 'shooter-1', 'shooter-2', 'shooter-3']) {
    const physical = commands.filter(command => 'unitIds' in command && command.unitIds.includes(id));
    expect(physical).toHaveLength(1);
    expect(physical[0]).toMatchObject({ type: 'attackMove', x: brute.x, y: brute.y });
  }
  expect(JSON.stringify(snapshot)).toBe(before);
});

it.each(BOOTSTRAP_VERSIONS)('%s keeps the exposed ready-soon archer moving before the next melee contact', version => {
  const frame = saved(360), snapshot = frame.snapshot, before = JSON.stringify(snapshot);
  const shooter = snapshot.units.find((unit: { id: string }) => unit.id === 'shooter-2')!;
  const brute = snapshot.units.find((unit: { id: string }) => unit.id === 'brute')!;
  expect(shooter.cooldown).toBe(8);
  expect(shooter.aim).toBeUndefined();
  expect(brute.speed).toBeGreaterThan(shooter.speed);
  expect(distance(shooter, brute)).toBeLessThan(mountedThreatReach(snapshot, brute, shooter, 15));
  const options = bootstrapPolicyContext(snapshot, 'us', version, { memory: frame.memory });
  const commands = planBootstrapNaval(snapshot, 'us', options);
  const orders = commands.filter(command => 'unitIds' in command && command.unitIds.includes(shooter.id));
  expect(orders).toHaveLength(1);
  expect(orders[0]?.type).toBe('move');
  if (orders[0]?.type !== 'move') throw Error('The exposed shooter must not wait for the next think in an attack order');
  const move = orders[0], road = groundSteeringRoute(snapshot.map, shooter, move);
  expect(distance(shooter, move)).toBeGreaterThan(MOVE_ORDER_ARRIVAL_RANGE);
  expect(distance(move, brute)).toBeGreaterThan(distance(shooter, brute));
  expect(sameGround(snapshot.map, shooter, move)).toBe(true);
  expect(distance(road[road.length - 1]!, move)).toBeLessThanOrEqual(MOVE_ORDER_ARRIVAL_RANGE);
  expect(capsuleClearsBodies(shooter, move, shooter.radius, snapshot.units.filter((unit: { id: string }) => unit.id !== shooter.id))).toBe(true);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it.each(BOOTSTRAP_VERSIONS)('%s uses an unobstructed escape while the actual front receives its ready heal', version => {
  const frame = saved(375), snapshot = frame.snapshot, before = JSON.stringify(snapshot);
  const shooter = snapshot.units.find((unit: { id: string }) => unit.id === 'shooter-2')!;
  const brute = snapshot.units.find((unit: { id: string }) => unit.id === 'brute')!;
  const options = bootstrapPolicyContext(snapshot, 'us', version, { memory: frame.memory });
  const commands = planBootstrapNaval(snapshot, 'us', options);
  const move = commands.find(command => command.type === 'move' && command.unitIds.includes(shooter.id));
  expect(move?.type).toBe('move');
  if (move?.type !== 'move') throw Error('Missing actual escape');
  expect(distance(move, brute)).toBeGreaterThan(distance(shooter, brute));
  expect(capsuleClearsBodies(shooter, move, shooter.radius, snapshot.units.filter((unit: { id: string }) => unit.id !== shooter.id))).toBe(true);
  expect(commands.filter(command => command.type === 'cast' && command.unitId === 'healer'
    && command.ability === 'heal' && command.targetId === 'front')).toHaveLength(1);
  expect(JSON.stringify(snapshot)).toBe(before);
});
