import { Matrix4 } from 'three';
import { SHIP_CAMERA } from '../../shared/ship-geometry';
import { detCos, detSin } from '../../shared/det-math';
import type { DeckRemainsPose } from '../deck-remains';

const TILT = Math.tan(SHIP_CAMERA.tilt);
/** The existing card crop uses upright paper coordinates (pixel Y / tilt).
 * Map those coordinates back onto the physical deck without changing any
 * living card's feet, crop, or camera-facing transform. drawAtlasCorpse's
 * seven-pixel baseline is a world offset, not part of glyph scale. */
export function deckRemainsMatrix(target: Matrix4, pose: DeckRemainsPose, scale: number): Matrix4 {
  const c = detCos(pose.heading), s = detSin(pose.heading);
  return target.set(
    c * scale, s * scale * TILT, 0, pose.x - s * 7,
    0, 0, 1, pose.height + .12,
    s * scale, -c * scale * TILT, 0, pose.y + c * 7,
    0, 0, 0, 1,
  );
}
