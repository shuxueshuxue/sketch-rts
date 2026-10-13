import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { UNIT_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext, researchPrerequisites } from './policy';
import { bootstrapEconomy } from './economy';
import { miningWorkforce } from './workforce';
import { mountedField } from './mounted-field';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  [false, true].flatMap(mirror => (['remote', 'detour', 'covered', 'ranged', 'ally', 'closed'] as const).map(setup => ({ version, mirror, setup }))))) (
  '$version buys one field scout only for exposed melee (mirror=$mirror setup=$setup)', ({ version, mirror, setup }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('mounted-field-recruitment').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: setup === 'ally' ? 'a' : 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(788), 500, 8000)
      .townHall('us', x(500), 1000).goldMine('natural', x(788), 1000, 8000)
      .townHall('foe', x(3500), 3500)
      .building('us', 'stables', x(1000), 1600, { id: 'factory' }).farms('us', 6, x(400), 3000);
    for (let i = 0; i < 5; i++) scene = scene
      .worker('us', x(760), 500 + i * 8, { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } })
      .worker('us', x(760), 1000 + i * 8, { order: { type: 'mine', resourceId: 'natural', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 6; i++) scene = scene.unit('us', 'footman', x(2300 + i * 40), 3200);
    scene = scene.unit('foe', setup === 'ranged' ? 'archer' : 'footman', x(2900), 2000, { id: 'objective' });
    if (setup === 'detour') scene = scene.tower('foe', x(2100), 1800);
    if (setup === 'covered') scene = scene.tower('foe', x(2900), 2000);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => setup === 'closed' && index % 128 === (mirror ? 63 : 64) ? '#' : '.').join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: ['objective'] });
    let purchases = 0, injury = 0;
    game.observer = { hit(_source, target, damage) {
      if ('order' in target && target.owner === 'us' && target.kind === 'horseArcher') injury += damage;
    } };
    for (let tick = 0; tick < ((setup === 'remote' || setup === 'detour') ? 3600 : 300) && game.units.some(unit => unit.id === 'objective'); tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        // Hold the already funded main screen on its own front; measure production and the independent sortie.
        options.doctrines = [{ id: 'existing-screen', race: 'grove', weight: 1, standIn: 'footman', raids: [],
          phases: [{ wants: [{ unit: 'footman', count: 6, priority: 66 }, ...researchPrerequisites(options.armyWants!, snapshot.players.us!)],
            advanceShare: 1, advanceSupply: 1000 }] }];
        const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [miningWorkforce, bootstrapEconomy, mountedField], options)
          .map(entry => ({ ...entry, playerId: 'us' }));
        purchases += entries.filter(entry => entry.command.type === 'train' && entry.command.unitKind === 'horseArcher').length;
        issueCommandFrame(game, entries);
        const horse = game.units.find(unit => unit.owner === 'us' && unit.kind === 'horseArcher');
        if (horse && (setup === 'remote' || setup === 'detour')) issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['objective'], targetId: horse.id });
      }
      stepGame(game);
    }
    const diagnostic = JSON.stringify({ purchases, injury, units: game.units.filter(unit => unit.kind === 'horseArcher' || unit.id === 'objective'), memory });
    expect(purchases, diagnostic).toBe((setup === 'remote' || setup === 'detour') ? 1 : 0);
    if ((setup === 'remote' || setup === 'detour')) {
      expect(game.units.some(unit => unit.id === 'objective'), diagnostic).toBe(false);
      expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'horseArcher')).toHaveLength(1);
      expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(UNIT_DEFS.horseArcher.cost);
    }
    expect(injury, diagnostic).toBe(0);
    expect(game.match.stats.unitsLost.us).toBe(0);
    const mined = 16000 - game.resources.filter(resource => resource.id === 'main' || resource.id === 'natural').reduce((sum, resource) => sum + resource.amount, 0);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBeCloseTo(500 + mined, 6);
  }, 30000);
