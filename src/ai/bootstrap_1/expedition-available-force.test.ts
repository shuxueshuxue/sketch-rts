import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import type { BootstrapAiVersion } from '../../shared/types';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, bootstrapScripts } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].map(mirror => ({ version, mirror })));

function run(version: BootstrapAiVersion, mirror: boolean, enoughAvailable: boolean) {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('separate-clearing-force').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
    .goldMine('assigned-mine', x(3400), 2850, 10000).goldMine('other-mine', x(3400), 1500, 10000);
  for (let i = 0; i < (enoughAvailable ? 3 : 1); i++) scene = scene.unit('us', enoughAvailable ? 'knight' : 'footman',
    x(3100 + i * 32), 800, { id: 'available-' + i });
  for (let i = 0; i < 8; i++) scene = scene.unit('us', 'horseArcher', x(3100 + i % 2 * 32),
    2500 + Math.floor(i / 2) * 32, { id: 'rider-' + i });
  for (let i = 0; i < 4; i++) scene = scene.unit('neutral', 'redDragon', x(3400 + i % 2 * 32),
    2800 + Math.floor(i / 2) * 32, { id: 'assigned-guard-' + i });
  for (let i = 0; i < 2; i++) scene = scene.unit('neutral', 'ogreWarrior', x(3360), 1470 + i * 60,
    { id: 'other-guard-' + i });
  const game = scene.build().createGame(); game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, i) => {
    const col = mirror ? 127 - i % 128 : i % 128;
    return col < 39 || col >= 93 ? '.' : col === 39 || col === 92 ? ',' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const memory = createAiPolicyMemory();
  memory.mounted = [{ unitIds: Array.from({ length: 8 }, (_, i) => 'rider-' + i),
    objective: { kind: 'camp', ids: Array.from({ length: 4 }, (_, i) => 'assigned-guard-' + i) } }];
  const scripts = bootstrapScripts(version).filter(script => ['naval', 'mountedTasks'].includes(script.id));
  let availableDamage = 0, assignedShots = 0, availableMarches = 0;
  game.observer = { hit(source, target, damage) {
    if (target.id.startsWith('available-')) availableDamage += damage;
    if (source.id.startsWith('rider-')) assignedShots++;
  } };
  for (let tick = 0; tick < 600; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', scripts, options);
      availableMarches += entries.filter(entry => entry.command.type === 'attackMove'
        && entry.command.unitIds.some(id => id.startsWith('available-'))).length;
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  const available = game.units.filter(unit => unit.id.startsWith('available-'));
  console.log(JSON.stringify({ version, mirror, enoughAvailable, availableDamage, assignedShots, availableMarches,
    available: available.map(unit => ({ id: unit.id, hp: unit.hp })),
    remainingOtherGuards: game.units.filter(unit => unit.id.startsWith('other-guard-')).length,
    lost: game.match.stats.unitsLost.us }));
  return { game, available, availableDamage, assignedShots, availableMarches };
}

it.each(cases)('$version does not borrow mounted force from another camp (mirror=$mirror)', ({ version, mirror }) => {
  const result = run(version, mirror, false);
  expect(result.available).toHaveLength(1);
  expect(result.available[0]!.hp).toBe(result.available[0]!.maxHp);
  expect(result.availableDamage).toBe(0);
  expect(result.assignedShots).toBeGreaterThan(0);
  expect(result.availableMarches).toBe(0);
  expect(result.game.match.stats.goldSpent.us).toBe(0);
});

it.each(cases)('$version still clears another camp with enough available force (mirror=$mirror)', ({ version, mirror }) => {
  const result = run(version, mirror, true);
  expect(result.available).toHaveLength(3);
  expect(result.availableMarches).toBeGreaterThan(0);
  expect(result.assignedShots).toBeGreaterThan(0);
  expect(result.game.units.some(unit => unit.id.startsWith('other-guard-'))).toBe(false);
  expect(result.game.match.stats.goldSpent.us).toBe(0);
});
