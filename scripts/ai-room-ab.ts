/** Full-seat room FFA is primary. A/B are competing seat cohorts, never alliances. */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roomAbCases, type RoomAbVersion, type RoomAbCase } from '../src/ai/benchmark/room-ab';
import { AI_SCRIPT_VERSIONS } from '../src/ai/policy';
import { ROOM_BASELINE_MANIFEST } from '../src/ai/frozen/room-baseline';
import { runRoomAbMatch, sha, type RoomAbReport } from '../tools/ai/room-ab-run';
const args = process.argv.slice(2);
const arg = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const out = resolve(arg('--out') ?? 'work/room-ab');
const cache = resolve(arg('--cache') ?? 'work/room-baseline-646c/cache');
const selected = arg('--case');
const allowed = new Set(['room-baseline-646c', 'room-current', 'v2-prod', 'v9_archer', 'v9_summoner', 'v9_knight', ...Object.keys(AI_SCRIPT_VERSIONS)]);
function version(key: string, fallback: RoomAbVersion): RoomAbVersion {
  const value = arg(key) ?? fallback; if (!allowed.has(value)) throw new Error(`Unknown brain ${value}`); return value as RoomAbVersion;
}
const config = { a: version('--a', 'room-baseline-646c'), b: version('--b', 'room-current'),
  seeds: (arg('--seeds') ?? 'ab-0,ab-1,ab-2').split(','), minutes: Number(arg('--minutes') ?? 20),
  ...(arg('--maps') ? { maps: arg('--maps')!.split(',') } : {}),
  ...(arg('--modes') ? { modes: arg('--modes')!.split(',') as ('ffa' | 'duel')[] } : {}) };
if (config.modes?.some(mode => mode !== 'ffa' && mode !== 'duel')) throw new Error('modes must be ffa and/or duel');
const cases = roomAbCases(config);
const files = ['scripts/ai-room-ab.ts', 'tools/ai/room-ab-run.ts', 'src/ai/benchmark/room-ab.ts',
  'src/ai/benchmark/room-ab-metrics.ts', 'src/ai/benchmark/room-baseline-646c-context.ts', 'src/ai/benchmark/room-baseline-646c-memory.ts'];
const provenance = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDiffSha256: sha(execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8' })),
  files: Object.fromEntries(files.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
  node: process.version, host: hostname(), artifact: ROOM_BASELINE_MANIFEST.artifact };
mkdirSync(out, { recursive: true });
if (selected) {
  const matrix = JSON.parse(readFileSync(join(out, 'matrix.json'), 'utf8')) as { cases: RoomAbCase[]; provenance: typeof provenance };
  if (sha(matrix.provenance) !== sha(provenance)) throw new Error('Source/provenance changed after matrix creation');
  const item = matrix.cases.find(item => item.name === selected); if (!item) throw new Error(`Unknown case ${selected}`);
  const folder = join(out, selected); if (existsSync(folder)) throw new Error('Refusing to overwrite a match');
  const report = await runRoomAbMatch({ item, out: folder, cache });
  console.log(JSON.stringify({ case: selected, tick: report.tick, winner: report.winner, reconciled: report.reconciled, elapsedMs: report.elapsedMs }));
} else {
  writeFileSync(join(out, 'matrix.json'), JSON.stringify({ config, provenance, cases }, null, 2) + '\n', { flag: 'wx' });
  const workers = Number(arg('--workers') ?? 8);
  if (!Number.isSafeInteger(workers) || workers < 1 || workers > 32) throw new Error('workers must be 1..32');
  let index = 0; const results: { name: string; exit: number | null }[] = [];
  await Promise.all(Array.from({ length: Math.min(workers, cases.length) }, async () => {
    while (index < cases.length) {
      const item = cases[index++]!;
      const exit = await new Promise<number | null>((done, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), ...args, '--case', item.name], { stdio: 'inherit' });
        child.on('error', reject); child.on('exit', done);
      });
      results.push({ name: item.name, exit }); if (exit !== 0) throw new Error(`${item.name} exited ${exit}`);
    }
  }));
  const reports = cases.map(item => JSON.parse(readFileSync(join(out, item.name, 'summary.json'), 'utf8')) as RoomAbReport);
  function aggregate(group: RoomAbReport[]) {
    return { games: group.length, decisive: group.filter(r => r.winner).length, timeouts: group.filter(r => !r.winner).length,
      cohorts: Object.fromEntries((['A', 'B'] as const).map(side => {
        const rows = group.flatMap(r => r.item.seats.filter(s => s.side === side).map(s => ({ r, s, m: r.metrics!.seats[s.owner]! })));
        const average = (fn: (row: typeof rows[number]) => number) => rows.reduce((sum, row) => sum + fn(row), 0) / rows.length;
        return [side, { seats: rows.length, wins: rows.filter(({ r, s }) => r.winner === s.owner).length,
          meanRank: average(({ r, s }) => r.ranks![s.owner]!), normalizedRank: average(({ r, s }) => (r.ranks![s.owner]! - 1) / (r.item.seats.length - 1)),
          survivalRate: average(({ m }) => Number(m.hasBuildings)), buildingPresenceSeconds: average(({ m }) => m.buildingPresenceSeconds),
          idleArmyUnitSeconds: average(({ m }) => m.idleArmyUnitSeconds), abaSwitches: average(({ m }) => m.abaSwitches),
          pressureFraction: average(({ m }) => m.pressureSeconds / m.observedSeconds) }];
      })) };
  }
  const pairs = [...new Set(cases.map(c => c.pair))].map(pair => {
    const [left, right] = reports.filter(r => r.item.pair === pair);
    return { pair, initialEqual: left!.initialSha256 === right!.initialSha256,
      commandEqual: left!.commandSha256 === right!.commandSha256, plannedEqual: left!.plannedSha256 === right!.plannedSha256,
      snapshotEqual: left!.snapshotSha256 === right!.snapshotSha256, memoryEqual: left!.memorySha256 === right!.memorySha256 };
  });
  const summary = { config, provenance, results, primaryFfa: aggregate(reports.filter(r => r.item.mode === 'ffa')),
    auxiliaryDuel: aggregate(reports.filter(r => r.item.seats.length === 2)),
    maps: cases.filter((c, i) => cases.findIndex(other => other.mapId === c.mapId) === i).map(c => ({ mapId: c.mapId,
      ffa: aggregate(reports.filter(r => r.item.mapId === c.mapId && r.item.mode === 'ffa')),
      duel: aggregate(reports.filter(r => r.item.mapId === c.mapId && r.item.seats.length === 2)) })),
    pairs, symmetry: config.a === config.b ? pairs.every(p => Object.values(p).every(value => typeof value !== 'boolean' || value)) : null,
    reconciled: reports.every(r => r.reconciled && !r.errors.length) };
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  const columns = ['case', 'mode', 'map', 'seed', 'rotation', 'owner', 'side', 'brain', 'family', 'race', 'tick', 'winner', 'rank', 'alive',
    'idleArmyUnitSeconds', 'abaSwitches', 'firstExpansion', 'firstIslandClearStart', 'firstIslandClearComplete', 'firstEnemySortie', 'completed', 'sitesDestroyed', 'pressureFraction', 'deaths'];
  const csv = [columns, ...reports.flatMap(r => r.item.seats.map(s => { const m = r.metrics!.seats[s.owner]!; return [r.item.name, r.item.mode, r.item.mapId, r.item.seed,
    r.item.rotation, s.owner, s.side, s.brain, s.family, s.race, r.tick, r.winner, r.ranks![s.owner], m.hasBuildings,
    m.idleArmyUnitSeconds, m.abaSwitches, m.firstExpansion, m.firstIslandClearStart, m.firstIslandClearComplete, m.firstEnemySortie,
    JSON.stringify(m.completed), m.sitesDestroyed, m.pressureSeconds / m.observedSeconds, JSON.stringify(r.deathSummaries[s.owner])]; }))]
    .map(row => row.map(value => JSON.stringify(String(value ?? ''))).join(',')).join('\n');
  writeFileSync(join(out, 'seats.csv'), csv + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ primaryFfa: summary.primaryFfa, auxiliaryDuel: summary.auxiliaryDuel, symmetry: summary.symmetry, reconciled: summary.reconciled }));
  if (!summary.reconciled || summary.symmetry === false) process.exitCode = 1;
}
