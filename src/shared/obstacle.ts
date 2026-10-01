import type { Obstacle, ObstacleKind } from "./types";

// What breaking an obstacle (see @@@obstacle) costs: rocks take a town hall's beating, about ten seconds of six footmen, a
// gate most of half again. Each is as wide as the way it shuts: with the routing's margin round its body (see
// @@@building-pathing) it shuts a way about 144 wide (rocks) or 160 (a gate), a ford's two cells of shallows round its way
// counted in; the generator lays the ways it stands on that narrow (see @@@generated-obstacles).
export const OBSTACLE_DEFS: Record<ObstacleKind, { hp: number; radius: number }> = {
  rocks: { hp: 900, radius: 56 },
  gate: { hp: 1500, radius: 64 },
};

export function createObstacle(id: string, kind: ObstacleKind, x: number, y: number, along: { x: number; y: number }): Obstacle {
  const { hp, radius } = OBSTACLE_DEFS[kind];
  return { id, kind, owner: "neutral", x, y, radius, hp, maxHp: hp, along };
}
