import { expect, it } from 'vitest';
import { strikeGap } from './combat-geometry';
import { workingWeaponGeometry } from './combat-fire-geometry';
import { installedWeapons } from './ship-equipment';
import { createGame, issuePlayerCommand, snapshotGame, stepGame } from './sim';

function empty() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = [];
  delete game.map.terrain;
  game.scriptedVictory = true;
  return game;
}

it('keeps a reloading gun as cover but rejects its wrong arc and an actual friendly hull in the lane', () => {
  const game = empty(), ship = game.spawnUnit('player', 'bombardShip', 1000, 1000);
  ship.sailing!.heading = 0;
  const target = game.spawnUnit('enemy', 'transport', 1400, 1000);
  const gun = installedWeapons(game, ship)[0]!;
  gun.kind = 'shipCannon';
  const before = workingWeaponGeometry(snapshotGame(game), ship, target);
  expect(before.some(weapon => weapon.covers)).toBe(true);
  gun.cooldownRemaining = 1000; ship.cooldown = 1000;
  expect(workingWeaponGeometry(snapshotGame(game), ship, target)).toEqual(before);
  ship.sailing!.heading = Math.PI;
  expect(workingWeaponGeometry(snapshotGame(game), ship, target)[0]!.withinArc).toBe(false);
  ship.sailing!.heading = 0;
  const blocker = game.spawnUnit('player', 'transport', 1250, 1000);
  blocker.sailing!.heading = Math.PI / 2;
  expect(workingWeaponGeometry(snapshotGame(game), ship, target)[0]).toMatchObject({ withinRange: true, clearLane: false, covers: false });
});

it('uses native center minimum range when a catapult actually fires at a nearer hull edge', () => {
  const game = empty(), catapult = game.spawnUnit('player', 'catapult', 1000, 1000);
  const cutter = game.spawnUnit('enemy', 'cutter', 1220, 1000);
  cutter.sailing!.heading = .8389260535763501;
  const shot = workingWeaponGeometry(snapshotGame(game), catapult, cutter)[0]!;
  expect(shot.gap).toBeCloseTo(160, 3);
  expect(shot.minimumGap).toBe(220); expect(shot.minimum).toBe(180);
  expect(shot.belowMinimum).toBe(false); expect(shot.covers).toBe(true);
  expect(strikeGap(catapult, cutter)).toBeLessThan(180);
  let landed = false;
  game.observer = { hit(attacker, target) { if (attacker.id === catapult.id && target.id === cutter.id) landed = true; } };
  issuePlayerCommand(game, 'enemy', { type: 'holdPosition', unitIds: [cutter.id] });
  issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [catapult.id], targetId: cutter.id });
  for (let tick = 0; tick < 120 && !landed; tick++) stepGame(game);
  expect(landed).toBe(true);
  expect(catapult.x).toBe(1000); expect(catapult.y).toBe(1000);
  expect(Math.hypot(catapult.x - cutter.x, catapult.y - cutter.y)).toBe(220);
});
