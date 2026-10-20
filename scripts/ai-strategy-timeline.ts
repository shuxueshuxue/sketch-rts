import { createHash } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { AiPolicyMemory } from '../src/ai/memory';
import type { AiPlanTrace } from '../src/ai/plan-trace';
import type { AiGameRunInput } from '../src/ai/game-runner';

// Consume the exact Stage 1 baseline configuration, including source, seat
// phases and command delay. Compare all five SHA256 values with its control.
const [base, caseFile, out] = process.argv.slice(2);
if (!base || !caseFile || !out) throw new Error('Expected source-tree case.json output-dir');
const config = JSON.parse(readFileSync(caseFile, 'utf8')) as AiGameRunInput & { source: string };
const { runAiGameLoop } = await import(`${base}/src/ai/game-runner.ts`) as typeof import('../src/ai/game-runner');
const { createAiMemoryProvider } = await import(`${base}/src/ai/planner-context.ts`) as typeof import('../src/ai/planner-context');
const { planAiOwnerCommandEntriesWithTrace } = await import(`${base}/src/ai/plan-trace-planner.ts`) as typeof import('../src/ai/plan-trace-planner');
const { canonicalGameState, checksumGame } = await import(`${base}/src/shared/sim/checksum.ts`) as typeof import('../src/shared/sim/checksum');
const memories: Record<string, AiPolicyMemory> = {}, memoryProvider = createAiMemoryProvider(memories);
const previous: Record<string, AiPlanTrace> = {}, durations: number[] = [];
const plannedHash = createHash('sha256'), commandHash = createHash('sha256');
mkdirSync(out, { recursive: true });
const timelinePath = `${out}/objectives.jsonl`, fd = openSync(timelinePath, 'w');
let finalGame: Parameters<typeof checksumGame>[0], plannedCount = 0, commandCount = 0;
const loop = runAiGameLoop({ ...config, commandPlanner({ snapshot, owner, agent, source, teams }) {
  const start = performance.now();
  const result = planAiOwnerCommandEntriesWithTrace(snapshot, { playerId: owner, source, version: agent.version },
    { memoryProvider, teams }, previous[owner]);
  durations.push(performance.now() - start); previous[owner] = result.trace;
  plannedHash.update(JSON.stringify({ tick: snapshot.tick, owner, entries: result.commands }) + '\n'); plannedCount += result.commands.length;
  const strategy = result.trace.strategy;
  if (strategy) writeSync(fd, JSON.stringify({ tick: snapshot.tick, owner, objectives: strategy.objectives, methods: strategy.methods,
    assignments: strategy.assignments, idleForces: strategy.idleForces, budget: strategy.budget, limitations: strategy.limitations }) + '\n');
  return result.commands;
} }, {
  beforeLoop({ game }) { finalGame = game; },
  onCommand({ tick, owner, source, scriptId, command }) {
    commandHash.update(JSON.stringify({ tick, owner, source, scriptId, command }) + '\n'); commandCount++;
  },
});
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sorted = [...durations].sort((a, b) => a - b);
const receipt = { source: config.source, name: config.name, mapId: config.mapId, owners: Object.keys(config.agents), tick: loop.snapshot.tick,
  host: hostname(), node: process.version, plannedCount, commandCount,
  plannedSha256: plannedHash.digest('hex'), commandSha256: commandHash.digest('hex'), snapshotSha256: sha(loop.snapshot),
  memorySha256: sha(memories), canonicalSha256: sha(canonicalGameState(finalGame!)), checksum: checksumGame(finalGame!),
  thinkMs: { n: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) },
  elapsedMs: loop.elapsedMs, cpuMs: loop.cpuMs };
writeFileSync(`${out}/summary.json`, JSON.stringify(receipt, null, 2));
closeSync(fd);
await pipeline(createReadStream(timelinePath), createGzip(), createWriteStream(timelinePath + '.gz')); unlinkSync(timelinePath);
console.log(JSON.stringify(receipt));
