import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from '/src/shared/sim.ts';
import { checksumGame } from '/src/shared/sim/checksum.ts';
import { SimulationEngine } from '/src/shared/sim/engine.ts';
import { LockstepClient } from '/src/client/net/lockstep-client.ts';
import { advanceShipRouteSearch } from '/src/shared/ship-navigation.ts';
import { shipTraffic } from '/src/shared/ship-avoidance.ts';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
function restored(source) {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.scriptedVictory = true;
  restoreSnapshotIntoGame(game, JSON.parse(JSON.stringify(snapshotGame(source))), source.nextId);
  return game;
}

async function run() {
  const source = createGame('bareDuel', { aiPlayers: [] });
  source.units = []; source.items = []; source.buildings = []; source.resources = [];
  source.mercenaryCamps = []; source.obstacles = []; source.scriptedVictory = true;
  const cell = 64, cols = 256, rows = 256;
  source.map = { ...source.map, width: cols * cell, height: rows * cell, wind: { direction: Math.PI, speed: 80 },
    terrain: { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, index) => {
      const x = index % cols, y = Math.floor(index / cols);
      return x >= 65 && x < 85 && y >= 67 && y < 112 ? '.' : '~';
    }).join('') } };
  const ship = source.spawnUnit('player', 'warship', 1800, 5660);
  ship.sailing.heading = 0;
  issuePlayerCommand(source, 'player', { type: 'move', unitIds: [ship.id], x: 9000, y: 5660, avoidCombat: true });
  let savedJob;
  for (let tick = 0; tick < 80; tick++) {
    stepGame(source);
    savedJob = ship.sailing.planningJob && JSON.parse(ship.sailing.planningJob);
    if (savedJob?.phase === 'reference' && savedJob.searchSteps >= 19) break;
  }
  assert(savedJob?.phase === 'reference' && savedJob.searchSteps >= 19, 'Missing actual deep island checkpoint');
  const search = { phase: 'prepare' }, traffic = shipTraffic(savedJob.ship, savedJob.traffic);
  assert(!traffic.hasTraffic, 'The fixture unexpectedly has nearby traffic');
  for (let slice = 0; slice < savedJob.searchSteps; slice++) {
    assert(!advanceShipRouteSearch(source.map, savedJob.ship, savedJob.goal, traffic, Infinity, true, search), 'Saved cursor exceeds its actual search');
  }
  assert(search.visited > 50_000, 'The actual saved search did not exceed 50,000 expansions');
  const game = restored(source), reference = new SimulationEngine(restored(source));
  const frames = [
    { roomId: 'cold-browser', tick: game.tick, sequence: 0, commands: [] },
    { roomId: 'cold-browser', tick: game.tick + 1, sequence: 1, commands: [{ playerId: 'player', command: { type: 'stop', unitIds: [ship.id] } }] },
  ];
  const synchronousStarted = performance.now();
  reference.advanceFrame(frames[0]);
  const synchronousColdFirstFrameMs = performance.now() - synchronousStarted;
  reference.advanceFrame(frames[1]);
  const sent = [];
  let onMessage;
  const transport = { send: message => sent.push(message), onMessage: handler => { onMessage = handler; }, close() {} };
  const client = new LockstepClient({ roomId: 'cold-browser', playerId: 'player', engine: new SimulationEngine(game), transport, checksumEveryTicks: 1 });
  client.receiveFrame(frames[0]);
  const canvas = document.querySelector('canvas'), context = canvas.getContext('2d');
  const renders = [];
  let waitingRenders = 0, paintedWhileWaiting = 0;
  let previousRafTime;
  await new Promise((resolve, reject) => {
    function render(rafTime) {
      try {
        const renderStarted = performance.now();
        const index = renders.length;
        if (index === 3) {
          onMessage({ type: 'frame', frame: frames[1], epoch: 0 });
          onMessage({ type: 'frame', frame: frames[1], epoch: 0 });
        }
        const before = JSON.stringify(snapshotGame(game)), beforeHash = checksumGame(game), beforeTick = game.tick;
        const started = performance.now(), changed = client.updateToRenderTime(), elapsedMs = performance.now() - started;
        const record = { index, beforeTick, tick: game.tick, changed, elapsedMs, rafTime,
          rafGapMs: previousRafTime === undefined ? null : rafTime - previousRafTime };
        previousRafTime = rafTime;
        renders.push(record);
        if (!changed) {
          waitingRenders++;
          assert(JSON.stringify(snapshotGame(game)) === before, 'Preparation changed authoritative state');
          assert(checksumGame(game) === beforeHash, 'Preparation changed checksum');
        }
        context.fillStyle = '#17272c'; context.fillRect(0, 0, canvas.width, canvas.height);
        for (const previous of renders) {
          context.fillStyle = previous.changed ? '#66dc93' : '#55c5e6';
          context.fillRect(20 + previous.index * 10, 32, 8, 24);
        }
        context.fillStyle = '#fff'; context.font = '18px sans-serif';
        context.fillText(`Render ${index + 1}, authoritative tick ${game.tick}`, 20, 105);
        if (!changed) paintedWhileWaiting++;
        record.renderTotalMs = performance.now() - renderStarted;
        if (game.tick === source.tick + 2) resolve();
        else {
          assert(index < 48, 'Restored client did not consume both frames');
          requestAnimationFrame(render);
        }
      } catch (error) { reject(error); }
    }
    requestAnimationFrame(render);
  });
  assert(waitingRenders >= 18, 'Cold search was reconstructed synchronously');
  assert(paintedWhileWaiting === waitingRenders, 'The canvas did not draw while recovery was pending');
  assert(JSON.stringify(snapshotGame(game)) === JSON.stringify(reference.snapshot()), 'Recovered complete state differs from synchronous simulation');
  assert(checksumGame(game) === reference.checksum(), 'Recovered checksum differs from synchronous simulation');
  assert(JSON.stringify(sent.filter(message => message.type === 'checksum').map(message => message.tick)) === JSON.stringify([source.tick + 1, source.tick + 2]), 'Buffered frames skipped or duplicated checksums');
  client.close();
  const closedGame = restored(source), closedBefore = JSON.stringify(snapshotGame(closedGame));
  let closeMessages, closeCalls = 0;
  const closedTransport = { send() {}, onMessage: handler => { closeMessages = handler; }, close() { closeCalls++; } };
  const interrupted = new LockstepClient({ roomId: 'cold-browser', playerId: 'player', engine: new SimulationEngine(closedGame), transport: closedTransport });
  interrupted.receiveFrame(frames[0]);
  const closeRenders = [];
  await new Promise((resolve, reject) => {
    let index = 0;
    function render() {
      try {
        if (index === 3) {
          interrupted.close();
          const replacement = createGame('campRush', { aiPlayers: [] });
          closeMessages({ type: 'checkpoint', checkpoint: { roomId: 'cold-browser', tick: 0, snapshot: snapshotGame(replacement), nextId: replacement.nextId }, epoch: 2 });
          interrupted.receiveFrame(frames[0]);
        }
        const started = performance.now(), changed = interrupted.updateToRenderTime(), elapsedMs = performance.now() - started;
        assert(!changed && JSON.stringify(snapshotGame(closedGame)) === closedBefore, 'Closed or pending client changed authoritative state');
        closeRenders.push({ index, closed: index >= 3, elapsedMs, changed });
        context.fillStyle = '#17272c'; context.fillRect(0, 112, canvas.width, 42);
        context.fillStyle = '#fff'; context.fillText(`Recovery exact; closed restore cancelled (${index + 1}/5)`, 20, 135);
        if (++index === 5) resolve(); else requestAnimationFrame(render);
      } catch (error) { reject(error); }
    }
    requestAnimationFrame(render);
  });
  assert(closeCalls === 1, 'Close did not dispose the interrupted transport exactly once');
  return { passed: true, browser: navigator.userAgent, savedTick: source.tick, priorLogicalSlices: savedJob.searchSteps, reconstructedVisitedNodes: search.visited,
    jobBytes: ship.sailing.planningJob.length, waitingRenders, paintedWhileWaiting, synchronousColdFirstFrameMs,
    blockedRenderStateAndChecksumAssertions: waitingRenders, incomingAndDuplicateFrameDuringPreparation: true,
    completeFinalStateAndChecksumEqual: true, closedPartialRestoreCancelled: true, closeCalls, closeRenders,
    maximumClientRenderUpdateMs: Math.max(...renders.map(render => render.elapsedMs)),
    maximumMeasuredRenderTotalMs: Math.max(...renders.map(render => render.renderTotalMs)),
    clientRenderUpdatesOver50Ms: renders.filter(render => render.elapsedMs > 50).length,
    finalChecksum: checksumGame(game), renders,
    scope: 'Actual Chromium requestAnimationFrame and production LockstepClient. Client update timings exclude fixture setup, checksum assertions and canvas paint; this is a recovery scheduling check, not a full-game FPS benchmark.' };
}

run().then(result => { window.__coldRestoreResult = { ...result, done: true }; })
  .catch(error => { window.__coldRestoreResult = { passed: false, error: String(error.stack || error), done: true }; });
