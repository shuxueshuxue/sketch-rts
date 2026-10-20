/** Deterministic AI proof, not a win-rate benchmark.
 * tsx scripts/command-feedback-ai-parity.ts <source-tree> <case.json> <output-dir> <plain|trace> <source-sha>
 * Run the same script against immutable main/candidate trees; compare every tick without filtering effects.
 */
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import type { AiGameRunInput } from '../src/ai/game-runner';
import type { AiPolicyMemory } from '../src/ai/memory';
import type { AiPlanTrace } from '../src/ai/plan-trace';
import type { Game } from '../src/shared/sim';

const [tree, caseFile, output, mode, source] = process.argv.slice(2);
if (!tree || !caseFile || !output || !source || (mode !== 'plain' && mode !== 'trace')) {
  throw new Error('Expected source-tree case.json output-dir plain|trace source-sha');
}
const base = resolve(tree), config = JSON.parse(readFileSync(caseFile, 'utf8')) as AiGameRunInput;
const { runAiGameLoop } = await import(`${base}/src/ai/game-runner.ts`) as typeof import('../src/ai/game-runner');
const { createAiMemoryProvider, planAiOwnerCommandEntries } = await import(`${base}/src/ai/planner-context.ts`) as typeof import('../src/ai/planner-context');
const { buildAiPlanTrace } = await import(`${base}/src/ai/plan-trace.ts`) as typeof import('../src/ai/plan-trace');
const { canonicalGameState, checksumGame } = await import(`${base}/src/shared/sim/checksum.ts`) as typeof import('../src/shared/sim/checksum');
const { AiDeathLedger } = await import(`${base}/src/ai/death-ledger.ts`) as typeof import('../src/ai/death-ledger');
const memories: Record<string, AiPolicyMemory> = {}, memoryProvider = createAiMemoryProvider(memories);
const previous: Record<string, AiPlanTrace> = {};
const plannedHash = createHash('sha256'), commandHash = createHash('sha256'), checksumHash = createHash('sha256'), traceHash = createHash('sha256');
const seenEffects = new Set<string>(), effectTypes: Record<string, number> = {};
let ledger: InstanceType<typeof AiDeathLedger> | undefined;
let plannedCount = 0, commandCount = 0, traceCount = 0, checksumCount = 0, newReceipts = 0, peakEffects = 0;
mkdirSync(output, { recursive: true });
const checksumPath = `${output}/checksums.jsonl`, checksumFile = openSync(checksumPath, 'w');
const observeEffects = (game: Game) => {
  peakEffects = Math.max(peakEffects, game.effects.length);
  for (const effect of game.effects) {
    if (seenEffects.has(effect.id)) continue;
    seenEffects.add(effect.id);
    effectTypes[effect.type] = (effectTypes[effect.type] ?? 0) + 1;
    if (effect.feedbackStatus || effect.commandType || effect.id.startsWith('refused-') || effect.id.startsWith('waiting-')) newReceipts++;
  }
};
const recordState = (game: Game) => {
  observeEffects(game);
  const bytes = JSON.stringify({ tick: game.tick, checksum: checksumGame(game) }) + '\n';
  writeSync(checksumFile, bytes); checksumHash.update(bytes); checksumCount++;
};
const loop = runAiGameLoop({ ...config, commandPlanner({ snapshot, owner, source: origin, agent, teams }) {
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: owner, source: origin, version: agent.version }, { memoryProvider, teams });
  plannedHash.update(JSON.stringify({ tick: snapshot.tick, owner, entries }) + '\n'); plannedCount += entries.length;
  if (ledger) {
    ledger.recordThink(snapshot, owner, memories[owner]!);
    const trace = buildAiPlanTrace(snapshot, owner, memories[owner]!, agent.version, previous[owner]);
    const enriched = ledger.withPlanTrace(trace, trace.previousTick ?? -1);
    previous[owner] = enriched; traceHash.update(JSON.stringify(enriched) + '\n'); traceCount++;
  }
  return entries;
} }, {
  beforeLoop({ game, players }) {
    if (players.some(owner => !game.aiPlayers.includes(owner))) throw new Error('Proof requires all-AI seats');
    if (mode === 'trace') ledger = new AiDeathLedger(game, { owners: players });
    recordState(game);
  },
  onCommand({ game, tick, owner, source: origin, scriptId, command }) {
    commandHash.update(JSON.stringify({ tick, owner, source: origin, scriptId, command }) + '\n'); commandCount++;
    ledger?.recordIssuedCommand(tick, owner, command, scriptId, origin);
    observeEffects(game);
  },
  beforeStep({ game }) { observeEffects(game); },
  onStep({ game }) { recordState(game); },
});
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const summary = {
  source, mode, config, tick: loop.game.tick, checksumCount,
  checksumSequenceSha256: checksumHash.digest('hex'), finalChecksum: checksumGame(loop.game),
  canonicalSha256: sha(canonicalGameState(loop.game)), snapshotSha256: sha(loop.snapshot), memorySha256: sha(memories),
  plannedCount, plannedSha256: plannedHash.digest('hex'), commandCount, commandSha256: commandHash.digest('hex'),
  effectsCreated: seenEffects.size, peakEffects, finalEffects: loop.game.effects.length, effectTypes, newReceipts,
  traceCount, traceSha256: traceHash.digest('hex'), ledgerErrors: ledger?.errors ?? [],
};
ledger?.dispose(); closeSync(checksumFile);
await pipeline(createReadStream(checksumPath), createGzip(), createWriteStream(checksumPath + '.gz'));
unlinkSync(checksumPath);
writeFileSync(`${output}/summary.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
if (newReceipts || summary.ledgerErrors.length) process.exitCode = 1;
