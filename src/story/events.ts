import type { Building, Unit, WorldItem } from "../shared/types";
import type { Instant } from "./time";

// @@@story-events - What happens in the world, as a discriminated union a script can wait on and match against. The sim
// is not asked to announce anything: the Director watches it (every hit through the sim's observer, every arrival,
// departure, finished building and picked-up item by comparing the world with what it saw a tick before) and writes
// down what happened, in the order it happened. A script's own `signal` joins the same stream.
export type StoryEvent =
  // A blow landed (weapon, spell or script power).
  | { type: "hit"; at: Instant; attacker: Unit | Building; target: Unit | Building; damage: number }
  // A unit fell; the killer is whoever struck the last blow.
  | { type: "died"; at: Instant; unit: Unit; killer?: Unit | Building }
  // A unit left the field without dying: a summon's time ran out, or a script took it off the stage.
  | { type: "departed"; at: Instant; unit: Unit }
  // A unit came onto the field: trained, hired, summoned or brought on by a script.
  | { type: "arrived"; at: Instant; unit: Unit }
  | { type: "destroyed"; at: Instant; building: Building; by?: Unit | Building }
  // A building was placed, or its construction finished.
  | { type: "founded"; at: Instant; building: Building }
  | { type: "completed"; at: Instant; building: Building }
  | { type: "pickedUp"; at: Instant; item: WorldItem; unit: Unit }
  // A choice the player made (see stage.choose).
  | { type: "chose"; at: Instant; prompt: string; option: string }
  // Anything a script announces for other scripts to hear.
  | { type: "signal"; at: Instant; name: string; data?: unknown };

export type StoryEventType = StoryEvent["type"];
export type EventOf<K extends StoryEventType> = Extract<StoryEvent, { type: K }>;

// A pattern is a predicate, or the shape of what to match: every field it names must match, recursively, and fields it
// leaves out match anything. `{ unit: { owner: "enemy", variant: "ash/colossus" } }` matches the colossus's death.
export type Pattern<T> = ((value: T) => boolean) | (T extends readonly unknown[] ? T : T extends object ? { readonly [K in keyof T]?: Pattern<T[K]> } : T);

export function matches<T>(value: T, pattern: Pattern<T> | undefined): boolean {
  if (pattern === undefined) return true;
  if (typeof pattern === "function") return (pattern as (value: T) => boolean)(value);
  if (typeof pattern !== "object" || pattern === null) return Object.is(value, pattern);
  if (typeof value !== "object" || value === null) return false;
  for (const [key, part] of Object.entries(pattern)) {
    if (!matches((value as Record<string, unknown>)[key], part as Pattern<unknown>)) return false;
  }
  return true;
}

// A field that may be any of these values.
export function oneOf<T>(...values: readonly T[]): (value: T) => boolean {
  return (value) => values.includes(value);
}

// A unit or building by id, as a pattern.
export function entity(id: string): (value: { id: string } | undefined) => boolean {
  return (value) => value?.id === id;
}
