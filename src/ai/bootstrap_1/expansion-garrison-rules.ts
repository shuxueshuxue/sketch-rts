/** The existing mining handoff perimeter, shared by native retention, goal
 * declarations, post candidates and observed formal garrison proofs. */
export const EXPANSION_GARRISON_COVERAGE_RADIUS = 650;

export function withinExpansionGarrisonCoverage(point: { x: number; y: number }, mine: { x: number; y: number }): boolean {
  return Math.hypot(point.x - mine.x, point.y - mine.y) <= EXPANSION_GARRISON_COVERAGE_RADIUS;
}
