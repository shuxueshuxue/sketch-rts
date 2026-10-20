/** Shadow comparison against an immutable source tree. Never drives the world with the shadow's commands. */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadRoomBaseline, ROOM_BASELINE_MANIFEST } from '../src/ai/frozen/room-baseline';
import type { AiPolicyMemory } from '../src/ai/memory';
import type { SdkCommandSource } from '../src/sdk/game-runner';
import type { BootstrapAiVersion, GameSnapshot, RaceId } from '../src/shared/types';

const args = process.argv.slice(2);
const arg = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const reference = resolve(arg('--reference') ?? '.');
const cache = resolve(arg('--cache') ?? 'work/room-baseline-646c/cache');
const out = resolve(arg('--out') ?? 'work/room-baseline-646c/parity');
const ticks = Number(arg('--ticks') ?? 6000);
if (!Number.isSafeInteger(ticks) || ticks < 1) throw new Error('ticks must be a positive integer');
mkdirSync(out, { recursive: true });
const maps = ['brokenSea', 'greystonePass', 'gullIsland', 'pineshade', 'reedwater', 'ringwater',
  'sapphireArchipelago', 'templeSpring', 'turtleLake', 'twoShores', 'veiledHill'];
const families = ROOM_BASELINE_MANIFEST.families as BootstrapAiVersion[];
const fixtures = ['ring-beachhead-15m.json', 'temple-beachhead-15m.json', 'broken-beachhead-15m.json',
  'sapphire-beachhead-15m.json', 'summoner-active-sortie-9m26.json', 'knight-territory-10m.json',
  'defense-worker-32m36.json', 'executor-broken-sea-9585.json.gz'];
type Case = { name: string; map?: string; family?: BootstrapAiVersion; race?: RaceId; fixture?: string;
  fixtureVersions?: Record<string, BootstrapAiVersion>; versionProvenance?: string };
const cases: Case[] = [...maps.flatMap(map => families.flatMap(family => (['grove', 'ember'] as const)
  .map(race => ({ name: `${map}-${family}-${race}`, map, family, race })))),
  ...fixtures.map(fixture => ({ name: fixture.replace(/\.json(?:\.gz)?$/, ''), fixture,
    ...(fixture === 'defense-worker-32m36.json' ? { fixtureVersions: { v9_knight: 'v9_knight' as const },
      versionProvenance: 'src/ai/bootstrap_1/worker-safety.test.ts:31' } : {}) }))];
if (args.includes('--reverse')) cases.reverse();
const selected = arg('--case');
if (existsSync(join(out, selected ? `${selected}.json` : 'matrix.json')) || selected && existsSync(join(out, `${selected}-mismatch.json`)))
  throw new Error('Refusing to overwrite previous parity evidence; select a fresh output directory');
if (!selected) {
  const workers = Number(arg('--workers') ?? 4);
  if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('workers must be a positive integer');
  let index = 0;
  const results: { name: string; exit: number | null }[] = [];
  await Promise.all(Array.from({ length: Math.min(workers, cases.length) }, async () => {
    while (index < cases.length) {
      const item = cases[index++]!;
      const status = await new Promise<number | null>((done, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), ...args, '--case', item.name], { stdio: 'inherit' });
        child.on('error', reject); child.on('exit', done);
      });
      results.push({ name: item.name, exit: status });
      if (status !== 0) throw new Error(`Parity failed: ${item.name}, exit ${status}`);
    }
  }));
  const report = { sourceCommit: ROOM_BASELINE_MANIFEST.sourceCommit, artifact: ROOM_BASELINE_MANIFEST.artifact,
    ticks, cases: results.sort((a, b) => a.name.localeCompare(b.name)), passed: results.length };
  writeFileSync(join(out, 'matrix.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} else {
  const item = cases.find(item => item.name === selected);
  if (!item) throw new Error(`Unknown case ${selected}`);
  const from = (path: string) => pathToFileURL(join(reference, path)).href;
  const { runAiGameLoop } = await import(from('src/ai/game-runner.ts')) as typeof import('../src/ai/game-runner');
  const { planAiOwnerCommandEntries, createAiMemoryProvider } = await import(from('src/ai/planner-context.ts')) as typeof import('../src/ai/planner-context');
  const { createRoom, roomToGameSetup } = await import(from('src/shared/rooms.ts')) as typeof import('../src/shared/rooms');
  const { MAP_POOL } = await import(from('src/shared/map-pool.ts')) as typeof import('../src/shared/map-pool');
  const referenceSha = execFileSync('git', ['-C', reference, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (referenceSha !== ROOM_BASELINE_MANIFEST.sourceCommit) throw new Error(`Reference must be checked out at ${ROOM_BASELINE_MANIFEST.sourceCommit}`);
  execFileSync('git', ['-C', reference, 'diff', '--exit-code', 'HEAD', '--', 'src', 'package-lock.json']);
  const bundle = await loadRoomBaseline(cache);
  const memories: Record<string, AiPolicyMemory> = {};
  let frozen = bundle.createRoomPlanner(), count = 0, commands = 0;
  const provider = createAiMemoryProvider(memories), digest = createHash('sha256'), memoryDigest = createHash('sha256');
  const stickyMaps: { reference?: GameSnapshot['map']; frozen?: GameSnapshot['map'] } = {};
  const input = (snapshot: GameSnapshot, side: 'reference' | 'frozen') => {
    const map = stickyMaps[side] ??= structuredClone(snapshot.map);
    for (const key of Object.keys(map)) if (key !== 'terrain' && key !== 'landmarks') delete (map as Record<string, unknown>)[key];
    Object.assign(map, Object.fromEntries(Object.entries(snapshot.map).filter(([key]) => key !== 'terrain' && key !== 'landmarks')));
    return { ...structuredClone({ ...snapshot, map: undefined }), map } as GameSnapshot;
  };
  const compare = (snapshot: GameSnapshot, owner: string, version: BootstrapAiVersion, source: SdkCommandSource) => {
    const leftInput = input(snapshot, 'reference'), rightInput = input(snapshot, 'frozen');
    const request = { playerId: owner, source, version };
    const left = planAiOwnerCommandEntries(leftInput, request, { memoryProvider: provider, ...(snapshot.teams ? { teams: snapshot.teams } : {}) });
    const right = frozen.plan(rightInput, request);
    const a = JSON.stringify(left), b = JSON.stringify(right), ma = JSON.stringify(memories[owner]), mb = JSON.stringify(frozen.memory(owner));
    if (a !== b || ma !== mb) {
      writeFileSync(join(out, `${selected}-mismatch.json`), JSON.stringify({ tick: snapshot.tick, owner, request, snapshot,
        reference: left, frozen: right, referenceMemory: memories[owner], frozenMemory: frozen.memory(owner) }));
      throw new Error(`${selected}: byte mismatch at ${snapshot.tick}/${owner}: commands=${a === b}, memory=${ma === mb}`);
    }
    digest.update(JSON.stringify({ tick: snapshot.tick, owner, entries: left }) + '\n');
    memoryDigest.update(ma ?? 'undefined'); count++; commands += left.length;
    return left;
  };
  let finalTick: number, initialTick = 0, finalSnapshot: GameSnapshot;
  if (item.fixture) {
    const bytes = readFileSync(join(reference, 'src/ai/bootstrap_1/fixtures', item.fixture));
    const saved = JSON.parse((item.fixture.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString());
    const snapshot = saved.snapshot as GameSnapshot;
    const savedMemories = saved.memories ?? (saved.owner ? { [saved.owner]: saved.beforeMemory } : {});
    Object.assign(memories, structuredClone(savedMemories));
    frozen = bundle.createRoomPlanner(savedMemories);
    const versions = saved.versions ?? item.fixtureVersions ?? Object.fromEntries(Object.entries(saved.agents ?? {}).map(([owner, agent]: [string, any]) => [owner, agent.policyVersion ?? agent.version]));
    if (saved.owner) versions[saved.owner] = saved.version;
    for (const [owner, version] of Object.entries(versions)) if (families.includes(version as BootstrapAiVersion))
      compare(snapshot, owner, version as BootstrapAiVersion, 'internal-ai');
    if (count === 0) throw new Error(`Fixture did not compare any room planners: ${item.fixture}`);
    initialTick = finalTick = snapshot.tick; finalSnapshot = snapshot;
  } else {
    const map = MAP_POOL.find(map => map.id === item.map)!;
    const room = createRoom({ id: `freeze-parity-${map.id}`, host: { id: 'parity-host', name: 'Parity' }, mapId: map.id,
      humanCount: 1, aiCount: map.players - 1, seatSetup: Array.from({ length: map.players }, () =>
        ({ controller: 'ai', race: item.race!, team: 'ffa', aiVersion: item.family! })) });
    const setup = roomToGameSetup(room);
    const agents = Object.fromEntries(setup.playerSlots.map(slot => [slot.playerId,
      { controller: 'internal-ai' as const, version: item.family!, race: slot.race, team: setup.options.teams![slot.playerId]! }]));
    const loop = runAiGameLoop({ name: selected, mapId: setup.mapId, options: setup.options, agents, maxTicks: ticks, thinkInterval: 15,
      commandPlanner({ snapshot, owner, source }) { return compare(snapshot, owner, item.family!, source); } });
    finalSnapshot = loop.snapshot; finalTick = loop.snapshot.tick;
    if (finalTick !== ticks) throw new Error(`Expected ${ticks} ticks, match ended at ${finalTick}`);
  }
  const report = { sourceCommit: ROOM_BASELINE_MANIFEST.sourceCommit, artifactSha256: ROOM_BASELINE_MANIFEST.artifact.sha256,
    driverSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
    host: hostname(), node: process.version, platform: process.platform,
    ...item, initialTick, finalTick, thinks: count, commands, commandSha256: digest.digest('hex'), memorySha256: memoryDigest.digest('hex'),
    snapshotSha256: createHash('sha256').update(JSON.stringify(finalSnapshot)).digest('hex'), byteEqual: true, memoryEqual: true };
  writeFileSync(join(out, `${selected}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
