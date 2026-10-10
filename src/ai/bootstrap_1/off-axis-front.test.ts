import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint, setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planV8Charge } from '../policy/v8/charge';
import { bootstrapPolicyContext } from './policy';
import { planBootstrapGeneral } from './mine-defense';

it.each((['v9_archer', 'v9_knight'] as const).flatMap(version => (['grove', 'ember'] as const)
  .flatMap(race => [false, true].map(mirrored => ({ version, race, mirrored }))))) (
  'defeats a raid from its off-axis mining front ($version/$race, mirror=$mirrored)', ({ version, race, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    let scene = sketchScene('off-axis-mining-front').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).player('raiders', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('empty', x(788), 500, 0)
      .townHall('us', x(1200), 1500).goldMine('working', x(1488), 1500, 10000)
      .townHall('us', x(2400), 2300).goldMine('outpost', x(2688), 2300, 10000)
      .townHall('foe', x(3500), 500).townHall('raiders', x(3500), 3500);
    for (let i = 0; i < 4; i++) scene = scene.unit('us', heavy, x(2300 + i % 2 * 40), 2280 + Math.floor(i / 2) * 40,
      { id: `guard-${i}` }).building('us', 'farm', x(400 + i * 64), 3500);
    for (let i = 0; i < 12; i++) scene = scene.unit('foe', 'knight', x(3360 + i % 4 * 40), 550 + Math.floor(i / 4) * 40);
    for (let i = 0; i < 8; i++) scene = scene.unit('raiders', 'footman', x(3400 + i % 4 * 40), 2600 + Math.floor(i / 4) * 40,
      { id: `raid-${i}` });
    for (const [mine, hallX, hallY] of [['working', 1350, 1500], ['outpost', 2550, 2300]] as const) {
      for (let i = 0; i < 5; i++) scene = scene.worker('us', x(hallX), hallY - 50 + i * 25,
        { order: { type: 'mine', resourceId: mine, phase: 'toMine', timer: 0 } });
    }
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    for (const owner of ['foe', 'raiders']) issuePlayerCommand(game, owner,
      { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === owner).map(unit => unit.id) });
    const outpost = game.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall').at(-1)!;
    for (let tick = 0; tick < 2400 && !game.match.winner; tick++) {
      if (tick === 900) issuePlayerCommand(game, 'raiders', { type: 'attack',
        unitIds: game.units.filter(unit => unit.id.startsWith('raid-')).map(unit => unit.id), targetId: outpost.id });
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        // Isolate an established two-mine front, keeping the real general and charge executors.
        context.doctrines = [{ id: 'two-working-mines', race, weight: 1, raids: [], standIn: heavy,
          phases: [{ wants: [{ bases: 2, priority: 76 }], advanceShare: 1, advanceSupply: 1000 }] }];
        context.armyWants = [];
        const commands = [...planBootstrapGeneral(snapshot, 'us', context), ...planV8Charge(snapshot, 'us', context)];
        issueCommandFrame(game, commands.map(command => ({ command, playerId: 'us',
          source: 'external-agent' as const, scriptId: 'observed-main-army' })));
      }
      stepGame(game);
    }
    expect(game.units.filter(unit => unit.id.startsWith('raid-'))).toHaveLength(0);
    expect(game.units.filter(unit => unit.id.startsWith('guard-'))).toHaveLength(4);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.kind === 'worker')).toHaveLength(10);
    expect(game.match.winner).toBeNull();
    const mined = 20000 - game.resources.reduce((sum, mine) => sum + mine.amount, 0);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
  }, 15000);
