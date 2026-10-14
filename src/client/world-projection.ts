import { SHIP_CAMERA } from '../shared/ship-geometry';

export type WorldView = { x: number; y: number; width: number; height: number; zoom?: number };
const TILT = SHIP_CAMERA.tilt;

/** Shared screen geometry; using it does not load the WebGL renderer. */
export function projectWorld(view: WorldView, point: { x: number; y: number }, height = 0) {
  const z = view.zoom ?? 1;
  return { x: (point.x - view.x) * z, y: (point.y - view.y - height * Math.tan(TILT)) * z };
}
