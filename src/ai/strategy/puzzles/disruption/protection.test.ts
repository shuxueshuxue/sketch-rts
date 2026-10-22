import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../../../shared/types';
import { departureProtection } from './protection';
import { DISRUPTION_CASES } from './scenes';
import manifest from './fixtures/manifest.json';

for (const record of manifest) it(`joins original native protection evidence ${record.case}/${record.tick}`, () => {
  const original = readFileSync(new URL('./fixtures/' + record.file, import.meta.url));
  expect(createHash('sha256').update(original).digest('hex')).toBe(record.sha256);
  const plain = gunzipSync(original); expect(createHash('sha256').update(plain).digest('hex')).toBe(record.plainSha256);
  const row = JSON.parse(plain.toString()) as { snapshot: GameSnapshot };
  const puzzle = DISRUPTION_CASES.find(p => `${p.key}-${p.variant}` === record.case)!;
  const w = puzzle.create();
  const worker = row.snapshot.units.find(u => u.id === 'unit-planner-worker-1011')!;
  expect(worker.kind).toBe('worker');
  const nativeDeaths = new Set((row.snapshot.corpses ?? []).map(c => c.unitId));
  const proof = departureProtection(row.snapshot, w, worker, nativeDeaths);
  expect(proof.positive).toBe(true);
  if (record.tick === 1680) {
    expect(proof.confirmedAllDead).toBe(false);
    expect(proof.screenIds).toHaveLength(3);
    expect(proof.screenPower).toBeGreaterThan(proof.threatPower);
  } else expect(proof.confirmedAllDead).toBe(true);
});
