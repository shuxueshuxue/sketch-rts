import type { PlayerId, WorldEffect } from "../shared/types";

const privateFeedback = new Set<WorldEffect["type"]>([
  "move", "queuedMove", "mine", "queuedMine", "attack", "queuedAttack",
  "attackTarget", "queuedAttackTarget", "queuedRepair", "board", "unload",
  "boardingBlocked", "itemReceived", "goldBounty",
]);

/** Order receipts are private. A repair pulse tied to a real worker instead
 * describes visible work and must remain available to unit animation. */
export function isCommandFeedback(effect: Pick<WorldEffect, "type" | "unitId">): boolean {
  return privateFeedback.has(effect.type) || effect.type === "repair" && !effect.unitId;
}

/** Presentation only: do not remove effects from the shared simulation.
 * Unknown owners and a spectator without an issuing player fail closed for
 * private receipts; public combat keeps its existing visibility rules. */
export function shouldRenderCommandFeedback(effect: Pick<WorldEffect, "type" | "unitId" | "owner">, viewer?: PlayerId): boolean {
  return !isCommandFeedback(effect) || !!viewer && viewer !== "neutral" && effect.owner === viewer;
}
