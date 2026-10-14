import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { transformSync } from 'esbuild';
import { FocusedScopes, instrumentFocusedSource } from './six-player-focused-instrumentation';
import { runProbe } from './six-player-tick-probe';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const source = '/workspace/sketch-rts-six-player-structural-before-0f31';
const fixture = `function navalBudgetReserve(){return 0;}
function shoreSpot(snapshot,owner,water,options,despiteGuns=false){if(snapshot.error)throw snapshot.error;return snapshot.result;}
exports.shoreSpot=shoreSpot;`;
const compiled = transformSync(instrumentFocusedSource('/fixture/src/ai/policy/naval.ts', fixture).contents,
  { loader: 'ts', format: 'cjs' }).code;
const scopes = new FocusedScopes(new Set([6990]));
const module = { exports: {} as { shoreSpot(...args: unknown[]): unknown } };
new Function('module', 'exports', 'globalThis', compiled)(module, module.exports, { __sketchSixPlayerFocus: scopes });
const result = {}, snapshot = { result }, teams = { us: 'a', foe: 'b' }, water = { x: 1, y: 2 };
scopes.begin(6989);
assert.equal(module.exports.shoreSpot(snapshot, 'us', water, { teams }), result);
scopes.end(); assert.equal(scopes.takeShoreInputs().length, 0);
scopes.begin(6990);
const parent = scopes.enter('script.run', 'us', 'v6Economy');
assert.equal(module.exports.shoreSpot(snapshot, 'us', water, { teams }), result);
const error = new Error('unchanged original exception');
assert.throws(() => module.exports.shoreSpot({ error }, 'us', water, { teams }, true), thrown => thrown === error);
scopes.leave(parent); scopes.end();
const inputs = scopes.takeShoreInputs();
assert.equal(inputs.length, 2); assert.equal(inputs[0]!.snapshot, snapshot);
assert.equal(inputs[0]!.scriptId, 'v6Economy'); assert.equal(inputs[0]!.sequence, 0);
assert.equal(inputs[0]!.despiteGuns, false); assert.equal(inputs[1]!.despiteGuns, true);
assert.notEqual(inputs[0]!.water, water); assert.notEqual(inputs[0]!.teams, teams);
assert.deepEqual(inputs[0]!.teams, teams); assert.deepEqual(teams, { us: 'a', foe: 'b' });
assert.equal(scopes.takeShoreInputs().length, 0);

const root = await mkdtemp('/workspace/six-player-structural-shore-tool/captures-');
const plain = await runProbe({ source, ticks: 31, out: join(root, 'plain'), plain: true });
const timed = await runProbe({ source, ticks: 31, out: join(root, 'focused'), focusTicks: [0, 15, 30], focusRadius: 0 });
const originalBytes = gunzipSync(await readFile(join(root, 'plain', 'command-frames.jsonl.gz')));
const capturedBytes = gunzipSync(await readFile(join(root, 'focused', 'command-frames.jsonl.gz')));
assert.equal(originalBytes.compare(capturedBytes), 0);
assert.equal(plain.commandLogSha256, timed.commandLogSha256);
assert.equal(timed.commandLogSha256, '728be47578cdbea79678a68cb2bbfd90402f1795ae9e55e6ad8c9ddbf632a417');
assert.equal(timed.commandLogBytes, 4085); assert.equal(timed.finalChecksum, 'b8473a1c');
assert.equal(plain.finalChecksum, timed.finalChecksum);
const shoreBytes = gunzipSync(await readFile(join(root, 'focused', 'shore-inputs.jsonl.gz')));
const fact = { source, root, completed: true, frames: 31, commandBytes: capturedBytes.length,
  commandSha256: sha(capturedBytes), checksum: timed.finalChecksum, inputCaptureBytes: shoreBytes.length,
  note: 'The first 31 ticks need not call shoreSpot. The synthetic actual-body contract separately proves selected capture/return/exception transparency. This is a probe smoke, not performance evidence.' };
await writeFile('/workspace/six-player-structural-shore-tool/contract-result.json', JSON.stringify(fact, null, 2));
console.log(JSON.stringify(fact, null, 2));
