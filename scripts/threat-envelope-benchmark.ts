/** Standalone pure-module CPU/accounting probe, never a planner queue or game. */
import { performance } from 'node:perf_hooks';
import { createUnit } from '../src/shared/map';
import { aggregateThreatEnvelope, beginThreatEnvelope, scanThreatEnvelope,
  type ThreatEnvelopeCursor, type ThreatEnvelopeInput } from '../src/shared/threat-envelope';
const binding = { declarationId: 'benchmark', declarationVersion: 'v1', scheduleEpoch: 0 };
const segments = Array.from({ length: 80 }, (_, n) => ({ id: `s${n}`, from: { x: 100, y: 0 }, to: { x: 100, y: 0 } }));
const input: ThreatEnvelopeInput = { ownerId: 'planner', observedTick: 0, navigationVersion: 'v1', exposure: { binding,
  actors: { binding, version: 'v1', members: [{ id: 'worker', physicalVersion: 'v1' }] },
  route: { binding, version: 'v1', segments }, passage: { binding, version: 'v1', routeVersion: 'v1',
    segments: segments.map(s => ({ id: s.id, fromTick: 0, throughTick: 100 })) },
  resistance: { binding, version: 'v1', force: 0 } },
  enemies: Array.from({ length: 40 }, (_, n) => ({ unit: createUnit(`e${n}`, 'enemy', 'footman', 0, 0), physicalVersion: 'v1', evidenceVersion: 'reach-v1',
    capability: { armed: true, maxSpeed: 62, reach: 10, interruptForce: 0 } })), arrivals: [], qByKind: { footman: .2 } };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const cpuMs = (since: NodeJS.CpuUsage) => { const cpu = process.cpuUsage(since); return (cpu.user + cpu.system) / 1000; };
const measure = (f: ThreatEnvelopeInput, cursor: ThreatEnvelopeCursor) => {
  const cpu0 = process.cpuUsage(), t0 = performance.now();
  const scanned = scanThreatEnvelope(f, cursor, 6144);
  const scanWallMs = performance.now() - t0, scanCpuMs = cpuMs(cpu0);
  const cpu1 = process.cpuUsage(), t1 = performance.now();
  const result = aggregateThreatEnvelope(scanned);
  return { result, scanWallMs, scanCpuMs, aggregateWallMs: performance.now() - t1,
    aggregateCpuMs: cpuMs(cpu1) };
};
let cursor = beginThreatEnvelope();
const cold = [];
for (let n = 0; n < 10; n++) {
  const sample = measure(input, cursor); cold.push(sample); cursor = clone(sample.result.cursor);
  if (!sample.result.deferredPairs) break;
}
if (cold.reduce((n, row) => n + row.result.evaluatedPairs, 0) !== 3200) throw Error('Incomplete cold grid');
const warm = Array.from({ length: 200 }, () => measure(input, cursor));
const moved = clone(input) as { -readonly [K in keyof ThreatEnvelopeInput]: ThreatEnvelopeInput[K] };
moved.enemies = input.enemies.map((e, n) => n === 7 ? { ...e, unit: { ...e.unit, x: 1 } } : e);
const moving = Array.from({ length: 200 }, () => measure(moved, cursor));
const values = (rows: typeof cold, field: 'scanWallMs' | 'scanCpuMs' | 'aggregateWallMs' | 'aggregateCpuMs') => {
  const sorted = rows.map(r => r[field]).sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)],
    max: sorted.at(-1), mean: sorted.reduce((a, b) => a + b, 0) / sorted.length };
};
const summarize = (rows: typeof cold) => ({ samples: rows.length,
  scanIncludes: 'metadata + dependency checks + physical pair classification/reuse + per-pair row aggregation',
  finalAggregationIncludes: 'joint interruption threshold + one kind factor per named enemy + stable product',
  cpuScope: 'user + system CPU milliseconds; process.cpuUsage resolution and JIT/GC affect short samples',
  scanWallMs: values(rows, 'scanWallMs'), scanCpuMs: values(rows, 'scanCpuMs'),
  finalAggregationWallMs: values(rows, 'aggregateWallMs'), finalAggregationCpuMs: values(rows, 'aggregateCpuMs'),
  receipts: rows.slice(0, rows === cold ? rows.length : 1).map(({ result: r }) => ({ work: r.work,
    inspectionWork: r.inspectionWork, dependencyWork: r.dependencyWork, aggregationWork: r.aggregationWork, retentionWork: r.retentionWork,
    evaluatedPairs: r.evaluatedPairs, reusedPairs: r.reusedPairs, deferredPairs: r.deferredPairs, state: r.state })) });
console.log(JSON.stringify({ scope: '40 enemies × 80 point-exposure segments; all native arrival proofs deliberately missing',
  nativeQueryWork: 0, noNewGame: true, cold: summarize(cold), warm: summarize(warm), movedOneEnemy: summarize(moving),
  cursorBytes: Buffer.byteLength(JSON.stringify(cursor)), node: process.version }, null, 2));
