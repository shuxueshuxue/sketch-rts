import type { Game } from "../shared/sim";
import { createForestHorde } from "./menu-forest-horde";
import { createPirateBoarding } from "./menu-pirate-boarding";
import type { MenuBattleId } from "./menu-scene-world";

// @@@menu-battles - A home battle is fought by the match simulation, not drawn from a script: the scene authors only
// the field, the two casts and their opening orders, and the simulation walks, targets, hits and kills from there.
// It runs on a match thread (see @@@match-thread) built from the same opening as the page's copy, so a heavy tick
// never holds the home screen's frame; the page keeps its copy for the ground and the first picture.
export const MENU_BATTLES: Record<MenuBattleId, (seed: number) => Game> = {
  woods: (seed) => createForestHorde(seed).game,
  fleet: (seed) => createPirateBoarding(seed).game,
};
