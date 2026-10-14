/** Derived-mark CPU micro only. Both policies use the actual unchanged builder
 * and identical prebuilt publications; no simulation, drawing or FPS timing. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { createMapPresentation } from '../src/shared/presentation';
import { createUnit } from '../src/shared/map';
import { createGame, snapshotGame } from '../src/shared/sim';
import type { GameSnapshot } from '../src/shared/types';
import { MinimapPresentationCache } from '../src/client/minimap-presentation-cache';

const out = resolve(process.argv[2] ?? 'docs/art/refactor/followup/minimap-cache/micro.json');
const sourceFiles = ['src/client/main.ts', 'src/client/minimap-presentation-cache.ts', 'src/client/net/local-adapter.ts', 'src/shared/presentation.ts', 'src/shared/sim.ts', 'scripts/art-minimap-cache-micro.ts'];
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const before = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha(await readFile(file))])));
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { meanMs: values.reduce((a, b) => a + b, 0) / values.length, p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1) };
};
const scenarios = [];
let sink = 0;
for (const count of [2000, 10000]) {
  const game = createGame('verdantCrossroads', { aiPlayers: [] });
  game.map.width = game.map.height = 12000;
  game.units = Array.from({ length: count }, (_, index) => createUnit(`micro-${index}`, index % 20 === 0 ? 'neutral' : index % 2 ? 'player' : 'enemy',
    index % 20 === 0 ? 'stonebackBrute' : 'footman', 100 + (index * 137 % 11800), 100 + (index * 197 % 11800)));
  const base = snapshotGame(game);
  // 60 visual frames / 20 simulation publications per second. Already-created
  // input copies ensure snapshot/simulation allocation is excluded from timers.
  const publications: GameSnapshot[] = Array.from({ length: 40 }, (_, tick) => ({ ...base, tick,
    units: base.units.map((unit, index) => ({ ...unit, x: unit.x + tick * (index % 2 ? 1 : -1), y: unit.y + tick * .4 })) }));
  const inputs = publications.flatMap(publication => [publication, publication, publication]);
  const validationCache = new MinimapPresentationCache();
  const oldOutputs = inputs.map(snapshot => createMapPresentation(snapshot));
  const newOutputs = inputs.map(snapshot => validationCache.read(snapshot, snapshot));
  for (let index = 0; index < inputs.length; index++) assert.deepEqual(newOutputs[index], oldOutputs[index]);
  const uniqueOld = new Set(oldOutputs), uniqueNew = new Set(newOutputs);
  const constructedMarks = (outputs: Set<ReturnType<typeof createMapPresentation>>) => [...outputs].reduce((total, marks) => total + marks.length, 0);
  const allocation = { originalBuilds: uniqueOld.size, cachedBuilds: uniqueNew.size, originalMarkObjects: constructedMarks(uniqueOld), cachedMarkObjects: constructedMarks(uniqueNew),
    sourceIdArrays: 'Exactly one new sourceIds array per final mark in this unchanged builder. Temporary mapping/cluster/sort allocations are additional and are not counted as bytes.' };
  oldOutputs.length = newOutputs.length = 0;
  uniqueOld.clear(); uniqueNew.clear(); validationCache.reset();
  const samples: { round: number; position: number; policy: string; elapsedMs: number; calls: number; newBuilds: number }[] = [];
  // Balanced order; no removed warmups/outliers, no GC inside timed batches.
  for (let round = 0; round < 12; round++) {
    const order = round % 2 ? ['cached', 'original'] : ['original', 'cached'];
    for (const [position, policy] of order.entries()) {
      await new Promise(done => setTimeout(done, 0));
      const cache = new MinimapPresentationCache();
      const started = performance.now();
      for (const snapshot of inputs) {
        const marks = policy === 'original' ? createMapPresentation(snapshot) : cache.read(snapshot, snapshot);
        sink ^= marks.length ^ marks[0]!.x ^ marks.at(-1)!.y;
      }
      samples.push({ round, position, policy, elapsedMs: performance.now() - started, calls: inputs.length,
        newBuilds: policy === 'original' ? inputs.length : publications.length });
      cache.reset();
    }
  }
  const original = stats(samples.filter(sample => sample.policy === 'original').map(sample => sample.elapsedMs));
  const cached = stats(samples.filter(sample => sample.policy === 'cached').map(sample => sample.elapsedMs));
  scenarios.push({ units: count, world: { width: base.map.width, height: base.map.height }, publications: publications.length, visualReads: inputs.length,
    inputSHA256: sha(JSON.stringify(publications)), exactFrameComparisons: inputs.length, allocation, samples, summaries: { original, cached }, meanRatio: cached.meanMs / original.meanMs });
}
const after = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha(await readFile(file))])));
assert.deepEqual(after, before, 'Source changed during the micro');
await mkdir(resolve(out, '..'), { recursive: true });
await writeFile(out, JSON.stringify({ method: 'Node CPU micro of unchanged full-world mark derivation with 60Hz reads / 20Hz immutable owner publications. No simulation, rasterization, DOM, GPU or FPS included. Twelve balanced-order rounds, first/slow rounds all retained.',
  scope: 'Only local-adapter publication reuse. Public room / mutable unknown reads retain live derivation. Input snapshot graph construction and validation are outside timers. Exact mark-object/sourceIds counts are construction counts, not total memory allocation or heap peaks.',
  environment: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model },
  sourceSHA256: before, sourceStableAtEnd: true, scenarios, sink }, null, 2) + '\n');
console.log(JSON.stringify({ out, scenarios: scenarios.map(({ units, allocation, summaries, meanRatio }) => ({ units, allocation, summaries, meanRatio })) }, null, 2));
