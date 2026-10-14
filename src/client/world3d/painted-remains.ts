import type { Corpse, GameSnapshot } from '../../shared/types';
import { drawAtlasCorpse } from '../atlas-art';
import { corpseAppearanceKey } from '../art/corpses';
import { corpseAppearanceFor } from '../art/unit-appearance';
import { remainsVariant } from '../deck-remains';
import { ownerInk, type WorldFrame } from '../world-renderer';

/** An explicit, finite home-scene asset list; never a future simulation state. */
export type PaintedRemainsPreparation = {
  corpses: readonly Corpse[];
  models?: NonNullable<WorldFrame['models']>;
};

/** Preparation and visible deck remains share the exact original key/painter.
 * Density and world support remain the responsibility of their callers. */
export function paintedRemainsRecipe(snapshot: Pick<GameSnapshot, 'players'>, corpse: Corpse, models?: WorldFrame['models']) {
  const model = corpse.variant ? models?.(corpse.variant) : undefined;
  const appearance = corpseAppearanceFor(snapshot, corpse), color = ownerInk(corpse.owner, snapshot);
  const variant = remainsVariant(corpse.id);
  const key = `corpse:${corpse.kind}:${corpse.variant ?? ''}:${color}:${corpseAppearanceKey(appearance)}:${variant}`;
  return { model, key, paint: (ctx: CanvasRenderingContext2D) => {
    // WorldLayer's fixed seven-pixel baseline is already in its world transform.
    drawAtlasCorpse(ctx, corpse.kind, { x: 0, y: -7 }, 1, variant, model, corpse.variant, color, appearance);
  } };
}
