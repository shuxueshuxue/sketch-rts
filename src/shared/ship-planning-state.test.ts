import { describe, expect, it } from 'vitest';
import { boardUnit, deckPlacement, syncDecks } from './decks';
import { localToWorld, shipProfile } from './ship-geometry';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame, type Game } from './sim';
import { checksumGame } from './sim/checksum';
import { advanceShipRouteSearch, hullFits, type ShipRouteSearchState } from './ship-navigation';
import { shipTraffic } from './ship-avoidance';
import { advanceShipPlanningJob, prepareShipPlanningJob, prepareShipPlanningJobs, prepareRestoredShipPlanning } from './ship-planning-job';
import { beginShipPlanningFrame, tryAdmitShipPlan } from './ship-planning-budget';

function shipWithSavedWork() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  game.map = { ...game.map, width: 4000, height: 3000,
    wind: { direction: Math.PI / 2, speed: 80 },
    terrain: { cell: 100, cols: 40, rows: 30, cells: '~'.repeat(1200) } };
  const ship = game.spawnUnit('player', 'warship', 1000, 1000);
  ship.order = { type: 'move', x: 1800, y: 1200 };
  // Snapshot and command boundaries preserve the opaque codec without
  // inspecting a particular planner's internal phases or node records.
  const payload = JSON.stringify({ values: [{ state: 2, value: 1.0000000000000002 }, { state: 1, value: 3.5 }] });
  ship.sailing!.planningJob = payload;
  ship.sailing!.planningJobLastRequestedAtTick = game.tick;
  syncDecks(game.units);
  return { game, ship, payload };
}

function coastalVoyage(withTraffic = false) {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  game.mercenaryCamps = []; game.obstacles = []; game.scriptedVictory = true;
  const cell = 100, cols = 100, rows = 100;
  game.map = { ...game.map, width: cols * cell, height: rows * cell, wind: { direction: 0, speed: 80 },
    terrain: { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, index) => {
      const x = index % cols, y = Math.floor(index / cols);
      return x >= 46 && x <= 50 && y >= 45 && y <= 55 ? '.' : '~';
    }).join('') } };
  const ship = game.spawnUnit('player', 'transport', 4000, 5000);
  ship.sailing!.heading = 0;
  const crew = game.spawnUnit('player', 'footman', ship.x, ship.y);
  if (withTraffic) game.spawnUnit('player', 'cutter', 4200, 4750);
  expect(boardUnit(ship, crew, game.units)).toBe(true);
  const profile = shipProfile(ship)!;
  const berth = deckPlacement(ship, crew, game.units, { x: profile.length * .3, y: profile.beam * .2 });
  expect(berth).toBeDefined();
  expect(Math.hypot(berth!.x - crew.deck!.x, berth!.y - crew.deck!.y)).toBeGreaterThan(20);
  issuePlayerCommand(game, 'player', { type: 'move', unitIds: [crew.id], ...localToWorld(ship, berth!) });
  issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 5700, y: 5000, avoidCombat: true });
  syncDecks(game.units);
  stepGame(game);
  expect(ship.sailing!.planningJob).toBeDefined();
  expect(shipTraffic(ship, game.units).hasTraffic).toBe(withTraffic);
  return { game, ship, crew };
}

function restoredCopy(source: Game) {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.scriptedVictory = true;
  restoreSnapshotIntoGame(game, JSON.parse(JSON.stringify(snapshotGame(source))), source.nextId);
  return game;
}

function largeIslandVoyage(startingTick=0) {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  game.mercenaryCamps = []; game.obstacles = []; game.scriptedVictory = true;
  game.tick = startingTick;
  const cell = 64, cols = 256, rows = 256;
  game.map = { ...game.map, width: cols * cell, height: rows * cell, wind: { direction: Math.PI, speed: 80 },
    terrain: { cell, cols, rows, cells: Array.from({ length: cols * rows }, (_, index) => {
      const x = index % cols, y = Math.floor(index / cols);
      return x >= 65 && x < 85 && y >= 67 && y < 112 ? '.' : '~';
    }).join('') } };
  const ship = game.spawnUnit('player', 'warship', 1800, 5660);
  ship.sailing!.heading = 0;
  issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 9000, y: 5660, avoidCombat: true });
  syncDecks(game.units);
  return { game, ship };
}

describe('saved incremental ship planning state', () => {
  it('preserves the exact encoded state in independent snapshots and JSON restoration', () => {
    const { game, ship, payload } = shipWithSavedWork();
    const saved = snapshotGame(game);
    expect(saved.units[0]!.sailing).not.toBe(ship.sailing);
    expect(saved.units[0]!.sailing!.planningJob).toBe(payload);
    expect(saved.units[0]!.sailing!.planningJobLastRequestedAtTick).toBe(game.tick);
    const restored = createGame('bareDuel', { aiPlayers: [] });
    restoreSnapshotIntoGame(restored, JSON.parse(JSON.stringify(saved)), game.nextId);
    expect(JSON.parse(JSON.stringify(snapshotGame(restored)))).toEqual(JSON.parse(JSON.stringify(saved)));
    expect(checksumGame(restored)).toBe(checksumGame(game));
    ship.sailing!.planningJob = 'live changed';
    expect(saved.units[0]!.sailing!.planningJob).toBe(payload);
    expect(restored.units[0]!.sailing!.planningJob).toBe(payload);
    saved.units[0]!.sailing!.planningJob = 'saved changed';
    expect(restored.units[0]!.sailing!.planningJob).toBe(payload);
  });

  it('hashes fine floating differences and ordered records without rounding or sorting the codec', () => {
    const { game, ship, payload } = shipWithSavedWork();
    const original = checksumGame(game);
    ship.sailing!.planningJob = payload.replace('1.0000000000000002', '1');
    expect(checksumGame(game)).not.toBe(original);
    const data = JSON.parse(payload);
    data.values.reverse();
    ship.sailing!.planningJob = JSON.stringify(data);
    expect(checksumGame(game)).not.toBe(original);
    ship.sailing!.planningJob = payload;
    expect(checksumGame(game)).toBe(original);
    delete ship.sailing!.planningJob;
    expect(checksumGame(game)).not.toBe(original);
  });

  it.each(['move', 'stop', 'holdPosition'] as const)('discards work when an immediate %s command replaces the authority', command => {
    const { game, ship } = shipWithSavedWork();
    if (command === 'move') issuePlayerCommand(game, 'player', { type: command, unitIds: [ship.id], x: 2400, y: 1000 });
    else issuePlayerCommand(game, 'player', { type: command, unitIds: [ship.id] });
    expect(ship.sailing!.planningJob).toBeUndefined();
    expect(ship.sailing!.planningJobLastRequestedAtTick).toBeUndefined();
  });

  it('keeps the current work when a later movement is only queued', () => {
    const { game, ship, payload } = shipWithSavedWork();
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [ship.id], x: 2400, y: 1000, queued: true });
    expect(ship.sailing!.planningJob).toBe(payload);
    expect(ship.sailing!.planningJobLastRequestedAtTick).toBe(game.tick);
    expect(ship.order).toEqual({ type: 'move', x: 1800, y: 1200 });
    expect(ship.orderQueue).toHaveLength(1);
  });

  it('keeps a genuinely finished route while FIFO admission waits four frames', () => {
    const { game, ship } = coastalVoyage();
    let result: ReturnType<typeof advanceShipPlanningJob>;
    for (let slice = 0; !result && slice < 300; slice++) result = advanceShipPlanningJob(ship, game.map);
    expect(result?.points.length).toBeGreaterThan(0);
    const finished = ship.sailing!.planningJob!;
    expect(JSON.parse(finished).phase).toBe('finished');
    const blockers = Array.from({ length: 4 }, (_, index) => {
      const unit = game.spawnUnit('player', 'warship', 1000, 1000 + index * 300);
      unit.order = { type: 'move', x: 3000, y: unit.y };
      unit.sailing!.planningRequestedAtTick = index;
      unit.sailing!.planningLastRequestedAtTick = 9;
      return unit;
    });
    ship.sailing!.planningRequestedAtTick = 8;
    ship.sailing!.planningLastRequestedAtTick = 9;
    ship.sailing!.planningJobLastRequestedAtTick = 9;
    for (let tick = 10; tick < 14; tick++) {
      beginShipPlanningFrame(game.units, tick);
      for (const blocker of blockers) expect(tryAdmitShipPlan(blocker)).toBe(blocker === blockers[tick - 10]);
      expect(tryAdmitShipPlan(ship)).toBe(false);
      expect(ship.sailing!.planningJob).toBe(finished);
      expect(ship.sailing!.planningJobLastRequestedAtTick).toBe(tick);
    }
    beginShipPlanningFrame(game.units, 14);
    expect(tryAdmitShipPlan(ship)).toBe(true);
    expect(advanceShipPlanningJob(ship, game.map)).toEqual(result);
  });

  it('restores a compact actual island checkpoint after more than 50,000 expansions', () => {
    const { game, ship } = largeIslandVoyage();
    let checkpoint: { ship: typeof ship; traffic: typeof game.units; goal: { x: number; y: number }; searchSteps: number } | undefined;
    for (let tick = 0; tick < 80 && !checkpoint; tick++) {
      stepGame(game);
      const saved = ship.sailing!.planningJob && JSON.parse(ship.sailing!.planningJob);
      if (saved?.phase === 'reference' && saved.searchSteps >= 19) checkpoint = saved;
    }
    expect(checkpoint, 'the authored adverse-wind island still requires a large search').toBeDefined();
    const state: ShipRouteSearchState = { phase: 'prepare' };
    const traffic = shipTraffic(checkpoint!.ship, checkpoint!.traffic);
    expect(traffic.hasTraffic).toBe(false);
    for (let slice = 0; slice < checkpoint!.searchSteps; slice++) {
      expect(advanceShipRouteSearch(game.map, checkpoint!.ship, checkpoint!.goal, traffic, Infinity, true, state)).toBeUndefined();
    }
    expect(state.visited).toBeGreaterThan(50_000);
    expect(ship.sailing!.planningJob!.length).toBeLessThan(16_384);
    const resumed = restoredCopy(game);
    expect(checksumGame(resumed)).toBe(checksumGame(game));
    let completed = false;
    for (let tick = 0; tick < 80; tick++) {
      stepGame(game); stepGame(resumed);
      expect(JSON.parse(JSON.stringify(snapshotGame(resumed))), `large replay tick ${tick}`)
        .toEqual(JSON.parse(JSON.stringify(snapshotGame(game))));
      expect(checksumGame(resumed), `large checksum tick ${tick}`).toBe(checksumGame(game));
      expect(hullFits(game.map, ship), `large coast clearance tick ${tick}`).toBe(true);
      completed ||= !ship.sailing!.planningJob && !!ship.sailing!.route?.points.length;
    }
    expect(completed).toBe(true);
  });

  it('prepares an actual deep restored search across yields without changing saved authority', () => {
    const { game, ship } = largeIslandVoyage();
    let cursor = 0;
    for (let tick = 0; tick < 80 && cursor < 19; tick++) {
      stepGame(game);
      const saved = ship.sailing!.planningJob && JSON.parse(ship.sailing!.planningJob);
      cursor = saved?.phase === 'reference' ? saved.searchSteps ?? 0 : 0;
    }
    expect(cursor).toBeGreaterThanOrEqual(19);
    const resumed = restoredCopy(game);
    const partiallyPrepared = restoredCopy(game);
    expect(prepareShipPlanningJobs(partiallyPrepared)).toBe(false);
    const before = JSON.stringify(snapshotGame(resumed)), hash = checksumGame(resumed);
    expect(prepareShipPlanningJobs(resumed, 0)).toBe(false);
    let calls = 0, ready = false;
    while (!ready && calls <= cursor) {
      ready = prepareShipPlanningJobs(resumed);
      calls++;
      expect(JSON.stringify(snapshotGame(resumed)), `yield ${calls} authority`).toBe(before);
      expect(checksumGame(resumed), `yield ${calls} checksum`).toBe(hash);
    }
    expect(ready).toBe(true);
    expect(calls).toBe(cursor);
    expect(prepareShipPlanningJobs(resumed, 0)).toBe(true);
    stepGame(game); stepGame(resumed); stepGame(partiallyPrepared);
    expect(JSON.parse(JSON.stringify(snapshotGame(resumed))))
      .toEqual(JSON.parse(JSON.stringify(snapshotGame(game))));
    expect(resumed.nextId).toBe(game.nextId);
    expect(checksumGame(resumed)).toBe(checksumGame(game));
    expect(JSON.parse(JSON.stringify(snapshotGame(partiallyPrepared))))
      .toEqual(JSON.parse(JSON.stringify(snapshotGame(game))));
    expect(checksumGame(partiallyPrepared)).toBe(checksumGame(game));
  });

  it('shares one preparation slice across a real two-ship checkpoint in unit-order FIFO', () => {
    const { game, ship } = largeIslandVoyage();
    const second = game.spawnUnit('player', 'warship', 1800, 6500);
    second.sailing!.heading = 0;
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [second.id], x: 9000, y: 6500, avoidCombat: true });
    let cursors: number[] = [];
    for (let tick = 0; tick < 80; tick++) {
      stepGame(game);
      cursors = [ship, second].map(unit => {
        const job = unit.sailing!.planningJob && JSON.parse(unit.sailing!.planningJob);
        return job?.phase === 'reference' ? job.searchSteps ?? 0 : 0;
      });
      if (cursors.every(value => value >= 3)) break;
    }
    expect(cursors.every(value => value >= 3)).toBe(true);
    const resumed = restoredCopy(game), hulls = [ship, second].map(unit => resumed.units.find(copy => copy.id === unit.id)!);
    const before = JSON.stringify(snapshotGame(resumed)), hash = checksumGame(resumed);
    const total = cursors[0]! + cursors[1]!;
    for (let call = 1; call <= total; call++) {
      expect(prepareRestoredShipPlanning(resumed.units, resumed.map), `call ${call} global readiness`).toBe(call === total);
      expect(prepareShipPlanningJob(hulls[0]!, resumed.map, 0), `call ${call} first hull`).toBe(call >= cursors[0]!);
      expect(prepareShipPlanningJob(hulls[1]!, resumed.map, 0), `call ${call} second hull`).toBe(call === total);
      expect(JSON.stringify(snapshotGame(resumed))).toBe(before);
      expect(checksumGame(resumed)).toBe(hash);
    }
    stepGame(game); stepGame(resumed);
    expect(JSON.parse(JSON.stringify(snapshotGame(resumed))))
      .toEqual(JSON.parse(JSON.stringify(snapshotGame(game))));
    expect(checksumGame(resumed)).toBe(checksumGame(game));
  });

  it('drops partially reconstructed caches when a command or a fresh snapshot replaces them', () => {
    const { game, ship } = largeIslandVoyage();
    let cursor = 0;
    for (let tick = 0; tick < 80 && cursor < 3; tick++) {
      stepGame(game);
      const saved = ship.sailing!.planningJob && JSON.parse(ship.sailing!.planningJob);
      cursor = saved?.phase === 'reference' ? saved.searchSteps ?? 0 : 0;
    }
    expect(cursor).toBeGreaterThanOrEqual(3);
    const resumed = restoredCopy(game);
    expect(prepareShipPlanningJobs(resumed)).toBe(false);
    const oldUnit = resumed.units.find(unit => unit.id === ship.id)!;
    restoreSnapshotIntoGame(resumed, JSON.parse(JSON.stringify(snapshotGame(game))), game.nextId);
    expect(resumed.units.find(unit => unit.id === ship.id)).not.toBe(oldUnit);
    let calls = 0;
    while (!prepareShipPlanningJobs(resumed) && calls <= cursor) calls++;
    expect(calls + 1).toBe(cursor);
    stepGame(game); stepGame(resumed);
    expect(JSON.parse(JSON.stringify(snapshotGame(resumed))))
      .toEqual(JSON.parse(JSON.stringify(snapshotGame(game))));
    const canceled = restoredCopy(game);
    expect(prepareShipPlanningJobs(canceled)).toBe(false);
    issuePlayerCommand(canceled, 'player', { type: 'stop', unitIds: [ship.id] });
    expect(canceled.units.find(unit => unit.id === ship.id)!.sailing!.planningJob).toBeUndefined();
    expect(prepareShipPlanningJobs(canceled)).toBe(true);
  });

  it('skips a partially prepared old-wind graph while leaving cancellation to the next simulation tick', () => {
    const { game, ship } = largeIslandVoyage();
    let cursor = 0;
    for (let tick = 0; tick < 80 && cursor < 3; tick++) {
      stepGame(game);
      const saved = ship.sailing!.planningJob && JSON.parse(ship.sailing!.planningJob);
      cursor = saved?.phase === 'reference' ? saved.searchSteps ?? 0 : 0;
    }
    expect(cursor).toBeGreaterThanOrEqual(3);
    const resumed = restoredCopy(game);
    expect(prepareShipPlanningJobs(resumed)).toBe(false);
    const encoded = resumed.units.find(unit => unit.id === ship.id)!.sailing!.planningJob;
    resumed.map.wind = { direction: Math.PI / 3, speed: 80 };
    const untouched = JSON.stringify(snapshotGame(resumed)), hash = checksumGame(resumed);
    expect(prepareShipPlanningJobs(resumed, 0)).toBe(true);
    expect(prepareShipPlanningJobs(resumed)).toBe(true);
    expect(JSON.stringify(snapshotGame(resumed))).toBe(untouched);
    expect(checksumGame(resumed)).toBe(hash);
    expect(resumed.units.find(unit => unit.id === ship.id)!.sailing!.planningJob).toBe(encoded);
    const control = restoredCopy(resumed);
    stepGame(resumed); stepGame(control);
    expect(resumed.units.find(unit => unit.id === ship.id)!.sailing!.planningJob).not.toBe(encoded);
    expect(JSON.parse(JSON.stringify(snapshotGame(resumed))))
      .toEqual(JSON.parse(JSON.stringify(snapshotGame(control))));
    expect(checksumGame(resumed)).toBe(checksumGame(control));
  });

  it('skips an abandoned stunned-ship checkpoint that ordinary next-tick pruning will cancel', () => {
    const { game, ship } = largeIslandVoyage();
    let cursor = 0;
    for (let tick = 0; tick < 80 && cursor < 19; tick++) {
      stepGame(game);
      const saved = ship.sailing!.planningJob && JSON.parse(ship.sailing!.planningJob);
      cursor = saved?.phase === 'reference' ? saved.searchSteps ?? 0 : 0;
    }
    expect(cursor).toBeGreaterThanOrEqual(19);
    const encoded = ship.sailing!.planningJob, requested = ship.sailing!.planningJobLastRequestedAtTick;
    ship.effects.push({ type: 'stun', remaining: 10 });
    // Being stunned alone does not abandon a current request: it can still
    // resume before ordinary pruning expires it on a later tick.
    expect(prepareShipPlanningJobs(restoredCopy(game), 0)).toBe(false);
    stepGame(game);
    expect(ship.sailing!.planningJob).toBe(encoded);
    expect(ship.sailing!.planningJobLastRequestedAtTick).toBe(requested);
    expect(requested).toBe(game.tick - 1);
    const resumed = restoredCopy(game), before = JSON.stringify(snapshotGame(resumed)), hash = checksumGame(resumed);
    expect(prepareShipPlanningJobs(resumed, 0)).toBe(true);
    expect(prepareShipPlanningJobs(resumed)).toBe(true);
    expect(JSON.stringify(snapshotGame(resumed))).toBe(before);
    expect(checksumGame(resumed)).toBe(hash);
    expect(resumed.units.find(unit => unit.id === ship.id)!.sailing!.planningJob).toBe(encoded);
    stepGame(game); stepGame(resumed);
    expect(ship.sailing!.planningJob).toBeUndefined();
    expect(resumed.units.find(unit => unit.id === ship.id)!.sailing!.planningJob).toBeUndefined();
    expect(JSON.parse(JSON.stringify(snapshotGame(resumed))))
      .toEqual(JSON.parse(JSON.stringify(snapshotGame(game))));
    expect(checksumGame(resumed)).toBe(checksumGame(game));
  });

  it('skips an old-wind checkpoint immediately before the deterministic eight-minute boundary', () => {
    const { game, ship } = largeIslandVoyage(9594);
    while (game.tick < 9599) stepGame(game);
    const encoded = ship.sailing!.planningJob!;
    const job = JSON.parse(encoded);
    expect(job.phase).toBe('reference');
    expect(job.searchSteps).toBeGreaterThanOrEqual(19);
    expect(ship.sailing!.planningJobLastRequestedAtTick).toBe(9599);
    const resumed = restoredCopy(game), before = JSON.stringify(snapshotGame(resumed)), hash = checksumGame(resumed);
    expect(prepareShipPlanningJobs(resumed, 0)).toBe(true);
    expect(prepareShipPlanningJobs(resumed)).toBe(true);
    expect(JSON.stringify(snapshotGame(resumed))).toBe(before);
    expect(checksumGame(resumed)).toBe(hash);
    expect(resumed.units.find(unit => unit.id === ship.id)!.sailing!.planningJob).toBe(encoded);
    const oldWind = { ...resumed.map.wind! };
    stepGame(game); stepGame(resumed);
    expect(resumed.tick).toBe(9600);
    expect(resumed.map.wind!.changedAtTick).toBe(9600);
    expect(resumed.map.wind!.direction).not.toBe(oldWind.direction);
    expect(resumed.units.find(unit => unit.id === ship.id)!.sailing!.planningJob).not.toBe(encoded);
    expect(JSON.parse(JSON.stringify(snapshotGame(resumed))))
      .toEqual(JSON.parse(JSON.stringify(snapshotGame(game))));
    expect(checksumGame(resumed)).toBe(checksumGame(game));
  });

  it.each(['finish', 'wind change', 'new command', 'nearby traffic'] as const)('replays an actual pending coastal job for 300 ticks through %s and moving deck crew', change => {
    const { game, ship, crew } = coastalVoyage(change === 'nearby traffic');
    const resumed = restoredCopy(game), initialJob = ship.sailing!.planningJob!;
    const deckStart = { ...crew.deck! }, start = { x: ship.x, y: ship.y };
    let minimumBalance = ship.sailing!.balance, maximumBalance = minimumBalance;
    if (change === 'wind change') {
      game.map.wind = { direction: Math.PI / 3, speed: 80 };
      resumed.map.wind = { ...game.map.wind };
    } else if (change === 'new command') {
      for (const world of [game, resumed]) issuePlayerCommand(world, 'player', {
        type: 'move', unitIds: [ship.id], x: 6000, y: 5000, avoidCombat: true,
      });
      expect(ship.sailing!.planningJob).toBeUndefined();
    }
    let completed = false, pendingBoundaries = 0;
    for (let tick = 0; tick < 300; tick++) {
      // A fresh world at each saved-work boundary proves the next phase does
      // not rely on the original decoded cache or warm map geometry.
      const cold = ship.sailing!.planningJob ? restoredCopy(game) : undefined;
      if (cold) { pendingBoundaries++; stepGame(cold); }
      stepGame(game); stepGame(resumed);
      const state = JSON.parse(JSON.stringify(snapshotGame(game)));
      expect(JSON.parse(JSON.stringify(snapshotGame(resumed))), `continuous replay tick ${tick}`).toEqual(state);
      expect(checksumGame(resumed), `continuous checksum tick ${tick}`).toBe(checksumGame(game));
      if (cold) {
        expect(JSON.parse(JSON.stringify(snapshotGame(cold))), `cold phase tick ${tick}`).toEqual(state);
        expect(checksumGame(cold), `cold checksum tick ${tick}`).toBe(checksumGame(game));
      }
      expect(hullFits(game.map, ship), `coast clearance tick ${tick}`).toBe(true);
      completed ||= !ship.sailing!.planningJob && !!ship.sailing!.route?.points.length;
      minimumBalance = Math.min(minimumBalance, ship.sailing!.balance);
      maximumBalance = Math.max(maximumBalance, ship.sailing!.balance);
    }
    expect(pendingBoundaries).toBeGreaterThan(0);
    expect(completed).toBe(true);
    expect(ship.sailing!.planningJob).not.toBe(initialJob);
    expect(Math.hypot(ship.x - start.x, ship.y - start.y)).toBeGreaterThan(20);
    expect(Math.hypot(crew.deck!.x - deckStart.x, crew.deck!.y - deckStart.y)).toBeGreaterThan(1);
    expect(maximumBalance - minimumBalance).toBeGreaterThan(1e-6);
  });
});
