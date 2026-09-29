import { describe, expect, it } from "vitest";
import { generateMap } from "./generated-map";
import { createGame } from "./sim";

const PLAYERS = ["v9", "p1", "p2", "p3"];
const TEAMS = { v9: "v9-side", p1: "rivals", p2: "rivals", p3: "rivals" };
const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

function layout(seed: string, kind?: "ring" | "sides") {
  const map = generateMap({ seed, ...(kind ? { kind } : {}) }, PLAYERS, TEAMS);
  const halls = PLAYERS.map((player) => ({ player, x: map.starts[player]!.baseX, y: map.starts[player]!.baseY }));
  const expansions = map.resources.filter((mine) => !mine.id.endsWith("-main"));
  return { map, halls, expansions };
}

describe("generated maps", () => {
  it("gives four players a main mine and a natural each and more mines to contest, the same from every start of a ring", () => {
    for (let index = 0; index < 20; index += 1) {
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

  it("gives every player of two facing teams a natural of its own, nearer to it than to any other start", () => {
    for (let index = 0; index < 20; index += 1) {
      const { halls, expansions } = layout(`sides-${index}`, "sides");
      expect(expansions.length).toBeGreaterThanOrEqual(8);
      for (const hall of halls) {
        const natural = [...expansions].sort((a, b) => gap(a, hall) - gap(b, hall))[0]!;
        expect(gap(natural, hall)).toBeLessThan(1_000);
        for (const other of halls) if (other !== hall) expect(gap(natural, other)).toBeGreaterThan(gap(natural, hall));
      }
    }
  });

  it("keeps creeps out of every start's opening economy and everything on the map", () => {
    for (const kind of ["ring", "sides"] as const) {
      for (let index = 0; index < 20; index += 1) {
        const { map } = layout(`safe-${kind}-${index}`, kind);
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
    }
  });

  it("is the same map for the same seed and a different one for another, of both kinds over many seeds", () => {
    expect(layout("same")).toEqual(layout("same"));
    expect(layout("one").map.resources).not.toEqual(layout("two").map.resources);
    const kinds = new Set(Array.from({ length: 30 }, (_, index) => layout(`kind-${index}`).map.kind));
    expect(kinds).toEqual(new Set(["ring", "sides"]));
  });

  it("builds a game on the layout when the setup asks for one, and the map id's own otherwise", () => {
    const setup = { players: PLAYERS, teams: TEAMS, races: { v9: "grove", p1: "ember", p2: "grove", p3: "ember" } } as const;
    const plain = createGame("emberFen", setup);
    const generated = createGame("emberFen", { ...setup, layout: { seed: "game" } });
    const map = generateMap({ seed: "game" }, PLAYERS, TEAMS);
    expect(generated.resources).toEqual(map.resources);
    expect(generated.buildings.map((building) => [building.id, building.x, building.y])).toEqual(map.buildings.map((building) => [building.id, building.x, building.y]));
    expect(generated.map.landmarks).toEqual(map.landmarks);
    expect(plain.resources).not.toEqual(map.resources);
  });
});
