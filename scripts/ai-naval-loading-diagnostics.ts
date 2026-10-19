import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBenchmarkParallel } from '../src/sdk/benchmark/parallel';
import { createNavalRoomInput } from '../src/ai/benchmark/naval-room';
import { ROOM_AI_VERSIONS } from '../src/shared/rooms';
import { flag, requiredFlag } from './benchmark-cli';

const args = process.argv.slice(2), baseline = requiredFlag(args, 'baseline'), outDir = resolve(requiredFlag(args, 'out-dir'));
const rival = requiredFlag(args, 'rival');
if (rival !== 'v8' && rival !== 'v9') throw new Error('--rival must be v8 or v9');
const workers = Number(flag(args, 'workers') ?? 24);
if (!Number.isInteger(workers) || workers < 1 || workers > 24) throw new Error('--workers must be 1..24');
const names = new Set<string>();
for (const file of readdirSync(baseline)) {
  if (!file.endsWith('.json') || file === 'manifest.json' || file === 'report.json') continue;
  const report = JSON.parse(readFileSync(join(baseline, file), 'utf8'));
  // Recheck every game whose actual memory samples contain this mission, including successful ones.
  if (Object.values(report.result.trackers.naval).some((owner: any) => owner.samples.some((sample: any) => Object.values(sample.mission ?? {}).some((mission: any) => mission.purpose === 'creep')))) names.add(report.name);
}
const input = createNavalRoomInput({ rival, subjects: ROOM_AI_VERSIONS, outDir });
for (const evaluation of input.evaluations) evaluation.matches = evaluation.matches.filter(match => names.has(match.name));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ baseline, names: [...names], workers }));
const report = await runBenchmarkParallel(input, { workers, workerModule: new URL('../src/ai/benchmark/naval-loading-diagnostics.ts', import.meta.url).href });
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report));
console.log(JSON.stringify({ games: report.matchCount, outDir, elapsedMs: report.elapsedMs }));
