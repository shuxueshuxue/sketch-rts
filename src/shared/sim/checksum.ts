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
// 16: persisted, fairly scheduled complex ship route requests.
// 17: exact saved state of deterministic incremental ship navigation.
// 18: death-time corpse equipment, owner race and deck attachment facts.
// 19: building upgrades as work-queue jobs; the fortified tower is its own building kind.
// 20: the tick a ship's hull was last struck by an enemy, which slows its repair.
export const CHECKSUM_VERSION = 20;

export function checksumGame(game: Game): string {
  return fnv1a(JSON.stringify(canonicalGameState(game)));
}

/** Same-rules replay compatibility only; callers must validate the rules version first. */
export function checksumGameForVersion(game: Game, version: number): string {
  // Version 19 changed only how an upgrade under way and a fortified tower are kept; a game with neither hashes the same.
  if (version === CHECKSUM_VERSION) return checksumGame(game);
  const checkedGame = { ...game };
  // Versions 18 and 19 kept no tick of a ship's last hull hit (version 20); 18 differs from 19 only where 19 has an
  // upgrade under way or a fortified tower, which an 18 game cannot hold.
  if (version === 19 || version === 18) {
    checkedGame.units = game.units.map(unit => {
      if (unit.sailing?.hullHitTick === undefined) return unit;
      const { hullHitTick, ...sailing } = unit.sailing;
      return { ...unit, sailing };
    });
    return checksumGame(checkedGame);
  }
  if (version === 2) {
    delete checkedGame.corpses;
  } else if (version === 17) {
    if (game.corpses) checkedGame.corpses = game.corpses.map(corpse => {
      const { equipmentCaptured, rightItemKind, weaponKind, leftItemKind, ownerRace, deck, ...prior } = corpse;
      return prior;
    });
  } else {
    throw new Error(`Unsupported checksum version ${version}`);
  }
  return checksumGame(checkedGame);
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
