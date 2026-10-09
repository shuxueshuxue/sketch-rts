import { describe, expect, it } from 'vitest';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { clearTransferLanes } from './transfer-lanes';
import { navalUnitIds } from './naval';
import { createAiPolicyMemory } from '../memory';
import { BOARDING_GAP } from '../../shared/naval';
import { distanceToHull, localToWorld, shipProfile } from '../../shared/ship-geometry';
import { hullFits } from '../../shared/ship-navigation';

// Reduced from an ordinary Sapphire Archipelago match: an idle shore army
// blocked two settlers at the crossing indefinitely despite an empty ferry.
const rows = [
  ",~~~~~~~~~~~,,,............................",
  ",~~~~~~~~~~~,,.............................",
  ",~~~~~~~~~~,,,.............................",
  ",~~~~~~~~~~,,,.............................",
  ",~~~~~~~~~,,,..............................",
  ",~~~~~~~~~,,,..............................",
  ",~~~~~~~~~,,,..............................",
  "~~~~~~~~~,,,,..............................",
  "~~~~~~~~~,,,...............................",
  "~~~~~~~~~,,,...............................",
  "~~~~~~~~~,,,...............................",
  "~~~~~~~~,,,,...............................",
  "~~~~~~~~,,,,...............................",
  "~~~~~~~~,,,,...............................",
  "~~~~~~~~,,,,...............................",
  "~~~~~~~~,,,,...............................",
  "~~~~~~~~,,,,...............................",
  "~~~~~~~~,,,,...............................",
  "~~~~~~~~,,,,...............................",
  "~~~~~~~~~,,,,..............................",
  "~~~~~~~~~~,,,..............................",
  "~~~~~~~~~~,,,,,............................",
  "~~~~~~~~~~~,,,,,...........................",
  "~~~~~~~~~~~,,,,,...........................",
  "~~~~~~~~~~~~,,,,,..........................",
  "~~~~~~~~~~~~~,,,,..........................",
  "~~~~~~~~~~~~~,,,,..........................",
  "~~~~~~~~~~~~~~,,,..........................",
  "~~~~~~~~~~~~~~,,,,........................."
];
const crowd = [[288, 331.52538], [256, 352], [288, 266.0106], [288, 298.0106], [318.45099, 275.84611], [256, 406.67614], [318.45099, 307.84611], [272.63219, 379.33807], [348.34528, 296.42983], [284.54389, 421.1415], [299.20006, 361.50135], [322.51834, 339.58657], [312.7611, 436.23416], [301.17608, 393.80343], [364.36181, 324.13309], [343.46732, 445.2413], [327.74395, 375.96671], [329.62708, 408.45063], [351.35729, 353.45434], [360.35686, 418.06147], [358.08297, 386.14236], [381.52414, 364.1296]];
function quay() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.scriptedVictory = true; game.units = []; game.buildings = []; game.resources = [];
  game.map = { ...game.map, width: 43 * 32, height: rows.length * 32, terrain: { cell: 32, cols: 43, rows: rows.length, cells: rows.join('') } };
  // Moor the enlarged ferry inside the recorded rank. At the original
  // (304,432) berth its longer stern opens a crossing beyond the last soldier.
  const boat = game.spawnUnit('player', 'transport', 272, 368);
  boat.sailing!.heading = 3 * Math.PI / 2;
  const passengers = [game.spawnUnit('player', 'worker', 830.53, 397.03), game.spawnUnit('player', 'worker', 887, 393)];
  issuePlayerCommand(game, 'player', { type: 'board', unitIds: passengers.map(unit => unit.id), transportId: boat.id });
  for (const [x, y] of crowd) game.spawnUnit('player', 'archer', x!, y!);
  return { game, boat, passengers };
}

describe('AI crowded shore transfers', () => {
  it('clears a real blocked crossing using movement and completes boarding', () => {
    const blocked = quay(), cleared = quay();
    const passenger = blocked.passengers[0]!, profile = shipProfile(blocked.boat)!;
    const entrance = localToWorld(blocked.boat, { x: 0, y: profile.beam / 2 + passenger.radius + BOARDING_GAP });
    // A walker reaches boarding range only after entering this guard's body.
    expect(distanceToHull(blocked.boat, entrance)).toBeCloseTo(passenger.radius + BOARDING_GAP, 6);
    const guard = blocked.game.units.filter(unit => unit.kind === 'archer')
      .reduce((nearest, unit) => Math.hypot(unit.x - entrance.x, unit.y - entrance.y) < Math.hypot(nearest.x - entrance.x, nearest.y - entrance.y) ? unit : nearest);
    expect(Math.hypot(guard.x - entrance.x, guard.y - entrance.y)).toBeLessThan(passenger.radius + guard.radius);
    const memory = createAiPolicyMemory();
    for (let tick = 0; tick < 800; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(cleared.game);
        const commands = clearTransferLanes(snapshot, 'player');
        const claimed = navalUnitIds(snapshot, 'player', { version: 'v8', memory });
        for (const command of commands) {
          expect(command.type).toBe('move');
          if ('unitIds' in command) for (const id of command.unitIds) expect(claimed.has(id)).toBe(true);
          issuePlayerCommand(cleared.game, 'player', command);
        }
      }
      stepGame(blocked.game); stepGame(cleared.game);
      // Both branches use the same legal, stationary hull throughout: clearing
      // the actual shore bodies is what makes the crossing possible.
      for (const { game, boat } of [blocked, cleared]) {
        expect(hullFits(game.map, boat)).toBe(true);
        expect([boat.x, boat.y, boat.sailing!.heading]).toEqual([272, 368, 3 * Math.PI / 2]);
      }
    }
    expect(blocked.passengers.every(unit => !unit.deck)).toBe(true);
    expect(cleared.passengers.every(unit => unit.deck?.shipId === cleared.boat.id)).toBe(true);
  });
  it('preserves active combat, other owners and the boarding passengers', () => {
    const { game, passengers } = quay();
    passengers[0]!.x = 530; passengers[1]!.x = 560;
    const soldier = game.units.find(unit => unit.kind === 'archer')!;
    soldier.order = { type: 'attackMove', x: 650, y: 320 };
    const enemy = game.spawnUnit('enemy', 'archer', 355, 450);
    const commands = clearTransferLanes(snapshotGame(game), 'player');
    const ids = commands.flatMap(command => 'unitIds' in command ? command.unitIds : []);
    expect(ids).not.toContain(soldier.id); expect(ids).not.toContain(enemy.id);
    for (const passenger of passengers) expect(ids).not.toContain(passenger.id);
    expect(ids.length).toBeGreaterThan(0);
  });
});
