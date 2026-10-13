import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { UNIT_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, researchPrerequisites } from './policy';
import { bootstrapEconomy } from './economy';
import { miningWorkforce } from './workforce';
import { mountedTasks } from './mounted-tasks';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => [false, true].map(blocked => ({ version, mirror, blocked }))))) (
  '$version pays for a raid across an admitted detour, and rejects a closed bank (mirror=$mirror blocked=$blocked)', ({ version, mirror, blocked }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('mounted-objective-recruitment').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(788), 500, 8000)
      .townHall('us', x(500), 1000).goldMine('natural', x(788), 1000, 8000)
      .building('us', 'stables', x(700), 700, { id: 'factory' }).farms('us', 6, x(400), 3000)
      .worker('us', x(400), 500);
    scene = scene.townHall('foe', x(3000), 2400).worker('foe', x(3200), 2400, { id: 'objective' })
      .tower('foe', x(2100), 1800);
    for (let i = 0; i < 5; i++) {
      scene = scene.worker('us', x(760), 500 + i * 8, { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } })
        .worker('us', x(760), 1000 + i * 8, { order: { type: 'mine', resourceId: 'natural', phase: 'toMine', timer: 0 } });
    }
    for (let i = 0; i < 6; i++) scene = scene.unit('us', 'footman', x(1800 + i * 40), 3200);

    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => blocked && index % 128 === (mirror ? 63 : 64) ? '#' : '.').join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    let purchases = 0, scoutDamage = 0;
    game.observer = { hit(_source, target, damage) { if ('order' in target && target.owner === 'us' && target.kind === 'horseArcher') scoutDamage += damage; } };
    for (let tick = 0; tick < (blocked ? 300 : 3600) && game.units.some(unit => unit.id === 'objective'); tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        // Local production and sortie proof; the completed six-body screen remains on its own front.
        options.doctrines = [{ id: 'existing-screen', race: 'grove', weight: 1, standIn: 'footman', raids: [],
          phases: [{ wants: [{ unit: 'footman', count: 6, priority: 66 }, ...researchPrerequisites(options.armyWants!, snapshot.players.us!)],
            advanceShare: 1, advanceSupply: 1000 }] }];
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [miningWorkforce, bootstrapEconomy, mountedTasks], options)
          .map(entry => ({ ...entry, playerId: 'us' }));
        purchases += entries.filter(entry => entry.command.type === 'train' && entry.command.unitKind === 'horseArcher').length;
        issueCommandFrame(game, entries);
      }
      stepGame(game);
    }
    expect(purchases).toBe(blocked ? 0 : 1);
    if (!blocked) {
      expect(game.units.some(unit => unit.id === 'objective')).toBe(false);
      expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'horseArcher')).toHaveLength(1);
      expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(UNIT_DEFS.horseArcher.cost);
    }
    expect(scoutDamage).toBe(0);
    expect(game.match.stats.unitsLost.us).toBe(0);
    const mined = 16000 - game.resources.filter(resource => resource.id === 'main' || resource.id === 'natural').reduce((sum, resource) => sum + resource.amount, 0);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBeCloseTo(500 + mined, 6);
  }, 30000);
