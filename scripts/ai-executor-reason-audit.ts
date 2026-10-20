/** Read-only audit, not a win-rate benchmark.
 * tsx ai-executor-reason-audit.ts <source-tree> <case.json> <output-dir> <reason-utils.ts>
 * Use the same explicit reason-leaf allowlist for both source trees. */
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { AiGameRunInput } from '../src/ai/game-runner';
import type { AiPolicyMemory } from '../src/ai/memory';
import type { ExecutorReason } from '../src/ai/executor-reasons';

const [tree, caseFile, out, utils] = process.argv.slice(2);
if (!tree || !caseFile || !out || !utils) throw new Error('Expected source-tree case.json output-dir reason-utils.ts');
const config = JSON.parse(readFileSync(caseFile, 'utf8')) as AiGameRunInput & { source: string };
const { runAiGameLoop } = await import(`${tree}/src/ai/game-runner.ts`) as typeof import('../src/ai/game-runner');
const { planAiOwnerCommandEntries, createAiMemoryProvider } = await import(`${tree}/src/ai/planner-context.ts`) as typeof import('../src/ai/planner-context');
const { snapshotGame } = await import(`${tree}/src/shared/sim.ts`) as typeof import('../src/shared/sim');
const { canonicalGameState, checksumGame } = await import(`${tree}/src/shared/sim/checksum.ts`) as typeof import('../src/shared/sim/checksum');
const { buildAiPlanTrace } = await import(`${tree}/src/ai/plan-trace.ts`) as typeof import('../src/ai/plan-trace');
const { executorBehaviorMemory, executorMemoryReasons } = await import(utils) as typeof import('../src/ai/executor-reasons.test-utils');
const memories: Record<string, AiPolicyMemory> = {}, memoryProvider = createAiMemoryProvider(memories);
const fds = new Map<string, number>(), hashes = Object.fromEntries(['planned', 'commands', 'behavior-memory', 'raw-memory', 'worlds'].map(key => [key, createHash('sha256')]));
const reasonCounts: Record<string, number> = {};
let finalGame: Parameters<typeof snapshotGame>[0], plannedCount = 0, commandCount = 0, thinkCount = 0;
mkdirSync(out, { recursive: true });
const log = (name: string, row: unknown, hash = true) => {
  let fd = fds.get(name);
  if (fd === undefined) { fd = openSync(`${out}/${name}.jsonl`, 'w'); fds.set(name, fd); }
  const bytes = JSON.stringify(row) + '\n';
  writeSync(fd, bytes);
  if (hash) hashes[name]?.update(bytes);
};
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const world = () => ({ tick: finalGame.tick, snapshotSha256: sha(snapshotGame(finalGame)), canonicalSha256: sha(canonicalGameState(finalGame)), checksum: checksumGame(finalGame) });
runAiGameLoop({ ...config, commandPlanner({ snapshot, owner, agent, source, teams }) {
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: owner, version: agent.version, source }, { memoryProvider, teams });
  const memory = memories[owner]!;
  thinkCount++; plannedCount += entries.length;
  log('planned', { tick: snapshot.tick, owner, entries });
  log('behavior-memory', { tick: snapshot.tick, owner, memory: executorBehaviorMemory(memory) });
  // Hash the unmodified serialization too; only its enumerated reason leaves may differ.
  hashes['raw-memory']!.update(JSON.stringify({ tick: snapshot.tick, owner, memory }) + '\n');
  log('memory-reasons', { tick: snapshot.tick, owner, reasons: executorMemoryReasons(memory) }, false);
  const trace = buildAiPlanTrace(snapshot, owner, memory, agent.version);
  for (const reason of trace.executorReasons ?? []) {
    const key = `${reason.executor}/${reason.outcome}/${reason.reason}`;
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1;
    log('executor-reasons', { tick: snapshot.tick, owner, ...reason } satisfies ExecutorReason & { tick: number; owner: string }, false);
  }
  return entries;
} }, {
  beforeLoop({ game }) {
    finalGame = game;
    writeFileSync(`${out}/initial.json`, JSON.stringify({ source: config.source, config, snapshot: snapshotGame(game), nextId: game.nextId, activePlayers: game.activePlayers }));
    log('worlds', world());
  },
  onCommand({ tick, owner, source, scriptId, command }) {
    commandCount++; log('commands', { tick, owner, source, scriptId, command });
  },
  onStep({ game }) { if (game.tick % 1200 === 0) log('worlds', world()); },
});
log('worlds', world());
writeFileSync(`${out}/final.json`, JSON.stringify({ source: config.source, snapshot: snapshotGame(finalGame!), nextId: finalGame!.nextId, memories }));
const summary = { source: config.source, mapId: config.mapId, tick: finalGame!.tick, plannedCount, commandCount, thinkCount,
  hashes: Object.fromEntries(Object.entries(hashes).map(([key, hash]) => [key, hash.digest('hex')])),
  snapshotSha256: sha(snapshotGame(finalGame!)), canonicalSha256: sha(canonicalGameState(finalGame!)), checksum: checksumGame(finalGame!),
  memorySha256: sha(memories), behaviorMemorySha256: sha(Object.fromEntries(Object.entries(memories)
    .map(([owner, memory]) => [owner, executorBehaviorMemory(memory)]))), reasonCounts };
writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
for (const [name, fd] of fds) {
  closeSync(fd);
  const path = `${out}/${name}.jsonl`;
  await pipeline(createReadStream(path), createGzip(), createWriteStream(path + '.gz'));
  unlinkSync(path);
}
console.log(JSON.stringify({ map: config.mapId, tick: finalGame!.tick, thinkCount, hashes: summary.hashes }));
