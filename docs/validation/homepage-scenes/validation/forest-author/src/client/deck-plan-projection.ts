import { shipProfile, type Point } from '../shared/ship-geometry';
import type { Unit } from '../shared/types';

export const DECK_PLAN_SIZE = { width: 200, height: 340 };

/** SVG, fittings, crew and pointer destinations use the same local frame. */
export function deckPlanProjection(ship: Unit) {
    const profile = shipProfile(ship)!;
    const { width, height } = DECK_PLAN_SIZE;
    const scale = Math.min(width * .74 / profile.beam, height * .74 / profile.length);
    const project = (point: Point) => ({ x: width / 2 + point.y * scale, y: height / 2 - point.x * scale });
    const unproject = (point: Point) => ({ x: (height / 2 - point.y) / scale, y: (point.x - width / 2) / scale });
    const percent = (point: Point) => { const at = project(point); return { x: at.x / width * 100, y: at.y / height * 100 }; };
    return { width, height, scale, project, unproject, percent };
}
