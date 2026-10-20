import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

// Fresh process, no previous trace. Snapshots are the continuation of the exact
// recorded command stream; only the selected owner's saved memory is restored.
const [source, input, output, warm] = process.argv.slice(2);
if (!source || !input || !output) throw new Error('Expected source-root fork.json.gz receipt.json [warm]');
const load = (path: string) => import(pathToFileURL(resolve(source, 'src', path)).href);
const { planAiOwnerCommandEntriesWithTrace } = await load('ai/plan-trace-planner.ts');
const { evaluateSituation } = await load('ai/strategy/situation.ts');
const { setBuildingBodies } = await load('shared/terrain.ts');
const { standingBodies } = await load('shared/structure-bodies.ts');
const packet = JSON.parse(gunzipSync(readFileSync(input)).toString());
if (!packet.frames.length || !packet.memory) throw new Error('Empty fork recording');
const memory = packet.memory, hash = createHash('sha256');
if (warm) {
  const first = packet.frames[0]; setBuildingBodies(first.snapshot.map, standingBodies(first.snapshot));
  for (const other of Object.keys(first.snapshot.players).filter(other => other !== first.owner))
    evaluateSituation(first.snapshot, other, { jobs: [], unitClaims: {} });
}
for (const frame of packet.frames) {
  const result = planAiOwnerCommandEntriesWithTrace(frame.snapshot,
    { playerId: frame.owner, source: frame.source, version: frame.version, memory }, { teams: frame.snapshot.teams });
  for (const [name, actual, expected] of [['commands', result.commands, frame.commands],
    ['strategy', result.trace.strategy, frame.strategy], ['observation', memory.strategy, frame.observation]]) {
    const bytes = JSON.stringify(actual);
    if (bytes !== JSON.stringify(expected)) throw new Error(`${name} differs at ${frame.snapshot.tick}:${frame.owner}`);
    hash.update(bytes + '\n');
  }
}
const receipt = { source: resolve(source), input, warm: Boolean(warm),
  fromTick: packet.frames[0].snapshot.tick, toTick: packet.frames.at(-1).snapshot.tick,
  frames: packet.frames.length, commands: 'byte-identical', strategy: 'byte-identical', observation: 'byte-identical',
  sha256: hash.digest('hex') };
writeFileSync(output, JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
