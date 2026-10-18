import { describe, expect, it } from 'vitest';
import { generateMap } from './generated-map';
import { MAP_POOL } from './map-pool';
import { UNIT_DEFS } from './catalog';
import { createRoom, roomToGameSetup } from './rooms';
import { isWalkable, walkingDistance } from './terrain';
import type { GeneratedLayoutOptions } from './types';

describe('generated camp budget', () => {
  for (const map of MAP_POOL) {
    it(`${map.id}: scales camps with seats and gives every home two reachable opening camps`, () => {
      const { options } = roomToGameSetup(createRoom({ id: 'camp-budget', host: { id: 'host', name: 'Host' }, mapId: map.id, humanCount: 1, aiCount: map.players - 1 }));
      const drawn = generateMap(map.layout, options.players!, options.teams as Record<string, string>);
      expect(drawn.camps.length).toBeGreaterThanOrEqual(4 * map.players);
      for (const player of options.players!) {
        const start = drawn.starts[player]!, at = { x: start.baseX, y: start.baseY };
        const nearby = drawn.camps.filter(camp => camp.tier === 'green'
          && Object.values(drawn.starts).every(other => Math.hypot(camp.x - at.x, camp.y - at.y) <= Math.hypot(camp.x - other.baseX, camp.y - other.baseY) + 2)
          && (walkingDistance(drawn, camp, at) ?? Infinity) <= UNIT_DEFS.archer.speed * 30);
        expect(nearby.length, `${map.id}/${player}: opening camps`).toBeGreaterThanOrEqual(2);
      }
      for (const unit of drawn.units) expect(isWalkable(drawn, unit.x, unit.y), unit.id).toBe(true);
    });
  }
  it.each([2, 3, 4, 5, 6, 7, 8])('budgets fresh ring/sides layouts for %i seats', count => {
    const players = Array.from({ length: count }, (_, i) => `p${i}`);
    const teams = Object.fromEntries(players.map((player, i) => [player, i < count / 2 ? 'a' : 'b']));
    for (let i = 0; i < 2; i++) {
      const layout: GeneratedLayoutOptions = { seed: `budget-stress-${count}-${i}`, kind: count % 2 === 0 && count >= 4 ? 'sides' : 'ring' };
      const drawn = generateMap(layout, players, teams);
      expect(drawn.camps.length).toBeGreaterThanOrEqual(4 * count);
      for (const start of Object.values(drawn.starts)) {
        const home = { x: start.baseX, y: start.baseY };
        expect(drawn.camps.filter(camp => camp.tier === 'green' && (walkingDistance(drawn, camp, home) ?? Infinity) <= 1800).length).toBeGreaterThanOrEqual(2);
      }
      expect(generateMap(layout, players, teams)).toEqual(drawn);
    }
  });
});
