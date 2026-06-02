import type { Game } from "../sim";

export type CanonicalGameState = ReturnType<typeof canonicalGameState>;

const NUMBER_PRECISION = 1_000;

export function canonicalGameState(game: Game) {
  return canonicalize({
    tick: game.tick,
    match: game.match,
    map: game.map,
    players: game.players,
    units: game.units,
    buildings: game.buildings,
    resources: game.resources,
    mercenaryCamps: game.mercenaryCamps,
    items: game.items,
    effects: game.effects,
    runtime: {
      nextId: game.nextId,
      activePlayers: game.activePlayers,
      teams: game.teams,
    },
  });
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "number") return roundNumber(value);
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return canonicalizeArray(value);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function canonicalizeArray(value: unknown[]) {
  const normalized = value.map((entry) => canonicalize(entry));
  if (normalized.every(hasStringId)) return normalized.sort((left, right) => left.id.localeCompare(right.id));
  if (normalized.every((entry) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")) return [...normalized].sort((left, right) => String(left).localeCompare(String(right)));
  return normalized;
}

function hasStringId(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null && "id" in value && typeof (value as { id?: unknown }).id === "string";
}

function roundNumber(value: number) {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.round(value * NUMBER_PRECISION) / NUMBER_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}
