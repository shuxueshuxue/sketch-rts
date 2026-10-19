import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBenchmarkParallel } from '../src/sdk/benchmark/parallel';
import { auditNavalPool, createNavalRoomInput } from '../src/ai/benchmark/naval-room';
import { parseMetric } from '../src/ai/benchmark/metrics';
import { ROOM_AI_VERSIONS } from '../src/shared/rooms';
import type { RoomAiVersion } from '../src/shared/types';
import { boolFlag, csvFlag, flag, printJson, requiredFlag } from './benchmark-cli';

const args = process.argv.slice(2);
const rival = requiredFlag(args, 'rival');
if (rival !== 'v8' && rival !== 'v9') throw new Error('--rival must be v8 or v9; each is a separate benchmark');
const subjects = flag(args, 'subjects') ? csvFlag(args, 'subjects') as RoomAiVersion[] : ROOM_AI_VERSIONS;
for (const subject of subjects) if (!ROOM_AI_VERSIONS.includes(subject)) throw new Error(`Unknown room AI ${subject}`);
const workers = Number(flag(args, 'workers') ?? 24);
if (!Number.isInteger(workers) || workers < 1 || workers > 24) throw new Error('--workers must be 1..24');
const outDir = resolve(flag(args, 'out-dir') ?? `work/naval-room-${rival}`);
const audit = auditNavalPool();
const metrics = flag(args, 'metrics') ? csvFlag(args, 'metrics') : ['bases@5', 'bases@10', 'bases@15', 'spent@15', 'trade@40'];
metrics.forEach(parseMetric);
const input = createNavalRoomInput({
  rival, subjects, outDir, metrics,
  maps: flag(args, 'maps') ? csvFlag(args, 'maps') : audit.filter(map => map.selected).map(map => map.mapId),
  ...(flag(args, 'max-ticks') ? { maxTicks: Number(flag(args, 'max-ticks')) } : {}),
  ...(flag(args, 'sample-seconds') ? { sampleSeconds: Number(flag(args, 'sample-seconds')) } : {}),
});
if (flag(args, 'match')) for (const evaluation of input.evaluations) evaluation.matches = evaluation.matches.filter(match => match.name === flag(args, 'match'));
if (boolFlag(args, 'dry-run')) {
  printJson({ audit, matches: input.evaluations.flatMap(evaluation => evaluation.matches.map(match => ({ name: match.name, players: Object.keys(match.agents).length, agents: match.agents, mapId: match.mapId, options: match.options }))) });
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ audit, input, workers }, null, 2)}\n`);
  const report = await runBenchmarkParallel(input, { workers, workerModule: new URL('../src/ai/benchmark/naval-room-worker.ts', import.meta.url).href });
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify(report)}\n`);
  printJson({ outDir, matches: report.matchCount, elapsedMs: report.elapsedMs, totals: report.evaluations.map(evaluation => ({ subject: evaluation.name, wins: evaluation.matches.filter(match => match.result.winnerTeam === (match.name.includes('side-1') ? 'team-1' : 'team-2')).length, games: evaluation.matchCount, timeouts: evaluation.matches.filter(match => match.result.timeout).length })) });
}
