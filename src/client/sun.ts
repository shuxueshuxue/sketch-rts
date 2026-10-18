import { SHIP_CAMERA } from "../shared/ship-geometry";

// @@@sun - The world's one light (docs/art/render-contract.zh.md, rule 4): from the west, a little to the viewer's side,
// high, so a building's front is lit and its east side dark, as every painted asset is lit. SUN is where the sun stands
// from the point it lights (world x, height, world y); the 3D world puts its light there, and a Canvas world casts its
// shadows the same way (see standingShadow).
export const SUN = { x: -450, height: 650, y: 250 } as const;

const TILT = Math.tan(SHIP_CAMERA.tilt);

/** Where on the ground the shadow of a point `height` above its foot falls, from that foot. */
export function shadowOffset(height: number) {
  return { x: -SUN.x / SUN.height * height, y: -SUN.y / SUN.height * height };
}

/** Draws a standing thing's shadow on a Canvas world: `paint` draws the thing with its foot at the origin (screen units,
 * up is negative y); its picture is laid on the ground away from the sun, each pixel as far as its height casts it (a
 * pixel `v` above the foot stands v / tan(tilt) high, as on a card), in the shadow's ink. */
export function standingShadow(b: CanvasRenderingContext2D, foot: { x: number; y: number }, paint: (b: CanvasRenderingContext2D) => void) {
  const along = shadowOffset(1);
  b.save();
  b.transform(1, 0, -along.x / TILT, -along.y / TILT, foot.x, foot.y);
  b.filter = "brightness(0)";
  b.globalAlpha *= .24;
  paint(b);
  b.restore();
}
