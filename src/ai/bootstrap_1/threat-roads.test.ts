import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { retreatLandTravelTicks } from './safe-land-route';
import { threatLandRouter, threatRoadCommands } from './threat-roads';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
  (['detour', 'closed', 'corner'] as const).map(shape => ({ race, mirror, shape }))))) (
  '$race executes the admitted $shape road around live tower coverage (mirror=$mirror)', ({ race, mirror, shape }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const make = () => {
      const game = sketchScene('native-threat-road').map('bareDuel').replaceDefaults()
        .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
        .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
        .unit('us', race === 'grove' ? 'horseArcher' : 'sparkArcher', x(shape === 'corner' ? 3000 : 1100), shape === 'corner' ? 3000 : 2000, { id: 'traveller' })
        .tower('foe', x(2000), 2000, { id: 'tower' }).build().createGame();
      game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
        shape === 'closed' && index % 128 === (mirror ? 63 : 64) ? '#' : '.').join('') };
      for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
      setBuildingBodies(game.map, game.buildings);
      return game;
    };
    const game = make(), control = make(), unit = game.units.find(unit => unit.id === 'traveller')!;
    const goal = { x: x(shape === 'corner' ? 2370 : 2900), y: shape === 'corner' ? 2370 : 2000 }, snapshot = snapshotGame(game), tower = snapshot.buildings.find(b => b.id === 'tower')!;
    const terrain = game.map.terrain!.cells;
    if (shape === 'corner') expect(retreatLandTravelTicks(snapshot, unit, goal, [tower])).toBeDefined();
    else expect(retreatLandTravelTicks(snapshot, unit, goal, [tower])).toBeUndefined();
    const road = threatLandRouter(snapshot, unit, [tower])(goal);
    if (shape === 'closed') { expect(road).toBeUndefined(); return; }
    expect(road).toBeDefined();
    let injury = 0, controlInjury = 0;
    game.observer = { hit(_source, target, damage) { if (target.id === unit.id) injury += damage; } };
    control.observer = { hit(_source, target, damage) { if (target.id === unit.id) controlInjury += damage; } };
    for (const command of threatRoadCommands(unit, road!)) issuePlayerCommand(game, 'us', command);
    issuePlayerCommand(control, 'us', { type: 'move', unitIds: [unit.id], ...goal, avoidCombat: true });
    for (let tick = 0; tick < 2000 && Math.hypot(unit.x - goal.x, unit.y - goal.y) > 8; tick++) {
      stepGame(game); stepGame(control);
    }
    const diagnostic = JSON.stringify({ unit, road, injury, controlInjury });
    expect(Math.hypot(unit.x - goal.x, unit.y - goal.y), diagnostic).toBeLessThanOrEqual(8);
    expect(injury, diagnostic).toBe(0);
    if (shape === 'corner') expect(controlInjury, diagnostic).toBe(0);
    else expect(controlInjury, diagnostic).toBeGreaterThan(0);
    expect(game.units).toContain(unit);
    expect(game.map.terrain!.cells).toBe(terrain);
    expect(game.match.stats.goldSpent.us).toBe(0);
  }, 30000);
