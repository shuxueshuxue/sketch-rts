import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { hullContact } from './ship-geometry';
import { hullFits } from './ship-navigation';
import { advanceShipPlanningJob } from './ship-planning-job';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from './sim';

it('releases the real returning transport, keeps its pinned carrier constrained, and restores exactly', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('../ai/bootstrap_1/fixtures/archer-return-neighbors.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const ids = ['unit-p0-carrier-3510', 'unit-p0-transport-1046'];
  const starts = ids.map(id => {
    const ship = game.units.find(unit => unit.id === id)!;
    return { x: ship.x, y: ship.y };
  });
  let restored: ReturnType<typeof createGame> | undefined;
  for (let tick = 0; tick < 720; tick++) {
    if (tick === 120) {
      restored = createGame('bareDuel');
      restoreSnapshotIntoGame(restored, JSON.parse(JSON.stringify(snapshotGame(game))), game.nextId);
    }
    stepGame(game);
    if (restored) stepGame(restored);
    const ships = ids.map(id => game.units.find(unit => unit.id === id)!);
    for (const ship of ships) expect(hullFits(game.map, ship)).toBe(true);
    expect(hullContact(ships[0]!, ships[1]!)?.overlap ?? 0).toBeLessThan(.1);
  }
  for (const [index, id] of ids.entries()) {
    const ship = game.units.find(unit => unit.id === id)!;
    const travel = Math.hypot(ship.x - starts[index]!.x, ship.y - starts[index]!.y);
    if (ship.kind === 'transport') expect(travel, id).toBeGreaterThan(32);
    // The carrier's shore troops still block even its first pixel of surge.
    // Keeping that real body constraint is part of this execution fix.
    else expect(travel, id).toBeLessThan(1e-7);
    expect(ship.hp).toBe(saved.snapshot.units.find((unit: { id: string }) => unit.id === id)!.hp);
  }
  expect(snapshotGame(restored!)).toEqual(snapshotGame(game));
  expect(restored!.nextId).toBe(game.nextId);
}, 120000);

it('keeps actual shore troops in a restored planning view with no other frozen hull', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('../ai/bootstrap_1/fixtures/archer-return-neighbors.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  const ship = game.units.find(unit => unit.id === 'unit-p0-carrier-3510')!;
  const before = JSON.parse(ship.sailing!.planningJob!);
  expect(before.traffic).not.toHaveLength(0);
  expect(before.traffic.every((unit: { kind: string }) => unit.kind !== 'transport' && unit.kind !== 'carrier')).toBe(true);
  let result: ReturnType<typeof advanceShipPlanningJob>;
  for (let slice = 0; slice < 40 && !result; slice++) result = advanceShipPlanningJob(ship, game.map);
  // The previous derived view silently discarded these land bodies and
  // proposed a 198-pixel pivot through them. No such first move is legal.
  expect(result).toBeDefined();
  expect(result!.points).toEqual([]);
});

it('keeps nearby departing hulls while distant moving companions remain outside coastal planning traffic', () => {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = [];
  game.scriptedVictory = true;
  game.map = { ...game.map, width: 8192, height: 8192, wind: { direction: Math.PI / 2, speed: 60 },
    terrain: { cell: 64, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
      const x = index % 128, y = Math.floor(index / 128);
      return x >= 60 && x <= 67 && y >= 12 && y <= 65 ? '.' : '~';
    }).join('') } };
  const ship = game.spawnUnit('player', 'carrier', 2200, 3100);
  const near = game.spawnUnit('player', 'transport', 2000, 2920);
  const far = game.spawnUnit('player', 'transport', 1700, 3100);
  for (const vessel of [ship, near, far]) {
    vessel.sailing!.heading = Math.PI / 2;
    issuePlayerCommand(game, 'player', { type: 'move', unitIds: [vessel.id], x: 6500, y: 3100, avoidCombat: true });
  }
  stepGame(game);
  const job = JSON.parse(ship.sailing!.planningJob!);
  expect(job.traffic.some((unit: { id: string }) => unit.id === near.id)).toBe(true);
  expect(job.traffic.some((unit: { id: string }) => unit.id === far.id)).toBe(false);
});
