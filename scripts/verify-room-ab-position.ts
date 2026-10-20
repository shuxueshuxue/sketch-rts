/** Reconcile raw native events, death ledger and terminal snapshots without rerunning either planner. */
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip, gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BUILDING_DEFS, UNIT_DEFS } from '../src/shared/catalog';
import { roomAbMinePositions, type RoomAbPositionEvent } from '../src/ai/benchmark/room-ab-position';
import type { RoomAbReport } from '../tools/ai/room-ab-run';
import type { AiUnitDeathRecord } from '../src/ai/death-ledger-types';
import type { GameSnapshot } from '../src/shared/types';
const args = process.argv.slice(2), arg = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
if (!arg('--out')) throw new Error('Use --out COMPLETED_RUN [--compare OLDER_RUN]');
const out = resolve(arg('--out')!), compare = arg('--compare');
const matrix = JSON.parse(readFileSync(join(out, 'matrix.json'), 'utf8'));
const results = JSON.parse(readFileSync(join(out, 'matrix-status.json'), 'utf8'));
function must(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
must(results.complete && !results.failed && results.results.every((r: { exit: number }) => r.exit === 0), 'Incomplete matrix');
async function* rows<T>(path: string): AsyncGenerator<T> {
  if (!existsSync(path)) return;
  const input = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of input) if (line.trim()) yield JSON.parse(line) as T;
}
const checked = [];
for (const item of matrix.cases) {
  const folder = join(out, item.name), report = JSON.parse(readFileSync(join(folder, 'summary.json'), 'utf8')) as RoomAbReport;
  const final = JSON.parse(gunzipSync(readFileSync(join(folder, 'final.json.gz'))).toString()) as GameSnapshot;
  must(report.position && report.position.tick === report.tick && final.tick === report.tick, `${item.name}: missing terminal position`);
  const expected = Object.fromEntries(item.seats.map((s: { owner: string }) => [s.owner,
    { unitLossGold: 0, unitLosses: 0, buildingLossGold: 0, killedGold: 0, windowCents: 0,
      crossKilledGold: 0, crossLostGold: 0, hallsLost: 0, hallsKilled: 0, ledgerLossGold: 0, ledgerLosses: 0 }]));
  const sides = Object.fromEntries(report.item.seats.map(s => [s.owner, s.side]));
  let eventCount = 0;
  for await (const event of rows<RoomAbPositionEvent>(join(folder, 'position.jsonl.gz'))) {
    eventCount++;
    if (event.type === 'mining-income') {
      must(Math.abs(event.creditedGold * 100 - Math.round(event.creditedGold * 100)) < 1e-8
        && event.creditedGold >= 0 && event.tick <= report.tick, 'Invalid income');
      if (event.tick > report.tick - 1200 && expected[event.owner]) expected[event.owner]!.windowCents += Math.round(event.creditedGold * 100);
      continue;
    }
    const cost = event.type === 'unit-loss' ? UNIT_DEFS[event.kind as keyof typeof UNIT_DEFS].cost
      : BUILDING_DEFS[event.kind as keyof typeof BUILDING_DEFS].cost;
    must(event.gold === cost, `${item.name}: bad catalogue price ${event.targetId}`);
    const target = expected[event.targetOwner], source = event.sourceOwner ? expected[event.sourceOwner] : undefined;
    if (target) {
      if (event.type === 'unit-loss') { target.unitLossGold += cost; target.unitLosses++; } else target.buildingLossGold += cost;
      if (event.type === 'building-loss' && event.kind === 'townHall') target.hallsLost++;
    }
    if (source && event.hostile) {
      source.killedGold += cost;
      if (event.type === 'building-loss' && event.kind === 'townHall') source.hallsKilled++;
      if (target && sides[event.sourceOwner!] !== sides[event.targetOwner]) { source.crossKilledGold += cost; target.crossLostGold += cost; }
    }
  }
  for await (const death of rows<AiUnitDeathRecord>(join(folder, 'deaths.jsonl.gz'))) {
    const seat = expected[death.owner]; if (!seat || !death.countedAsNativeLoss) continue;
    seat.ledgerLossGold += death.catalogGold; seat.ledgerLosses++;
  }
  must(JSON.stringify(roomAbMinePositions(final)) === JSON.stringify(report.position.mines), `${item.name}: mine audit differs`);
  for (const seat of report.item.seats) {
    const e = expected[seat.owner]!, p = report.position.seats[seat.owner]!;
    const equal = (a: number, b: number, key: string) => must(Math.abs(a - b) < 1e-8, `${item.name}/${seat.owner}/${key}: ${a} != ${b}`);
    equal(e.unitLosses, report.nativeStats.unitsLost[seat.owner] ?? 0, 'native-losses');
    equal(e.unitLosses, e.ledgerLosses, 'ledger-losses'); equal(e.unitLossGold, e.ledgerLossGold, 'ledger-gold');
    equal(p.lostUnitGold, e.unitLossGold, 'lostUnitGold'); equal(p.lostBuildingGold, e.buildingLossGold, 'lostBuildingGold');
    equal(p.killedGold, e.killedGold, 'killedGold'); equal(p.crossKilledGold, e.crossKilledGold, 'crossKilledGold');
    equal(p.crossLostGold, e.crossLostGold, 'crossLostGold'); equal(p.miningWindowGold, e.windowCents / 100, 'miningWindowGold');
    equal(p.enemyMiningHallsDestroyed, e.hallsKilled, 'hallsKilled'); equal(p.ownMiningHallsLost, e.hallsLost, 'hallsLost');
    equal(p.aliveUnitGold, final.units.filter(u => u.hp > 0 && u.owner === seat.owner).reduce((v, u) => v + UNIT_DEFS[u.kind].cost, 0), 'aliveUnitGold');
    equal(p.aliveBuildingGold, final.buildings.filter(b => b.hp > 0 && b.owner === seat.owner).reduce((v, b) => v + BUILDING_DEFS[b.kind].cost, 0), 'aliveBuildingGold');
  }
  const hashKeys = ['initialSha256', 'plannedSha256', 'commandSha256', 'snapshotSha256', 'canonicalSha256', 'checksum', 'memorySha256'] as const;
  let previousEqual: boolean | null = null;
  if (compare) {
    const previous = JSON.parse(readFileSync(join(resolve(compare), item.name, 'summary.json'), 'utf8')) as RoomAbReport;
    previousEqual = hashKeys.every(key => previous[key] === report[key]);
    must(previousEqual, `${item.name}: instrumentation changed commands/world/memory`);
  }
  checked.push({ case: item.name, events: eventCount, seats: item.seats.length, previousEqual });
}
const receipt = { pass: true, sourceCommit: matrix.provenance.sourceCommit,
  auditCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), compare: compare ?? null, checked };
writeFileSync(join(out, 'position-audit.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass: true, games: checked.length, events: checked.reduce((n, row) => n + row.events, 0) }));
