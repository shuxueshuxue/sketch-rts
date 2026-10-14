/** Calibration only. Same observer API/order as the frozen structural probe. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const output = resolve(process.argv[2] ?? `${dirname(scriptPath)}/result.json`);
try { await access(output); throw new Error(`Refusing to overwrite ${output}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(dirname(output), { recursive: true });
if (typeof process.threadCpuUsage !== 'function') throw new Error('threadCpuUsage unavailable');
const threadCpuUsage = process.threadCpuUsage;
const clockAnchor = () => ({ performanceMs: performance.now(), hrtimeUs: Number(process.hrtime.bigint()) / 1000 });
function readUsage() {
  const before = clockAnchor();
  const thread = threadCpuUsage.call(process);
  const processCpu = process.cpuUsage();
  const resources = process.resourceUsage();
  const after = clockAnchor();
  return { before, after, observerOverheadMs: after.performanceMs - before.performanceMs, threadCpuUs: thread, processCpuUs: processCpu,
    resources: { voluntaryContextSwitches: resources.voluntaryContextSwitches, involuntaryContextSwitches: resources.involuntaryContextSwitches,
      minorPageFault: resources.minorPageFault, majorPageFault: resources.majorPageFault } };
}
let sentinel = 0x12345678;
function busy(ms) {
  const started = performance.now();
  let until = started;
  while (until - started < ms) {
    for (let i = 0; i < 128; i++) sentinel = Math.imul(sentinel ^ i, 16777619);
    until = performance.now();
  }
  return { startedMs: started, endedMs: performance.now() };
}
const definitions = [
  { kind: 'busy', requestedMs: 1 }, { kind: 'busy', requestedMs: 5 }, { kind: 'busy', requestedMs: 15 },
  { kind: 'busy', requestedMs: 100 }, { kind: 'asyncWait', requestedMs: 100 },
];
const processStartedMs = performance.now();
const warmupBefore = readUsage(), warmupWork = busy(15), warmupAfter = readUsage();
const samples = [];
for (let repeat = 0; repeat < 8; repeat++) {
  // Rotate order to avoid coupling one short workload to the same preceding case.
  for (let offset = 0; offset < definitions.length; offset++) {
    const definition = definitions[(repeat + offset) % definitions.length];
    const before = readUsage();
    let workload;
    if (definition.kind === 'busy') workload = busy(definition.requestedMs);
    else {
      const startedMs = performance.now();
      await new Promise(done => setTimeout(done, definition.requestedMs));
      workload = { startedMs, endedMs: performance.now() };
    }
    const after = readUsage();
    const threadCpuMs = (after.threadCpuUs.user + after.threadCpuUs.system - before.threadCpuUs.user - before.threadCpuUs.system) / 1000;
    const intervalWallMs = (after.before.performanceMs + after.after.performanceMs - before.before.performanceMs - before.after.performanceMs) / 2;
    const wallLowerMs = after.before.performanceMs - before.after.performanceMs;
    const wallUpperMs = after.after.performanceMs - before.before.performanceMs;
    samples.push({ repeat, ...definition, before, after, workload, threadCpuMs, intervalWallMs, wallLowerMs, wallUpperMs,
      signedWallMinusThreadCpuMs: intervalWallMs - threadCpuMs,
      signedThreadCpuMinusWallUpperMs: threadCpuMs - wallUpperMs,
      processCpuMs: (after.processCpuUs.user + after.processCpuUs.system - before.processCpuUs.user - before.processCpuUs.system) / 1000 });
  }
}
const quantile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
const summaries = definitions.map(definition => {
  const selected = samples.filter(sample => sample.kind === definition.kind && sample.requestedMs === definition.requestedMs);
  return { ...definition, samples: selected.length, wallMedianMs: quantile(selected.map(sample => sample.intervalWallMs), .5),
    threadCpuMedianMs: quantile(selected.map(sample => sample.threadCpuMs), .5),
    signedWallMinusThreadCpuMinMs: Math.min(...selected.map(sample => sample.signedWallMinusThreadCpuMs)),
    signedWallMinusThreadCpuMaxMs: Math.max(...selected.map(sample => sample.signedWallMinusThreadCpuMs)),
    threadCpuAboveEntireWallBracketCount: selected.filter(sample => sample.signedThreadCpuMinusWallUpperMs > 0).length,
    largestThreadCpuAboveEntireWallBracketMs: Math.max(...selected.map(sample => sample.signedThreadCpuMinusWallUpperMs)) };
});
const result = { schema: 1, node: process.version, v8: process.versions.v8, sourceSha256: createHash('sha256').update(await readFile(scriptPath)).digest('hex'),
  argv: process.argv, processWallMs: performance.now() - processStartedMs, sentinel, warmup: { before: warmupBefore, workload: warmupWork, after: warmupAfter },
  method: { apiOrderMatchesFrozenObserver: true, scheduling: '8 rotated repeats of busy1/5/15/100ms and async wait100ms; one retained warmup15ms',
    rawDeltasNotClamped: true, interpretation: 'Microsecond representation is not a validated microsecond error bound. A CPU delta above the entire archived wall bracket disproves precise short-window CPU/wait attribution for that sample; no correction is invented. Clean-process calibration does not prove the historical game stall cause.' },
  summaries, samples };
await writeFile(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output, sourceSha256: result.sourceSha256, processWallMs: result.processWallMs, summaries }, null, 2));
