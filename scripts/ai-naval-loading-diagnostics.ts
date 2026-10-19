import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBenchmarkParallel } from '../src/sdk/benchmark/parallel';
import { createNavalRoomInput, type NavalRoomMatch } from '../src/ai/benchmark/naval-room';
import { ROOM_AI_VERSIONS } from '../src/shared/rooms';
import { boolFlag, flag, requiredFlag } from './benchmark-cli';

const args = process.argv.slice(2), baseline = requiredFlag(args, 'baseline'), outDir = resolve(requiredFlag(args, 'out-dir'));
const rival = requiredFlag(args, 'rival');
if (rival !== 'v8' && rival !== 'v9') throw new Error('--rival must be v8 or v9');
const workers = Number(flag(args, 'workers') ?? 24);
if (!Number.isInteger(workers) || workers < 1 || workers > 24) throw new Error('--workers must be 1..24');
const names = new Set<string>();
const forced = flag(args, 'matches-file');
if (forced) for (const name of JSON.parse(readFileSync(forced, 'utf8')) as string[]) names.add(name);
for (const file of forced ? [] : readdirSync(baseline)) {
  if (!file.endsWith('.json') || file === 'manifest.json' || file === 'report.json') continue;
  const report = JSON.parse(readFileSync(join(baseline, file), 'utf8'));
  // Every game with ships: also remeasure real crossings after excluding same-island reboarding.
  if (Object.values(report.result.trackers.naval).some((owner: any) => owner.ships.length > 0)) names.add(report.name);
}
const excludedFile = flag(args, 'exclude-matches-file');
const excluded = new Set<string>(excludedFile ? JSON.parse(readFileSync(excludedFile, 'utf8')) : []);
const input = createNavalRoomInput({ rival, subjects: ROOM_AI_VERSIONS, outDir });
for (const evaluation of input.evaluations) evaluation.matches = evaluation.matches.filter(match => names.has(match.name) && !excluded.has(match.name));
if (boolFlag(args, 'full-metrics')) for (const evaluation of input.evaluations) for (const match of evaluation.matches) (match as NavalRoomMatch).naval.fullMetrics = true;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ baseline, names: [...names], workers }));
const report = await runBenchmarkParallel(input, { workers, workerModule: new URL('../src/ai/benchmark/naval-loading-diagnostics.ts', import.meta.url).href });
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report));
console.log(JSON.stringify({ games: report.matchCount, outDir, elapsedMs: report.elapsedMs }));
