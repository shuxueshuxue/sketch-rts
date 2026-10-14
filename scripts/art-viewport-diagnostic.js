/** Independent intrusive phase diagnostic. Never use this as a formal sample. */
import './art-viewport-fixture.js';
window.viewportReview.ready = false;
const source = '/@fs' + __BENCHMARK_SOURCE_ROOT__;
const modules = await Promise.all(['client/world-presentation', 'client/presentation-view', 'client/unit-animation', 'client/unit-facing', 'client/unit-motion', 'client/combat-presentation', 'client/ship-wakes', 'client/projectile-origins'].map(path => import(/* @vite-ignore */ `${source}/src/${path}.ts`)));
const [presentation, view, animation, facing, motion, combat, wakes, projectiles] = modules;
let active;
const records = [];
const wrap = (prototype, method, label) => {
  if (!prototype[method]) return;
  const original = prototype[method];
  prototype[method] = function (...args) {
    if (!active) return original.apply(this, args);
    const at = performance.now();
    try { return original.apply(this, args); }
    finally { const stats = active.phases[label] ??= { calls: 0, ms: 0 }; stats.calls++; stats.ms += performance.now() - at; }
  };
};
for (const [prototype, method, label] of [
  [view.PresentationViewIndex.prototype, 'update', 'viewIndex.update'],
  [view.PresentationViewIndex.prototype, 'query', 'viewIndex.query'],
  [animation.UnitAnimationTracker.prototype, 'update', 'animation.update'],
  [animation.UnitAnimationTracker.prototype, 'frame', 'animation.frame'],
  [animation.UnitAnimationTracker.prototype, 'observeDirections', 'animation.observeDirections'],
  [facing.UnitFacingTracker.prototype, 'updateSnapshot', 'facing.updateSnapshot'],
  [motion.UnitMotionSmoother.prototype, 'update', 'motion.update'],
  [combat.CombatPresentationTracker.prototype, 'update', 'combat.update'],
  [combat.CombatPresentationTracker.prototype, 'frame', 'combat.frame'],
  [wakes.ShipWakeTracker.prototype, 'update', 'wakes.update'],
  [projectiles.ProjectileOriginTracker.prototype, 'update', 'projectiles.update'],
]) wrap(prototype, method, label);
const draw = presentation.WorldPresentation.prototype.draw;
presentation.WorldPresentation.prototype.draw = function (frame, ...args) {
  const originalRender = this.layer?.renderer?.render?.toString().replace(/\s+/g, '');
  active = { tick: frame.snapshot.tick, now: frame.now, units: frame.snapshot.units.length, cpuDiagnostic: originalRender === '()=>{}', phases: {} };
  const at = performance.now();
  try { return draw.call(this, frame, ...args); }
  finally { active.totalMs = performance.now() - at; records.push(active); active = undefined; }
};
const originalCycle = window.viewportReview.cycle;
window.viewportReview.cycle = async (...args) => {
  records.length = 0;
  const result = await originalCycle(...args);
  let previousTick;
  const measured = records.filter(row => row.cpuDiagnostic && row.now >= 114 * 1000 / 60);
  for (const row of records) { row.freshTick = row.tick !== previousTick; previousTick = row.tick; }
  result.phaseDiagnostic = { formalSample: false, intrusiveWrappers: true, records: measured, scope: 'Prototype wrappers add measurement overhead. Only used to locate phase cost. Calls are inclusive and nested (e.g. blood surface resolver can request animation.frame inside combat.update); do not add all phases or treat this as the formal before/after result.' };
  return result;
};
window.viewportReview.ready = true;
