import { unitMover } from '../../shared/catalog';
import { groundWholeAnchors, groundWholeAt, groundShoreContacts, type Terrain } from '../../shared/terrain';
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
  shoresByLand: ReadonlyMap<LandId, ReadonlyMap<SeaId, readonly Shore[]>>;
  scannedRows: number;
  totalRows: number;
  scannedAtTick: number;
}>;
type MutableIndex = { lands: Map<LandId, Point>; seas: Map<SeaId, Point>; shores: Shore[]; shoresByLand: Map<LandId, Map<SeaId, Shore[]>>; scannedRows: number; totalRows: number; scannedAtTick: number };
const indices = new WeakMap<Terrain, MutableIndex>();

/** Enumerates labels from the one terrain connectivity implementation, once per
 * immutable terrain. Buildings never change these IDs; roads still check bodies. */
export function regionIndex(map: GameMap, rowBudget = Infinity, tick = 0): RegionIndex {
  if (!map.terrain) return { lands: new Map([['land:1', { x: 0, y: 0 }]]),
    seas: new Map([['sea:1', { x: 0, y: 0 }]]), shores: [], shoresByLand: new Map(), scannedRows: 0, totalRows: 0, scannedAtTick: tick };
  const terrain = map.terrain;
  let result = indices.get(terrain);
  if (!result) indices.set(terrain, result = {
    lands: new Map(groundWholeAnchors(map).map(({ label, point }) => [`land:${label}` as LandId, point])),
    seas: new Map(groundWholeAnchors(map, 'sea').map(({ label, point }) => [`sea:${label}` as SeaId, point])),
    shores: [], shoresByLand: new Map(), scannedRows: 0, totalRows: terrain.rows, scannedAtTick: tick,
  });
  const end = Math.min(terrain.rows, result.scannedRows + rowBudget);
  const add = (shore: Shore) => {
    result!.shores.push(shore);
    let seas = result!.shoresByLand.get(shore.landId);
    if (!seas) result!.shoresByLand.set(shore.landId, seas = new Map());
    let contacts = seas.get(shore.seaId);
    if (!contacts) seas.set(shore.seaId, contacts = []);
    contacts.push(shore);
  };
  if (end > result.scannedRows) result.scannedAtTick = tick;
  for (const contact of groundShoreContacts(map, result.scannedRows, end)) add({
    landId: `land:${contact.land}`, seaId: `sea:${contact.sea}`, ground: contact.ground, water: contact.water,
  });
  result.scannedRows = end;
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
