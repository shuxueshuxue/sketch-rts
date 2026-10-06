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
export const CHECKSUM_VERSION = 7;

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
