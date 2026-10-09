import type { Game } from "../sim";
import { canonicalGameState } from "./canonical";
export { canonicalGameState, type CanonicalGameState } from "./canonical";

// Which way checksumGame hashes, for anything that stores a checksum to compare later. 1: keys and ids ordered by
// localeCompare (locale-dependent); 2: by code unit (see @@@canonical-order). Checksums of different versions cannot be
// compared: the same game mostly hashes differently under each.
// 3: persistent corpse records participate in deterministic state checks.
// 4: movement and push velocities use distance per second.
// 5: live deck crew, local deck orders and continuous hull poses.
// 6: serialized hull routes and swept coast collision.
// 7: equipment positions, live mounted weapons and damaged ship parts.
// 8: fixed veteran skill offers, learned skills and shared damage-reduction effects.
// 9: unit classes, skill target filters and general mechanical repair orders.
// 10: true wind, sail trim, signed hull velocity and wind-aware routes.
// 11: deterministic eight-minute wind changes and serialized weather events.
// 12: persistent voyage helm, passing decisions and moving-target pursuit.
// 13: curved laylines, moving gun aim and stable firing stations.
// 14: sheltered cabin crew, compartment damage and heavy broadside hulls.
// 15: enlarged hulls, guard stations, population cabins and deployed boarding bridges.
export const CHECKSUM_VERSION = 15;

export function checksumGame(game: Game): string {
  return fnv1a(JSON.stringify(canonicalGameState(game)));
}

export function fnv1a(input: string) {
  // @@@canonical-checksum - The hash is intentionally simple; determinism comes from canonical state, not cryptographic strength.
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
