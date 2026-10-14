import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const beforePath = resolve(process.argv[2] ?? 'docs/art/refactor/followup/viewport-performance/before/results.json');
const afterPath = resolve(process.argv[3] ?? 'docs/art/refactor/followup/viewport-performance/after/results.json');
const output = resolve(process.argv[4] ?? 'docs/art/refactor/followup/viewport-performance/comparison.json');
const before = JSON.parse(await readFile(beforePath)), after = JSON.parse(await readFile(afterPath));
if (!before.completed || !after.completed || !before.validation?.passed || !after.validation?.passed) throw new Error('Both source runs must complete and validate');
// Baseline source text is archived. Only the untimed counter collector gained a
// viewStats diagnostic; compare the remaining fixture rather than hiding that.
const { createHash } = await import('node:crypto');
const beforeFixture = await readFile(resolve(dirname(beforePath), 'fixture.js'), 'utf8');
const afterFixture = await readFile(resolve(dirname(afterPath), 'fixture.js'), 'utf8');
const withoutCounters = value => value.replace(/\/\/ Counter reads occur after samples have finished, never inside a timer\.\n/g, '').replace(/const counters = layer =>[^\n]*\n/, 'const counters = UNTYPED_NON_TIMED_METADATA;\n');
const beforeTimedFixture = createHash('sha256').update(withoutCounters(beforeFixture)).digest('hex'), afterTimedFixture = createHash('sha256').update(withoutCounters(afterFixture)).digest('hex');
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b), p = n => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * n))];
  return { samples: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length, p50Ms: p(.5), p95Ms: p(.95), p99Ms: p(.99), maxMs: sorted.at(-1), over16_67Ms: values.filter(x => x > 1000 / 60).length, over50Ms: values.filter(x => x > 50).length };
};
const rows = [], imageComparisons = [];
for (const count of before.counts) {
  const old = before.cycles.filter(c => c.hiddenCount === count), fresh = after.cycles.filter(c => c.hiddenCount === count);
  if (old.length !== fresh.length) throw new Error(`Mismatched repetitions for ${count}`);
  const get = (items, field) => summary(items.flatMap(c => field(c)));
  const fields = {
    fullCpuSubmission: c => c.cpu.valuesMs,
    freshTickCpuSubmission: c => c.cpu.valuesMs.filter((_, i) => i === 0 || c.cpu.sampleTicks[i] !== c.cpu.sampleTicks[i - 1]),
    sameTickCpuSubmission: c => c.cpu.valuesMs.filter((_, i) => i > 0 && c.cpu.sampleTicks[i] === c.cpu.sampleTicks[i - 1]),
    world3DCpuSubmission: c => c.cpu.layerValuesMs,
    freshTickWorld3DSubmission: c => c.cpu.layerValuesMs.filter((_, i) => i === 0 || c.cpu.sampleTicks[i] !== c.cpu.sampleTicks[i - 1]),
    canvasPassesAndCoordinator: c => c.cpu.canvasValuesMs,
    realCompleteWall: c => c.real.completeWallValuesMs,
    realSubmission: c => c.real.submitValuesMs,
    realFrameStartIntervals: c => c.real.intervalsMs,
  };
  const timings = Object.fromEntries(Object.entries(fields).map(([key, field]) => {
    const baseline = get(old, field), revised = get(fresh, field);
    return [key, { before: baseline, after: revised, p50ReductionPct: (1 - revised.p50Ms / baseline.p50Ms) * 100, meanReductionPct: (1 - revised.meanMs / baseline.meanMs) * 100 }];
  }));
  rows.push({ hiddenCount: count, visibleCount: 100, timings,
    visibleFactsIdentical: old.every((c, i) => c.pixelProofSha256 === fresh[i].pixelProofSha256),
    resources: { before: old.map(c => c.before.cards), after: fresh.map(c => c.before.cards) },
    blankCamera: { before: old.map(c => c.empty), after: fresh.map(c => c.empty) },
    returnedCamera: { before: old.map(c => c.returned), after: fresh.map(c => c.returned) } });
  for (let i = 0; i < old.length; i++) for (const name of ['battlefield', 'empty', 'returned']) {
    const a = await loadImage(resolve(dirname(beforePath), old[i].screenshots[name].path)), b = await loadImage(resolve(dirname(afterPath), fresh[i].screenshots[name].path));
    if (a.width !== b.width || a.height !== b.height) throw new Error(`Screenshot dimensions differ ${count}/${i}/${name}`);
    const canvas = createCanvas(a.width, a.height), ctx = canvas.getContext('2d');
    ctx.drawImage(a, 0, 0); const aa = ctx.getImageData(0, 0, a.width, a.height).data;
    ctx.clearRect(0, 0, a.width, a.height); ctx.drawImage(b, 0, 0); const bb = ctx.getImageData(0, 0, b.width, b.height).data;
    let changedPixels = 0, maxChannelDifference = 0, absoluteChannelDifference = 0;
    for (let pixel = 0; pixel < aa.length; pixel += 4) { let changed = false; for (let channel = 0; channel < 4; channel++) { const delta = Math.abs(aa[pixel + channel] - bb[pixel + channel]); if (delta) changed = true; maxChannelDifference = Math.max(maxChannelDifference, delta); absoluteChannelDifference += delta; } if (changed) changedPixels++; }
    imageComparisons.push({ hiddenCount: count, cycle: i, camera: name, width: a.width, height: a.height, changedPixels, changedPixelFraction: changedPixels / (a.width * a.height), maxChannelDifference, meanAbsoluteChannelDifference: absoluteChannelDifference / aa.length, pngBytesIdentical: old[i].screenshots[name].sha256 === fresh[i].screenshots[name].sha256 });
  }
}
const result = { beforeSource: { root: before.sourceRoot, commit: before.sourceCommit, sha256: before.sourceSha256 }, afterSource: { root: after.sourceRoot, commit: after.sourceCommit, dirty: after.sourceDirty, sha256: after.sourceSha256 },
  fixtureIdentical: before.fixtureSha256 === after.fixtureSha256, fixtureExceptUntimedCountersIdentical: beforeTimedFixture === afterTimedFixture, timedFixtureSha256: { before: beforeTimedFixture, after: afterTimedFixture }, rendererIdentical: JSON.stringify(before.cycles[0].device) === JSON.stringify(after.cycles[0].device), viewportIdentical: JSON.stringify(before.viewport) === JSON.stringify(after.viewport),
  rows, imageComparisons, allVisibleFactsIdentical: rows.every(row => row.visibleFactsIdentical), allPixelsIdentical: imageComparisons.every(row => row.changedPixels === 0),
  meaning: 'CPU submission includes resource preparation and possible driver/upload backpressure even though renderer.render is disabled. World3DLayer is nested in the full three-pass presentation; do not add them. Complete wall is verified async GPU completion plus Canvas submission and event-loop scheduling upper bound on SwiftShader, not GPU timer duration or hardware FPS. 720 CPU samples per size pooled across two independent lifetimes; only 36 real samples per size, too few for stable tail inference.' };
await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, fixtureIdentical: result.fixtureIdentical, fixtureExceptUntimedCountersIdentical: result.fixtureExceptUntimedCountersIdentical, rendererIdentical: result.rendererIdentical, allVisibleFactsIdentical: result.allVisibleFactsIdentical, allPixelsIdentical: result.allPixelsIdentical, rows: rows.map(({ hiddenCount, timings }) => ({ hiddenCount, cpu: timings.fullCpuSubmission, layer: timings.world3DCpuSubmission, canvas: timings.canvasPassesAndCoordinator, real: timings.realCompleteWall })) }, null, 2));
