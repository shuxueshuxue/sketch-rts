import { readCacheMap, retainCacheMap } from './bounded-cache';
import { unitMover } from '../../shared/catalog';
import { groundWholeAt, groundRegionIndex, type GroundRegionIndex, type GroundShore } from '../../shared/terrain';
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
// Geography is prepared by terrain's existing game warmup, before the first
// think. These are views of that one index, with no AI publication progress.
export type Shore = GroundShore;
export type RegionIndex = GroundRegionIndex;
export const regionIndex = groundRegionIndex;

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
  const previous = readCacheMap(values, unit.id);
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
    retainCacheMap(values, unit.id, { x, y, mover, shipId, cabin, location }, 2048); return location;
  }
  return { kind: 'unknown', point, reason: deferredRecord({ code: shipId ? 'passenger-support-unknown' : 'terrain-component-unknown',
    detail: shipId ? `Supporting ship ${shipId} is absent or outside navigable water` : 'No traversable terrain label at the unit position',
    evidence: [{ source: 'terrain.groundWholeAt', tick, certainty: 'recorded', detail: unit.id }] }) };
}
