import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyContext } from '../policy/types';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext, bootstrapScripts } from './policy';
import { miningJobSafety } from './mining-job-defense';

function actual(tick: 11400 | 12000) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/mining-building-fire-${tick}.json.gz`, import.meta.url))).toString());
  const snapshot: GameSnapshot = saved.snapshot;
  setBuildingBodies(snapshot.map, [...snapshot.buildings, ...snapshot.obstacles ?? []]);
  const options: AiPolicyContext = { memory: saved.memories.p0, ...(snapshot.teams ? { teams: snapshot.teams } : {}) };
  return { snapshot, options };
}

it.each(BOOTSTRAP_VERSIONS)('%s does not refill the actually covered western mine after a worker becomes idle', version => {
  const { snapshot, options } = actual(12000);
  // Counterfactual admission boundary: only this original worker's current
  // mining order becomes idle. The two real working towers remain unchanged.
  const worker = snapshot.units.find(unit => unit.id === 'unit-p0-worker-1019')!;
  worker.order = { type: 'idle' };
  const economy = bootstrapScripts(version).find(script => script.id === 'economy')!;
  const entries = runAiCommandEntriesFromScripts(snapshot, 'p0', [economy],
    bootstrapPolicyContext(snapshot, 'p0', version, options));
  expect(entries.some(entry => entry.command.type === 'mine' && entry.command.resourceId === 'gold-gen-5')).toBe(false);
});

it('releases a real12000 mining job along a safe public road despite its completed own hall', () => {
  const { snapshot, options } = actual(12000);
  const entries = runAiCommandEntriesFromScripts(snapshot, 'p0', [miningJobSafety],
    bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', options));
  const commands = entries.map(entry => entry.command);
  expect(commands.some(command => command.type === 'move' && command.avoidCombat
    && command.unitIds.includes('unit-p0-worker-1019'))).toBe(true);
  expect(commands.some(command => command.type === 'mine' && command.resourceId === 'gold-gen-5')).toBe(false);

  // Explicit counterfactual: without the other own halls, the only shelter
  // is the real exposed4507. Lack of a safe endpoint must not publish escape.
  const without = actual(12000);
  without.snapshot.buildings = without.snapshot.buildings.filter(building => building.owner !== 'p0'
    || building.kind !== 'townHall' || building.id === 'building-p0-townHall-4507');
  setBuildingBodies(without.snapshot.map, [...without.snapshot.buildings, ...without.snapshot.obstacles ?? []]);
  const noShelter = runAiCommandEntriesFromScripts(without.snapshot, 'p0', [miningJobSafety],
    bootstrapPolicyContext(without.snapshot, 'p0', 'v9_archer', without.options));
  expect(noShelter.some(entry => 'unitIds' in entry.command
    && entry.command.unitIds.includes('unit-p0-worker-1019'))).toBe(false);
});

it('preserves the actual11400 paid hall builder before either enemy tower exists', () => {
  const { snapshot, options } = actual(11400);
  const worker = snapshot.units.find(unit => unit.id === 'unit-p0-worker-1379')!;
  expect(worker.order).toEqual({ type: 'repair', buildingId: 'building-p0-townHall-4507' });
  const entries = runAiCommandEntriesFromScripts(snapshot, 'p0', [miningJobSafety],
    bootstrapPolicyContext(snapshot, 'p0', 'v9_archer', options));
  expect(entries.some(entry => 'unitIds' in entry.command && entry.command.unitIds.includes(worker.id))).toBe(false);
  expect(worker.order).toEqual({ type: 'repair', buildingId: 'building-p0-townHall-4507' });
});
