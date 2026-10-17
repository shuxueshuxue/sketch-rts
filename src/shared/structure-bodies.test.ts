import { describe, expect, it } from "vitest";
import { buildingPlacementBlocker } from "./build-placement";
import { MAP_POOL } from "./map-pool";
import { createRoom, roomToGameSetup } from "./rooms";
import { createGame, issueCommand, stepGame } from "./sim";
import { siteBodies } from "./structure-bodies";
import { footprintCells, footprintGap, isOpenGround } from "./terrain";

function poolGame(id: (typeof MAP_POOL)[number]["id"]) {
  const spec = MAP_POOL.find(map => map.id === id)!;
  const { options } = roomToGameSetup(createRoom({ id: `bodies-${id}`, host: { id: "host", name: "Host" }, mapId: id, humanCount: 1, aiCount: spec.players - 1 }));
  const game = createGame(id, { ...options, aiPlayers: [] });
  stepGame(game);
  return game;
}

// @@@structure-body - Mines, shops and mercenary camps are bodies as buildings are, on every pool map.
describe("neutral sites are bodies", () => {
  it.each(MAP_POOL.map(map => map.id))("on %s units walk round them, nothing is built on them, and none overlaps another", id => {
    const game = poolGame(id);
    const sites = siteBodies(game);
    const cell = game.map.terrain!.cell;
    // No two sites, and no site and building, share a cell.
    const all = [...sites, ...game.buildings];
    for (const [index, site] of sites.entries()) {
      const own = footprintCells(cell, site.x, site.y, site.radius);
      for (const other of all.slice(index + 1)) {
        const theirs = footprintCells(cell, other.x, other.y, other.radius);
        const meet = own.left <= theirs.right && theirs.left <= own.right && own.top <= theirs.bottom && theirs.top <= own.bottom;
        expect(meet, `${site.id} overlaps ${other.id}`).toBe(false);
      }
      // A farm laid on its center is refused for it.
      expect(buildingPlacementBlocker(game, "farm", site)?.id, `farm on ${site.id}`).toBe(site.id);
    }
    // No unit stands inside a site: a camp's creeps keep watch from outside its walls.
    for (const unit of game.units) for (const site of sites) expect(footprintGap(game.map, unit, site), `${unit.id} inside ${site.id}`).toBeGreaterThan(0);
    // A worker sent straight across a site walks round it: its center never enters the footprint.
    for (const site of sites.filter(site => site.kind !== "goldMine").concat(sites.filter(site => site.kind === "goldMine").slice(0, 2))) {
      const run = poolGame(id);
      const off = site.radius + 90;
      const ends = [[{ x: site.x - off, y: site.y }, { x: site.x + off, y: site.y }], [{ x: site.x, y: site.y - off }, { x: site.x, y: site.y + off }]]
        .find(([from, to]) => isOpenGround(run.map, from!.x, from!.y) && isOpenGround(run.map, to!.x, to!.y));
      if (!ends) continue;
      const worker = run.spawnUnit("player", "worker", ends[0]!.x, ends[0]!.y);
      issueCommand(run, { type: "move", unitIds: [worker.id], x: ends[1]!.x, y: ends[1]!.y });
      for (let tick = 0; tick < 160; tick++) {
        stepGame(run);
        expect(footprintGap(run.map, worker, site), `${worker.id} inside ${site.id} at tick ${run.tick}`).toBeGreaterThan(0);
      }
    }
  });
});

// A building laid against a mine's face toward the hall leaves the miners another face (see mineEntrance).
describe("a mine walled on one side", () => {
  it("is still mined from an open face when a tower stands against the face toward the hall", () => {
    const game = poolGame("reedwater");
    const hall = game.buildings.find(building => building.owner === "player" && building.kind === "townHall")!;
    const mine = game.resources.reduce((best, resource) => Math.hypot(resource.x - hall.x, resource.y - hall.y) < Math.hypot(best.x - hall.x, best.y - hall.y) ? resource : best);
    mine.amount = 100000;
    const cell = game.map.terrain!.cell;
    const toward = { x: Math.sign(hall.x - mine.x) * (cell * 2), y: Math.sign(hall.y - mine.y) * (cell * 2) };
    const template = game.buildings.find(building => building.kind === "townHall")!;
    game.buildings.push({ ...template, id: "wall-tower", owner: "player", kind: "defenseTower", x: mine.x + toward.x, y: mine.y + toward.y, radius: 30, hp: 200, maxHp: 200, queue: [], researchQueue: [], complete: true });
    game.units = game.units.filter(unit => unit.owner !== "player");
    const workers = Array.from({ length: 3 }, () => game.spawnUnit("player", "worker", hall.x + 60, hall.y));
    issueCommand(game, { type: "mine", unitIds: workers.map(worker => worker.id), resourceId: mine.id });
    const gold = game.players.player!.gold;
    for (let tick = 0; tick < 1200; tick++) stepGame(game);
    expect(game.players.player!.gold).toBeGreaterThan(gold);
  });
});
