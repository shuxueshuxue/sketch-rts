import type { Corpse, Unit } from '../shared/types';
import { shipProfile } from '../shared/ship-geometry';
import { detCos, detSin } from '../shared/det-math';
import { SIM_TICKS_PER_SECOND } from '../shared/time';

export type DisplayedHull = { x: number; y: number; heading: number };
export type DeckRemainsPose = DisplayedHull & { height: number };

/** A dead body stays on its recorded support. Missing/sunk support never
 * converts a deck death into a ground corpse at stale world coordinates. */
export function deckRemainsPose(corpse: Corpse, ship: Unit | undefined, displayed?: DisplayedHull): DeckRemainsPose | undefined {
  if (!corpse.deck || !ship || ship.id !== corpse.deck.shipId || ship.hp <= 0) return undefined;
  const profile = shipProfile(ship);
  if (!profile) return undefined;
  const heading = displayed?.heading ?? ship.sailing?.heading ?? 0;
  const c = detCos(heading), s = detSin(heading);
  return {
    x: (displayed?.x ?? ship.x) + corpse.deck.x * c - corpse.deck.y * s,
    y: (displayed?.y ?? ship.y) + corpse.deck.x * s + corpse.deck.y * c,
    heading, height: profile.deckHeight,
  };
}

/** Weathering is instance opacity, never part of a raster/cache key. */
export function remainsOpacity(tick: number, diedAtTick: number): number {
  const age = Math.max(0, tick - diedAtTick) / SIM_TICKS_PER_SECOND;
  return .58 - Math.min(1, age / 8) * .18;
}

export function remainsVariant(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
  return hash % 6;
}

const indexes = new WeakMap<readonly Corpse[], { length: number; byShip: ReadonlyMap<string, readonly Corpse[]> }>();
const EMPTY: ReadonlyMap<string, readonly Corpse[]> = new Map();
/** Facts are immutable; mutable recorder snapshots only append new remains. */
export function deckRemainsByShip(corpses: readonly Corpse[] | undefined): ReadonlyMap<string, readonly Corpse[]> {
  if (!corpses?.length) return EMPTY;
  const prior = indexes.get(corpses);
  if (prior?.length === corpses.length) return prior.byShip;
  const byShip = new Map<string, Corpse[]>();
  for (const corpse of corpses) if (corpse.deck) {
    let group = byShip.get(corpse.deck.shipId);
    if (!group) byShip.set(corpse.deck.shipId, group = []);
    group.push(corpse);
  }
  indexes.set(corpses, { length: corpses.length, byShip });
  return byShip;
}
