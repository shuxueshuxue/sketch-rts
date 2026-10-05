import type { SceneBuilder } from "../sdk/scene";
import type { Owner, UnitKind, UnitOrder } from "../shared/types";

export type BlockOptions = {
  /** Where the front rank stands; the block is centred on `y`. */
  x: number;
  y: number;
  /** The side the block faces; later ranks stand behind the front one. */
  facing: "east" | "west";
  ranks?: number;
  spacingX?: number;
  spacingY?: number;
  order?: UnitOrder;
};

/** Adds `count` units as a block of `ranks` ranks, spread evenly along y. */
export function block(scene: SceneBuilder, owner: Owner, kind: UnitKind, count: number, options: BlockOptions) {
  const ranks = options.ranks ?? 1;
  const perRank = Math.ceil(count / ranks);
  const behind = (options.spacingX ?? 40) * (options.facing === "east" ? -1 : 1);
  const spacingY = options.spacingY ?? 42;
  for (let index = 0; index < count; index += 1) {
    const rank = Math.floor(index / perRank);
    const file = index % perRank;
    const filesInRank = Math.min(perRank, count - rank * perRank);
    scene.unit(owner, kind, options.x + rank * behind, options.y + (file - (filesInRank - 1) / 2) * spacingY, options.order ? { order: options.order } : {});
  }
  return scene;
}
