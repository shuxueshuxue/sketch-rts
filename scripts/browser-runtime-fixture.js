import * as THREE from 'three';

const source = '/@fs' + __BENCHMARK_SOURCE_ROOT__;
const modules = await Promise.all([
  'shared/sim', 'shared/decks', 'shared/ship-geometry', 'shared/ship-gangway',
  'client/world3d/world-layer', 'client/unit-facing', 'client/unit-animation', 'client/unit-motion',
  'client/resources', 'client/world3d/model-library', 'client/world3d/model-portraits',
  'client/model-portraits', 'client/relations',
].map(path => import(/* @vite-ignore */ `${source}/src/${path}.ts`)));
const [sim, decks, geometry, gangways, world, facing, animation, motion, resources, models, portraits, portraitProvider, relations] = modules;
await resources.resources.initialize();
const owners = ['player', 'ally', 'enemy'];
const game = sim.createGame('bareDuel', {
  aiPlayers: [], players: owners, teams: { player: 'friendly', ally: 'friendly', enemy: 'opposing' },
});
for (const key of ['units', 'items', 'buildings', 'resources', 'mercenaryCamps', 'shops', 'obstacles', 'effects', 'projectiles']) game[key] = [];
game.scriptedVictory = true;
game.map.width = 6400;
game.map.height = 6400;
game.map.terrain = { cell: 64, cols: 100, rows: 100, cells: '~'.repeat(3200) + '.'.repeat(6800) };
const kinds = ['shipOfTheLine', 'warship', 'transport', 'cutter', 'carrier', 'bombardShip'];
const ships = [];
for (let i = 0; i < 24; i++) {
  const owner = owners[i % owners.length];
  const ship = game.spawnUnit(owner, kinds[i % kinds.length], 500 + (i % 6) * 500, 500 + Math.floor(i / 6) * 430);
  ship.sailing.heading = (i % 4) * Math.PI / 3;
  ships.push(ship);
  for (let n = 0; n < 4; n++) {
    const crew = game.spawnUnit(owner, ['worker', 'archer', 'priest', 'footman'][n], ship.x, ship.y);
    if (!decks.boardUnit(ship, crew, game.units)) {
      // Small cutters cannot fit every recruit. Keep those actual units on
      // the visible shore rather than ignoring failed boarding on open water.
      Object.assign(crew, { x: 3400 + (i % 6) * 140, y: 2200 + Math.floor(i / 6) * 140 + n * 32 });
    }
  }
}
for (let i = 0; i < 160; i++) game.spawnUnit(owners[i % owners.length], ['archer', 'footman', 'worker', 'priest'][i % 4], 300 + (i % 20) * 135, 2200 + Math.floor(i / 20) * 70);

// Use the real deployment geometry, including the height difference between
// these two hulls, rather than inserting a synthetic marker into the scene.
const bridgeSource = ships[2], bridgeTarget = ships[4];
bridgeSource.sailing.heading = bridgeTarget.sailing.heading = 0;
bridgeTarget.x = bridgeSource.x;
bridgeTarget.y = bridgeSource.y + (geometry.shipProfile(bridgeSource).beam + geometry.shipProfile(bridgeTarget).beam) / 2 + 12;
decks.syncDecks(game.units);
bridgeSource.order = { type: 'boardShip', targetId: bridgeTarget.id };
if (!gangways.beginShipBoarding(game.map, game.units, bridgeSource, bridgeTarget, 0, game)) throw new Error('Fixture gangway approach refused');
gangways.updateShipGangways(game.map, game.units, 0, game);
game.tick = gangways.GANGWAY_SETUP_TICKS;
gangways.updateShipGangways(game.map, game.units, game.tick, game);
if (gangways.gangwaySurface(bridgeSource, bridgeTarget)?.phase !== 'ready') throw new Error('Fixture gangway did not deploy');
const bridgeCrew = game.units.find(unit => unit.deck?.shipId === bridgeSource.id);
bridgeCrew.gangway = { sourceId: bridgeSource.id, targetId: bridgeTarget.id, t: .5, lateral: 0 };
decks.syncDecks(game.units);
if (game.units.length !== 280 || ships.length !== 24) throw new Error('Fixture load changed');

const snapshot = sim.snapshotGame(game), discarded = [], installedModels = new Map();
const expectedModels = [...new Set([...models.snapshotModelKeys(snapshot), ...models.matchModelKeys])].sort();
const originalModelSet = models.worldModels.models.set.bind(models.worldModels.models);
models.worldModels.models.set = (key, value) => {
  installedModels.set(key, (installedModels.get(key) || 0) + 1);
  return originalModelSet(key, value);
};
const byZone = zone => game.units.filter(unit => zone === 'hull' ? geometry.shipProfile(unit) : zone === 'ground' ? !unit.deck && !geometry.shipProfile(unit) : zone === 'deck' ? unit.deck && !unit.gangway : unit.gangway);
const hoverCases = ['ground', 'deck', 'hull'].flatMap(zone => owners.map(owner => ({ zone, owner, id: byZone(zone).find(unit => unit.owner === owner).id })));
hoverCases.push({ zone: 'bridge', owner: bridgeCrew.owner, id: bridgeCrew.id });
const smallSelection = new Set([
  ...['ground', 'deck'].flatMap(zone => owners.flatMap(owner => byZone(zone).filter(unit => unit.owner === owner).slice(0, 2).map(unit => unit.id))),
  ...kinds.map(kind => ships.find(ship => ship.kind === kind).id), bridgeCrew.id,
]);
const largeSelection = new Set(game.units.map(unit => unit.id));

function stats(layer, renderer = layer.renderer) {
  const maps = ['positions', 'templates', 'bounds', 'cards', 'cardGeometry', 'rigModels', 'rigPoses', 'deckMotion', 'entities', 'ships', 'shipPoses', 'gangwaySurfaces', 'recoil'];
  const selection = layer.selection, batches = [...selection.batches.values()];
  return {
    owned: Object.fromEntries([
      ...maps.map(key => [key, layer[key]?.size ?? null]),
      ['actorBatches', layer.batches.batches.size], ['actorGeometries', layer.batches.geometries.size], ['actorTextures', layer.batches.textures.size],
      ['selectionBatches', selection.batches.size], ['selectionHulls', selection.hulls.size],
    ]),
    selection: {
      instances: batches.reduce((sum, batch) => sum + batch.mesh.count, 0),
      capacity: batches.reduce((sum, batch) => sum + batch.capacity, 0),
      batches: Object.fromEntries([...selection.batches].map(([key, batch]) => [key, { instances: batch.mesh.count, capacity: batch.capacity, visible: batch.mesh.visible }])),
      depthTest: selection.material.depthTest, depthWrite: selection.material.depthWrite, disposed: selection.disposed,
    },
    transforms: layer.transforms?.length, sceneChildren: layer.scene?.children?.length,
    renderer: renderer ? { memory: { ...renderer.info.memory }, render: { ...renderer.info.render } } : undefined,
    sharedModels: models.worldModels.models.size, installedModels: Object.fromEntries(installedModels),
  };
}

function observeMarkerResources(selection) {
  const seen = new WeakSet(), counts = {};
  const observe = (resource, kind) => {
    if (seen.has(resource)) return;
    seen.add(resource);
    const count = counts[kind] ??= { allocated: 0, disposed: 0 };
    count.allocated++;
    resource.addEventListener('dispose', () => count.disposed++);
  };
  const batch = value => { observe(value.mesh, 'instanceMeshes'); observe(value.mesh.geometry, 'instanceGeometry'); };
  const sample = () => {
    observe(selection.material, 'materials'); observe(selection.quad, 'surfaceGeometry');
    for (const hull of selection.hulls.values()) observe(hull, 'hullGeometry');
    for (const value of selection.batches.values()) batch(value);
  };
  // A selection can grow several times in one draw. Observe its temporary
  // buffers before their normal release as well as the retained final batch.
  const release = selection.release;
  selection.release = function (value) { batch(value); return release.call(this, value); };
  sample();
  return { sample, stats: () => Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, { ...value, live: value.allocated - value.disposed }])) };
}

function validateMarkers(layer, frame, hover) {
  const expected = new Set([...frame.selectedIds, frame.hoveredId].filter(Boolean));
  const matrix = new THREE.Matrix4(), ink = new THREE.Color(), wantedInk = new THREE.Color();
  const observed = [], roles = new Set(), zones = new Set();
  for (const [key, batch] of layer.selection.batches) for (let index = 0; index < batch.mesh.count; index++) {
    batch.mesh.getMatrixAt(index, matrix); batch.mesh.getColorAt(index, ink);
    const e = matrix.elements;
    const unit = frame.snapshot.units.find(unit => {
      if (!expected.has(unit.id)) return false;
      const hull = geometry.shipProfile(unit);
      if (hull ? key !== `hull:${unit.kind}` : key !== 'surface') return false;
      const at = layer.positions.get(unit.id);
      return at && Math.hypot(at.x - e[12], at.y - e[14]) < .02;
    });
    if (!unit) throw new Error(`Unmatched actual marker ${key} at ${e[12]},${e[14]}`);
    expected.delete(unit.id);
    const role = relations.relationTo(frame.snapshot, frame.viewer, unit.owner);
    wantedInk.set(relations.RELATION_INK[role]);
    if (Math.max(Math.abs(ink.r - wantedInk.r), Math.abs(ink.g - wantedInk.g), Math.abs(ink.b - wantedInk.b)) > 1e-6) throw new Error(`Wrong ${role} marker color: ${unit.id}`);
    let zone = 'ground', height = .15;
    if (geometry.shipProfile(unit)) zone = 'hull';
    else if (unit.deck) {
      zone = 'deck';
      const ship = frame.snapshot.units.find(ship => ship.id === unit.deck.shipId);
      height += geometry.shipProfile(ship).deckHeight;
      const crossing = unit.gangway, surface = crossing && layer.gangwaySurfaces.get(crossing.sourceId);
      if (surface) {
        zone = 'bridge';
        const source = layer.shipPoses.get(crossing.sourceId), target = layer.shipPoses.get(crossing.targetId);
        const a = geometry.shipProfile(source).deckHeight, b = geometry.shipProfile(target).deckHeight;
        const span = Math.hypot(surface.target.x - surface.source.x, surface.target.y - surface.source.y);
        height = a + (b - a) * crossing.t + .15 * span / Math.hypot(span, b - a);
        const actualSlope = e[1] / Math.hypot(e[0], e[2]);
        if (Math.abs(actualSlope - (b - a) / span) > 1e-5) throw new Error('Bridge marker does not follow the actual sloped floor');
      }
    }
    if (Math.abs(e[13] - height) > .02) throw new Error(`Wrong ${zone} marker height: ${e[13]} versus ${height}`);
    const scale = geometry.shipProfile(unit) ? geometry.shipScale(unit) : 1;
    const width = (frame.selectedIds.has(unit.id) ? 3 : 2) / scale;
    if (Math.abs(batch.data.getZ(index) - width) > 1e-5) throw new Error(`Wrong selected/hover stroke: ${unit.id}`);
    if (!batch.mesh.visible || batch.mesh.material.depthTest !== true || batch.mesh.material.depthWrite !== false) throw new Error('Marker missing normal depth-buffer behavior');
    roles.add(role); zones.add(zone); observed.push(unit.id);
  }
  if (expected.size) throw new Error(`Selected/hovered actors have no marker: ${[...expected]}`);
  return { selected: frame.selectedIds.size, actualInstances: observed.length, roles: [...roles].sort(), zones: [...zones].sort(), hover: hover ? { ...hover, role: relations.relationTo(frame.snapshot, frame.viewer, hover.owner), selected: frame.selectedIds.has(hover.id) } : undefined };
}

async function resourceStats() {
  const loader = resources.resources;
  await Promise.all([...loader.images.values()].map(request => Promise.resolve(request).catch(() => undefined)));
  let retainedRawBytes = 0;
  for (const request of loader.requests.values()) {
    const value = await Promise.resolve(request).catch(() => undefined);
    if (value instanceof ArrayBuffer) retainedRawBytes += value.byteLength;
  }
  return {
    entries: loader.entries.size, requests: loader.requests.size, decodedImages: loader.decodedImages.size, retainedRawBytes,
    owned: Object.fromEntries(['entries', 'requests', 'images', 'decodedImages', 'retainedBytes', 'assetsByPath', 'sizesByUrl', 'assetsByStage', 'controllers', 'listeners'].map(key => [key, loader[key].size])),
    cacheStats: loader.cacheStats(), home: loader.summary('home'), match: loader.summary('match'),
  };
}

window.runtimeReview = {
  ready: true,
  async cycle(index) {
    const canvas = document.createElement('canvas'); canvas.id = 'world'; document.querySelector('#world').replaceWith(canvas);
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 unavailable');
    const layer = world.World3DLayer.create(canvas, gl);
    const markerResources = observeMarkerResources(layer.selection);
    const frame = {
      snapshot, ctx: document.createElement('canvas').getContext('2d'), view: { x: 0, y: 0, width: 1280, height: 720, zoom: .25 }, now: 0,
      facing: new facing.UnitFacingTracker(), animation: new animation.UnitAnimationTracker(), motion: new motion.UnitMotionSmoother(),
      viewer: 'player', selectedIds: largeSelection, labels: { mercenaryStock: () => '', unitKind: () => '' },
    };
    const start = performance.now(); await layer.prepare(snapshot, 'home'); const homeMs = performance.now() - start;
    const matchStart = performance.now(); await layer.prepare(snapshot, 'match'); const matchMs = performance.now() - matchStart;
    const interactionProofs = [];
    for (const hover of hoverCases) {
      frame.selectedIds = new Set([...smallSelection].filter(id => id !== hover.id)); frame.hoveredId = hover.id;
      layer.draw(frame); markerResources.sample(); interactionProofs.push(validateMarkers(layer, frame, hover));
    }
    frame.selectedIds = largeSelection; frame.hoveredId = undefined;
    layer.draw(frame); markerResources.sample();
    interactionProofs.push(validateMarkers(layer, frame));
    const portraitImages = kinds.map(key => Boolean(portraits.currentModelPortrait(`ships/${key}`, '#65908c')));
    if (portraitImages.some(ready => !ready) || !portraitProvider.drawModelPortrait(frame.ctx, 'ships/transport', 0, 0, 32, '#65908c')) throw new Error('Loaded ship portrait unavailable');
    const renderer = layer.renderer, realRender = renderer.render;
    // CPU scene preparation only: exclude WebGL rendering from these timing
    // samples. Interaction proofs above and the final frame use real rendering.
    renderer.render = () => {};
    const warm = [], changed = [];
    try {
      for (let n = 0; n < 120; n++) {
        frame.now = n * 1000 / 60;
        const at = performance.now(); layer.draw(frame); warm.push(performance.now() - at); markerResources.sample();
      }
      for (let n = 0; n < 120; n++) {
        frame.now = 2000 + n * 1000 / 60; frame.snapshot = sim.snapshotGame(game); frame.snapshot.tick = snapshot.tick + n + 1;
        const hover = hoverCases[n % hoverCases.length];
        frame.selectedIds = n % 2 ? new Set([...smallSelection].filter(id => id !== hover.id)) : largeSelection; frame.hoveredId = hover.id;
        const at = performance.now(); layer.draw(frame); changed.push(performance.now() - at); markerResources.sample();
      }
    } finally { renderer.render = realRender; }
    frame.selectedIds = largeSelection; frame.hoveredId = undefined;
    layer.draw(frame); markerResources.sample(); interactionProofs.push(validateMarkers(layer, frame));
    if (index === 5) window.runtimeReview.lastScreenshot = canvas.toDataURL('image/png');
    const before = stats(layer), markerResourcesBefore = markerResources.stats(), error = gl.getError();
    layer.dispose();
    const lossDeadline = performance.now() + 1000;
    while (!gl.isContextLost() && performance.now() < lossDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    const after = stats(layer, renderer), contextLost = gl.isContextLost(); discarded.push(layer);
    const summarize = values => {
      const sorted = [...values].sort((a, b) => a - b);
      return { meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length, p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1) };
    };
    return {
      index, homeMs, matchMs, staticCpu: summarize(warm), updatedCpu: summarize(changed), before, after,
      interactionProofs, markerResourcesBefore, markerResourcesAfter: markerResources.stats(), glError: error, contextLost, resources: await resourceStats(),
    };
  },
  async teardown() {
    // Mirrors main.ts pagehide ordering for the resources this fixture owns:
    // layers first, then request/decode caches, then UI portraits and models.
    for (const layer of discarded) layer.dispose();
    const sharedBefore = { ...models.worldModels.cacheStats(), parts: models.worldModels.parts.size };
    resources.resources.dispose();
    portraits.clearModelPortraits();
    models.worldModels.dispose();
    const ctx = document.createElement('canvas').getContext('2d');
    return {
      expectedModels, installedModels: Object.fromEntries(installedModels), sharedBefore,
      sharedAfter: { ...models.worldModels.cacheStats(), parts: models.worldModels.parts.size },
      portraitProviderCleared: !portraitProvider.drawModelPortrait(ctx, 'ships/transport', 0, 0, 32, '#65908c'),
      resources: await resourceStats(), retainedDisposedLayers: discarded.length, ownedMaps: discarded.map(layer => stats(layer)),
    };
  },
};
