import { describe, expect, it } from "vitest";
import { CAMP_TEMPLATES, HABITAT_FAMILY } from "./camps";
import { generateMap } from "./generated-map";
import { createGame } from "./sim";
import { BUILDING_DEFS } from "./catalog";
import { MAP_IDEAS } from "./map-ids";
import { isFootprintBuildable, isShoreFootprint, isWalkable, setBuildingBodies, snapToFootprint, walkableGoal, walkDestination, walkingDistance } from "./terrain";
import type { MapIdea } from "./types";

const PLAYERS = ["v9", "p1", "p2", "p3"];
const TEAMS = { v9: "v9-side", p1: "rivals", p2: "rivals", p3: "rivals" };
const PAIRS = { a1: "north", a2: "north", b1: "south", b2: "south" };
const DUEL = { d1: "d1", d2: "d2" };
const gap = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
// The seats every idea takes in these tests: a duel, four on a ring, or two pairs.
const SEATS: Record<MapIdea, Record<string, string>> = {
  openRing: TEAMS,
  openSides: PAIRS,
  fountainRing: TEAMS,
  turtleIsle: TEAMS,
  twistedPaths: TEAMS,
  outerSea: TEAMS,
  oneMarket: DUEL,
  floodedValley: DUEL,
  hiddenHill: DUEL,
  bridgeStand: DUEL,
  deepJungle: DUEL,
  northIsles: DUEL,
  riverValley: PAIRS,
  twoShores: PAIRS,
};

function layout(seed: string, idea?: MapIdea, teams: Record<string, string> = idea ? SEATS[idea] : TEAMS, kind?: "ring" | "sides") {
  const players = Object.keys(teams);
  const map = generateMap({ seed, ...(idea ? { idea } : {}), ...(kind ? { kind } : {}) }, players, teams);
  const halls = players.map((player) => ({ player, x: map.starts[player]!.baseX, y: map.starts[player]!.baseY }));
  const expansions = map.resources.filter((mine) => !mine.id.endsWith("-main"));
  const ground = { terrain: map.terrain, width: map.size, height: map.size };
  return { map, halls, expansions, ground };
}

// The water a ship sails from the point (deep or shallow, four ways), and how much of it is deep.
function sea(map: ReturnType<typeof generateMap>, at: { x: number; y: number }) {
  const { cols, rows, cell, cells } = map.terrain;
  const start = Math.floor(at.y / cell) * cols + Math.floor(at.x / cell);
  const reached = new Set<number>();
  let deep = 0;
  const queue = [start];
  reached.add(start);
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head]!;
    if (cells[index] === "~") deep += 1;
    const col = index % cols;
    const row = (index - col) / cols;
    for (const [c, r] of [[col + 1, row], [col - 1, row], [col, row + 1], [col, row - 1]] as const) {
      const next = r * cols + c;
      if (c < 0 || r < 0 || c >= cols || r >= rows || reached.has(next) || (cells[next] !== "~" && cells[next] !== ",")) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return { reached, deep };
}

describe("generated maps", () => {
  it("draws every idea for its seats: every start walks to every other start and every mine but an island's, over ground it can stand on", () => {
    for (const idea of MAP_IDEAS) {
      for (let index = 0; index < 3; index += 1) {
        const { map, halls, ground } = layout(`walk-${index}`, idea);
        expect(map.idea).toBe(idea);
        const things = [...map.resources, ...map.mercenaryCamps, ...map.units, ...map.buildings, ...map.sites];
        for (const thing of things) expect(isWalkable(ground, thing.x, thing.y)).toBe(true);
        const walked = map.resources.filter((mine) => walkingDistance(ground, halls[0]!, mine) !== undefined);
        // Only an island's mine is out of a walk, and only where the idea has islands.
        expect(map.resources.length - walked.length).toBeLessThanOrEqual(4);
        for (const hall of halls) for (const thing of [...halls, ...walked, ...map.mercenaryCamps]) expect(walkingDistance(ground, hall, thing)).toBeDefined();
        // Most of the land is walked, but not all of it.
        const land = [...map.terrain.cells].filter((cell) => cell !== "~").length;
        const open = [...map.terrain.cells].filter((cell) => cell === "." || cell === "," || cell === "m" || cell === "=").length / land;
        expect(open).toBeGreaterThan(0.4);
        expect(open).toBeLessThan(0.8);
        // Every camp says what it is and where it stands.
        expect(map.camps.length).toBe(new Set(map.units.filter((unit) => unit.owner === "neutral").map((unit) => unit.id.split("-").slice(0, 3).join("-"))).size);
        for (const camp of map.camps) expect(["green", "orange", "red"]).toContain(camp.tier);
      }
    }
  });

  it("draws an idea from the seed among those that take the seats, and the open ring for seats no other idea takes", () => {
    const duels = new Set(Array.from({ length: 30 }, (_, index) => layout(`pick-${index}`, undefined, DUEL).map.idea));
    expect(duels).toEqual(new Set(["oneMarket", "floodedValley", "hiddenHill", "bridgeStand", "deepJungle", "northIsles"]));
    const rings = new Set(Array.from({ length: 30 }, (_, index) => layout(`pick-${index}`, undefined, TEAMS).map.idea));
    expect(rings).toEqual(new Set(["fountainRing", "turtleIsle", "twistedPaths", "outerSea"]));
    expect(layout("pick-3", undefined, { a: "a", b: "b", c: "c" }).map.idea).toBe("openRing");
    expect(() => generateMap({ seed: "x", idea: "oneMarket" }, PLAYERS, TEAMS)).toThrow(/oneMarket/);
  });

  it("gives four players a main mine and a natural each and more mines to contest, the same from every start of a ring", () => {
    for (const idea of ["fountainRing", "turtleIsle", "twistedPaths", "outerSea"] as const) {
      const { map, halls, expansions } = layout(`ring-${idea}`, idea);
      expect(expansions.length).toBeGreaterThanOrEqual(8);
      for (const hall of halls) {
        const main = map.resources.find((mine) => mine.id === `gold-${hall.player}-main`)!;
        expect(gap(main, hall)).toBeLessThan(300);
        for (const mine of expansions) expect(gap(mine, hall)).toBeGreaterThan(500);
      }
      // Every start sees the same map: its nearest expansions lie at the same distances.
      const nearest = halls.map((hall) => expansions.map((mine) => gap(mine, hall)).sort((a, b) => a - b).slice(0, 3));
      for (const distances of nearest) distances.forEach((distance, rank) => expect(Math.abs(distance - nearest[0]![rank]!)).toBeLessThan(4));
      // And exactly the same ground.
      const { cols, cells } = map.terrain;
      for (let row = 0; row < cols; row += 1) for (let col = 0; col < cols; col += 1) expect(cells[col * cols + (cols - 1 - row)]).toBe(cells[row * cols + col]);
    }
  });

  it("puts every main on a plateau walled by its cliff, and outside it by forest or rock, but for one ramp, with room to build", () => {
    for (const idea of ["openRing", "fountainRing", "hiddenHill", "riverValley"] as const) {
      const { map, halls, ground } = layout(`plateau-${idea}`, idea);
      const { cols, cell, levels, cells } = map.terrain;
      for (const hall of halls) {
        const at = Math.floor(hall.y / cell) * cols + Math.floor(hall.x / cell);
        expect(levels![at]).toBe("1");
        let room = 0;
        for (let dy = -400; dy <= 400; dy += 50) for (let dx = -400; dx <= 400; dx += 50) if (isFootprintBuildable(ground, hall.x + dx, hall.y + dy, 40)) room += 1;
        expect(room).toBeGreaterThan(90);
        // Round the main, just past its rim, the ground is open only toward its ramp: of 64 spokes, those whose cell 48
        // past the plateau's edge is open are under a quarter of the turn (the skirt is at least 90 deep all round).
        const open = Array.from({ length: 64 }, (_, spoke) => spoke).filter((spoke) => {
          const angle = (spoke / 64) * Math.PI * 2;
          const cellAt = (reach: number) => Math.floor((hall.y + Math.sin(angle) * reach) / cell) * cols + Math.floor((hall.x + Math.cos(angle) * reach) / cell);
          let reach = 0;
          while (levels![cellAt(reach)] !== "0" && reach < 2_000) reach += 16;
          const past = cellAt(reach + 48);
          return ".,m".includes(cells[past]!);
        });
        expect(open.length).toBeGreaterThan(0);
        expect(open.length).toBeLessThan(16);
      }
      // Plateau ground meets low ground only across a ramp.
      for (let index = 0; index < cells.length; index += 1) {
        if (cells[index] !== "." || levels![index] !== "1") continue;
        for (const next of [index + 1, index - 1, index + cols, index - cols]) if (cells[next] === ".") expect(levels![next]).not.toBe("0");
      }
    }
  });

  it("gives every player of two facing teams a natural of its own, nearer to it than to any other start", () => {
    for (const idea of ["openSides", "riverValley", "twoShores"] as const) {
      for (let index = 0; index < 3; index += 1) {
        const { halls, expansions } = layout(`sides-${index}`, idea);
        expect(expansions.length).toBeGreaterThanOrEqual(6);
        for (const hall of halls) {
          const natural = [...expansions].sort((a, b) => gap(a, hall) - gap(b, hall))[0]!;
          expect(gap(natural, hall)).toBeLessThan(1_100);
          for (const other of halls) if (other !== hall) expect(gap(natural, other)).toBeGreaterThan(gap(natural, hall));
        }
      }
    }
    expect(() => generateMap({ seed: "uneven", kind: "sides" }, PLAYERS, TEAMS)).toThrow(/same size/);
  });

  it("keeps creeps out of every start's opening economy and everything on the map", () => {
    for (const idea of MAP_IDEAS) {
      const { map } = layout(`safe-${idea}`, idea);
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
    expect(layout("one", "openRing").map.terrain.cells).not.toEqual(layout("two", "openRing").map.terrain.cells);
    const kinds = new Set(Array.from({ length: 30 }, (_, index) => layout(`kind-${index}`, undefined, PAIRS).map.kind));
    expect(kinds).toEqual(new Set(["ring", "sides"]));
  });

  it("draws a map for any number of players from two to eight", () => {
    for (let count = 2; count <= 8; count += 1) {
      const players = Array.from({ length: count }, (_, index) => `p${index}`);
      const teams = Object.fromEntries(players.map((player) => [player, player]));
      const { map, halls, ground } = layout(`count-${count}`, undefined, teams, "ring");
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
    // Laid on whole cells (see @@@building-footprint).
    const laid = map.buildings.map((building) => ({ id: building.id, ...snapToFootprint({ terrain: map.terrain }, building.radius, building) }));
    expect(generated.buildings.map((building) => [building.id, building.x, building.y])).toEqual(laid.map((building) => [building.id, building.x, building.y]));
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

  it("puts island mines only a ship reaches, and near every start a shore for a shipyard on open water that reaches them", () => {
    for (const idea of ["fountainRing", "twistedPaths", "outerSea", "northIsles", "twoShores"] as const) {
      for (let index = 0; index < 2; index += 1) {
        const { map, halls, ground } = layout(`isle-${index}`, idea);
        const islands = map.resources.filter((mine) => walkingDistance(ground, halls[0]!, mine) === undefined);
        expect(islands.length).toBeGreaterThan(0);
        const landings = islands.map((mine) => walkableGoal(ground, mine.x, mine.y, "sea"));
        for (const hall of halls) {
          const yards: { x: number; y: number }[] = [];
          for (let dy = -2_800; dy <= 2_800; dy += 48) for (let dx = -2_800; dx <= 2_800; dx += 48) if (dx * dx + dy * dy <= 2_800 ** 2 && isShoreFootprint(ground, hall.x + dx, hall.y + dy, BUILDING_DEFS.shipyard.radius)) yards.push({ x: hall.x + dx, y: hall.y + dy });
          const harbor = yards
            .sort((a, b) => gap(a, hall) - gap(b, hall))
            .slice(0, 8)
            .some((yard) => {
              const water = sea(map, walkableGoal(ground, yard.x, yard.y, "sea"));
              return water.deep >= 64 && landings.some((landing) => water.reached.has(Math.floor(landing.y / map.terrain.cell) * map.terrain.cols + Math.floor(landing.x / map.terrain.cell)));
            });
          expect(harbor).toBe(true);
        }
      }
    }
  });

  it("lays the ground an idea names: a flooded valley's shallows and mud, a river's bridges that walls a ship out, one shop on one market", () => {
    const flood = layout("ground-1", "floodedValley").map.terrain.cells;
    expect([...flood].filter((cell) => cell === ",").length).toBeGreaterThan(200);
    expect(flood).toContain("m");
    const bridge = layout("ground-1", "bridgeStand");
    const { cols, cell, cells } = bridge.map.terrain;
    const decks = [...cells].flatMap((char, index) => (char === "=" ? [index] : []));
    expect(decks.length).toBeGreaterThan(10);
    for (const deck of decks) {
      const at = { x: ((deck % cols) + 0.5) * cell, y: (Math.floor(deck / cols) + 0.5) * cell };
      expect(isWalkable(bridge.ground, at.x, at.y)).toBe(true);
      expect(isWalkable(bridge.ground, at.x, at.y, "sea")).toBe(false);
    }
    const market = layout("ground-1", "oneMarket").map;
    expect(market.sites).toEqual([{ kind: "shop", x: market.size / 2, y: market.size / 2 }]);
  });

  it("fills every camp with a template of its colour, mostly of its ground's family, and every copy of a camp alike", () => {
    let own = 0;
    let all = 0;
    for (const idea of MAP_IDEAS) {
      const { map } = layout("camps-1", idea);
      const signatures = map.camps.map((camp, index) => {
        const kinds = map.units.filter((unit) => unit.id.startsWith(`creep-gen-${index + 1}-`)).map((unit) => unit.kind).sort();
        const template = CAMP_TEMPLATES.find((candidate) => candidate.tier === camp.tier && [...candidate.kinds].sort().join() === kinds.join());
        expect(template, `${idea} camp ${index + 1}: ${kinds.join()}`).toBeDefined();
        all += 1;
        if (template!.family === HABITAT_FAMILY[camp.habitat] || template!.family === "dragon") own += 1;
        return `${camp.tier}:${kinds.join()}`;
      });
      // Four starts on a ring: a camp stands once (in the middle) or four times, every copy with the same creeps.
      if (SEATS[idea] === TEAMS) for (const signature of new Set(signatures)) expect([1, 4]).toContain(signatures.filter((other) => other === signature).length);
    }
    expect(own / all).toBeGreaterThan(0.7);
  });

  it("lays rocks and gates across shortcuts only: the hill's back ways, the middle ford, the jungle's ways in, with every start, mine and camp still reached round them", () => {
    const laid: [MapIdea, string[]][] = [
      ["hiddenHill", ["gate", "gate"]],
      ["bridgeStand", ["rocks"]],
      ["deepJungle", ["gate", "gate"]],
    ];
    for (const [idea, kinds] of laid) {
      for (let index = 0; index < 4; index += 1) {
        const { map, halls, ground } = layout(`obstacles-${index}`, idea);
        expect(map.idea).toBe(idea);
        expect(map.obstacles.map((obstacle) => obstacle.kind)).toEqual(kinds);
        for (const obstacle of map.obstacles) expect(isWalkable(ground, obstacle.x, obstacle.y)).toBe(true);
        const routed = { terrain: map.terrain };
        setBuildingBodies(routed, map.obstacles);
        const camps = map.units.filter((unit) => unit.owner === "neutral");
        for (const goal of [...halls, ...map.resources, ...camps]) {
          const at = walkableGoal(ground, goal.x, goal.y);
          expect(walkDestination(routed, halls[0]!, at)).toEqual(at);
        }
      }
    }
    for (const idea of ["openRing", "oneMarket", "floodedValley"] as const) expect(layout("obstacles-0", idea).map.obstacles).toEqual([]);
  });
});
