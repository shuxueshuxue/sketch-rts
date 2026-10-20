import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flag, requiredFlag } from './benchmark-cli';

// Actual room host, pool, protocol, host and worker entry. Only the planner
// import in the measured worker is redirected to the opt-in decision boundary.
// The unmodified server otherwise leaves this observation feature disabled.
const args = process.argv.slice(2), root = resolve(requiredFlag(args, 'source-root'));
const out = resolve(requiredFlag(args, 'out')), ticks = Number(flag(args, 'ticks') ?? 18000);
if (!Number.isInteger(ticks) || ticks < 1) throw new Error('ticks must be a positive integer');
mkdirSync(out, { recursive: true });
const load = (file: string) => import(pathToFileURL(resolve(root, 'src', file)).href);
const { createRoomHost } = await load('server/room-host.ts');
const { createAiThinkPool } = await load('ai/think-worker/node-pool.ts');
const { poolMap } = await load('shared/map-pool.ts');
const decisionPath = resolve(root, 'src/ai/strategy-decision-planner.ts');
const observed = existsSync(decisionPath);
const quote = JSON.stringify;
const bridge = resolve(out, 'measurement-bridge.ts');
writeFileSync(bridge, `import { threadId } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { planAiCommandFrameFromSnapshot as ordinary } from ${quote(resolve(root, 'src/ai/runtime.ts'))};
${observed ? `import { planAiOwnerCommandEntriesWithDecision } from ${quote(decisionPath)};
import { normalizeCommandFrameEntries } from ${quote(resolve(root, 'src/shared/sim/command-frame-runtime.ts'))};` : ''}
writeFileSync(${quote(out)} + '/worker-' + threadId + '.json', JSON.stringify({threadId,pid:process.pid,observed:${observed},root:${quote(root)}}));
export function planAiCommandFrameFromSnapshot(snapshot, requests, options) {
  ${observed ? `if (snapshot.match.winner) return {commands:[]};
  const commands=[];
  for (const request of requests) commands.push(...planAiOwnerCommandEntriesWithDecision(snapshot,request,options).commands);
  return {commands:normalizeCommandFrameEntries(commands)};` : 'return ordinary(snapshot,requests,options);'}
}
`);
const workerEntry = resolve(root, 'src/ai/think-worker/node-entry.ts'), workerBundle = resolve(out, 'measured-worker.mjs');
const originalHost = resolve(root, 'src/ai/think-worker/host.ts');
const replacement = 'import { planAiCommandFrameFromSnapshot } from "../runtime";';
const originalText = readFileSync(originalHost, 'utf8');
if (originalText.split(replacement).length !== 2) throw new Error('Host planner boundary changed; update the measured import explicitly');
await build({ entryPoints: [workerEntry], outfile: workerBundle, bundle: true, platform: 'node', format: 'esm', target: 'node24',
  plugins: [{ name: 'measured-planner-import', setup(api) {
    api.onLoad({ filter: /\/think-worker\/host\.ts$/ }, () => ({ loader: 'ts', resolveDir: resolve(root, 'src/ai/think-worker'),
      contents: originalText.replace(replacement, `import { planAiCommandFrameFromSnapshot } from ${quote(bridge)};`) }));
  } }] });
const pool = createAiThinkPool({ threads: 4, workerUrl: pathToFileURL(workerBundle), execArgv: [] });
const host = createRoomHost({ autoTick: true, aiThinkExecutor(runtime: any, game: any) {
  const executor = pool.executor(runtime, game);
  // All eight rooms submit at the same tick, then await their real worker at
  // the delivery tick. This removes machine-load-dependent late commands while
  // preserving the production pool/session/room allocation topology.
  return { ...executor, take(tick: number) { return executor.take(tick, true); } };
} });
const maps = ['grandEstuary', 'sapphireArchipelago', 'twoShores', 'turtleLake'];
const rooms: string[] = [], frameHashes = new Map<string, ReturnType<typeof createHash>>();
const finalFrames = new Map<string, { tick: number; checksum?: string }>();
const setup: unknown[] = [];
for (let copy = 0; copy < 2; copy++) for (const mapId of maps) {
  const map = poolMap(mapId), id = `strategy-room-${mapId}-${copy}`;
  const room = host.createRoom({ id, host: { id: `human-${id}`, name: 'Idle human' }, mapId, slotCount: map.players,
    layoutSeed: map.layout.seed, visibility: 'private', seatSetup: Array.from({ length: map.players }, (_, index) => ({
      controller: index ? 'ai' : 'human', team: map.layout.kind === 'sides' ? `team-${index % 2 + 1}` : 'ffa',
      race: index % 2 ? 'grove' : 'ember', aiVersion: 'v9_archer',
    })) });
  frameHashes.set(id, createHash('sha256'));
  host.observeRoomFrames(id, (event: any) => {
    frameHashes.get(id)!.update(JSON.stringify(event.frame) + '\n');
    finalFrames.set(id, { tick: event.tick, ...(event.checksum ? { checksum: event.checksum } : {}) });
  });
  host.startRoom(id); rooms.push(id); setup.push({ id, mapId, slots: room.slots, layoutSeed: map.layout.seed });
}
const started = performance.now();
try {
  for (let tick = 0; tick < ticks; tick++) {
    host.tickActiveRooms(1);
    for (const id of rooms) if (host.getRoom(id).status === 'errored') throw new Error(`Room ${id} errored at ${tick}`);
    if ((tick + 1) % 3000 === 0) console.log(JSON.stringify({ tick: tick + 1, rss: process.memoryUsage().rss }));
  }
  const maxRssKiB = process.resourceUsage().maxRSS;
  const outcomes = rooms.map(id => ({ id, status: host.getRoom(id).status, ...(finalFrames.get(id) ?? {}),
    ...(host.getRoom(id).status === 'inMatch' ? { tick: host.currentTick(id), checksum: host.checksumRoom(id) } : {}),
    frameSha256: frameHashes.get(id)!.digest('hex') }));
  const workers = readdirSync(out).filter(file => /^worker-\d+\.json$/.test(file)).map(file => JSON.parse(readFileSync(resolve(out, file), 'utf8')));
  if (workers.length !== 4) throw new Error(`Expected four actual worker isolates, got ${workers.length}`);
  const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const receipt = { root, observed, node: process.version, host: hostname(), pid: process.pid, ticks, roomCount: rooms.length,
    workerCount: workers.length, workers, elapsedMs: performance.now() - started, maxRssKiB, memory: process.memoryUsage(),
    recorderFile: fileURLToPath(import.meta.url), recorderSha256: sha(fileURLToPath(import.meta.url)),
    workerHostFile: originalHost, workerHostSha256: sha(originalHost), workerBundleSha256: sha(workerBundle),
    scheduling: 'production rooms/pool; settle at delivery tick; idle human plus default room AI', setup, outcomes };
  writeFileSync(resolve(out, 'summary.json'), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
} finally { await pool.close(); }
