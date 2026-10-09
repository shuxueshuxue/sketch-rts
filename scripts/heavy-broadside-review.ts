import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCombatScene, type CombatScene } from './ship-combat-review';
import { createGame, issuePlayerCommand } from '../src/shared/sim';
import { installedWeapons, rebuildShipFittings, shipMounts, SHIP_WEAPONS } from '../src/shared/ship-equipment';
import type { Unit, WorldItem } from '../src/shared/types';

function sea(direction = Math.PI / 4, island = false) {
  const game = createGame('bareDuel', { players: ['player', 'enemy'], aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = [];
  game.scriptedVictory = true;
  game.map = { ...game.map, width: 8192, height: 8192, wind: { direction, speed: 80 },
    terrain: { cell: 32, cols: 256, rows: 256, cells: Array.from({ length: 65536 }, (_, i) =>
      island && i % 256 >= 100 && i % 256 < 120 && Math.floor(i / 256) >= 106 && Math.floor(i / 256) < 145 ? '.' : '~').join('') } };
  return game;
}
function move(game: ReturnType<typeof sea>, ship: Unit, x: number, y: number, queued = false) {
  issuePlayerCommand(game, ship.owner, { type: 'move', unitIds: [ship.id], x, y, queued, avoidCombat: true });
}
function fullBattery(game: ReturnType<typeof sea>, ship: Unit) {
  for (const mount of shipMounts(ship)) {
    if (installedWeapons(game, ship).some(item => item.mountId === mount.id)) continue;
    const gun: WorldItem = { id: `review-${ship.id}-${mount.id}`, kind: 'shipCannon', shipId: ship.id,
      mountId: mount.id, x: ship.x, y: ship.y, durability: SHIP_WEAPONS.shipCannon.hp, cooldownRemaining: 0 };
    game.items.push(gun);
  }
  rebuildShipFittings(game, ship);
}

export const heavyBroadsideScenes: CombatScene[] = [
  ...[false, true].map((full): CombatScene => ({ id: full ? 'heavy-full-broadside' : 'heavy-factory-broadside',
    label: full ? 'Eight fitted guns, four-gun broadside' : 'Four factory guns, two-gun broadside', category: 'combat', duration: 90,
    setup: () => {
      const game = sea(), focus = game.spawnUnit('player', 'shipOfTheLine', 2600, 4000);
      if (full) fullBattery(game, focus);
      const target = game.spawnUnit('enemy', 'warship', 2600, 4360);
      target.sailing!.heading = -Math.PI / 2;
      issuePlayerCommand(game, 'player', { type: 'attack', unitIds: [focus.id], targetId: target.id });
      issuePlayerCommand(game, 'enemy', { type: 'attack', unitIds: [target.id], targetId: focus.id });
      return { game, focus, target, ships: [focus, target] };
    } })),
  { id: 'heavy-upwind-1500', label: 'Heavy hull: 1500 units directly upwind', category: 'upwind', duration: 240,
    setup: () => {
      const game = sea(Math.PI), focus = game.spawnUnit('player', 'shipOfTheLine', 3200, 4000), goal = { x: 4700, y: 4000 };
      move(game, focus, goal.x, goal.y);
      return { game, focus, ships: [focus], goal };
    } },
  ...[false, true].map((oblique): CombatScene => ({ id: oblique ? 'heavy-oblique-queued' : 'heavy-aligned-queued',
    label: oblique ? 'Heavy hull: oblique departure into two queued bends' : 'Heavy hull: two queued right-angle bends', category: 'course', duration: 220,
    setup: () => {
      const game = sea(), focus = game.spawnUnit('player', 'shipOfTheLine', oblique ? 1500 : 1800, oblique ? 1500 : 4000);
      focus.sailing!.heading = oblique ? Math.PI / 2 : 0;
      const corners = oblique ? [{ x: 2200, y: 1500 }, { x: 2200, y: 2200 }] : [{ x: 4200, y: 4000 }, { x: 4200, y: 5800 }];
      const goal = oblique ? { x: 2900, y: 2200 } : { x: 6000, y: 5800 };
      for (const [index, point] of [...corners, goal].entries()) move(game, focus, point.x, point.y, index > 0);
      return { game, focus, ships: [focus], goal, corners };
    } })),
  { id: 'heavy-island-passage', label: 'Heavy hull: island passage with a full swept hull', category: 'course', duration: 220,
    setup: () => {
      const game = sea(Math.PI / 4, true), focus = game.spawnUnit('player', 'shipOfTheLine', 1800, 4000), goal = { x: 6000, y: 4000 };
      move(game, focus, goal.x, goal.y);
      return { game, focus, ships: [focus], goal };
    } },
];

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = process.argv.indexOf('--out');
  const output = resolve(index >= 0 ? process.argv[index + 1]! : 'work/heavy-broadside-metrics.json');
  const rows = heavyBroadsideScenes.map(scene => {
    const { metrics } = runCombatScene(scene, false);
    const safe = metrics.coastViolations === 0 && metrics.maxHullOverlap < .1;
    const passed = safe && (scene.category === 'combat'
      ? metrics.firstShot !== null && metrics.firstShot < 20 && metrics.teamDamage > 0
      : metrics.arrived && (scene.id.includes('queued') ? metrics.queuedIdleTicks === 0 && metrics.queuedLongestPendingStopSeconds < 1 : true));
    process.stdout.write(`${scene.id}: ${passed ? 'PASS' : 'FAIL'} ${JSON.stringify(metrics)}\n`);
    return { id: scene.id, label: scene.label, passed, metrics };
  });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ schema: 1, ship: 'shipOfTheLine', scenes: rows }, null, 2)}\n`);
  if (rows.some(row => !row.passed)) process.exitCode = 1;
}
