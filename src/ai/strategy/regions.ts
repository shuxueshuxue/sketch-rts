import { unitMover } from '../../shared/catalog';
import { groundWholeAnchors, groundWholeAt, groundShoreContacts, type Terrain } from '../../shared/terrain';
import type { GameMap, Unit } from '../../shared/types';
import type { LandId, Location, Point, SeaId } from './types';
import { deferredRecord } from './explanations';

const landNames = new Map<number, LandId>(), seaNames = new Map<number, SeaId>();
function landName(label: number): LandId {
  let value = landNames.get(label); if (!value) landNames.set(label, value = `land:${label}`); return value;
}
function seaName(label: number): SeaId {
  let value = seaNames.get(label); if (!value) seaNames.set(label, value = `sea:${label}`); return value;
}
export const landIdAt = (map: GameMap, point: Point): LandId | undefined => {
  const label = groundWholeAt(map, point);
  return label === undefined ? undefined : landName(label);
};
export const seaIdAt = (map: GameMap, point: Point): SeaId | undefined => {
  const label = groundWholeAt(map, point, 'sea');
  return label === undefined ? undefined : seaName(label);
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

type LocationFact = { x: number; y: number; mover: 'land' | 'sea'; shipId: string | undefined; cabin: boolean; location: Location };
const locations = new WeakMap<object, Map<string, LocationFact>>();
/** Only known, tick-independent locations are retained. The key includes every
 * input read below; an eviction or cold cache recomputes exactly the same fact.
 * No Unit, snapshot, memory or explanation from an old frame is retained. */
export function unitLocation(map: GameMap, unit: Unit, units: ReadonlyMap<string, Unit>, tick: number): Location {
  const shipId = unit.deck?.shipId ?? unit.cabin?.shipId;
  const ship = shipId ? units.get(shipId) : undefined;
  const x = ship?.x ?? unit.x, y = ship?.y ?? unit.y, mover = unitMover(unit.kind), cabin = Boolean(unit.cabin);
  const namespace = map.terrain ?? map;
  let values = locations.get(namespace);
  if (!values) locations.set(namespace, values = new Map());
  const previous = values.get(unit.id);
  if ((!shipId || ship) && previous?.x === x && previous.y === y && previous.mover === mover
    && previous.shipId === shipId && previous.cabin === cabin) return previous.location;
  const point = { x, y };
  let location: Location | undefined;
  if (shipId && ship) {
    const seaId = seaIdAt(map, ship);
    if (seaId) location = { kind: 'aboard', shipId, seaId, compartment: cabin ? 'cabin' : 'deck', point };
  } else if (!shipId && mover === 'sea') {
    const seaId = seaIdAt(map, point);
    if (seaId) location = { kind: 'sea', seaId, point };
  } else if (!shipId) {
    const landId = landIdAt(map, point);
    if (landId) location = { kind: 'land', landId, point };
  }
  if (location) {
    if (values.size >= 2048) values.delete(values.keys().next().value!);
    values.set(unit.id, { x, y, mover, shipId, cabin, location }); return location;
  }
  return { kind: 'unknown', point, reason: deferredRecord({ code: shipId ? 'passenger-support-unknown' : 'terrain-component-unknown',
    detail: shipId ? `Supporting ship ${shipId} is absent or outside navigable water` : 'No traversable terrain label at the unit position',
    evidence: [{ source: 'terrain.groundWholeAt', tick, certainty: 'recorded', detail: unit.id }] }) };
}
