import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runBenchmarkParallel } from '../src/sdk/benchmark/parallel';
import { createNavalRoomInput } from '../src/ai/benchmark/naval-room';
import { ROOM_AI_VERSIONS } from '../src/shared/rooms';
import { flag, requiredFlag } from './benchmark-cli';

const args = process.argv.slice(2), rival = requiredFlag(args, 'rival');
if (rival !== 'v8' && rival !== 'v9') throw new Error('--rival must be v8 or v9');
const workers = Number(flag(args, 'workers') ?? 24);
if (!Number.isInteger(workers) || workers < 1 || workers > 24) throw new Error('--workers must be 1..24');
const outDir = resolve(requiredFlag(args, 'out-dir'));
const input = createNavalRoomInput({ rival, subjects: ROOM_AI_VERSIONS, outDir,
  ...(flag(args, 'max-ticks') ? { maxTicks: Number(flag(args, 'max-ticks')) } : {}) });
if (flag(args, 'match')) for (const evaluation of input.evaluations) evaluation.matches = evaluation.matches.filter(match => match.name === flag(args, 'match'));
const matches = input.evaluations.flatMap(evaluation => evaluation.matches);
if (!matches.length) throw new Error('No matches selected');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ source: flag(args, 'source') ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), rival, workers, names: matches.map(match => match.name) }));
const report = await runBenchmarkParallel(input, { workers, workerModule: new URL('../src/ai/benchmark/naval-obstacle-worker.ts', import.meta.url).href });
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report));
console.log(JSON.stringify({ rival, games: report.matchCount, outDir, elapsedMs: report.elapsedMs }));
