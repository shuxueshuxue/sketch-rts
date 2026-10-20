import { unitMover } from '../../shared/catalog';
import { groundWholeAt, type Terrain } from '../../shared/terrain';
import type { GameMap, Unit } from '../../shared/types';
import type { LandId, Location, Point, SeaId } from './types';

export const landIdAt = (map: GameMap, point: Point): LandId | undefined => {
  const label = groundWholeAt(map, point);
  return label === undefined ? undefined : `land:${label}`;
};
export const seaIdAt = (map: GameMap, point: Point): SeaId | undefined => {
  const label = groundWholeAt(map, point, 'sea');
  return label === undefined ? undefined : `sea:${label}`;
};
export type Shore = Readonly<{ landId: LandId; seaId: SeaId; ground: Point; water: Point }>;
export type RegionIndex = Readonly<{
  lands: ReadonlyMap<LandId, Point>;
  seas: ReadonlyMap<SeaId, Point>;
  shores: readonly Shore[];
}>;
const indices = new WeakMap<Terrain, RegionIndex>();

/** Enumerates labels from the one terrain connectivity implementation, once per
 * immutable terrain. Buildings never change these IDs; roads still check bodies. */
export function regionIndex(map: GameMap): RegionIndex {
  if (!map.terrain) return { lands: new Map([['land:1', { x: 0, y: 0 }]]),
    seas: new Map([['sea:1', { x: 0, y: 0 }]]), shores: [] };
  const terrain = map.terrain, known = indices.get(terrain);
  if (known) return known;
  const lands = new Map<LandId, Point>(), seas = new Map<SeaId, Point>(), shores: Shore[] = [];
  for (let row = 0; row < terrain.rows; row++) {
    for (let col = 0; col < terrain.cols; col++) {
      const point = { x: (col + .5) * terrain.cell, y: (row + .5) * terrain.cell };
      const land = landIdAt(map, point), sea = seaIdAt(map, point);
      if (land && !lands.has(land)) lands.set(land, point);
      if (sea && !seas.has(sea)) seas.set(sea, point);
      if (land && sea) shores.push({ landId: land, seaId: sea, ground: point, water: point });
      // Landing needs a land/water contact, not enough land to place a shipyard.
      // Small islands may have a usable beach and no legal shipyard footprint.
      if (sea && !land) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const ground = { x: point.x + dx * terrain.cell, y: point.y + dy * terrain.cell };
        const landId = landIdAt(map, ground);
        if (landId) shores.push({ landId, seaId: sea, ground, water: point });
      }
    }
  }
  const result = { lands, seas, shores };
  indices.set(terrain, result);
  return result;
}

export function unitLocation(map: GameMap, unit: Unit, units: ReadonlyMap<string, Unit>, tick: number): Location {
  const shipId = unit.deck?.shipId ?? unit.cabin?.shipId;
  const ship = shipId ? units.get(shipId) : undefined;
  const point = { x: ship?.x ?? unit.x, y: ship?.y ?? unit.y };
  if (shipId && ship) {
    const seaId = seaIdAt(map, ship);
    if (seaId) return { kind: 'aboard', shipId, seaId, compartment: unit.cabin ? 'cabin' : 'deck', point };
  } else if (!shipId && unitMover(unit.kind) === 'sea') {
    const seaId = seaIdAt(map, point);
    if (seaId) return { kind: 'sea', seaId, point };
  } else if (!shipId) {
    const landId = landIdAt(map, point);
    if (landId) return { kind: 'land', landId, point };
  }
  return { kind: 'unknown', point, reason: { code: shipId ? 'passenger-support-unknown' : 'terrain-component-unknown',
    detail: shipId ? `Supporting ship ${shipId} is absent or outside navigable water` : 'No traversable terrain label at the unit position',
    evidence: [{ source: 'terrain.groundWholeAt', tick, certainty: 'recorded', detail: unit.id }] } };
}
