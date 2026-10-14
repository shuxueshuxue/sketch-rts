// Appended to the real main module only by the correctness driver. The driver
// extracts its exact derived-minimap block into __drawPublishedMinimap; all
// adapter/lifecycle/command code and the production minimap brush remain live.
const __proofRows = [], __proofImages = [], __proofMarks = new WeakMap();
let __proofSerial = 0, __proofLast, __proofClock = 0;
const __proofAssert = (ok, why) => { if (!ok) throw Error(why); };
async function __proofSHA(bytes) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join(''); }
function __proofObserve(marks) {
  __proofAssert(!!snapshot, 'Minimap did not have a snapshot');
  const expected = __proofOriginalMarks(snapshot);
  __proofAssert(JSON.stringify(marks) === JSON.stringify(expected), 'Full-world derived marks differ');
  if (!__proofMarks.has(marks)) __proofMarks.set(marks, ++__proofSerial);
  const paint = (input, viewer) => {
    const output = document.createElement('canvas'); output.width = 240; output.height = 220;
    drawMinimapMap(output.getContext('2d'), snapshot, { x: 4, y: 5, width: 220, height: 200 }, input, viewer);
    return { canvas: output, rgba: output.getContext('2d').getImageData(0, 0, 240, 220).data };
  };
  const checks = [];
  for (const viewer of [undefined, localPlayerId]) {
    const original = paint(expected, viewer), cached = paint(marks, viewer);
    let different = 0;
    for (let n = 0; n < original.rgba.length; n++) different += Number(original.rgba[n] !== cached.rgba[n]);
    __proofAssert(different === 0, 'Complete original RGBA minimap pixels differ');
    checks.push({ viewer: viewer ?? null, comparedBytes: cached.rgba.length, different, canvas: cached.canvas, rgba: cached.rgba });
  }
  __proofLast = { snapshot, marks, row: { roomId: currentRoomId, tick: snapshot.tick,
    localRoom: !!currentRoomId && deploymentRuntime.isLocalRoom(currentRoomId), markIdentity: __proofMarks.get(marks),
    marks: marks.length, unitIds: snapshot.units.map(unit => unit.id), buildingIds: snapshot.buildings.map(building => building.id),
    resourceIds: snapshot.resources.map(resource => resource.id), campIds: snapshot.mercenaryCamps.map(camp => camp.id),
    expectedMarks: expected.length, checks } };
}
window.__runMinimapMainProof = async () => {
  // This controlled publication clock and suppressed RAF are only a lifecycle
  // test. No observed duration, browser FPS, world-render or GPU claim is made.
  Object.defineProperty(performance, 'now', { configurable: true, value: () => __proofClock });
  async function sample(label) {
    __drawPublishedMinimap();
    const { row } = __proofLast;
    const checks = [];
    for (const check of row.checks) {
      const name = `${label}-${check.viewer ?? 'owners'}.png`;
      const blob = await new Promise(done => check.canvas.toBlob(done, 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      __proofImages.push({ name, base64: btoa(String.fromCharCode(...bytes)), pngSHA256: await __proofSHA(bytes), rgbaSHA256: await __proofSHA(check.rgba) });
      checks.push({ viewer: check.viewer, comparedBytes: check.comparedBytes, different: check.different, image: name });
    }
    __proofRows.push({ label, ...row, checks });
    return __proofLast;
  }
  async function start(id, mapId) {
    const room = await deploymentRuntime.createRoom({ id, host: localUser, mapId, humanCount: 1, aiCount: 1, visibility: 'private' });
    const started = await deploymentRuntime.startRoom(room.id, localUser, handleRuntimeRoomUpdate);
    currentRoom = started.room; currentRoomId = started.room.id; localPlayerId = started.playerId;
    activateStartedMatch(started.adapter, started.snapshot, started.chat);
    menuOpen = false;
  }
  await start('minimap-proof-one', 'bareDuel');
  const initial = await sample('initial');
  for (let frame = 0; frame < 3; frame++) {
    __proofAssert(syncActiveGameAdapterSnapshot(), 'Native frontend sync failed');
    const steady = await sample(`steady-${frame}`);
    __proofAssert(steady.snapshot === initial.snapshot && steady.marks === initial.marks, 'Unchanged local publication rebuilt');
  }
  __proofAssert(syncBeforeCommandProjection(), 'Native input projection failed');
  const worker = snapshot.units.find(unit => unit.owner === localPlayerId && unit.kind === 'worker');
  __proofAssert(!!worker, 'Real local world has no worker');
  __proofAssert(sendCommand({ type: 'move', unitIds: [worker.id], x: worker.x + 200, y: worker.y }), 'Native command failed');
  __proofAssert(syncActiveGameAdapterSnapshot(), 'Post-command projection failed');
  const command = await sample('command');
  __proofAssert(command.snapshot !== initial.snapshot && command.marks !== initial.marks, 'Local command left obsolete marks');
  __proofClock += 50;
  __proofAssert(syncActiveGameAdapterSnapshot(), 'Render-time advance projection failed');
  const advanced = await sample('advanced');
  __proofAssert(advanced.snapshot !== command.snapshot && advanced.marks !== command.marks, 'Simulation advance left obsolete marks');
  minimapRelations = true;
  const relations = await sample('relations');
  __proofAssert(relations.marks === advanced.marks, 'Relations needlessly rebuilt geometry marks');
  openMenuRoute({ screen: 'home' });
  __proofAssert(menuOpen && currentRoomId === undefined, 'Native home return did not disconnect');
  // Verify reset through the actual disconnect chain without retaining this
  // manual read: the next start resets again through activateStartedMatch.
  __proofAssert(minimapPresentation.read(advanced.snapshot, advanced.snapshot) !== advanced.marks, 'Home return retained the old publication');
  await start('minimap-proof-two', 'verdantCrossroads');
  const second = await sample('new-room');
  __proofAssert(second.snapshot.map.id === 'verdantCrossroads' && second.marks !== advanced.marks, 'New room reused the old marks');
  const latest = second.snapshot, latestMarks = second.marks;
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  __proofAssert(applicationClosed && snapshot === undefined, 'Native pagehide did not release the app');
  __proofAssert(minimapPresentation.read(latest, latest) !== latestMarks, 'Pagehide retained minimap marks');
  return { passed: true, rows: __proofRows, images: __proofImages, uniqueCachedMarkArrays: __proofSerial,
    adjustments: ['Import real main after resources.initialize; do not call initializeVisuals or prepare model/audio payloads.',
      'Suppress RAF and use a controlled performance.now publication clock. This is correctness only.',
      'Start real private rooms through the existing deployment runtime, then real activate/sync/command/home/pagehide paths.',
      'Execute the exact extracted main derived-minimap block; its real drawMinimap brush and wind/viewport calls remain unchanged.',
      'Separate original-builder and cached mark brush outputs compare all original RGBA, including transparent RGB, for owner and relation views.'] };
};
