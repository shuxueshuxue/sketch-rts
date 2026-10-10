import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { UNIT_DEFS } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

it.each([false, true].flatMap(mirrored => (['footman', 'emberRavager'] as const).map(guard => ({ mirrored, guard }))))(
  'one purchased rider raids the nearer exposed mining line before a distant camp ($guard, mirror=$mirrored)', ({ mirrored, guard }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    let scene = sketchScene('mounted-nearby-raid').map('openClaims').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: guard === 'footman' ? 'grove' : 'ember', team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(716), 500, 10000)
      .building('us', 'stables', x(1000), 1800, { id: 'stables' }).farms('us', 6, x(400), 2800)
      .townHall('foe', x(2200), 1800, { id: 'raid-hall' }).tower('foe', x(2200), 2080)
      .unit('foe', guard, x(1600), 2300, { id: 'idle-guard' })
      .unit('neutral', 'graniteGolem', x(3200), 3200, { id: 'camp-guard' })
      .goldMine('camp', x(3400), 3200, 6000);
    for (let index = 0; index < 3; index++) scene = scene.worker('us', x(600), 480 + index * 25,
      { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (let index = 0; index < 5; index++) scene = scene.worker('foe', x(1930), 1700 + index * 25, { id: `target-${index}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
    issuePlayerCommand(game, 'us', { type: 'train', buildingId: 'stables', unitKind: 'horseArcher' });
    for (let tick = 0; tick <= UNIT_DEFS.horseArcher.trainTime; tick++) stepGame(game);
    const rider = game.units.find(unit => unit.kind === 'horseArcher')!;
    let damage = 0, workersKilled = 0;
    game.observer = { hit(source, target, taken) {
      if (target.id === rider.id) damage += taken;
      if (source.id === rider.id && target.id.startsWith('target-') && target.hp <= 0) workersKilled++;
    } };
    for (let tick = 0; tick < 2400 && game.units.some(unit => unit.id.startsWith('target-')); tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version: 'v9_archer', memory, policyMode: 'combat' }, { teams: game.teams }));
      stepGame(game);
    }
    expect(workersKilled).toBe(5);
    expect(game.units.some(unit => unit.id.startsWith('target-'))).toBe(false);
    expect(game.units).toContain(rider);
    expect(damage).toBe(0);
    expect(game.units.find(unit => unit.id === 'idle-guard')!.hp).toBe(UNIT_DEFS[guard].hp);
    expect(game.units.find(unit => unit.id === 'camp-guard')!.hp).toBe(UNIT_DEFS.graniteGolem.hp);
    expect(game.match.winner).toBeNull();
    expect(game.match.stats.goldSpent.us).toBe(UNIT_DEFS.horseArcher.cost);
    const mined = 10000 - game.resources.find(mine => mine.id === 'main')!.amount;
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
  }, 30000);
