/** Fresh-process counterfactual replays on one exact snapshot stream, never different opponent worlds. */
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, openSync, writeSync, closeSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { loadRoomBaseline } from '../src/ai/frozen/room-baseline';
import { createAiMemoryProvider, planAiOwnerCommandEntries } from '../src/ai/planner-context';
import type { AiPolicyMemory } from '../src/ai/memory';
import { roomAbCases } from '../src/ai/benchmark/room-ab';
import type { BootstrapAiVersion, GameSnapshot } from '../src/shared/types';
import { runRoomAbMatch, sha } from '../tools/ai/room-ab-run';
const args = process.argv.slice(2), arg = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const out = resolve(arg('--out') ?? 'work/room-ab-isolation'), cache = resolve(arg('--cache') ?? 'work/room-baseline-646c/cache');
const arm = arg('--arm'), selected = arg('--map'), maps = ['greystonePass', 'sapphireArchipelago'];
const script = fileURLToPath(import.meta.url);
if (!arm && !selected) {
  if (existsSync(out)) throw new Error('Select a fresh evidence directory');
  mkdirSync(out, { recursive: true });
  for (const map of maps) for (const mode of ['record', 'plain', 'interposed', 'unobserved'])
    execFileSync(process.execPath, ['--import', 'tsx', script, ...args, '--map', map, '--arm', mode], { stdio: 'inherit' });
  const cases = maps.map(map => {
    const load = (name: string) => JSON.parse(readFileSync(join(out, map, `${name}.json`), 'utf8'));
    const record = load('record'), plain = load('plain'), interposed = load('interposed'), unobserved = load('unobserved');
    const equal = ['plannedSha256', 'commandSha256', 'snapshotSha256', 'canonicalSha256', 'checksum', 'memorySha256']
      .every(key => record[key] === unobserved[key]);
    return { map, baselineInputChecks: record.inputChecks, sameObjectProbeChecks: record.sameObjectProbeChecks,
      livePlain: plain, liveInterposed: interposed, observerOnOffEqual: equal };
  });
  const pass = cases.every(c => c.baselineInputChecks > 0 && c.sameObjectProbeChecks > 0
    && c.livePlain.equal && c.liveInterposed.equal && c.observerOnOffEqual);
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ pass, cases }, null, 2) + '\n');
  if (!pass) throw new Error('Isolation verification failed');
} else {
  if (!selected || !maps.includes(selected) || !['record', 'plain', 'interposed', 'unobserved'].includes(arm ?? '')) throw new Error('Unknown isolation map/arm');
  const dir = join(out, selected); mkdirSync(dir, { recursive: true });
  const item = roomAbCases({ a: 'room-baseline-646c', b: 'room-current', seeds: ['isolation-646c'], minutes: 15,
    maps: [selected], modes: ['ffa'] })[0]!;
  if (arm === 'record' || arm === 'unobserved') {
    let corpus: number | undefined;
    let count = 0;
    const probe = (await loadRoomBaseline(cache)).createRoomPlanner();
    if (arm === 'record') corpus = openSync(join(dir, 'corpus.jsonl'), 'wx');
    const report = await runRoomAbMatch({ item, cache, out: join(dir, arm), maxTicks: 6000,
      observed: arm === 'record', probeInputs: arm === 'record', onThink(row) {
        if (arm !== 'record' || row.baseline) return;
        const snapshot = row.snapshot;
        const before = { snapshot: sha(snapshot), map: sha(snapshot.map) };
        // The very same object already used by the live planner is handed to an isolated frozen probe.
        probe.plan(snapshot, { playerId: row.owner, version: row.family, source: 'internal-ai' });
        if (before.snapshot !== sha(snapshot) || before.map !== sha(snapshot.map)) throw new Error('Same-object frozen probe mutated input');
        if (count === 0) writeSync(corpus!, JSON.stringify({ map: snapshot.map }) + '\n');
        const { terrain: _terrain, landmarks: _landmarks, ...dynamicMap } = snapshot.map;
        writeSync(corpus!, JSON.stringify({ owner: row.owner, family: row.family, snapshot: { ...snapshot, map: dynamicMap },
          entries: row.entries, memorySha256: sha(row.memory) }) + '\n'); count++;
      } });
    if (corpus !== undefined) {
      closeSync(corpus);
      await pipeline(createReadStream(join(dir, 'corpus.jsonl')), createGzip({ level: 3 }), createWriteStream(join(dir, 'corpus.jsonl.gz'), { flags: 'wx' }));
      unlinkSync(join(dir, 'corpus.jsonl'));
    }
    writeFileSync(join(dir, `${arm}.json`), JSON.stringify({ ...report, sameObjectProbeChecks: count }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ map: selected, arm, tick: report.tick, inputChecks: report.inputChecks, sameObjectProbeChecks: count }));
  } else {
    const memories: Record<string, AiPolicyMemory> = {}, provider = createAiMemoryProvider(memories);
    const probe = arm === 'interposed' ? (await loadRoomBaseline(cache)).createRoomPlanner() : null;
    const lines = createInterface({ input: createReadStream(join(dir, 'corpus.jsonl.gz')).pipe(createGunzip()), crlfDelay: Infinity });
    let map: GameSnapshot['map'] | undefined, count = 0, inputChecks = 0;
    for await (const line of lines) {
      const row = JSON.parse(line) as { map?: GameSnapshot['map']; owner: string; family: BootstrapAiVersion;
        snapshot: GameSnapshot; entries: unknown; memorySha256: string };
      if (row.map) { map = row.map; continue; }
      if (!map) throw new Error('Corpus has no static map');
      // Keep stable map identity within each arm, as the hosted room does.
      for (const key of Object.keys(map)) if (key !== 'terrain' && key !== 'landmarks') delete (map as Record<string, unknown>)[key];
      Object.assign(map, row.snapshot.map); row.snapshot.map = map;
      const frozenCall = () => {
        const before = { snapshot: sha(row.snapshot), map: sha(map) };
        probe!.plan(row.snapshot, { playerId: row.owner, version: row.family, source: 'internal-ai' });
        if (before.snapshot !== sha(row.snapshot) || before.map !== sha(map)) throw new Error(`Replay probe mutated input at ${row.snapshot.tick}`);
        inputChecks++;
      };
      if (probe && count % 2 === 0) frozenCall();
      const entries = planAiOwnerCommandEntries(row.snapshot, { playerId: row.owner, version: row.family, source: 'internal-ai' },
        { memoryProvider: provider, teams: row.snapshot.teams ?? {} });
      if (probe && count % 2 === 1) frozenCall();
      if (JSON.stringify(entries) !== JSON.stringify(row.entries) || sha(memories[row.owner]) !== row.memorySha256)
        throw new Error(`${arm}: live replay mismatch at ${row.snapshot.tick}/${row.owner}`);
      count++;
    }
    writeFileSync(join(dir, `${arm}.json`), JSON.stringify({ equal: true, thinks: count, inputChecks, byteComparison: 'every-command-and-memory-on-the-identical-mixed-match-snapshot-stream' }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ map: selected, arm, equal: true, thinks: count, inputChecks }));
  }
}
