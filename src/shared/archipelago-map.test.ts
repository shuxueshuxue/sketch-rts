import { describe, expect, it } from "vitest";
import { createGame } from "./sim";
import { sameGround, walkableGoal, isFootprintBuildable } from "./terrain";
import { BUILDING_DEFS } from "./catalog";

describe("island starts terrain", () => {
  it.each([[2, 5120], [4, 7168]])("isolates %i players and connects their coasts through one sea at size %i", (count, size) => {
    const players = Array.from({ length: count }, (_, index) => `p${index}`);
    const game = createGame("ladder", { players, layout: { idea: "islandStarts", seed: `holdout-${size}`, size } });
    const halls = game.buildings.filter(building => building.kind === "townHall");
    const coasts = halls.map(hall => walkableGoal(game.map, hall.x, hall.y, "sea"));
    expect(game.map.width).toBe(size);
    expect(halls).toHaveLength(count);
    for (const hall of halls) {
      expect(isFootprintBuildable(game.map, hall.x, hall.y, BUILDING_DEFS.townHall.radius)).toBe(true);
      const mine = game.resources.find(resource => resource.id === `gold-${hall.owner}-main`)!;
      expect(sameGround(game.map, hall, mine)).toBe(true);
      expect(game.units.filter(unit => unit.owner === hall.owner && unit.kind === "worker")).toHaveLength(3);
      for (const rival of halls.filter(rival => rival.owner !== hall.owner)) expect(sameGround(game.map, hall, rival)).toBe(false);
    }
    for (const coast of coasts) expect(sameGround(game.map, coast, coasts[0]!, "sea")).toBe(true);
  });
});
