import { boardUnit } from '../../shared/decks';
import type { GameSnapshot, Unit } from '../../shared/types';

/** Ask the real deck packing model. Payload mass alone cannot tell whether
 * cavalry, siege weapons and people fit around installed equipment.
 * Only deck occupants participate; no full-world scan per candidate. */
export function convoyCanCarry(snapshot: GameSnapshot, boats: readonly Unit[], passengers: readonly Unit[]): boolean {
  const hulls = new Set(boats.map(boat => boat.id));
  const reserved = snapshot.units.filter(unit => unit.deck && hulls.has(unit.deck.shipId));
  const seen = new Set(reserved.map(unit => unit.id));
  const candidates = passengers.filter(unit => !seen.has(unit.id) && Boolean(seen.add(unit.id)))
    .sort((a, b) => b.radius - a.radius || a.id.localeCompare(b.id));
  for (const unit of candidates) {
    let fits = false;
    for (const boat of boats) {
      const copy = { ...unit, deck: undefined };
      if (!boardUnit(boat, copy, reserved)) continue;
      reserved.push(copy); fits = true; break;
    }
    if (!fits) return false;
  }
  return true;
}
