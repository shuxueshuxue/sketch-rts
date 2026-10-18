import { generateMap } from '../src/shared/generated-map';
import { MAP_POOL } from '../src/shared/map-pool';
import { createRoom, roomToGameSetup } from '../src/shared/rooms';
import { UNIT_DEFS } from '../src/shared/catalog';
import { walkingDistance } from '../src/shared/terrain';

// Use the room's actual seats and generated terrain. Reverse the symmetric land
// query so all camps reuse one distance field per starting seat.
const rows = MAP_POOL.map(map => {
  const { options } = roomToGameSetup(createRoom({ id: `audit-${map.id}`, host: { id: 'audit', name: 'Audit' }, mapId: map.id, humanCount: 1, aiCount: map.players - 1 }));
  const drawn = generateMap(map.layout, options.players!, options.teams as Record<string, string>);
  const strength = drawn.units.filter(unit => unit.owner === 'neutral').reduce((sum, unit) => sum + (UNIT_DEFS[unit.kind].creepFoodPower ?? 0), 0);
  const perStart = options.players!.map(player => {
    const start = drawn.starts[player]!, at = { x: start.baseX, y: start.baseY };
    const camps = drawn.camps.map(camp => ({ tier: camp.tier, distance: walkingDistance(drawn, camp, at) }));
    return { player, x: at.x, y: at.y,
      campsWithin120s: camps.filter(camp => camp.distance !== undefined && camp.distance <= UNIT_DEFS.archer.speed * 120).length,
      greenWithin30s: camps.filter(camp => camp.tier === 'green' && camp.distance !== undefined && camp.distance <= UNIT_DEFS.archer.speed * 30).length,
      nearestCamp: Math.min(...camps.flatMap(camp => camp.distance === undefined ? [] : [camp.distance])),
      allocatedCamps: 0, allocatedStrength: 0,
    };
  });
  let transportOnlyCamps = 0;
  for (const camp of drawn.camps) {
    const costs = perStart.map(start => walkingDistance(drawn, camp, start) ?? Infinity);
    const nearest = Math.min(...costs);
    if (!Number.isFinite(nearest)) { transportOnlyCamps++; continue; }
    // Grid rounding can move symmetric walks by a cell. Split tied camps;
    // a contested central camp must not all accrue to the first room seat.
    const shares = costs.map((cost, i) => cost <= nearest + drawn.terrain.cell ? i : -1).filter(i => i >= 0);
    const power = drawn.units.filter(unit => unit.owner === 'neutral' && Math.hypot(unit.x - camp.x, unit.y - camp.y) < 100)
      .reduce((sum, unit) => sum + (UNIT_DEFS[unit.kind].creepFoodPower ?? 0), 0);
    for (const i of shares) { perStart[i]!.allocatedCamps += 1 / shares.length; perStart[i]!.allocatedStrength += power / shares.length; }
  }
  return { id: map.id, name: map.name.zh, size: drawn.size, players: map.players, camps: drawn.camps.length,
    tiers: Object.fromEntries(['green', 'orange', 'red'].map(tier => [tier, drawn.camps.filter(camp => camp.tier === tier).length])),
    strength, campsPerPlayer: drawn.camps.length / map.players, strengthPerPlayer: strength / map.players, transportOnlyCamps, perStart };
});
console.log(JSON.stringify({ walkingSpeed: UNIT_DEFS.archer.speed, rows }, null, 2));
