import { createUnit } from '../map';
import { deckPlacement } from '../decks';
import { circleInPolygon, shipPassengers, shipProfile, worldToLocal } from '../ship-geometry';
import { bodyMass } from '../physical-body';
import { isWalkable } from '../terrain';
import type { CommandRefusal } from '../command-refusal';
import type { GameSnapshot, Unit, UnitKind } from '../types';

type Point = { x: number; y: number };
type Placement = { ship?: Unit; point?: Point } | { refusal: CommandRefusal };

/** The same physical placement test serves target previews and the actual cast. It allocates no entity ID. */
export function summonPlacement(snapshot: GameSnapshot, caster: Unit, kind: UnitKind, at: Point): Placement {
  const ship = snapshot.units.find(ship => shipProfile(ship) && ship.owner === caster.owner
    && circleInPolygon(worldToLocal(ship, at), 0, shipProfile(ship)!.deck));
  if (!ship) return isWalkable(snapshot.map, at.x, at.y) ? {} : { refusal: { reason: 'condition-unmet', detail: { category: 'target' } } };
  const probe = createUnit('summon-probe', caster.owner, kind, at.x, at.y);
  const point = deckPlacement(ship, probe, snapshot.units, worldToLocal(ship, at));
  const load = shipPassengers(snapshot.units, ship).reduce((mass, unit) => mass + bodyMass(unit), bodyMass(probe));
  return point && load <= shipProfile(ship)!.loadCapacity ? { ship, point }
    : { refusal: { reason: 'condition-unmet', detail: { category: 'occupied' } } };
}
