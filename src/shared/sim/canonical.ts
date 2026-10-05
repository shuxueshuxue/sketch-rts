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
    shops: game.shops,
    items: game.items,
    projectiles: game.projectiles,
    effects: game.effects,
    corpses: game.corpses,
    obstacles: game.obstacles,
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
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function canonicalizeArray(value: unknown[]) {
  const normalized = value.map((entry) => canonicalize(entry));
  if (normalized.every(hasStringId)) return normalized.sort((left, right) => compareCodeUnits(left.id, right.id));
  if (normalized.every((entry) => typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean")) return [...normalized].sort((left, right) => compareCodeUnits(String(left), String(right)));
  return normalized;
}

// @@@canonical-order - Keys and ids sort by UTF-16 code unit, the same on every machine. They used to sort by
// localeCompare, which collates by the machine's locale and ICU: under lt-LT (y between i and j) a new game's keys came out
// in another order and the same game hashed differently, so a client in that locale reported a desync against the server
// on every check. The new order changes most checksums (157 of 196 states sampled from four gauntlet games; a fresh game's
// often stays the same): see CHECKSUM_VERSION.
function compareCodeUnits(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasStringId(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null && "id" in value && typeof (value as { id?: unknown }).id === "string";
}

function roundNumber(value: number) {
  if (!Number.isFinite(value)) return value;
  const rounded = Math.round(value * NUMBER_PRECISION) / NUMBER_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}
