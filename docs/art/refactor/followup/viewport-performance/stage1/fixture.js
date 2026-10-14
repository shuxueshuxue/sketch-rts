import { waitForArtGpuCompletion } from './art-gpu-completion.mjs';

const source = '/@fs' + __BENCHMARK_SOURCE_ROOT__;
const paths = ['shared/sim', 'client/world-presentation', 'client/world3d/world-layer', 'client/unit-facing', 'client/unit-animation', 'client/unit-motion', 'client/combat-presentation', 'client/projectile-origins', 'client/resources', 'client/world3d/model-library'];
const [sim, presentation, world, facing, animation, motion, combat, projectiles, resources, models] = await Promise.all(paths.map(path => import(/* @vite-ignore */ `${source}/src/${path}.ts`)));
await resources.resources.initialize();
const WIDTH = 1280, HEIGHT = 720, VISIBLE = 100;
const VIEWS = { battlefield: { x: 0, y: 0, width: WIDTH, height: HEIGHT, zoom: .75 }, empty: { x: 24000, y: 24000, width: WIDTH, height: HEIGHT, zoom: .75 } };
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b), percentile = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return { samples: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length, p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99), maxMs: sorted.at(-1), over16_67Ms: values.filter(x => x > 1000 / 60).length, over50Ms: values.filter(x => x > 50).length };
};
// Counter reads occur after samples have finished, never inside a timer.
const counters = layer => ({ cards: layer.cardStats(), combat: layer.combatStats(), positions: layer.positions.size, render: { ...layer.renderer.info.render }, memory: { ...layer.renderer.info.memory }, viewIndex: typeof layer.viewStats === 'function' ? layer.viewStats() : null });
function makeScene(hiddenCount) {
  const game = sim.createGame('bareDuel', { aiPlayers: [], players: ['player', 'enemy'], teams: { player: 'a', enemy: 'b' } });
  for (const key of ['units', 'items', 'buildings', 'resources', 'mercenaryCamps', 'shops', 'obstacles', 'effects', 'projectiles', 'corpses']) game[key] = [];
  game.scriptedVictory = true;
  game.map.width = game.map.height = 32768;
  game.map.terrain = { cell: 64, cols: 512, rows: 512, cells: '.'.repeat(512 * 512) };
  game.map.landmarks = [];
  const visibleKinds = ['footman', 'lancer', 'archer', 'priest'];
  const hiddenKinds = ['footman', 'lancer', 'archer', 'priest', 'worker', 'knight', 'golem', 'graniteGolem'];
  for (let i = 0; i < VISIBLE + hiddenCount; i++) {
    const isVisible = i < VISIBLE, n = isVisible ? i : i - VISIBLE;
    const x = isVisible ? 170 + n % 10 * 135 : 6000 + n % 100 * 145;
    const y = isVisible ? 180 + Math.floor(n / 10) * 75 : 6000 + Math.floor(n / 100) * 145;
    const unit = game.spawnUnit(n % 2 ? 'enemy' : 'player', (isVisible ? visibleKinds : hiddenKinds)[n % (isVisible ? 4 : 8)], x, y);
    // These are presentation fixtures, so no simulation executes these orders.
    unit.order = { type: 'hold', x, y };
  }
  const initial = sim.snapshotGame(game);
  const baseUnits = initial.units.map(unit => ({ ...unit }));
  const visibleIds = baseUnits.slice(0, VISIBLE).map(unit => unit.id);
  const snapshotAt = tick => {
    const units = baseUnits.map((base, i) => {
      const n = i < VISIBLE ? i : i - VISIBLE;
      const moving = n % 4 === 1 || n % 8 === 5;
      const dx = moving ? Math.sin(tick / 13) * 24 : 0;
      const dy = moving ? Math.cos(tick / 17) * 10 : 0;
      return { ...base, x: base.x + dx, y: base.y + dy, cooldown: n % 4 === 2 ? Math.max(0, 24 - tick % 24) : 0,
        abilityCooldowns: n % 4 === 3 ? { heal: Math.max(0, 40 - tick % 40) } : {},
        ...(n % 8 === 5 ? { order: { type: 'charge', targetId: baseUnits[i % 2 ? i - 1 : Math.min(i + 1, baseUnits.length - 1)].id } } : {}) };
    });
    const effects = [];
    // Visible facts are byte-identical across world sizes. Hidden actions never
    // consume the globally bounded blood burst budget in this controlled case.
    for (const [start, count] of [[0, 8], [VISIBLE, Math.min(hiddenCount, 48)]]) for (let n = 0; n < count; n++) {
      const unit = units[start + n], target = units[start + (n + 1) % count], actionTick = tick - tick % 24;
      effects.push({ id: `release-${start}-${n}-${actionTick}`, type: 'melee', x: target.x, y: target.y, duration: 24, remaining: 24 - tick % 24,
        actionMode: n % 4 === 3 ? 'cast' : 'attack', actionTick, sourceId: unit.id, sourceKind: unit.kind,
        fromX: unit.x, fromY: unit.y, toX: target.x, toY: target.y });
      if (start === 0 && n < 2) effects.push({ id: `blood-${n}-${actionTick}`, type: 'hit', x: target.x, y: target.y, duration: 24, remaining: 24 - tick % 24,
        unitId: target.id, damage: 70, targetKind: target.kind, targetHpAfter: 30, targetMaxHp: target.maxHp, targetRadius: target.radius,
        targetUnitClass: 'nonMechanical', fromX: unit.x, fromY: unit.y });
    }
    return { ...initial, tick, units, effects };
  };
  return { game, snapshotAt, visibleIds, baseUnits };
}
function createFrame(scene) {
  const canvas = document.createElement('canvas'); canvas.className = 'game-canvas'; canvas.width = WIDTH; canvas.height = HEIGHT;
  document.querySelector('#mount').append(canvas);
  const view = new presentation.WorldPresentation(canvas);
  const frame = { ctx: canvas.getContext('2d'), snapshot: scene.snapshotAt(0), view: VIEWS.battlefield, now: 0,
    facing: new facing.UnitFacingTracker(), animation: new animation.UnitAnimationTracker(), motion: new motion.UnitMotionSmoother(),
    combat: new combat.CombatPresentationTracker(), projectiles: new projectiles.ProjectileOriginTracker(),
    viewer: 'player', selectedIds: new Set([scene.visibleIds[0]]), labels: { mercenaryStock: () => '', unitKind: () => '' } };
  return { canvas, view, frame };
}
function capture(view, canvas) {
  const output = document.createElement('canvas'); output.width = WIDTH; output.height = HEIGHT;
  const ctx = output.getContext('2d'); ctx.fillStyle = '#182526'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.drawImage(view.ground, 0, 0); ctx.drawImage(view.actors, 0, 0); ctx.drawImage(canvas, 0, 0);
  return output.toDataURL('image/png');
}
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, options) {
  return originalGetContext.call(this, type, type === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
};
window.viewportReview = {
  ready: true,
  async cycle(hiddenCount, cycle, options = {}) {
    const scene = makeScene(hiddenCount), { canvas, view, frame } = createFrame(scene);
    await view.prepare(frame.snapshot, 'home');
    if (!view.is3D) throw new Error('Benchmark requires real WorldPresentation WebGL path');
    const layer = view.layer, gl = view.context, debug = gl.getExtension('WEBGL_debug_renderer_info');
    const device = { renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER), vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), version: gl.getParameter(gl.VERSION), dpr: devicePixelRatio };
    const restore = layer.renderer.render, realLayerDraw = layer.draw;
    let layerMs = 0;
    layer.draw = function (input) { const at = performance.now(); const output = realLayerDraw.call(this, input); layerMs = performance.now() - at; return output; };
    const cpuValues = [], layerValues = [], canvasValues = [], sameValues = [], changedValues = [], sampleTicks = [];
    const update = (n, camera = VIEWS.battlefield) => { frame.now = n * 1000 / 60; const tick = Math.floor(n / 3); if (frame.snapshot.tick !== tick) frame.snapshot = scene.snapshotAt(tick); frame.view = camera; return tick; };
    // Warm every pose reached by the exact CPU loop first using real draws;
    // otherwise renderer.render=noop can defer uploader work to a later sample.
    for (let n = 0; n < 54; n += 3) { update(n); view.draw(frame, 'home'); await waitForArtGpuCompletion(gl); }
    layer.renderer.render = () => {};
    try {
      let previousTick;
      for (let n = 54; n < 54 + (options.cpuFrames ?? 360) + 60; n++) {
        const tick = update(n), sameTick = tick === previousTick, at = performance.now(); view.draw(frame, 'home'); const elapsed = performance.now() - at;
        if (n >= 114) { cpuValues.push(elapsed); layerValues.push(layerMs); canvasValues.push(elapsed - layerMs); sampleTicks.push(tick); (sameTick ? sameValues : changedValues).push(elapsed); }
        previousTick = tick;
      }
    } finally { layer.renderer.render = restore; }
    const fullValues = [], submitValues = [], intervals = [], completion = [];
    let previousStart;
    for (let i = 0; i < (options.realFrames ?? 18); i++) {
      await new Promise(resolve => requestAnimationFrame(resolve)); update(480 + i);
      const at = performance.now(); if (previousStart !== undefined) intervals.push(at - previousStart); previousStart = at;
      view.draw(frame, 'home'); const submitted = performance.now(); const waited = await waitForArtGpuCompletion(gl);
      fullValues.push(performance.now() - at); submitValues.push(submitted - at); completion.push(waited);
    }
    const before = counters(layer), finalTick = frame.snapshot.tick;
    const screenshots = { battlefield: capture(view, canvas) };
    const lastNow = frame.now;
    frame.view = VIEWS.empty; frame.now = lastNow + 5; const emptyAt = performance.now(); view.draw(frame, 'home'); const emptySubmitted = performance.now(); await waitForArtGpuCompletion(gl);
    const empty = { submissionMs: emptySubmitted - emptyAt, completeWallMs: performance.now() - emptyAt, ...counters(layer) };
    screenshots.empty = capture(view, canvas);
    frame.view = VIEWS.battlefield; frame.now = lastNow + 5; const returnAt = performance.now(); view.draw(frame, 'home'); const returnSubmitted = performance.now(); await waitForArtGpuCompletion(gl);
    const returned = { submissionMs: returnSubmitted - returnAt, completeWallMs: performance.now() - returnAt, ...counters(layer) };
    screenshots.returned = capture(view, canvas);
    const pixelProof = { visibleIds: scene.visibleIds, visibleUnitFacts: frame.snapshot.units.slice(0, VISIBLE), visibleEffectFacts: frame.snapshot.effects.filter(e => !e.id.startsWith('release-100-')), tick: finalTick };
    const error = gl.getError(); layer.draw = realLayerDraw;
    view.dispose(); canvas.remove();
    const result = { hiddenCount, visibleCount: VISIBLE, totalUnits: VISIBLE + hiddenCount, cycle, device,
      cpu: { fullPresentation: summarize(cpuValues), world3DLayer: summarize(layerValues), canvasPassesAndCoordinator: summarize(canvasValues), sameTick: summarize(sameValues), freshTick: summarize(changedValues), valuesMs: cpuValues, layerValuesMs: layerValues, canvasValuesMs: canvasValues, sampleTicks },
      real: { fullPresentationCompleteWall: summarize(fullValues), submission: summarize(submitValues), frameStartIntervals: summarize(intervals), completeWallValuesMs: fullValues, submitValuesMs: submitValues, intervalsMs: intervals, completion },
      before, empty, returned, pixelProof, screenshots, glError: error, disposed: view.disposed,
      scope: 'WorldPresentation production actor WebGL + ground Canvas + overlay Canvas. CPU samples disable renderer.render only; real Canvas submission and other resource work remain. Snapshot construction, simulation, capture, GC are excluded. Canvas deferred work and GPU completion are separately represented by real complete-wall samples; complete wall includes fence polling/event-loop scheduling, not GPU timer-query duration or hardware FPS.' };
    console.log('VIEWPORT cycle', hiddenCount, cycle, result.cpu.fullPresentation.meanMs, result.real.fullPresentationCompleteWall.meanMs);
    return result;
  },
  async simulation(hiddenCount) {
    const scene = makeScene(hiddenCount), values = [], serialization = [];
    // Real simulation kept separate: neutral holds, no AI, not a combat/AI benchmark.
    for (const unit of scene.game.units) unit.owner = 'player';
    for (let i = 0; i < 12; i++) { const at = performance.now(); sim.stepGame(scene.game); const step = performance.now() - at; const snapAt = performance.now(); sim.snapshotGame(scene.game); if (i >= 2) { values.push(step); serialization.push(performance.now() - snapAt); } }
    return { units: scene.game.units.length, step: summarize(values), snapshotSerialization: summarize(serialization), scope: '12 real simulation ticks, 2 warmup, all units hold, one owner, no AI. Excludes presentation. This diagnoses population scaling, not representative combat/AI cost.' };
  },
  teardown() { models.worldModels.dispose(); resources.resources.dispose(); return true; },
};
