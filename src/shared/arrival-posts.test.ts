import { expect, it } from 'vitest';
import { createGame, stepGame } from './sim';
import { createBuilding } from './map';
import type { Unit, UnitOrder } from './types';
import scene from './test-fixtures/arrival-casters.json';

// A bench game's own army as it stood (ladder-14, v9_knight against v9, tick 29600): knights, raiders and lancers idle
// in their base between a town hall and three towers, and its casters each sent to a post of their own round it, a
// body or less from one another's (the AI gives each its own). None ever arrived: each pressed against a friend
// standing on or walking to the next post, and a friend counted as there only at the very same point. They waited
// there for the rest of the game.
it('lets casters sent to posts a body apart arrive among each other', () => {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.items = []; game.buildings = []; game.resources = []; game.mercenaryCamps = []; game.obstacles = []; game.scriptedVictory = true;
  const size = scene.rows.length, cell = scene.cell;
  game.map = { ...game.map, width: size * cell, height: size * cell, terrain: { cell, cols: size, rows: size, cells: scene.rows.join('') } };
  const local = <T extends { x: number; y: number }>(point: T): T => ({ ...point, x: point.x - scene.origin.x, y: point.y - scene.origin.y });
  for (const [i, building] of scene.buildings.entries()) {
    const at = local(building);
    game.buildings.push(createBuilding(`building-${i}`, 'player', building.kind as never, at.x, at.y, true));
  }
  const army: Unit[] = scene.units.filter(unit => unit.owner === 'player').map(recorded => {
    const at = local(recorded), unit = game.spawnUnit('player', recorded.kind as never, at.x, at.y);
    Object.assign(unit, { x: at.x, y: at.y, arrivedAt: recorded.arrivedAt ? local(recorded.arrivedAt) : undefined });
    unit.order = ('x' in recorded.order ? local(recorded.order as { x: number; y: number }) : recorded.order) as UnitOrder;
    return unit;
  });
  const casters = army.filter(unit => unit.order.type === 'move');
  expect(casters.map(unit => unit.kind).sort()).toEqual(['priest', 'priest', 'priest', 'witch', 'witch', 'witch', 'witch']);
  for (let tick = 0; tick < 60 * 20; tick++) stepGame(game);
  expect(casters.map(unit => unit.order.type)).toEqual(casters.map(() => 'idle'));
});
