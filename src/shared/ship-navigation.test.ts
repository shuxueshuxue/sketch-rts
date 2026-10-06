import { describe, expect, it } from "vitest";
import { boardUnit } from "./decks";
import { createUnit } from "./map";
import { landingSpot } from "./naval";
import { shove, slide } from "./push";
import { hullFits, hullPassageClear, hullStep, nearestShipPose, shipRoute, planShipRoute } from "./ship-navigation";
import { distanceToHull, hullContact, shipPassengers, shipProfile } from "./ship-geometry";
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame, stepGame } from "./sim";
import { checksumGame } from "./sim/checksum";
import { setBuildingBodies } from "./terrain";
import { seconds } from "./time";
import type { GameMap, Unit } from "./types";

const at = (col: number, row: number) => ({ x: (col + .5) * 32, y: (row + .5) * 32 });
function map(cell: (col: number, row: number) => string): GameMap {
  const base = createGame("bareDuel").map;
  let cells = "";
  for (let row = 0; row < 24; row++) for (let col = 0; col < 30; col++) cells += cell(col, row);
  return { ...base, width: 960, height: 768, terrain: { cols: 30, rows: 24, cell: 32, cells } };
}
const channel = () => map((x, y) => ((x >= 3 && x <= 10 || x >= 19 && x <= 27) && y >= 4 && y <= 20) || (x >= 11 && x <= 18 && y >= 11 && y <= 13) ? "~" : ".");
const island = () => map((x, y) => x === 0 || y === 0 || x === 29 || y === 23 || (x >= 12 && x <= 15 && y >= 5 && y <= 13) ? "." : "~");
function game(water: GameMap) {
  const g = createGame("bareDuel");
  g.units = []; g.buildings = []; g.resources = []; g.map = water; g.scriptedVictory = true;
  return g;
}
const ship = (kind: "transport" | "carrier", col: number, row: number) => createUnit("ship", "player", kind, at(col, row).x, at(col, row).y);
const pose = (unit: Unit, heading = unit.sailing?.heading ?? 0) => ({ x: unit.x, y: unit.y, heading });

describe("full hull water navigation", () => {
  it('continues a budgeted route past its intermediate endpoint and preserves it through a save',()=>{
    const g=game(island()),boat=g.spawnUnit('player','transport',at(6,10).x,at(6,10).y),goal=at(22,10);
    issuePlayerCommand(g,'player',{type:'move',unitIds:[boat.id],...goal,avoidCombat:true});
    const first=planShipRoute(g.map,boat,goal,()=>true,1);expect(first.partial).toBe(true);
    boat.sailing!.route={goalX:goal.x,goalY:goal.y,...first,end:first.points.at(-1)!,trafficKey:'',startX:boat.x,startY:boat.y,startHeading:boat.sailing!.heading};
    const restored=game(island());restoreSnapshotIntoGame(restored,snapshotGame(g),g.nextId);
    for(let tick=0;tick<seconds(80);tick++){stepGame(g);stepGame(restored);}
    expect(Math.hypot(boat.x-goal.x,boat.y-goal.y)).toBeLessThan(5);
    expect(boat.order.type).toBe('idle');expect(checksumGame(g)).toBe(checksumGame(restored));
  });
  it("detects an obstructing cell crossed by an edge even when no hull vertex is in it", () => {
    const water = map((x, y) => x === 12 && y === 9 ? "." : "~");
    const boat = ship("transport", 12, 10);
    expect(hullFits(water, boat)).toBe(false);
    expect(hullFits(map(() => "~"), boat)).toBe(true);
  });
  it("sweeps translation instead of tunneling between valid endpoints", () => {
    const water = map((x, y) => x === 14 && y === 10 ? "." : "~");
    const boat = ship("transport", 9, 10), goal = { ...at(20, 10), heading: 0 };
    expect(hullFits(water, boat)).toBe(true);
    expect(hullFits(water, boat, goal)).toBe(true);
    expect(hullPassageClear(water, boat, pose(boat), goal)).toBe(false);
    const stopped = hullStep(water, boat, goal);
    expect(stopped.x).toBeLessThan(14 * 32);
    expect(hullFits(water, boat, { ...stopped, heading: 0 })).toBe(true);
  });
  it("allows an aligned narrow ship through a channel but rejects its turn and a wider carrier", () => {
    const water = channel(), boat = ship("transport", 14, 12), carrier = ship("carrier", 14, 12);
    expect(hullFits(water, boat)).toBe(true);
    expect(hullFits(water, boat, pose(boat, Math.PI))).toBe(true);
    expect(hullPassageClear(water, boat, pose(boat), pose(boat, Math.PI))).toBe(false);
    expect(hullFits(water, carrier)).toBe(false);
    for (const kind of ["transport", "carrier"] as const) {
      const g = game(water), vessel = g.spawnUnit("player", kind, at(6, 12).x, at(6, 12).y);
      issuePlayerCommand(g, "player", { type: "move", unitIds: [vessel.id], ...at(23, 12) });
      for (let i = 0; i < seconds(40); i++) { stepGame(g); expect(hullFits(g.map, vessel)).toBe(true); }
      expect(vessel.order.type).toBe("idle");
      if (kind === "transport") expect(Math.hypot(vessel.x - at(23, 12).x, vessel.y - at(23, 12).y)).toBeLessThan(1);
      else expect(vessel.x).toBeLessThan(11 * 32);
    }
  });
  it("follows a continuous island detour and resumes the same active route after a snapshot", () => {
    const g = game(island()), vessel = g.spawnUnit("player", "transport", at(5, 10).x, at(5, 10).y);
    issuePlayerCommand(g, "player", { type: "move", unitIds: [vessel.id], ...at(24, 10) });
    for (let i = 0; i < seconds(1); i++) stepGame(g);
    const saved = snapshotGame(g), route = saved.units[0]!.sailing!.route!;
    expect(route.points.length).toBeGreaterThan(2);
    expect(route.points).not.toBe(vessel.sailing!.route!.points);
    expect(route.end).not.toBe(vessel.sailing!.route!.end);
    const resumed = game(island()); restoreSnapshotIntoGame(resumed, saved, g.nextId);
    for (let i = 0; i < seconds(35); i++) {
      const from = pose(vessel);
      stepGame(g); stepGame(resumed);
      expect(hullFits(g.map, vessel)).toBe(true);
      expect(hullPassageClear(g.map, vessel, from, pose(vessel))).toBe(true);
      expect(checksumGame(resumed)).toBe(checksumGame(g));
    }
    expect(vessel.order.type).toBe("idle");
    expect(Math.hypot(vessel.x - at(24, 10).x, vessel.y - at(24, 10).y)).toBeLessThan(1);
  });
  it("stops a shove at the coast without moving any of the hull onto land", () => {
    const water = map((x) => x < 8 ? "." : "~"), boat = ship("transport", 11, 10);
    shove(boat, -1, 0, 300);
    for (let i = 0; i < seconds(2); i++) { slide(boat, water); expect(hullFits(water, boat)).toBe(true); }
    expect(boat.x).toBeGreaterThanOrEqual(8 * 32 + 80 - .01);
  });
  it("can maneuver away from a parallel berth before turning seaward", () => {
    const g = game(map(x => x < 10 ? "." : "~")), vessel = g.spawnUnit("player", "transport", at(11, 10).x, at(11, 10).y);
    vessel.x = 10 * 32 + shipProfile(vessel)!.beam/2+2; vessel.sailing!.heading = Math.PI / 2;
    expect(hullFits(g.map, vessel)).toBe(true);
    issuePlayerCommand(g, "player", { type: "move", unitIds: [vessel.id], ...at(20, 10) });
    for (let i = 0; i < seconds(30); i++) { stepGame(g); expect(hullFits(g.map, vessel)).toBe(true); }
    expect(vessel.order.type).toBe("idle");
    expect(Math.hypot(vessel.x - at(20, 10).x, vessel.y - at(20, 10).y)).toBeLessThan(1);
  });
  it("places a new hull in connected water without jumping into a disconnected pond", () => {
    const water = map((x) => x < 10 || x > 12 ? "~" : "."), boat = ship("transport", 6, 10);
    const destination = nearestShipPose(water, boat, at(22, 10))!;
    expect(destination.x).toBeLessThan(10 * 32);
    expect(hullFits(water, boat, destination)).toBe(true);
  });
  it("invalidates the geometry cache when a channel's terrain changes", () => {
    const water = channel(), boat = ship("transport", 6, 12), goal = at(23, 12);
    expect(shipRoute(water, boat, goal).at(-1)).toMatchObject(goal);
    water.terrain!.cells = water.terrain!.cells.split("").map((c, i) => i % 30 === 14 ? "." : c).join("");
    expect(shipRoute(water, boat, goal).at(-1)!.x).toBeLessThan(14 * 32);
  });
  it("keeps a finished ship queued when its pond has no space for the full hull", () => {
    const g = game(map((x, y) => x === 10 && y === 10 ? "~" : "."));
    // This can occur after a scripted terrain change while a paid job is already in progress.
    const yard = createGame("bareDuel", { scenario: { addBuildings: [{ id: "yard", owner: "player", kind: "shipyard", ...at(8, 10) }] } }).buildings.find(b => b.id === "yard")!;
    yard.queue = [{ unitKind: "transport", remaining: 1 }]; g.buildings = [yard];
    for (let i = 0; i < seconds(1); i++) stepGame(g);
    expect(g.units).toHaveLength(0); expect(yard.queue[0]!.remaining).toBe(0);
    g.map.terrain!.cells = "~".repeat(30 * 24);
    stepGame(g);
    expect(yard.queue).toHaveLength(0); expect(g.units).toHaveLength(1);
    expect(hullFits(g.map, g.units[0]!)).toBe(true);
  });
});

describe("physical disembarkation", () => {
  it("lands several crew in distinct clear positions rather than stacking them", () => {
    const g = game(map(x => x < 10 ? "." : "~")), vessel = g.spawnUnit("player", "transport", at(12, 10).x, at(12, 10).y);
    const crew = ["worker", "worker", "archer"].map(kind => g.spawnUnit("player", kind as "worker" | "archer", 0, 0));
    for (const unit of crew) expect(boardUnit(vessel, unit, g.units)).toBe(true);
    for (const unit of crew) issuePlayerCommand(g, "player", { type: "unloadPassenger", transportId: vessel.id, passengerId: unit.id });
    expect(shipPassengers(g.units, vessel)).toHaveLength(0);
    for (const unit of crew) expect(distanceToHull(vessel, unit)).toBeGreaterThan(unit.radius);
    for (let a = 0; a < crew.length; a++) for (let b = a + 1; b < crew.length; b++)
      expect(Math.hypot(crew[a]!.x - crew[b]!.x, crew[a]!.y - crew[b]!.y)).toBeGreaterThan(crew[a]!.radius + crew[b]!.radius);
  });
  it("rejects a blocked landing and keeps the crew aboard", () => {
    const water = map(x => x < 10 ? "." : "~"), vessel = ship("transport", 12, 10), passenger = createUnit("crew", "player", "worker", 0, 0);
    expect(boardUnit(vessel, passenger, [vessel, passenger])).toBe(true);
    expect(landingSpot(water, vessel, 0, 1, [vessel, passenger], passenger)).toBeDefined();
    setBuildingBodies(water, [{ x: 160, y: vessel.y, radius: 200 }]);
    expect(landingSpot(water, vessel, 0, 1, [vessel, passenger], passenger)).toBeUndefined();
    expect(passenger.deck?.shipId).toBe(vessel.id);
  });
});

describe("convex hull separation", () => {
  it("moves a contained smaller hull all the way out of the larger hull", () => {
    const a = ship("carrier", 14, 10), b = createUnit("small", "enemy", "cutter", a.x, a.y);
    const contact = hullContact(a, b)!;
    b.x += contact.x * (contact.overlap + .001); b.y += contact.y * (contact.overlap + .001);
    expect(hullContact(a, b)).toBeUndefined();
  });
});
