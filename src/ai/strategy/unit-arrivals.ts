import type { Arrival, SituationUnit } from './types';
import type { DecisionFacts } from './decision';

export type ArrivalColumns = Readonly<{ ids: readonly string[]; index: ReadonlyMap<string, number> }>;
export type UnitArrivalFacts = Readonly<{
  columns: ArrivalColumns;
  values: readonly (Arrival | undefined)[];
  count: number;
}>;
type Entry = SituationUnit['arrivals'][number];
type Projection = UnitArrivalFacts & { rendered?: readonly Entry[] };
const storedArrivals = Symbol('unit-numerical-arrivals');
type StoredUnit = { [storedArrivals]?: Projection };
const emptyEntries: readonly Entry[] = Object.freeze([]);
export const EMPTY_UNIT_ARRIVALS: UnitArrivalFacts = { columns: { ids: [], index: new Map() }, values: [], count: 0 };

export function arrivalColumns(ids: readonly string[]): ArrivalColumns {
  const index = new Map<string, number>();
  for (let position = 0; position < ids.length; position++) index.set(ids[position]!, position);
  return { ids, index };
}

export function unitArrivalFacts(unit: object): UnitArrivalFacts | undefined { return (unit as StoredUnit)[storedArrivals]; }

function materialize(this: StoredUnit): readonly Entry[] {
  const facts = this[storedArrivals]!;
  if (!facts.count) return emptyEntries;
  if (facts.rendered) return facts.rendered;
  const entries: Entry[] = [];
  for (let index = 0; index < facts.columns.ids.length; index++) {
    const arrival = facts.values[index];
    if (arrival) entries.push({ targetId: facts.columns.ids[index]!, arrival });
  }
  return facts.rendered = entries;
}
const arrayProjection: PropertyDescriptor = { enumerable: true, configurable: true, get: materialize };

/** Own only the compact immutable route row, never an evaluator or snapshot.
 * The shared getter has no per-unit closure and preserves the original JSON. */
export function withUnitArrivals<T extends object>(unit: T, facts: UnitArrivalFacts): T & Pick<SituationUnit, 'arrivals'> {
  Object.defineProperty(unit, storedArrivals, { value: facts });
  return Object.defineProperty(unit, 'arrivals', arrayProjection) as T & Pick<SituationUnit, 'arrivals'>;
}

/** The decision path does not allocate the compatibility array or entry pairs.
 * Deserialized/plain scene inputs continue to use their ordinary array. */
export function unitArrival(unit: SituationUnit, targetId: string): Arrival | undefined;
export function unitArrival(unit: DecisionFacts<SituationUnit>, targetId: string): DecisionFacts<Arrival> | undefined;
export function unitArrival(unit: SituationUnit | DecisionFacts<SituationUnit>, targetId: string): Arrival | DecisionFacts<Arrival> | undefined {
  const facts = unitArrivalFacts(unit);
  if (!facts) return unit.arrivals.find(entry => entry.targetId === targetId)?.arrival;
  const index = facts.columns.index.get(targetId);
  return index === undefined ? undefined : facts.values[index];
}

export function mapUnitArrivals<T>(unit: SituationUnit, project: (targetId: string, arrival: Arrival) => T): T[] {
  const facts = unitArrivalFacts(unit);
  if (!facts) return unit.arrivals.map(entry => project(entry.targetId, entry.arrival));
  const result: T[] = [];
  for (let index = 0; index < facts.columns.ids.length; index++) {
    const arrival = facts.values[index]; if (arrival) result.push(project(facts.columns.ids[index]!, arrival));
  }
  return result;
}
