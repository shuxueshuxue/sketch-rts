import { expect, it } from "vitest";
import { createGame } from "./sim";
import { poolMap } from "./map-pool";
import { isWalkable, nearestByWalk, walkingDistance } from "./terrain";

// @@@nearest-field answers what a walk from each candidate to the goal answers: the nearest, the lower index among
// equals, nothing when none reaches it.
it("picks the candidate each candidate's own walk to the goal picks, on a pool map", () => {
  const game = createGame("elderwood", { players: ["player", "enemy", "enemy2", "enemy3"], layout: { ...poolMap("elderwood")!.layout, seed: "pool-elderwood-1" } } as never);
  const map = game.map;
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const point = () => ({ x: Math.floor(random() * map.width), y: Math.floor(random() * map.height) });
  let compared = 0, ties = 0;
  for (let round = 0; round < 60; round += 1) {
    const candidates = Array.from({ length: 1 + Math.floor(random() * 6) }, point);
    // A repeated candidate and a mirrored pair make ties the lower index must win.
    candidates.push(candidates[0]!, { x: map.width - candidates[0]!.x, y: map.height - candidates[0]!.y });
    for (let goalIndex = 0; goalIndex < 8; goalIndex += 1) {
      const goal = point();
      let expected: number | undefined, shortest = Infinity;
      candidates.forEach((candidate, index) => {
        const walk = walkingDistance(map, candidate, goal);
        if (walk !== undefined && walk < shortest) { expected = index; shortest = walk; }
        else if (walk !== undefined && walk === shortest) ties += 1;
      });
      expect(nearestByWalk(map, candidates, goal), JSON.stringify({ candidates, goal })).toBe(expected);
      if (isWalkable(map, goal.x, goal.y)) compared += 1;
    }
  }
  expect(compared).toBeGreaterThan(100);
  expect(ties).toBeGreaterThan(0);
});
