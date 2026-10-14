import { waitForArtGpuCompletion } from './art-gpu-completion.mjs';

const source = '/@fs' + __BENCHMARK_SOURCE_ROOT__;
const paths = ['shared/sim', 'client/world-presentation', 'client/unit-facing', 'client/unit-animation',
  'client/unit-motion', 'client/combat-presentation', 'client/projectile-origins', 'client/resources', 'client/world3d/model-library'];
const [sim, presentation, facing, animation, motion, combat, projectiles, resources, models] =
  await Promise.all(paths.map(path => import(/* @vite-ignore */ `${source}/src/${path}.ts`)));
await resources.resources.initialize();
const VISIBLE = 100;
const VISIBLE_KINDS = ['footman', 'lancer', 'priest', 'knight', 'golem', 'rubbleGolem', 'graniteGolem',
  'ogreWarrior', 'ogreMage', 'ogreLord', 'deepSnapper', 'spiderQueen', 'redDragon', 'ancientStag',
  'stonebackBrute', 'tidePriest', 'siegeRam', 'ballista', 'catapult', 'organGun'];
const CASTERS = new Set(['priest', 'ogreMage', 'tidePriest']);
const GROUPS = ['idle', 'walk', 'attack', 'cast-or-attack', 'carry-idle-or-walk'];
const HELD_TICK = 163, HELD_NOW = 491 * 1000 / 60, CENTER = { x: 777.5, y: 450 };
const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');
const snapshotSha = snapshot => sha256(new TextEncoder().encode(JSON.stringify(snapshot)));
const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, options) {
  return originalGetContext.call(this, type, type === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
};
let active;
function makeScene(hiddenCount = 0) {
  const game = sim.createGame('bareDuel', { aiPlayers: [], players: ['player', 'enemy'], teams: { player: 'a', enemy: 'b' } });
  for (const key of ['units', 'items', 'buildings', 'resources', 'mercenaryCamps', 'shops', 'obstacles', 'effects', 'projectiles', 'corpses']) game[key] = [];
  game.scriptedVictory = true;
  game.map.width = game.map.height = 32768;
  game.map.terrain = { cell: 64, cols: 512, rows: 512, cells: '.'.repeat(512 * 512) };
  game.map.landmarks = [];
  for (let i = 0; i < VISIBLE + hiddenCount; i++) {
    const isVisible = i < VISIBLE, n = isVisible ? i : i - VISIBLE;
    const x = isVisible ? 170 + n % 10 * 135 : 6000 + n % 100 * 145;
    const y = isVisible ? 180 + Math.floor(n / 10) * 75 : 6000 + Math.floor(n / 100) * 145;
    const instance = Math.floor(n / VISIBLE_KINDS.length), kind = VISIBLE_KINDS[n % VISIBLE_KINDS.length];
    const unit = game.spawnUnit(instance % 2 ? 'enemy' : 'player', kind, x, y);
    unit.order = { type: 'hold', x, y };
  }
  const initial = sim.snapshotGame(game), baseUnits = initial.units.map(unit => ({ ...unit }));
  const visibleIds = baseUnits.slice(0, VISIBLE).map(unit => unit.id);
  const releaseAt = (tick, period, phase) => tick < phase ? undefined : phase + Math.floor((tick - phase) / period) * period;
  const snapshotAt = tick => {
    const units = baseUnits.map((base, i) => {
      const n = i < VISIBLE ? i : i - VISIBLE, group = Math.floor(n / VISIBLE_KINDS.length) % GROUPS.length;
      // The last group tests both stationary and moving ready poses. Unarmed
      // creatures naturally return to their authored idle/walk state instead.
      const moving = group === 1 || group === 4 && n % 2 === 1;
      const dx = moving ? Math.sin(tick / 13) * 24 : 0, dy = moving ? Math.cos(tick / 17) * 10 : 0;
      return { ...base, x: base.x + dx, y: base.y + dy, cooldown: 0, abilityCooldowns: {} };
    });
    const effects = [];
    // Visible facts cannot depend on the hidden population. The nearby empty
    // camera may cull them, but their authored action histories stay untouched.
    for (const [start, count] of [[0, VISIBLE], [VISIBLE, Math.min(hiddenCount, VISIBLE)]]) {
      for (let n = 0; n < count; n++) {
        const group = Math.floor(n / VISIBLE_KINDS.length) % GROUPS.length;
        if (group < 2) continue;
        const unit = units[start + n], isCast = group === 3 && CASTERS.has(unit.kind);
        const period = group === 4 ? 120 : isCast ? 40 : 24;
        const phase = group === 4 ? 24 : Math.floor((n % VISIBLE_KINDS.length) / 5) * 6;
        const actionTick = releaseAt(tick, period, phase);
        if (actionTick === undefined) continue;
        // +/-31 slots is a diagonal of roughly 60 degrees in the unprojected
        // world; real camera projection and authored facing choose the pose.
        const targetIndex = (n + (n % 2 === 0 && group === 2 ? 31 : -31) + count) % count;
        const target = units[start + targetIndex], age = tick - actionTick;
        effects.push({ id: `release-${start}-${n}-${actionTick}`, type: 'melee', x: target.x, y: target.y,
          duration: period, remaining: period - age, actionMode: isCast ? 'cast' : 'attack', actionTick,
          sourceId: unit.id, sourceKind: unit.kind, fromX: unit.x, fromY: unit.y, toX: target.x, toY: target.y });
        // Release metadata is authoritative; the cooldown is a matching fact,
        // never a timer that the fixture uses to change simulation rules.
        unit.cooldown = group === 4 ? Math.max(0, 6 - age) : Math.max(0, period - age);
      }
    }
    // These fixed presentation facts add ground/body stains and a fresh
    // airborne burst. They intentionally do not advance or alter simulation.
    for (const [hitTick, targetIndex, id] of [[145, 48, 'mip-ground-body'], [162, 54, 'mip-airborne']]) {
      if (tick < hitTick) continue;
      const target = units[targetIndex], attacker = units[targetIndex - 1];
      effects.push({ id, type: 'hit', x: target.x, y: target.y, duration: 60, remaining: 60 - (tick - hitTick),
        unitId: target.id, damage: 70, targetHpAfter: 30, targetMaxHp: target.maxHp,
        targetKind: target.kind, targetRadius: target.radius, targetUnitClass: 'nonMechanical',
        fromX: attacker.x, fromY: attacker.y });
    }
    return { ...initial, tick, units, effects };
  };
  return { game, snapshotAt, visibleIds, baseUnits };
}

function camera({ width, height, zoom, empty = false }) {
  return { x: empty ? 24000 : CENTER.x - width / (2 * zoom),
    y: empty ? 24000 : CENTER.y - height / (2 * zoom), width, height, zoom };
}
function resizeOverlay(canvas, width, height) {
  const dpr = Math.min(devicePixelRatio, 2), physicalWidth = Math.round(width * dpr), physicalHeight = Math.round(height * dpr);
  if (canvas.width !== physicalWidth) canvas.width = physicalWidth;
  if (canvas.height !== physicalHeight) canvas.height = physicalHeight;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  const mount = document.querySelector('#mount'); mount.style.width = `${width}px`; mount.style.height = `${height}px`;
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
function counts(layer, frame) {
  const stateCounts = {}, carryKinds = new Set(), kindCounts = {};
  for (const unit of frame.snapshot.units) {
    const pose = frame.animation.frame(unit, frame.now);
    stateCounts[pose.mode] = (stateCounts[pose.mode] ?? 0) + 1;
    if (pose.carry) carryKinds.add(unit.kind);
    kindCounts[unit.kind] = (kindCounts[unit.kind] ?? 0) + 1;
  }
  const ink = frame.combat.frame(frame.now);
  return { cards: layer.cardStats(), remains: layer.remainsStats(), viewIndex: layer.viewStats?.() ?? null,
    combat: layer.combatStats(), render: { ...layer.renderer.info.render }, memory: { ...layer.renderer.info.memory },
    observedStateCounts: stateCounts, carryKinds: [...carryKinds].sort(), kindCounts,
    blood: { airborne: ink.droplets.length, ground: ink.ground.length, body: ink.body.length,
      weapon: ink.body.filter(mark => mark.surface === 'weapon').length } };
}
function pickProbe(view, frame) {
  const result = [], zoom = frame.view.zoom;
  for (const unit of frame.snapshot.units) {
    const at = view.layer.positions.get(unit.id);
    if (!at) continue;
    for (const [dx, dy] of [[0, 0], [6, -8], [-10, 0]]) {
      const point = { x: (at.x + dx - frame.view.x) * zoom, y: (at.bodyY + dy - frame.view.y) * zoom };
      if (point.x < 0 || point.y < 0 || point.x >= frame.view.width || point.y >= frame.view.height) continue;
      result.push({ unitId: unit.id, dx, dy, point, hit: view.pick(point) ?? null });
    }
  }
  return result;
}
async function captures(view, canvas, gl) {
  const actors = view.actors, ground = view.ground;
  const width = actors.width, height = actors.height;
  if (ground.width !== width || ground.height !== height || canvas.width !== width || canvas.height !== height) {
    throw new Error(`Physical layer dimensions disagree: actors ${width}x${height}, ground ${ground.width}x${ground.height}, overlay ${canvas.width}x${canvas.height}`);
  }
  const output = document.createElement('canvas'); output.width = width; output.height = height;
  const ctx = output.getContext('2d'); ctx.fillStyle = '#182526'; ctx.fillRect(0, 0, width, height);
  // No retina downsampling: all three source canvases already have these exact
  // physical dimensions, so each pixel is composited at its native resolution.
  ctx.drawImage(ground, 0, 0); ctx.drawImage(actors, 0, 0); ctx.drawImage(canvas, 0, 0);
  const native = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, native);
  const composite = ctx.getImageData(0, 0, width, height).data;
  let nonzeroAlphaPixels = 0;
  for (let i = 3; i < native.length; i += 4) if (native[i]) nonzeroAlphaPixels++;
  return { width, height, actorsPng: actors.toDataURL('image/png'), compositePng: output.toDataURL('image/png'),
    actorDrawingBufferRgbaSha256: await sha256(native), compositeRgbaSha256: await sha256(composite),
    actorDrawingBufferFormat: 'Unmodified WebGL RGBA8 readPixels, bottom-up, native framebuffer alpha representation. Hash covers every color and alpha byte, including transparent pixels. Actor PNG is encoded by the browser canvas at exactly the same physical size.',
    nonzeroAlphaPixels };
}
window.mipCameraReview = {
  ready: true,
  async init(options = {}) {
    if (active) throw new Error('Dispose the active camera proof before initialization');
    const dimensions = { width: options.width ?? 1280, height: options.height ?? 720, zoom: options.zoom ?? .75 };
    const scene = makeScene(), canvas = document.createElement('canvas'); canvas.className = 'game-canvas';
    document.querySelector('#mount').append(canvas); resizeOverlay(canvas, dimensions.width, dimensions.height);
    const view = new presentation.WorldPresentation(canvas);
    const frame = { ctx: canvas.getContext('2d'), snapshot: scene.snapshotAt(144), view: camera(dimensions), now: 144 * 50,
      facing: new facing.UnitFacingTracker(), animation: new animation.UnitAnimationTracker(), motion: new motion.UnitMotionSmoother(),
      combat: new combat.CombatPresentationTracker(), projectiles: new projectiles.ProjectileOriginTracker(), viewer: 'player',
      selectedIds: new Set([scene.visibleIds[0]]), labels: { mercenaryStock: () => '', unitKind: () => '' } };
    await view.prepare(frame.snapshot, 'home');
    if (!view.is3D) throw new Error('Camera proof requires the production WorldPresentation WebGL path');
    const gl = view.context;
    // Observe an identical short fact history first. Afterwards no snapshot,
    // simulation tick or presentation clock advances during camera changes.
    for (let tick = 144; tick <= HELD_TICK; tick++) {
      frame.snapshot = scene.snapshotAt(tick); frame.now = tick * 50; view.draw(frame, 'home');
      await waitForArtGpuCompletion(gl);
    }
    frame.now = HELD_NOW;
    const frozenSha = await snapshotSha(frame.snapshot), debug = gl.getExtension('WEBGL_debug_renderer_info');
    active = { scene, view, canvas, frame, gl, frozenSha };
    return { tick: frame.snapshot.tick, now: frame.now, snapshotSha256: frozenSha, units: frame.snapshot.units.length,
      authoredKinds: VISIBLE_KINDS, center: CENTER, warmHistory: { firstTick: 144, lastTick: HELD_TICK, steps: 20 },
      scope: 'Correctness proof with controlled mixed-asset presentation facts. No simulation runs. Original zoom-dependent density policy, full source RGBA, authored geometry, picking and 2048px shadows are unchanged. Zoom and window size may reduce the visible subset; scene population and facts stay fixed.',
      device: { renderer: gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER),
        vendor: gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR), version: gl.getParameter(gl.VERSION),
        dpr: devicePixelRatio, contextAttributes: gl.getContextAttributes() } };
  },
  async step(input) {
    if (!active) throw new Error('Initialize the camera proof first');
    const { view, canvas, frame, gl, frozenSha } = active;
    if (!(input.width > 0 && input.height > 0 && input.zoom > 0)) throw new Error('Camera dimensions and zoom must be positive');
    const beforeSha = await snapshotSha(frame.snapshot), beforeNow = frame.now, beforeTick = frame.snapshot.tick;
    const resourcesBefore = counts(view.layer, frame);
    if (input.dpr !== undefined && devicePixelRatio !== input.dpr) throw new Error(`CDP DPR is ${devicePixelRatio}, expected ${input.dpr}`);
    resizeOverlay(canvas, input.width, input.height); frame.view = camera(input);
    await new Promise(resolve => requestAnimationFrame(resolve));
    // Exactly one production draw is captured. A mip promotion cannot hide a
    // lower-quality first frame behind a second warmup draw.
    view.draw(frame, 'home');
    if (!view.is3D) throw new Error('Camera transition fell back from WebGL');
    await waitForArtGpuCompletion(gl);
    const screenshots = await captures(view, canvas, gl), resourcesAfter = counts(view.layer, frame);
    const picks = pickProbe(view, frame), afterSha = await snapshotSha(frame.snapshot);
    const unchanged = beforeSha === frozenSha && afterSha === frozenSha && frame.now === beforeNow && frame.snapshot.tick === beforeTick;
    const glError = gl.getError();
    if (!unchanged) throw new Error('A camera change altered frozen snapshot facts or the presentation clock');
    if (glError !== gl.NO_ERROR) throw new Error(`GL error during camera proof: ${glError}`);
    return { label: input.label, input, view: frame.view, dpr: devicePixelRatio,
      innerWindow: { width: innerWidth, height: innerHeight }, physical: { width: screenshots.width, height: screenshots.height },
      snapshotBeforeSha256: beforeSha, snapshotAfterSha256: afterSha, nowBefore: beforeNow, nowAfter: frame.now,
      tick: frame.snapshot.tick, unchanged, glError, resourcesBefore, resourcesAfter, picks, screenshots };
  },
  dispose() {
    if (!active) return { disposed: true, wasActive: false };
    const { view, canvas, frame, frozenSha } = active;
    const now = frame.now, tick = frame.snapshot.tick; view.dispose(); canvas.remove(); active = undefined;
    return { disposed: view.disposed, wasActive: true, snapshotSha256: frozenSha, tick, now };
  },
  teardown() { this.dispose(); models.worldModels.dispose(); resources.resources.dispose(); return true; },
};
