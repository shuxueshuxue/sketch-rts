/** Intrusive card request diagnostic; do not use its timings as benchmark data. */
import './art-viewport-fixture.js';
window.viewportReview.ready = false;
const source = '/@fs' + __BENCHMARK_SOURCE_ROOT__;
const { PaintedCardBatches } = await import(/* @vite-ignore */ `${source}/src/client/world3d/painted-card-batches.ts`);
let recording = false, batches = new WeakMap(), traces = [];
const get = batch => {
  let trace = batches.get(batch);
  if (!trace) { trace = { frames: [] }; batches.set(batch, trace); traces.push(trace); }
  return trace;
};
const originalBegin = PaintedCardBatches.prototype.begin;
PaintedCardBatches.prototype.begin = function (...args) {
  if (recording) get(this).frames.push({ requests: [] });
  return originalBegin.apply(this, args);
};
const originalAdd = PaintedCardBatches.prototype.add;
PaintedCardBatches.prototype.add = function (key, density, paint, matrix, id, foot, tileSize = 128, opacity = 1) {
  if (recording) {
    const frame = get(this).frames.at(-1);
    // Keep request order and duplicate instances, but no functions/matrices.
    frame?.requests.push({ key, density, tileSize });
  }
  return originalAdd.call(this, key, density, paint, matrix, id, foot, tileSize, opacity);
};
const originalFinish = PaintedCardBatches.prototype.finish;
PaintedCardBatches.prototype.finish = function (...args) {
  const output = originalFinish.apply(this, args);
  if (recording) get(this).frames.at(-1).stats = this.stats();
  return output;
};
const originalCycle = window.viewportReview.cycle;
window.viewportReview.cycle = async (...args) => {
  traces = []; batches = new WeakMap(); recording = true;
  try {
    const output = await originalCycle(...args);
    output.cardTrace = { formalSample: false, batches: traces,
      scope: 'Production begin/add/finish order with intrusive wrappers and post-finish counters. Only used to replay cache policy; all reported timings are diagnostic.' };
    return output;
  } finally { recording = false; }
};
window.viewportReview.ready = true;
