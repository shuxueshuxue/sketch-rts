import type { Game } from "../sim";
import { canonicalGameState } from "./canonical";
export { canonicalGameState, type CanonicalGameState } from "./canonical";

export function checksumGame(game: Game): string {
  return fnv1a(JSON.stringify(canonicalGameState(game)));
}

function fnv1a(input: string) {
  // @@@canonical-checksum - The hash is intentionally simple; determinism comes from canonical state, not cryptographic strength.
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
