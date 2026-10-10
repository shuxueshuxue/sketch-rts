import { expect, it } from 'vitest';
import { sketchScene } from '../sdk/scene';
import { SdkCommandFrameRuntime } from '../sdk/commands/frame';
import { hullFits } from './ship-navigation';
import { shipPassengers } from './ship-geometry';
import { stepGame } from './sim';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  'walks $race settlers round a shipyard before entering its ferry (mirror=$mirror)', ({ race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const game = sketchScene('shore-approach').map('bareDuel').replaceDefaults()
      .player('us', { race }).player('foe', { race: 'grove' })
      .townHall('us', x(500), 500).townHall('foe', x(500), 3500)
      .building('us', 'shipyard', x(1024), 1024)
      .worker('us', x(1804), 1024, { id: 'settler-a' })
      .worker('us', x(1804), 1080, { id: 'settler-b' }).build().createGame();
    const cells = Array.from({ length: 128 * 128 }, (_, index) => {
      const col = mirror ? 127 - index % 128 : index % 128;
      return col < 28 ? '~' : col < 32 ? ',' : '.';
    }).join('');
    game.map = { ...game.map, width: 4096, height: 4096, terrain: { cell: 32, cols: 128, rows: 128, cells } };
    const boat = game.spawnUnit('us', 'transport', x(886.128952492706), 976, { x: x(886.128952492706), y: 976, heading: mirror ? Math.PI - 0.7470009198974483 : 0.7470009198974483 });
    stepGame(game);
    expect(hullFits(game.map, boat)).toBe(true);
    const settlers = game.units.filter(unit => unit.kind === 'worker');
    const sdk = new SdkCommandFrameRuntime(game);
    sdk.issue([{ playerId: 'us', scriptId: 'shore-approach', command: { type: 'board', unitIds: settlers.map(unit => unit.id), transportId: boat.id } }]);
    for (let tick = 0; tick < 900 && shipPassengers(game.units, boat).length < 2; tick++) stepGame(game);
    const diagnostic = JSON.stringify(game.units.map(unit => ({ id: unit.id, x: unit.x, y: unit.y, order: unit.order, deck: unit.deck })));
    expect(shipPassengers(game.units, boat).map(unit => unit.id).sort(), diagnostic).toEqual(['settler-a', 'settler-b']);
    for (const settler of settlers) { expect(game.units).toContain(settler); expect(settler.hp).toBe(settler.maxHp); }
    expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBe(500);
  },
);
