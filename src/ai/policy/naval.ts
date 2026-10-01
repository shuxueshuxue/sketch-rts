import { isBuildPlacementClear } from "../../shared/build-placement";
import { BUILDING_DEFS, UNIT_DEFS, unitMover } from "../../shared/catalog";
import { canReach } from "../../shared/naval";
import { groundWholes, isWalkable, sameGround, walkableGoal } from "../../shared/terrain";
import { seconds } from "../../shared/time";
import type { Building, GameCommand, GameSnapshot, PlayerId, ResourceNode, TrainableUnitKind, Unit } from "../../shared/types";
import { shipsAfloat } from "./ground";
import { isEnemyOwner } from "./ownership";
import { buildings, units } from "./snapshot";
import { distance } from "./spatial";
import type { AiPolicyContext } from "./types";
import { canSupply, playerState } from "./world-model";

type Point = { x: number; y: number };

// @@@ai-naval - What an AI does on the water, as a Warcraft III player takes an island expansion: once it holds two bases,
// on a map with a mine its workers cannot walk to (an island's, see @@@ai-home-ground) and a shore of its own on that mine's
// water, it raises a shipyard there, trains WARSHIPS warships and a transport, clears the island's guard from the water
// (its creeps cannot reach a ship off the beach, see @@@reach), ferries CREW workers over, raises a hall by the mine and
// mines it. On any water, enemy ships that come near its halls are met by its warships, a shipyard raised for them first
// where it has none. The ships, the crew on their way and the workers on the island are this script's alone. On a map with
// neither an island mine nor an enemy ship it does nothing at all.
const WARSHIPS = 2;
const CREW = 4;
// Enemy ships this near an own hall or the shipyard are met.
const HOME_WATERS = 900;
// The shore searched round each own hall for a shipyard, and how finely (a sea map's beach lies 1000 to 1300 from its
// start's main).
const SHORE_REACH = 1_500;
const SHORE_STEP = 32;

type IslandPlan = { mine: ResourceNode; landing: Point };

// What the water asks to be bought next, one thing at a time: a shipyard, then the warships, then (for an island) a
// transport, and once workers stand on the island its hall. The gold is the economy's to find: V6 takes it as one of its
// goals and saves for it (see v6/economy navalGoals); the shared library's economy (V5) buys it when it can (planNavalEconomy).
// `issue` takes the workers already given a building this think, and adds the one it gives this one.
export type NavalWant = { id: string; cost: number; issue: (builders: Set<string>) => GameCommand | undefined };

export function navalWant(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): NavalWant | undefined {
  const plan = islandPlan(snapshot, owner);
  const threat = enemyShipsNear(snapshot, owner, options);
  const water = plan?.landing ?? threat[0];
  if (!water) return undefined;
  const halls = buildings(snapshot, owner).filter((building) => building.kind === "townHall" && building.complete);
  if (!threat.length && halls.length < 2) return undefined;
  const yard = shipyardOf(snapshot, owner, water);
  if (!yard) {
    return {
      id: "naval:shipyard",
      cost: BUILDING_DEFS.shipyard.cost,
      issue: (builders) => {
        const spot = shoreSpot(snapshot, owner, water);
        const builder = spot && nearestWorker(snapshot, owner, spot, builders);
        if (!spot || !builder) return undefined;
        builders.add(builder.id);
        return { type: "build", unitId: builder.id, buildingKind: "shipyard", x: spot.x, y: spot.y };
      },
    };
  }
  const fleet = units(snapshot, owner);
  const ship: TrainableUnitKind | undefined =
    fleet.filter((unit) => unit.kind === "warship").length < WARSHIPS ? "warship" : plan && !fleet.some((unit) => unit.kind === "transport") && !islandHallOf(snapshot, owner, plan) ? "transport" : undefined;
  if (ship && yard.complete && yard.queue.length === 0 && canSupply(snapshot, owner, ship)) {
    return { id: `naval:${ship}`, cost: UNIT_DEFS[ship].cost, issue: () => ({ type: "train", buildingId: yard.id, unitKind: ship }) };
  }
  if (!plan || islandHallOf(snapshot, owner, plan)) return undefined;
  const islanders = units(snapshot, owner).filter((unit) => unit.kind === "worker" && sameGround(snapshot.map, unit, plan.mine));
  if (islanders.length === 0) return undefined;
  return {
    id: "naval:islandHall",
    cost: BUILDING_DEFS.townHall.cost,
    issue: (builders) => {
      const builder = islanders.find((worker) => !builders.has(worker.id));
      const site = builder && hallSite(snapshot, plan.mine);
      if (!builder || !site) return undefined;
      builders.add(builder.id);
      return { type: "build", unitId: builder.id, buildingKind: "townHall", x: site.x, y: site.y };
    },
  };
}

// The shared library's economy script: the water's next want, when the gold is there.
export function planNavalEconomy(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand | undefined {
  const want = navalWant(snapshot, owner, options);
  return want && playerState(snapshot, owner).gold >= want.cost ? want.issue(new Set()) : undefined;
}

export function planNavalTactics(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  const plan = islandPlan(snapshot, owner);
  const threat = enemyShipsNear(snapshot, owner, options);
  if (!plan && threat.length === 0) return [];
  const own = units(snapshot, owner);
  const commands: GameCommand[] = [];
  const warships = own.filter((unit) => unit.kind === "warship");
  const guards = plan ? snapshot.units.filter((unit) => unit.owner === "neutral" && distance(unit, plan.mine) <= 350) : [];
  for (const ship of warships) {
    const busy = ship.order.type === "attack" || ship.order.type === "attackMove";
    const foe = nearestOf(threat.filter((enemy) => canReach(snapshot.map, ship, enemy)), ship) ?? nearestOf(guards.filter((creep) => canReach(snapshot.map, ship, creep)), ship);
    if (foe && !busy) commands.push({ type: "attack", unitIds: [ship.id], targetId: foe.id });
    else if (!foe && plan && ship.order.type === "idle" && distance(ship, plan.landing) > 300) commands.push({ type: "move", unitIds: [ship.id], x: plan.landing.x, y: plan.landing.y });
  }
  if (!plan) return commands;
  const transport = own.find((unit) => unit.kind === "transport");
  const islanders = own.filter((unit) => unit.kind === "worker" && sameGround(snapshot.map, unit, plan.mine));
  const hall = islandHallOf(snapshot, owner, plan);
  // The island's workers mine its mine once its hall stands.
  if (hall?.complete) {
    const idle = islanders.filter((worker) => worker.order.type === "idle").map((worker) => worker.id);
    if (idle.length > 0) commands.push({ type: "mine", unitIds: idle, resourceId: plan.mine.id });
  }
  if (!transport || hall) return commands;
  const aboard = transport.cargo?.length ?? 0;
  const boarding = own.filter((unit) => unit.order.type === "board");
  if (islanders.length === 0 && aboard + boarding.length < CREW) {
    const crew = own
      .filter((unit) => unit.kind === "worker" && unit.order.type === "mine" && !sameGround(snapshot.map, unit, plan.mine))
      .sort((a, b) => distance(a, transport) - distance(b, transport))
      .slice(0, CREW - aboard - boarding.length);
    if (crew.length > 0) commands.push({ type: "board", unitIds: crew.map((worker) => worker.id), transportId: transport.id });
  }
  if (aboard >= CREW && boarding.length === 0 && guards.length === 0 && transport.order.type !== "unload") commands.push({ type: "unload", unitIds: [transport.id], x: plan.mine.x, y: plan.mine.y });
  return commands;
}

// The ships, the crew on their way and the workers on the island are moved by this script alone.
export function navalUnitIds(snapshot: GameSnapshot, owner: PlayerId): ReadonlySet<string> {
  const claimed = new Set<string>();
  if (groundWholes(snapshot.map) <= 1 && !shipsAfloat(snapshot)) return claimed;
  const plan = islandPlan(snapshot, owner);
  for (const unit of units(snapshot, owner)) {
    if (unitMover(unit.kind) === "sea" || unit.order.type === "board" || (plan && unit.kind === "worker" && sameGround(snapshot.map, unit, plan.mine))) claimed.add(unit.id);
  }
  return claimed;
}

function islandHallOf(snapshot: GameSnapshot, owner: PlayerId, plan: IslandPlan): Building | undefined {
  return buildings(snapshot, owner).find((building) => building.kind === "townHall" && distance(building, plan.mine) <= 320);
}

function hallSite(snapshot: GameSnapshot, mine: Point): Point | undefined {
  for (let reach = 140; reach <= 220; reach += 20) {
    for (let spoke = 0; spoke < 16; spoke += 1) {
      const angle = (spoke / 16) * Math.PI * 2;
      const at = { x: Math.round(mine.x + Math.cos(angle) * reach), y: Math.round(mine.y + Math.sin(angle) * reach) };
      if (sameGround(snapshot.map, at, mine) && isBuildPlacementClear(snapshot, "townHall", at)) return at;
    }
  }
  return undefined;
}

// The nearest mine with gold left that the owner's workers cannot walk to but a ship from its own shore can reach, with
// the water a ship lands at. Found once per map and owner; a map where none is found looks again every PLAN_RETRY (its
// shore may have been built over, or its halls may since stand by another water).
const PLAN_RETRY = seconds(20);
const plans = new WeakMap<object, Map<PlayerId, { plan: IslandPlan | undefined; tick: number }>>();
function islandPlan(snapshot: GameSnapshot, owner: PlayerId): IslandPlan | undefined {
  const map = snapshot.map;
  if (!map.terrain || groundWholes(map) <= 1) return undefined;
  const home = buildings(snapshot, owner).find((building) => building.kind === "townHall");
  if (!home) return undefined;
  let perOwner = plans.get(map.terrain);
  if (!perOwner) plans.set(map.terrain, (perOwner = new Map()));
  let known = perOwner.get(owner);
  if (!known || (!known.plan && snapshot.tick - known.tick >= PLAN_RETRY)) {
    const plan = snapshot.resources
      .filter((mine) => mine.amount > 0 && !sameGround(map, home, mine))
      .map((mine) => ({ mine, landing: walkableGoal(map, mine.x, mine.y, "sea") }))
      .filter((entry) => isWalkable(map, entry.landing.x, entry.landing.y, "sea") && Boolean(shoreSpot(snapshot, owner, entry.landing)))
      .sort((a, b) => distance(a.mine, home) - distance(b.mine, home))[0];
    known = { plan, tick: snapshot.tick };
    perOwner.set(owner, known);
  }
  const plan = known.plan;
  const live = plan && snapshot.resources.find((mine) => mine.id === plan.mine.id && mine.amount > 0);
  return plan && live ? { mine: live, landing: plan.landing } : undefined;
}

// The owner's shipyard on the given water, if it has one.
function shipyardOf(snapshot: GameSnapshot, owner: PlayerId, water: Point): Building | undefined {
  return buildings(snapshot, owner).find((building) => building.kind === "shipyard" && sameGround(snapshot.map, walkableGoal(snapshot.map, building.x, building.y, "sea"), water, "sea"));
}

// A shore spot on the owner's own ground, nearest its halls, where a shipyard may stand on the given water.
function shoreSpot(snapshot: GameSnapshot, owner: PlayerId, water: Point): Point | undefined {
  const map = snapshot.map;
  const halls = buildings(snapshot, owner).filter((building) => building.kind === "townHall");
  const home = halls[0];
  if (!home) return undefined;
  for (let reach = 160; reach <= SHORE_REACH; reach += SHORE_STEP) {
    for (const hall of halls) {
      if (!sameGround(map, hall, home)) continue;
      const spokes = Math.max(16, Math.round((reach * 2 * Math.PI) / SHORE_STEP));
      for (let spoke = 0; spoke < spokes; spoke += 1) {
        const angle = (spoke / spokes) * Math.PI * 2;
        const at = { x: Math.round(hall.x + Math.cos(angle) * reach), y: Math.round(hall.y + Math.sin(angle) * reach) };
        if (!sameGround(map, at, home) || !isBuildPlacementClear(snapshot, "shipyard", at)) continue;
        if (sameGround(map, walkableGoal(map, at.x, at.y, "sea"), water, "sea")) return at;
      }
    }
  }
  return undefined;
}

function enemyShipsNear(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Unit[] {
  if (!shipsAfloat(snapshot)) return [];
  const ships = snapshot.units.filter((unit) => unitMover(unit.kind) === "sea" && unit.owner !== "neutral" && isEnemyOwner(snapshot, owner, unit.owner, options));
  if (ships.length === 0) return ships;
  const posts = buildings(snapshot, owner).filter((building) => building.kind === "townHall" || building.kind === "shipyard");
  return ships.filter((ship) => posts.some((post) => distance(ship, post) <= HOME_WATERS));
}

function nearestWorker(snapshot: GameSnapshot, owner: PlayerId, point: Point, builders: Set<string>) {
  return nearestOf(units(snapshot, owner).filter((unit) => unit.kind === "worker" && unit.order.type === "mine" && !builders.has(unit.id) && sameGround(snapshot.map, unit, point)), point);
}

function nearestOf<T extends Point>(things: T[], from: Point): T | undefined {
  let best: T | undefined;
  for (const thing of things) if (!best || distance(thing, from) < distance(best, from)) best = thing;
  return best;
}
