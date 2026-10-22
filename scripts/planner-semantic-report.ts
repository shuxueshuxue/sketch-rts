import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { assessColdSemantic, countSemanticSwitches, validateSemanticFrames, type SemanticFrame } from './goal-semantic-judgment';

/** Input is an explicit normal-owner observation projection, not old planner
 * memory decoded by this script. No fallback reconstructs missing allocation. */
const args = process.argv.slice(2), allowed = new Set(['--input', '--out', '--mode', '--k', '--tail', '--start-tick', '--ticks-per-minute', '--require-allocation']);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]!, value = args[i + 1];
  if (!allowed.has(key) || options.has(key) || value === undefined || value.startsWith('--')) throw Error(`Invalid option: ${key}`);
  options.set(key, value);
}
const input = options.get('--input'), out = options.get('--out');
if (!input || !out) throw Error('Usage: planner-semantic-report.ts --input projection.jsonl[.gz] --out report.json --mode cold|live --start-tick 1');
const mode = options.get('--mode') ?? 'cold';
if (mode !== 'cold' && mode !== 'live') throw Error('Mode must be cold or live');
const integer = (key: string, fallback: number) => {
  const raw = options.get(key), n = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(n)) throw Error(`Expected integer ${key}`); return n;
};
const requireAllocation = options.get('--require-allocation') ?? 'true';
if (!['true', 'false'].includes(requireAllocation)) throw Error('--require-allocation must be true or false');
const bytes = readFileSync(resolve(input));
const plain = input.endsWith('.gz') ? gunzipSync(bytes) : bytes;
const frames = plain.toString('utf8').split('\n').filter(x => x.trim()).map(line => JSON.parse(line) as SemanticFrame);
if (!frames.length) throw Error('No semantic observations');
validateSemanticFrames(frames);
const frozen = { k: integer('--k', 20), tail: integer('--tail', 3), requireAllocation: requireAllocation === 'true' };
const clock = { startTick: integer('--start-tick', 1), ticksPerMinute: integer('--ticks-per-minute', 1200) };
const groups = new Map<string, SemanticFrame[]>();
for (const f of frames) {
  const key = JSON.stringify([f.run, f.seat, f.goalId]), rows = groups.get(key) ?? [];
  rows.push(f); groups.set(key, rows);
}
const cold = mode === 'cold' ? [...groups.entries()].map(([key, rows]) => ({ group: JSON.parse(key), ...assessColdSemantic(rows, frozen) })) : [];
const report = { schema: 'goal-semantic-judgment:1', mode, frozen, clock,
  input: { path: resolve(input), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    plainSha256: createHash('sha256').update(plain).digest('hex'), observations: frames.length },
  cold, switches: countSemanticSwitches(frames, clock),
  scope: 'Read-only judgment projection. No planner, allocator, ledger, SDK, simulation or pathfinding imports. Original puzzle verdicts/allocation must be exported by the normal owner; missing evidence remains missing.' };
writeFileSync(resolve(out), JSON.stringify(report, null, 2) + '\n');
const failures = cold.filter(x => !x.convergence.passed || !x.solving.passed).length;
console.log(JSON.stringify({ mode, observations: frames.length, groups: groups.size, coldFailures: failures, out: resolve(out) }));
if (failures) process.exitCode = 1;
