import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { mountedField, mountedFieldTargets } from './mounted-field';
import { mountedFiringPoint } from './mounted-tasks';

// Field admission counts finished towers and armed non-workers as cover. An unfinished tower and the
// workers building it are armed too; the ride to the admitted station must not judge it against them.
it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['tower', 'workers'] as const).flatMap(cover => [false, true].map(mirror => ({ version, cover, mirror }))))) (
  '$version rides to the station its field admission found (uncounted $cover, mirror=$mirror)', ({ version, cover, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('mounted-field-cover').map('bareDuel').replaceDefaults()
      .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
      .unit('us', 'horseArcher', x(1000), 1600, { id: 'rider' })
      .unit('foe', 'footman', x(1500), 1600, { id: 'objective' });
    // Every station 10 short of the rider's range around the objective lies inside this cover.
    if (cover === 'tower') scene = scene.tower('foe', x(1500), 1680, { complete: false, hp: 30 });
    else for (const [dx, dy] of [[-260, 0], [260, 0], [0, -260], [0, 260], [-184, -184], [184, -184], [-184, 184], [184, 184]] as const)
      scene = scene.worker('foe', x(1500 + dx), 1600 + dy);
    const game = scene.build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const snapshot = snapshotGame(game);
    const options = bootstrapPolicyContext(snapshot, 'us', version, { memory: createAiPolicyMemory(), teams: game.teams });
    const rider = snapshot.units.find(unit => unit.id === 'rider')!, objective = snapshot.units.find(unit => unit.id === 'objective')!;
    expect(mountedFieldTargets(snapshot, 'us', rider, new Set([rider.id]), options).map(target => target.id)).toEqual(['objective']);
    const station = mountedFiringPoint(snapshot, rider, objective,
      snapshot.buildings.filter(building => building.owner === 'foe' && building.complete && building.attackDamage > 0),
      snapshot.units.filter(unit => unit.owner === 'foe' && unit.kind !== 'worker'))!;
    expect(station).toBeDefined();

    const commands = runAiCommandEntriesFromScripts(snapshot, 'us', [mountedField], options).map(entry => entry.command);

    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every(command => command.type === 'move' && command.unitIds.join() === rider.id)).toBe(true);
    const last = commands.at(-1)!;
    expect(last.type === 'move' && Math.hypot(last.x - station.x, last.y - station.y)).toBeLessThanOrEqual(MOVE_ORDER_ARRIVAL_RANGE);
  });
