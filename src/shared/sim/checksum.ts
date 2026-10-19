import type { Game } from "../sim";
import type { UnitAim } from '../types';
import { canonicalGameState } from "./canonical";
export { canonicalGameState, type CanonicalGameState } from "./canonical";

// Which way checksumGame hashes, for anything that stores a checksum to compare later. 1: keys and ids ordered by
// localeCompare (locale-dependent); 2: by code unit (see @@@canonical-order). Checksums of different versions cannot be
// compared: the same game mostly hashes differently under each.
// This versions the canonical hash representation, not the seed-to-initial-map mapping: changing a map changes the
// state being hashed, while the checksum format can stay the same.
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
// 21: human seat identity and persistent guard stations; all-AI state hashes stay unchanged.
// 22: aim records identify the target allowed to finish the current ranged windup.
export const CHECKSUM_VERSION = 22;

export function checksumGame(game: Game): string {
  return fnv1a(JSON.stringify(canonicalGameState(game)));
}

/** Same-rules replay compatibility only; callers must validate the rules version first. */
export function checksumGameForVersion(game: Game, version: number): string {
  // Version 19 changed only how an upgrade under way and a fortified tower are kept; a game with neither hashes the same.
  if (version === CHECKSUM_VERSION) return checksumGame(game);
  const checkedGame = { ...game };
  checkedGame.units = game.units.map(withoutAimTarget);
  checkedGame.items = game.items.map(withoutAimTarget);
  if (version === 21) return checksumGame(checkedGame);
  checkedGame.units = checkedGame.units.map(unit => {
    const { guardPosition, ...prior } = unit;
    if (prior.order.type === 'move' && prior.order.returnToGuard) {
      const { returnToGuard, ...order } = prior.order;
      prior.order = order;
    }
    return prior;
  });
  // Versions 18 and 19 kept no tick of a ship's last hull hit (version 20); 18 differs from 19 only where 19 has an
  // upgrade under way or a fortified tower, which an 18 game cannot hold.
  if (version === 20 || version === 19 || version === 18) {
    checkedGame.units = checkedGame.units.map(unit => {
      if (version === 20 || unit.sailing?.hullHitTick === undefined) return unit;
      const { hullHitTick, ...sailing } = unit.sailing;
      return { ...unit, sailing };
    });
    return priorVersionChecksum(checkedGame);
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
  return priorVersionChecksum(checkedGame);
}

function withoutAimTarget<T extends { aim?: UnitAim | undefined }>(entity: T): T {
  if (!entity.aim || entity.aim.targetId === undefined) return entity;
  const { targetId, ...aim } = entity.aim;
  return { ...entity, aim };
}

function priorVersionChecksum(game: Game): string {
  const canonical = canonicalGameState(game) as { runtime: { humanPlayers?: string[] } };
  delete canonical.runtime.humanPlayers;
  return fnv1a(JSON.stringify(canonical));
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
