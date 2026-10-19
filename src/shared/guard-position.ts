import { localToWorld } from './ship-geometry';
import type { PlayerId, Unit } from './types';

export const GUARD_LEASH_RANGE = 600;
type GuardWorld = { aiPlayers: readonly PlayerId[]; units: readonly Unit[] };

/** Controller identity belongs to the simulation, including external SDK agents. */
export function hasHumanGuard(world: GuardWorld, unit: Unit): boolean {
  return unit.owner !== 'neutral' && !world.aiPlayers.includes(unit.owner);
}

/** Only births and completed/activated explicit commands establish a new station. */
export function setGuardPosition(world: GuardWorld, unit: Unit): void {
  if (!hasHumanGuard(world, unit)) return;
  unit.guardPosition = unit.deck
    ? { x: unit.deck.x, y: unit.deck.y, shipId: unit.deck.shipId }
    : { x: unit.x, y: unit.y };
  if (unit.sailing) delete unit.sailing.defense;
}

/** A deck station follows its hull rather than becoming a point in open water. */
export function guardPosition(world: Pick<GuardWorld, 'units'>, unit: Unit): { x: number; y: number } {
  const station = unit.guardPosition;
  if (!station) return { x: unit.x, y: unit.y };
  const ship = station.shipId && world.units.find(candidate => candidate.id === station.shipId && candidate.hp > 0);
  return ship ? localToWorld(ship, station) : station;
}

export function automaticLeash(world: GuardWorld, unit: Unit): { leashX: number; leashY: number } {
  if (!unit.guardPosition) setGuardPosition(world, unit);
  const origin = hasHumanGuard(world, unit) ? guardPosition(world, unit) : unit;
  return { leashX: origin.x, leashY: origin.y };
}
