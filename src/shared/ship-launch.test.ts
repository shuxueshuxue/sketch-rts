import { describe, expect, it, vi } from 'vitest';
import { UNIT_DEFS } from './catalog';
import { createBuilding, createUnit, trainTimeFor } from './map';
import { shipBodyClearAtPose } from './ship-collisions';
import { distanceToHull, hullContact, SHIP_KINDS, shipProfile } from './ship-geometry';
import { shipLaunchPose, shipLaunchPrototype } from './ship-launch';
import * as navigation from './ship-navigation';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';
import { checksumGame } from './sim/checksum';
import { footprintHalf } from './terrain';
import type { GameMap, UnitKind } from './types';

function coast(cell: (x: number, y: number) => string = x => x < 10 ? '.' : '~'): GameMap {
  let cells = '';
  for (let y = 0; y < 40; y++) for (let x = 0; x < 50; x++) cells += cell(x, y);
  return { ...createGame('bareDuel', { aiPlayers: [] }).map, width: 1600, height: 1280, terrain: { cell: 32, cols: 50, rows: 40, cells } };
}
function scene(map = coast()) {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.map = map; game.units = []; game.items = []; game.resources = []; game.mercenaryCamps = []; game.shops = [];
  game.scriptedVictory = true;
  const dock = createBuilding('dock', 'player', 'shipyard', 304, 624, true);
  game.buildings = [dock]; game.players.player.gold = 10000; game.players.player.supplyCap = 100;
  return { game, dock };
}
function paidJob(context: ReturnType<typeof scene>, kind: UnitKind = 'transport') {
  issuePlayerCommand(context.game, 'player', { type: 'train', buildingId: context.dock.id, unitKind: kind as 'transport' });
  return context.dock.queue[0]!;
}

describe('ships launched from a physical pier', () => {
  it('reuses blocked-job prototypes and local profiles while refreshing a yard pose, kind or changed body layout', () => {
    const {game,dock}=scene(coast(x=>x<10?'.':',')), prototype=shipLaunchPrototype(dock,'carrier'), profile=shipProfile(prototype);
    const blocker=createUnit('body','player','rockGolem',460,624); blocker.radius=blocker.bodyRadius=300; game.units.push(blocker);
    for(let tick=0;tick<20;tick++) {
      expect(shipLaunchPrototype(dock,'carrier')).toBe(prototype);
      expect(shipProfile(prototype)).toBe(profile);
      expect(shipLaunchPose(game,dock,prototype)).toBeUndefined();
    }
    dock.x+=64; dock.owner='enemy';
    expect(shipLaunchPrototype(dock,'carrier')).toBe(prototype); expect(prototype).toMatchObject({x:dock.x,y:dock.y,owner:'enemy'});
    const warship=shipLaunchPrototype(dock,'warship'); expect(warship).not.toBe(prototype); expect(warship.kind).toBe('warship');
    // A probe may not carry a previous caller's campaign scale or fittings into
    // the next default trained hull.
    prototype.deckScale=2; prototype.fittings=[];
    const clean=shipLaunchPrototype(dock,'carrier'); expect(clean).not.toBe(prototype);
    expect(clean.deckScale).toBeUndefined(); expect(clean.fittings).toBeUndefined();
    expect(shipProfile(clean)!.length).toBe(profile!.length);
    clean.radius+=10; expect(shipLaunchPrototype(dock,'carrier')).not.toBe(clean);
  });

  it.each(SHIP_KINDS)('trains %s with its whole enlarged hull outside the coast and pier', kind => {
    const { game, dock } = scene();
    paidJob({ game, dock }, kind);
    const cost = UNIT_DEFS[kind].cost, balance = game.players.player.gold;
    for (let tick = 0; tick < trainTimeFor(kind); tick++) stepGame(game);
    expect(game.players.player.gold).toBe(10000 - cost); expect(balance).toBe(game.players.player.gold);
    expect(dock.queue).toHaveLength(0); expect(game.units).toHaveLength(1);
    const ship = game.units[0]!, pose = { x: ship.x, y: ship.y, heading: ship.sailing!.heading };
    expect(navigation.hullFits(game.map, ship)).toBe(true);
    expect(shipBodyClearAtPose(game.map, ship, pose, [dock])).toBe(true);
    expect(distanceToHull(ship, dock)).toBeGreaterThanOrEqual(footprintHalf(dock.radius, 32) + 3.99);
    expect(Math.hypot(ship.x - dock.x, ship.y - dock.y)).toBeLessThan(shipProfile(ship)!.length + 120);
    expect(ship.hp).toBe(ship.maxHp); expect(dock.hp).toBe(dock.maxHp);
  });

  it('keeps a paid ship queued at an occupied pier and launches immediately after traffic leaves', () => {
    const context = scene(), { game, dock } = context;
    const job = paidJob(context); job.remaining = 1;
    // Real idle hulls occupy the shallow berth from the coast to the outer
    // launch row; there is ample distant sea, which is not a launch berth.
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
      const blocker = createUnit(`traffic-${row}-${col}`, 'player', 'carrier', 396 + col * 146, 328 + row * 296);
      blocker.sailing = { heading: Math.PI / 2, speed: 0, load: 0, balance: 0 }; blocker.order = { type: 'hold', x: blocker.x, y: blocker.y }; game.units.push(blocker);
    }
    const balance = game.players.player.gold, id = game.nextId;
    for (let tick = 0; tick < 3; tick++) stepGame(game);
    expect(dock.queue).toEqual([job]); expect(job.remaining).toBe(0);
    expect(game.units.some(unit => unit.kind === 'transport')).toBe(false);
    expect(game.players.player.gold).toBe(balance); expect(game.nextId).toBe(id);
    for (const blocker of game.units) { blocker.x += 700; blocker.order = { type: 'hold', x: blocker.x, y: blocker.y }; }
    stepGame(game);
    const ship = game.units.find(unit => unit.kind === 'transport')!;
    expect(dock.queue).toHaveLength(0); expect(ship).toBeDefined();
    expect(navigation.hullFits(game.map, ship)).toBe(true);
    for (const other of game.units) if (other !== ship) expect(hullContact(ship, other)).toBeUndefined();
    expect(game.players.player.gold).toBe(balance);
  });

  it('uses only the dock water component and waits when a nearby separate pond is the only room', () => {
    const { game, dock } = scene(coast((x, y) => x >= 10 && x <= 11 && y >= 17 && y <= 21 || x >= 14 ? '~' : '.'));
    const job = paidJob({ game, dock }, 'carrier'); job.remaining = 1;
    for (let tick = 0; tick < 10; tick++) stepGame(game);
    expect(game.units).toHaveLength(0); expect(dock.queue).toEqual([job]);
    game.map.terrain!.cells = coast().terrain!.cells;
    stepGame(game);
    expect(game.units).toHaveLength(1); expect(dock.queue).toHaveLength(0);
    expect(navigation.hullFits(game.map, game.units[0]!)).toBe(true);
  });

  it('selects an aligned hull in a coastal channel and preserves its chosen heading on creation', () => {
    const { game, dock } = scene(coast((x, y) => x >= 10 && y >= 18 && y <= 21 ? '~' : '.'));
    const job = paidJob({ game, dock }, 'transport'); job.remaining = 1;
    const prototype = createUnit('launch', 'player', 'transport', dock.x, dock.y);
    const pose = shipLaunchPose(game, dock, prototype)!;
    expect(pose).toBeDefined(); expect(Math.abs(Math.sin(pose.heading))).toBeLessThan(1e-6);
    stepGame(game);
    expect(game.units).toHaveLength(1);
    expect(game.units[0]).toMatchObject({ x: pose.x, y: pose.y, sailing: { heading: pose.heading } });
    expect(navigation.hullFits(game.map, game.units[0]!)).toBe(true);
  });

  it('reuses the shoreline and failed occupancy search, then reacts to a live body moving or dying', () => {
    const { game, dock } = scene(coast(x => x < 10 ? '.' : ',')), prototype = createUnit('launch', 'player', 'carrier', dock.x, dock.y);
    const blocker = createUnit('body', 'player', 'rockGolem', 460, 624); blocker.radius = blocker.bodyRadius = 300;
    game.units.push(blocker);
    const checks = vi.spyOn(navigation, 'hullFits');
    expect(shipLaunchPose(game, dock, prototype)).toBeUndefined(); const first = checks.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThanOrEqual(16 * 4 * 5 * 3);
    for (let repeat = 0; repeat < 10; repeat++) expect(shipLaunchPose(game, dock, prototype)).toBeUndefined();
    expect(checks.mock.calls.length).toBe(first);
    blocker.x = 1300; expect(shipLaunchPose(game, dock, prototype)).toBeDefined();
    blocker.x = 460; expect(shipLaunchPose(game, dock, prototype)).toBeUndefined();
    blocker.hp = 0; expect(shipLaunchPose(game, dock, prototype)).toBeDefined();
    checks.mockRestore();
  });

  it('resumes a blocked paid launch identically after save and replay without cached runtime state', () => {
    const context = scene(coast(x => x < 10 ? '.' : ',')), { game, dock } = context, job = paidJob(context, 'warship'); job.remaining = 1;
    const blocker = createUnit('body', 'player', 'rockGolem', 460, 624); blocker.radius = blocker.bodyRadius = 300; blocker.order = { type: 'hold', x: blocker.x, y: blocker.y };
    game.units.push(blocker); stepGame(game);
    expect(dock.queue).toHaveLength(1);
    const saved = snapshotGame(game), restored = scene().game;
    restoreSnapshotIntoGame(restored, saved, game.nextId);
    for (const replay of [game, restored]) replay.units.find(unit => unit.id === blocker.id)!.hp = 0;
    for (let tick = 0; tick < 6; tick++) {
      stepGame(game); stepGame(restored);
      expect(checksumGame(restored)).toBe(checksumGame(game));
    }
    expect(game.units.some(unit => unit.kind === 'warship')).toBe(true);
    expect(dock.queue).toHaveLength(0); expect(saved.buildings[0]!.queue).toHaveLength(1);
  });
});
