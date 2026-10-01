import { describe, expect, it } from "vitest";
import { generateMap } from "./generated-map";
import { createGame } from "./sim";
import { BUILDING_DEFS } from "./catalog";
import { isFootprintBuildable, isShoreFootprint, isWalkable, walkableGoal, walkingDistance } from "./terrain";

const PLAYERS = ["v9", "p1", "p2", "p3"];
const TEAMS = { v9: "v9-side", p1: "rivals", p2: "rivals", p3: "rivals" };
const PAIRS = { a1: "north", a2: "north", b1: "south", b2: "south" };
const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

function layout(seed: string, kind?: "ring" | "sides", players = PLAYERS, teams: Record<string, string> = TEAMS) {
  const map = generateMap({ seed, ...(kind ? { kind } : {}) }, players, teams);
  const halls = players.map((player) => ({ player, x: map.starts[player]!.baseX, y: map.starts[player]!.baseY }));
  const expansions = map.resources.filter((mine) => !mine.id.endsWith("-main"));
  const ground = { terrain: map.terrain, width: map.size, height: map.size };
  return { map, halls, expansions, ground };
}

describe("generated maps", () => {
  it("gives four players a main mine and a natural each and more mines to contest, the same from every start of a ring", () => {
    for (let index = 0; index < 12; index += 1) {
      const { map, halls, expansions } = layout(`ring-${index}`, "ring");
      expect(expansions.length).toBeGreaterThanOrEqual(8);
      for (const hall of halls) {
        const main = map.resources.find((mine) => mine.id === `gold-${hall.player}-main`)!;
        expect(gap(main, hall)).toBeLessThan(300);
        for (const mine of expansions) expect(gap(mine, hall)).toBeGreaterThan(500);
      }
      // Every start sees the same map: its nearest expansions lie at the same distances.
      const nearest = halls.map((hall) => expansions.map((mine) => gap(mine, hall)).sort((a, b) => a - b).slice(0, 3));
      for (const distances of nearest) distances.forEach((distance, rank) => expect(Math.abs(distance - nearest[0]![rank]!)).toBeLessThan(4));
    }
  });

  it("carves a ladder map: every start walks to every other start and every mine, camp and post, over ground it can stand on", () => {
    for (let index = 0; index < 12; index += 1) {
      const { map, halls, ground } = layout(`walk-${index}`);
      const open = [...map.terrain.cells].filter((cell) => cell === ".").length / map.terrain.cells.length;
      expect(open).toBeGreaterThan(0.15);
      expect(open).toBeLessThan(0.6);
      const things = [...map.resources, ...map.mercenaryCamps, ...map.units, ...map.buildings];
      for (const thing of things) expect(isWalkable(ground, thing.x, thing.y)).toBe(true);
      for (const hall of halls) for (const thing of [...halls, ...map.resources, ...map.mercenaryCamps]) expect(walkingDistance(ground, hall, thing)).toBeDefined();
      // A start's own natural is a short walk down its ramp, nearer it than to any other start.
      for (const hall of halls) {
        const natural = map.resources.filter((mine) => !mine.id.endsWith("-main")).sort((a, b) => walkingDistance(ground, hall, a)! - walkingDistance(ground, hall, b)!)[0]!;
        for (const other of halls) if (other !== hall) expect(walkingDistance(ground, other, natural)!).toBeGreaterThan(walkingDistance(ground, hall, natural)!);
      }
    }
  });

  it("puts every main on a plateau walled by its cliff but for one ramp, with room to build", () => {
    for (let index = 0; index < 8; index += 1) {
      const { map, halls, ground } = layout(`plateau-${index}`);
      const { cols, cell, levels } = map.terrain;
      for (const hall of halls) {
        const at = Math.floor(hall.y / cell) * cols + Math.floor(hall.x / cell);
        expect(levels![at]).toBe("1");
        let room = 0;
        for (let dy = -400; dy <= 400; dy += 50) for (let dx = -400; dx <= 400; dx += 50) if (isFootprintBuildable(ground, hall.x + dx, hall.y + dy, 40)) room += 1;
        expect(room).toBeGreaterThan(90);
      }
      // Plateau ground meets low ground only across a ramp.
      for (let index = 0; index < map.terrain.cells.length; index += 1) {
        if (map.terrain.cells[index] !== "." || levels![index] !== "1") continue;
        for (const next of [index + 1, index - 1, index + cols, index - cols]) if (map.terrain.cells[next] === ".") expect(levels![next]).not.toBe("0");
      }
    }
  });

  it("is exactly the same ground seen from every start of four", () => {
    for (let index = 0; index < 6; index += 1) {
      const { map } = layout(`turn-${index}`);
      const { cols, cells } = map.terrain;
      for (let row = 0; row < cols; row += 1) for (let col = 0; col < cols; col += 1) expect(cells[col * cols + (cols - 1 - row)]).toBe(cells[row * cols + col]);
    }
  });

  it("gives every player of two facing teams a natural of its own, nearer to it than to any other start", () => {
    const players = Object.keys(PAIRS);
    for (let index = 0; index < 10; index += 1) {
      const { halls, expansions } = layout(`sides-${index}`, "sides", players, PAIRS);
      expect(expansions.length).toBeGreaterThanOrEqual(6);
      for (const hall of halls) {
        const natural = [...expansions].sort((a, b) => gap(a, hall) - gap(b, hall))[0]!;
        expect(gap(natural, hall)).toBeLessThan(1_100);
        for (const other of halls) if (other !== hall) expect(gap(natural, other)).toBeGreaterThan(gap(natural, hall));
      }
    }
    expect(() => generateMap({ seed: "uneven", kind: "sides" }, PLAYERS, TEAMS)).toThrow(/same size/);
  });

  it("keeps creeps out of every start's opening economy and everything on the map", () => {
    for (let index = 0; index < 12; index += 1) {
      const { map } = layout(`safe-${index}`);
      const spots = Object.values(map.starts).flatMap((start) => [{ x: start.baseX, y: start.baseY }, { x: start.mineX, y: start.mineY }]);
      const neutrals = map.units.filter((unit) => unit.owner === "neutral");
      expect(neutrals.length).toBeGreaterThan(0);
      for (const creep of neutrals) for (const spot of spots) expect(gap(creep, spot)).toBeGreaterThan(440);
      for (const thing of [...map.units, ...map.buildings, ...map.resources, ...map.mercenaryCamps]) {
        expect(thing.x).toBeGreaterThanOrEqual(0);
        expect(thing.y).toBeGreaterThanOrEqual(0);
        expect(thing.x).toBeLessThanOrEqual(map.size);
        expect(thing.y).toBeLessThanOrEqual(map.size);
      }
      for (const item of map.items) expect(map.units.some((unit) => unit.id === item.carrierId)).toBe(true);
    }
  });

  it("is the same map for the same seed and a different one for another, of both kinds for even teams", () => {
    expect(layout("same")).toEqual(layout("same"));
    expect(layout("one").map.terrain.cells).not.toEqual(layout("two").map.terrain.cells);
    const kinds = new Set(Array.from({ length: 30 }, (_, index) => layout(`kind-${index}`, undefined, Object.keys(PAIRS), PAIRS).map.kind));
    expect(kinds).toEqual(new Set(["ring", "sides"]));
    expect(new Set(Array.from({ length: 10 }, (_, index) => layout(`kind-${index}`).map.kind))).toEqual(new Set(["ring"]));
  });

  it("draws a map for any number of players from two to eight", () => {
    for (let count = 2; count <= 8; count += 1) {
      const players = Array.from({ length: count }, (_, index) => `p${index}`);
      const teams = Object.fromEntries(players.map((player) => [player, player]));
      const { map, halls, ground } = layout(`count-${count}`, "ring", players, teams);
      expect(Object.keys(map.starts)).toHaveLength(count);
      for (const hall of halls) expect(walkingDistance(ground, halls[0]!, hall)).toBeDefined();
    }
  });

  it("builds a game on the layout when the setup asks for one, and the map id's own otherwise", () => {
    const setup = { players: PLAYERS, teams: TEAMS, races: { v9: "grove", p1: "ember", p2: "grove", p3: "ember" } } as const;
    const plain = createGame("verdantCrossroads", setup);
    const generated = createGame("verdantCrossroads", { ...setup, layout: { seed: "game" } });
    const map = generateMap({ seed: "game" }, PLAYERS, TEAMS);
    expect(generated.resources).toEqual(map.resources);
    expect(generated.buildings.map((building) => [building.id, building.x, building.y])).toEqual(map.buildings.map((building) => [building.id, building.x, building.y]));
    expect(generated.map.landmarks).toEqual(map.landmarks);
    expect(generated.map.terrain).toEqual(map.terrain);
    expect(plain.resources).not.toEqual(map.resources);
    expect(plain.map.terrain).toBeUndefined();
  });

  it("always plays the ladder map on a generated layout: the setup's, or the one the seed \"ladder\" draws", () => {
    const setup = { players: PLAYERS, teams: TEAMS, races: { v9: "grove", p1: "ember", p2: "grove", p3: "ember" } } as const;
    const unseeded = createGame("ladder", setup);
    const seeded = createGame("ladder", { ...setup, layout: { seed: "game" } });
    const ladderMap = generateMap({ seed: "ladder" }, PLAYERS, TEAMS);
    const gameMap = generateMap({ seed: "game" }, PLAYERS, TEAMS);
    expect(unseeded.map).toMatchObject({ id: "ladder", name: "Ladder Map", width: ladderMap.size, height: ladderMap.size });
    expect(unseeded.resources).toEqual(ladderMap.resources);
    expect(unseeded.map.terrain).toEqual(ladderMap.terrain);
    expect(seeded.map.id).toBe("ladder");
    expect(seeded.resources).toEqual(gameMap.resources);
    expect(seeded.map.terrain).toEqual(gameMap.terrain);
  });

  it("fills a sea map's middle with one sea: an island mine only a ship reaches, and a beach for every start's shipyard", () => {
    for (const players of [PLAYERS.slice(0, 2), PLAYERS]) {
      for (let index = 0; index < 4; index += 1) {
        const map = generateMap({ seed: `sea-${index}`, sea: true }, players, Object.fromEntries(players.map((player) => [player, player])));
        const ground = { terrain: map.terrain, width: map.size, height: map.size };
        const middle = { x: map.size / 2, y: map.size / 2 };
        const island = map.resources.find((mine) => gap(mine, middle) < 2)!;
        const halls = players.map((player) => ({ x: map.starts[player]!.baseX, y: map.starts[player]!.baseY }));
        const landing = walkableGoal(ground, island.x, island.y, "sea");
        // Every start's beach, on the way from it to the middle, takes a shipyard whose ships sail to the island.
        const harbors = halls.map((hall) => {
          for (let share = 0; share <= 1; share += 0.01) {
            for (const side of [0, 32, -32, 64, -64]) {
              const along = { x: hall.x + (middle.x - hall.x) * share, y: hall.y + (middle.y - hall.y) * share };
              const at = { x: along.x + ((middle.y - hall.y) / gap(hall, middle)) * side, y: along.y - ((middle.x - hall.x) / gap(hall, middle)) * side };
              if (!isShoreFootprint(ground, at.x, at.y, BUILDING_DEFS.shipyard.radius)) continue;
              const water = walkableGoal(ground, at.x, at.y, "sea");
              if (walkingDistance(ground, water, landing, "sea") !== undefined) return water;
            }
          }
          return undefined;
        });
        expect(harbors.every((harbor) => harbor !== undefined)).toBe(true);
        for (const hall of halls) {
          for (const other of halls) expect(walkingDistance(ground, hall, other)).toBeDefined();
          expect(walkingDistance(ground, hall, island)).toBeUndefined();
        }
      }
    }
  });
});
