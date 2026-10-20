/** Full-seat room FFA is primary. A/B are competing seat cohorts, never alliances. */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roomAbCases, type RoomAbVersion, type RoomAbCase } from '../src/ai/benchmark/room-ab';
import { AI_SCRIPT_VERSIONS } from '../src/ai/policy';
import { formatRoomAbCsv } from '../src/ai/benchmark/room-ab-csv';
import { summarizeRoomAbResponses } from '../src/ai/benchmark/room-ab-responses';
import { canonicalRoomAbClearings } from '../src/ai/benchmark/room-ab-clearings';
import { summarizeRoomAbPositions, ROOM_AB_POSITION_METRICS } from '../src/ai/benchmark/room-ab-position-report';
import { ROOM_BASELINE_MANIFEST } from '../src/ai/frozen/room-baseline';
import { runRoomAbMatch, sha, type RoomAbReport } from '../tools/ai/room-ab-run';
import type { GameSnapshot } from '../src/shared/types';
const args = process.argv.slice(2);
const arg = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const out = resolve(arg('--out') ?? 'work/room-ab');
const cache = resolve(arg('--cache') ?? 'work/room-baseline-646c/cache');
const selected = arg('--case');
const allowed = new Set(['room-baseline-646c', 'room-current', 'v2-prod', 'v9_archer', 'v9_summoner', 'v9_knight', ...Object.keys(AI_SCRIPT_VERSIONS)]);
function version(key: string, fallback: RoomAbVersion): RoomAbVersion {
  const value = arg(key) ?? fallback; if (!allowed.has(value)) throw new Error(`Unknown brain ${value}`); return value as RoomAbVersion;
}
let config = { a: version('--a', 'room-baseline-646c'), b: version('--b', 'room-current'),
  seeds: (arg('--seeds') ?? 'ab-0,ab-1,ab-2').split(','), minutes: Number(arg('--minutes') ?? 20),
  ...(arg('--maps') ? { maps: arg('--maps')!.split(',') } : {}),
  ...(arg('--modes') ? { modes: arg('--modes')!.split(',') as ('ffa' | 'duel')[] } : {}) };
if (config.modes?.some(mode => mode !== 'ffa' && mode !== 'duel')) throw new Error('modes must be ffa and/or duel');
let cases = roomAbCases(config);
if (args.includes('--reverse')) cases.reverse();
const files = ['scripts/ai-room-ab.ts', 'tools/ai/room-ab-run.ts', 'src/ai/benchmark/room-ab.ts',
  'src/ai/benchmark/room-ab-csv.ts', 'src/ai/benchmark/room-ab-responses.ts', 'src/ai/benchmark/room-ab-clearings.ts', 'src/ai/benchmark/room-ab-metrics.ts',
  'src/ai/benchmark/room-ab-position.ts', 'src/ai/benchmark/room-ab-position-report.ts', 'src/shared/sim/observation.ts', 'src/shared/sim.ts',
  'src/ai/benchmark/room-baseline-646c-context.ts', 'src/ai/benchmark/room-baseline-646c-memory.ts'];
const provenance = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDiffSha256: sha(execFileSync('git', ['diff', 'HEAD'], { encoding: 'utf8' })),
  files: Object.fromEntries(files.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
  node: process.version, host: hostname(), artifact: ROOM_BASELINE_MANIFEST.artifact };
const savedMatrix = args.includes('--summarize') ? JSON.parse(readFileSync(join(out, 'matrix.json'), 'utf8')) as
  { config: typeof config; cases: RoomAbCase[]; provenance: typeof provenance } : null;
if (savedMatrix) { config = savedMatrix.config; cases = savedMatrix.cases; }
const reportOut = savedMatrix ? resolve(arg('--report-out') ?? `${out}-report`) : out;
if (savedMatrix && selected) throw new Error('--summarize cannot run a match');
mkdirSync(reportOut, { recursive: true });
mkdirSync(out, { recursive: true });
if (selected) {
  const matrix = JSON.parse(readFileSync(join(out, 'matrix.json'), 'utf8')) as { cases: RoomAbCase[]; provenance: typeof provenance };
  if (sha(matrix.provenance) !== sha(provenance)) throw new Error('Source/provenance changed after matrix creation');
  const item = matrix.cases.find(item => item.name === selected); if (!item) throw new Error(`Unknown case ${selected}`);
  const folder = join(out, selected); if (existsSync(folder)) throw new Error('Refusing to overwrite a match');
  const report = await runRoomAbMatch({ item, out: folder, cache });
  console.log(JSON.stringify({ case: selected, tick: report.tick, winner: report.winner, reconciled: report.reconciled, elapsedMs: report.elapsedMs }));
} else {
  let results: { name: string; exit: number | null }[] = [];
  if (!savedMatrix) {
    writeFileSync(join(out, 'matrix.json'), JSON.stringify({ config, provenance, cases }, null, 2) + '\n', { flag: 'wx' });
    const workers = Number(arg('--workers') ?? 8);
    if (!Number.isSafeInteger(workers) || workers < 1 || workers > 32) throw new Error('workers must be 1..32');
    let index = 0, failed = false;
    await Promise.all(Array.from({ length: Math.min(workers, cases.length) }, async () => {
      while (!failed && index < cases.length) {
        const item = cases[index++]!;
        const exit = await new Promise<number | null>((done, reject) => {
          const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), ...args, '--case', item.name], { stdio: 'inherit' });
          child.on('error', reject); child.on('exit', done);
        });
        results.push({ name: item.name, exit }); failed ||= exit !== 0;
      }
    }));
    writeFileSync(join(out, 'matrix-status.json'), JSON.stringify({ results, complete: results.length === cases.length, failed }, null, 2) + '\n', { flag: 'wx' });
    if (failed) throw new Error('Match failed; all active children have finished and no further matches were started. See matrix-status.json');
  } else results = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')).results;
  const reports = cases.map(item => JSON.parse(readFileSync(join(out, item.name, 'summary.json'), 'utf8')) as RoomAbReport);
  if (results.length !== cases.length || results.some(r => r.exit !== 0) || reports.some((r, i) => sha(r.item) !== sha(cases[i])
    || r.artifactSha256 !== ROOM_BASELINE_MANIFEST.artifact.sha256 || !r.observed)) throw new Error('Incomplete or mismatched match evidence');
  // Normalize old raw observations too: a retained conquest can also clear a road camp.
  const guardAssociationAudit = reports.map(r => {
    const initial = JSON.parse(readFileSync(join(out, r.item.name, 'initial.json'), 'utf8')).snapshot as GameSnapshot;
    r.metrics = canonicalRoomAbClearings(r.metrics!, initial);
    return { case: r.item.name, associations: r.metrics.clearingAssociations };
  });
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
  const positions = summarizeRoomAbPositions(reports);
  const summary = { config, provenance: savedMatrix?.provenance ?? provenance, reportProvenance: provenance, results, primaryFfa: aggregate(reports.filter(r => r.item.mode === 'ffa')),
    positions,
    guardAssociationAudit,
    seatMetrics: reports.flatMap(r => r.item.seats.map(s => ({ case: r.item.name, owner: s.owner, side: s.side,
      rank: r.ranks![s.owner], ...r.metrics!.seats[s.owner]! }))),
    seatResponses: reports.flatMap(r => r.item.seats.map(s => ({ case: r.item.name, owner: s.owner, side: s.side,
      ...summarizeRoomAbResponses(r.metrics!.responses.filter(row => row.owner === s.owner)) }))),
    auxiliaryDuel: aggregate(reports.filter(r => r.item.seats.length === 2)),
    maps: cases.filter((c, i) => cases.findIndex(other => other.mapId === c.mapId) === i).map(c => ({ mapId: c.mapId,
      ffa: aggregate(reports.filter(r => r.item.mapId === c.mapId && r.item.mode === 'ffa')),
      duel: aggregate(reports.filter(r => r.item.mapId === c.mapId && r.item.seats.length === 2)) })),
    pairs, pairedWorldsEqual: pairs.every(p => p.initialEqual), symmetry: config.a === config.b ? pairs.every(p => Object.values(p).every(value => typeof value !== 'boolean' || value)) : null,
    reconciled: reports.every(r => r.reconciled && !r.errors.length) };
  writeFileSync(join(reportOut, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  const columns = ['case', 'mode', 'map', 'seed', 'rotation', 'owner', 'side', 'brain', 'family', 'race', 'tick', 'winner', 'rank', 'alive',
    'idleArmyUnitSeconds', 'abaSwitches', 'firstExpansion', 'firstIslandClearStart', 'firstIslandClearComplete', 'firstEnemySortie',
    'completed', 'completedBy15m', 'sitesDestroyed', 'sitesDestroyedWithArmyElsewhere', 'siteResponses', 'preemptions', 'pressureFraction', 'deaths', 'position'];
  const csv = formatRoomAbCsv([columns, ...reports.flatMap(r => r.item.seats.map(s => { const m = r.metrics!.seats[s.owner]!; return [r.item.name, r.item.mode, r.item.mapId, r.item.seed,
    r.item.rotation, s.owner, s.side, s.brain, s.family, s.race, r.tick, r.winner, r.ranks![s.owner], m.hasBuildings,
    m.idleArmyUnitSeconds, m.abaSwitches, m.firstExpansion, m.firstIslandClearStart, m.firstIslandClearComplete, m.firstEnemySortie,
    JSON.stringify(m.completed), JSON.stringify(m.completedBy15m), m.sitesDestroyed, m.sitesDestroyedWithArmyElsewhere,
    JSON.stringify(summarizeRoomAbResponses(r.metrics!.responses.filter(row => row.owner === s.owner))), m.preemptions === null ? 'unknown' : m.preemptions,
    m.pressureSeconds / m.observedSeconds, JSON.stringify(r.deathSummaries[s.owner]), JSON.stringify(r.position?.seats[s.owner] ?? null)]; }))]);
  writeFileSync(join(reportOut, 'seats.csv'), csv, { flag: 'wx' });
  if (positions.available) {
    writeFileSync(join(reportOut, 'position-games.csv'), formatRoomAbCsv([
      ['case', 'map', 'mode', 'timeout', 'metric', 'A', 'B', 'A_minus_B', 'winner'],
      ...positions.matches.flatMap(m => Object.entries(m.comparisons).map(([key, c]) =>
        [m.case, m.mapId, m.mode, m.timeout, key, JSON.stringify(c.a), JSON.stringify(c.b), c.delta, c.winner])),
    ]), { flag: 'wx' });
    writeFileSync(join(reportOut, 'position-pairs.csv'), formatRoomAbCsv([
      ['pair', 'map', 'mode', 'both_timeout', 'metric', 'paired_A_minus_B', 'winner', 'mirrored'],
      ...positions.pairs.flatMap(p => Object.entries(p.metrics).map(([key, m]) =>
        [p.pair, p.mapId, p.mode, p.timeoutPair, key, m.delta, m.winner, m.mirror])),
    ]), { flag: 'wx' });
    writeFileSync(join(reportOut, 'position-maps.csv'), formatRoomAbCsv([
      ['map', 'scope', 'metric', 'higher_is_better', 'games', 'A_wins', 'B_wins', 'ties', 'unavailable', 'pairs',
        'finite_pairs', 'mean_paired_A_minus_B', 'min_paired_A_minus_B', 'max_paired_A_minus_B', 'A_pair_wins', 'B_pair_wins', 'pair_ties'],
      ...positions.maps.flatMap(m => (['timeoutFfa', 'allEndFfa', 'auxiliaryDuel'] as const).flatMap(scope =>
        Object.entries(m[scope].metrics).map(([key, v]) => [m.mapId, scope, key, v.higherIsBetter, m[scope].games,
          v.games.aWins, v.games.bWins, v.games.ties, v.games.unavailable, m[scope].pairs, v.finitePairs,
          v.meanPairedDelta, v.minPairedDelta, v.maxPairedDelta, v.paired.aWins, v.paired.bWins, v.paired.ties]))),
    ]), { flag: 'wx' });
    if (Object.keys(positions.allEndFfa.metrics).length !== Object.keys(ROOM_AB_POSITION_METRICS).length) throw new Error('Missing metric');
  } else console.warn('Position metrics unavailable in older evidence; rerun matches to record mining deliveries and terminal assets.');
  const positionSymmetry = positions.available && config.a === config.b ? positions.mirrored && positions.finitePairedDeltasZero : null;
  console.log(JSON.stringify({ primaryFfa: summary.primaryFfa, auxiliaryDuel: summary.auxiliaryDuel, symmetry: summary.symmetry,
    positionSymmetry, reconciled: summary.reconciled }));
  if (!summary.reconciled || !summary.pairedWorldsEqual || summary.symmetry === false || positionSymmetry === false) process.exitCode = 1;
}
