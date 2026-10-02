import { isBuildPlacementClear } from "../../shared/build-placement";
import { BUILDING_DEFS, UNIT_DEFS, unitMover } from "../../shared/catalog";
import { canReach, carries } from "../../shared/naval";
import { groundWholes, isWalkable, sameGround, shoreSpots, walkableGoal } from "../../shared/terrain";
import { seconds } from "../../shared/time";
import type { Building, GameCommand, GameSnapshot, PlayerId, ResourceNode, TrainableUnitKind, Unit } from "../../shared/types";
import { resolveAiCommandIntent } from "./commands";
import { shipsAfloat } from "./ground";
import { isEnemyOwner, isOpponentOwner } from "./ownership";
import { buildings, units } from "./snapshot";
import { distance } from "./spatial";
import type { AiPolicyContext } from "./types";
import { isV9Policy } from "./versions";
import { canSupply, playerState } from "./world-model";

type Point = { x: number; y: number };

// @@@ai-naval - What an AI does on the water, from what the water before it offers and never from what kind of map it is
// on (no map is told it has water: see @@@open-water), as a Warcraft III player reads a map:
// - a mine its workers cannot walk to (an island's, see @@@ai-home-ground) that a ship from its own shore reaches: once it
//   holds two bases it raises a shipyard on that water, trains WARSHIPS warships and a transport, clears the island's guard
//   from the water (its creeps cannot reach a ship off the beach, see @@@reach), ferries CREW workers over, raises a hall
//   by the mine and mines it;
// - an enemy's hall within a warship's range of the water its own shore is on (a lake or a river at the enemy's door, a
//   sea at its coast): once it holds two bases, WARSHIPS warships shoot the workers and buildings there from the water
//   wherever no tower covers them, and a hurt one sails home;
// - enemy ships near its halls or its shipyard, on any water: its warships meet them, a shipyard raised for them first
//   where it has none;
// - @@@ai-closeout - an opponent's last buildings, all on ground its army cannot walk to (a base on an island): a
//   shipyard on their water, a transport, then warships; the transport takes soldiers from home aboard up to what it
//   carries and lands them by the nearest of those buildings, and comes back for more while they stand; landed soldiers
//   go for the buildings on their ground. Before, its army stood at home for good while an island hall held out.
// The ships, the crew and soldiers on their way and whoever stands off the home's ground are this script's alone. Where
// the water offers none of these (or there is none) it does nothing at all. V9 takes to the water for the closeout alone
// (see @@@v9-water).
const WARSHIPS = 2;
const CREW = 4;
// Enemy ships this near an own hall or the shipyard are met.
const HOME_WATERS = 900;
// A shipyard stands no nearer a hall than this, off its workers' way to the mine.
const HALL_BERTH = 160;
// How many cells out from a landing a ship looks for open water to wait on.
const OFFSHORE_STEPS = 8;
// A shipyard stands this much farther off an enemy warship than its guns reach.
const GUN_MARGIN = 100;
// A target this near an enemy tower is the tower's to cover: towers are the coast's strongest defense, and a warship that
// comes within their range loses.
const TOWER_COVER = BUILDING_DEFS.defenseTower.attackRange;
// A warship below this share of its health keeps out of the raid.
const HURT = 0.4;

type IslandPlan = { mine: ResourceNode; landing: Point };
type RaidPlan = { water: Point };
type AssaultPlan = { target: Building; landing: Point };

// What the water asks to be bought next, one thing at a time: a shipyard, then the warships, then (for an island) a
// transport, and once workers stand on the island its hall. The gold is the economy's to find: V6 takes it as one of its
// goals and saves for it (see v6/economy navalGoals); the shared library's economy (V5) buys it when it can (planNavalEconomy).
// `issue` takes the workers already given a building this think, and adds the one it gives this one.
export type NavalWant = { id: string; cost: number; issue: (builders: Set<string>) => GameCommand | undefined };

export function navalWant(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): NavalWant | undefined {
  const threat = enemyShipsNear(snapshot, owner, options);
  const assault = assaultPlan(snapshot, owner, options);
  const halls = buildings(snapshot, owner).filter((building) => building.kind === "townHall" && building.complete);
  if (!threat.length && !assault && halls.length < 2) return undefined;
  // @@@v9-water - V9 takes to the water only for the assault on an opponent walled off by it. Against three, every
  // shipyard it raised was for an island's mine, and the mines paid back 26480 of the 48670 gold its shipyards, warships
  // and island halls cost (50 games): its two escorts were sunk and rebuilt (4.5 warships a game) on lakes the rivals'
  // navies held, and in 22 of the 34 games it raised a shipyard its transport never came. Off the water V9 won 235 of
  // 500 against 185 (the 1v3 bench at 1.5 of its mining), its losses at a median 4385 gold against 5455; shipping the
  // workers first and escorting them only on contested water won 183.
  if (isV9Policy(options) && !assault) return undefined;
  const plan = assault ? undefined : islandPlan(snapshot, owner, options);
  const water = assault?.landing ?? plan?.landing ?? raidPlan(snapshot, owner, options)?.water ?? threat[0];
  if (!water) return undefined;
  const yard = shipyardOf(snapshot, owner, water);
  if (!yard) {
    return {
      id: "naval:shipyard",
      cost: BUILDING_DEFS.shipyard.cost,
      issue: (builders) => {
        const spot = shoreSpot(snapshot, owner, water, options);
        const builder = spot && nearestWorker(snapshot, owner, spot, builders);
        if (!spot || !builder) return undefined;
        builders.add(builder.id);
        return { type: "build", unitId: builder.id, buildingKind: "shipyard", x: spot.x, y: spot.y };
      },
    };
  }
  const fleet = units(snapshot, owner);
  const warships = fleet.filter((unit) => unit.kind === "warship").length;
  // A transport on other water serves nothing here (one from an island's ferry sat on its own lake through an assault).
  const transported = fleet.some((unit) => unit.kind === "transport" && sameGround(snapshot.map, unit, water, "sea"));
  const ship: TrainableUnitKind | undefined = assault
    ? !transported ? "transport" : warships < WARSHIPS ? "warship" : undefined
    : warships < WARSHIPS ? "warship" : plan && !transported && !islandHallOf(snapshot, owner, plan) ? "transport" : undefined;
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
  const own = units(snapshot, owner);
  const warships = own.filter((unit) => unit.kind === "warship");
  const assault = assaultPlan(snapshot, owner, options);
  const plan = assault ? undefined : islandPlan(snapshot, owner, options);
  const threat = enemyShipsNear(snapshot, owner, options);
  if (!plan && !assault && threat.length === 0 && warships.length === 0) return [];
  const commands: GameCommand[] = [];
  const raid = warships.length > 0 ? raidPlan(snapshot, owner, options) : undefined;
  const guards = plan ? snapshot.units.filter((unit) => unit.owner === "neutral" && distance(unit, plan.mine) <= 350) : [];
  const prey = raid ? raidTargets(snapshot, owner, options, raid) : [];
  const harbor = buildings(snapshot, owner).find((building) => building.kind === "shipyard");
  for (const ship of warships) {
    const busy = ship.order.type === "attack" || ship.order.type === "attackMove";
    const hurt = ship.hp < ship.maxHp * HURT;
    const reachable = <T extends Unit | Building>(things: T[]) => things.filter((thing) => canReach(snapshot.map, ship, thing));
    const besieged = assault ? reachable(snapshot.buildings.filter((building) => isOpponentOwner(snapshot, owner, building.owner, options))) : [];
    const foe = nearestOf(reachable(threat), ship) ?? nearestOf(reachable(guards), ship) ?? (hurt ? undefined : (nearestPrey(prey, ship) ?? nearestOf(besieged, ship)));
    const home = harbor && walkableGoal(snapshot.map, harbor.x, harbor.y, "sea");
    if (foe && !busy) commands.push({ type: "attack", unitIds: [ship.id], targetId: foe.id });
    else if (hurt && !foe && home && ship.order.type !== "move" && distance(ship, home) > 300) commands.push({ type: "move", unitIds: [ship.id], x: home.x, y: home.y });
    else if (!foe && !hurt && ship.order.type === "idle") {
      const station = assault ? offshore(snapshot, assault.landing, assault.target) : plan ? offshore(snapshot, plan.landing, plan.mine) : prey.length > 0 ? raid?.water : undefined;
      if (station && distance(ship, station) > 300) commands.push({ type: "move", unitIds: [ship.id], x: station.x, y: station.y });
    }
  }
  if (assault) return [...commands, ...assaultCommands(snapshot, owner, options, assault, own)];
  if (!plan) return commands;
  const transport = own.find((unit) => unit.kind === "transport" && sameGround(snapshot.map, unit, plan.landing, "sea"));
  const islanders = own.filter((unit) => unit.kind === "worker" && sameGround(snapshot.map, unit, plan.mine));
  const hall = islandHallOf(snapshot, owner, plan);
  // The island's workers mine its mine once its hall stands.
  if (hall?.complete) {
    const idle = islanders.filter((worker) => worker.order.type === "idle").map((worker) => worker.id);
    if (idle.length > 0) commands.push({ type: "mine", unitIds: idle, resourceId: plan.mine.id });
  }
  // A transport that has set its crew down waits off the beach they cross (see offshore).
  if (transport && transport.order.type === "idle" && !transport.cargo?.length && (islanders.length > 0 || hall) && isWalkable(snapshot.map, transport.x, transport.y)) {
    const off = offshore(snapshot, plan.landing, plan.mine);
    if (distance(transport, off) > 40) commands.push({ type: "move", unitIds: [transport.id], x: off.x, y: off.y });
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

// The ships, the crew and soldiers on their way, the workers on the island and the soldiers landed off the home's ground
// are moved by this script alone.
export function navalUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadonlySet<string> {
  const claimed = new Set<string>();
  if (groundWholes(snapshot.map) <= 1 && !shipsAfloat(snapshot)) return claimed;
  const plan = islandPlan(snapshot, owner, options);
  const home = buildings(snapshot, owner).find((building) => building.kind === "townHall");
  for (const unit of units(snapshot, owner)) {
    const landed = home && unitMover(unit.kind) === "land" && unit.kind !== "worker" && !sameGround(snapshot.map, unit, home);
    if (unitMover(unit.kind) === "sea" || unit.order.type === "board" || landed || (plan && unit.kind === "worker" && sameGround(snapshot.map, unit, plan.mine))) claimed.add(unit.id);
  }
  return claimed;
}

// The assault's moves (see @@@ai-closeout): landed soldiers go for the enemy's buildings on their ground; the transport
// takes soldiers from home aboard while it has room and some stand idle, and lands them by the target.
function assaultCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, assault: AssaultPlan, own: Unit[]): GameCommand[] {
  const map = snapshot.map;
  const home = buildings(snapshot, owner).find((building) => building.kind === "townHall");
  if (!home) return [];
  const commands: GameCommand[] = [];
  const soldier = (unit: Unit) => unitMover(unit.kind) === "land" && unit.kind !== "worker" && unit.expiresTick === undefined;
  const foes = snapshot.buildings.filter((building) => isOpponentOwner(snapshot, owner, building.owner, options));
  const landed = own.filter((unit) => soldier(unit) && !sameGround(map, unit, home) && (unit.order.type === "idle" || unit.order.type === "hold"));
  const byTarget = new Map<string, string[]>();
  for (const unit of landed) {
    const target = nearestOf(foes.filter((building) => sameGround(map, building, unit)), unit);
    if (target) byTarget.set(target.id, [...(byTarget.get(target.id) ?? []), unit.id]);
  }
  for (const [targetId, unitIds] of byTarget) {
    const target = foes.find((building) => building.id === targetId)!;
    commands.push(resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds, x: target.x, y: target.y }, options));
  }
  const transport = own.find((unit) => unit.kind === "transport" && sameGround(map, unit, assault.landing, "sea"));
  if (!transport || transport.order.type === "unload") return commands;
  const supply = (list: Unit[]) => list.reduce((total, unit) => total + UNIT_DEFS[unit.kind].supplyUsed, 0);
  const aboard = transport.cargo ?? [];
  const boarding = own.filter((unit) => unit.order.type === "board");
  let room = carries(transport) - supply(aboard) - supply(boarding);
  const crew: Unit[] = [];
  for (const unit of own.filter((candidate) => soldier(candidate) && sameGround(map, candidate, home) && (candidate.order.type === "idle" || candidate.order.type === "hold" || candidate.order.type === "move")).sort((a, b) => distance(a, transport) - distance(b, transport))) {
    if (UNIT_DEFS[unit.kind].supplyUsed > room) continue;
    crew.push(unit);
    room -= UNIT_DEFS[unit.kind].supplyUsed;
  }
  if (crew.length > 0) commands.push({ type: "board", unitIds: crew.map((unit) => unit.id), transportId: transport.id });
  else if (aboard.length > 0 && boarding.length === 0) commands.push({ type: "unload", unitIds: [transport.id], x: assault.target.x, y: assault.target.y });
  return commands;
}

// Open water off a landing: the first point straight out from what the landing is by (an island's mine, the assault's
// target) that a ship sails and no land unit walks, so ships waiting there keep off the shallows of the beach. Waiting on
// a landing's shallows, V8's warships and its emptied transport walled in its own workers on their way to the island's
// hall site (three of the pool's games at ddec752).
function offshore(snapshot: GameSnapshot, landing: Point, from: Point): Point {
  const map = snapshot.map;
  const step = map.terrain?.cell ?? 32;
  const length = distance(landing, from) || 1;
  for (let k = 1; k <= OFFSHORE_STEPS; k += 1) {
    const point = { x: landing.x + ((landing.x - from.x) / length) * step * k, y: landing.y + ((landing.y - from.y) / length) * step * k };
    if (isWalkable(map, point.x, point.y, "sea") && !isWalkable(map, point.x, point.y)) return point;
  }
  return landing;
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

// The plans below are found once per owner, and looked for again every PLAN_RETRY: an island's while none is found (its
// shore may have been built over, or its halls may since stand by another water), the enemy's door always (its buildings
// and towers come and go). They are kept in the owner's memory (a game saved with its AIs' memory plays on as it would
// have: kept by the terrain beside it, a replay from a save took other naval commands than the game had, and a second
// game on the same terrain object took the first one's plans).
const PLAN_RETRY = seconds(20);

function navalMemory(options: AiPolicyContext) {
  return (options.memory.naval ??= {});
}

// The nearest mine with gold left that the owner's workers cannot walk to but a ship from its own shore can reach, with
// the water a ship lands at.
function islandPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): IslandPlan | undefined {
  const map = snapshot.map;
  if (!map.terrain || groundWholes(map) <= 1) return undefined;
  const home = buildings(snapshot, owner).find((building) => building.kind === "townHall");
  if (!home) return undefined;
  const memory = navalMemory(options);
  let known = memory.island;
  if (!known || (!known.plan && snapshot.tick - known.tick >= PLAN_RETRY)) {
    // A mine an opponent's hall holds is no island to take but a base to assault (see @@@ai-closeout).
    const held = (mine: ResourceNode) => snapshot.buildings.some((building) => building.kind === "townHall" && distance(building, mine) <= 400 && isOpponentOwner(snapshot, owner, building.owner, options));
    const plan = snapshot.resources
      .filter((mine) => mine.amount > 0 && !sameGround(map, home, mine) && !held(mine))
      .map((mine) => ({ mine, landing: walkableGoal(map, mine.x, mine.y, "sea") }))
      .filter((entry) => isWalkable(map, entry.landing.x, entry.landing.y, "sea") && Boolean(shoreSpot(snapshot, owner, entry.landing, options)))
      .sort((a, b) => distance(a.mine, home) - distance(b.mine, home))[0];
    known = { tick: snapshot.tick, ...(plan ? { plan: { mineId: plan.mine.id, landing: { x: plan.landing.x, y: plan.landing.y } } } : {}) };
    memory.island = known;
  }
  const plan = known.plan;
  const live = plan && snapshot.resources.find((mine) => mine.id === plan.mineId && mine.amount > 0);
  return plan && live ? { mine: live, landing: plan.landing } : undefined;
}

// The assault (see @@@ai-closeout): of the opponents whose every building stands off the owner's home's ground, the
// building nearest its home that water by it joins to a shore of the owner's (or its shipyard), with that water. Looked for again
// every PLAN_RETRY, and at once when its target falls.
function assaultPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): AssaultPlan | undefined {
  const map = snapshot.map;
  if (!map.terrain || groundWholes(map) <= 1) return undefined;
  const home = buildings(snapshot, owner).find((building) => building.kind === "townHall");
  if (!home) return undefined;
  const memory = navalMemory(options);
  let known = memory.assault;
  const standing = known?.plan && snapshot.buildings.some((building) => building.id === known!.plan!.targetId);
  if (!known || snapshot.tick - known.tick >= PLAN_RETRY || (known.plan && !standing)) {
    // The opponents walled off by water: every building of theirs off the home's ground (another opponent may still stand
    // on it, for the army: four players' games ended with the island's last hall untouched while two fought on).
    const foes = snapshot.buildings.filter((building) => isOpponentOwner(snapshot, owner, building.owner, options));
    const ashore = new Set(foes.filter((building) => sameGround(map, home, building)).map((building) => building.owner));
    const islanders = foes.filter((building) => !ashore.has(building.owner));
    let assault: AssaultPlan | undefined;
    if (islanders.length > 0) {
      for (const target of islanders.sort((a, b) => distance(a, home) - distance(b, home))) {
        const landing = walkableGoal(map, target.x, target.y, "sea");
        if (!isWalkable(map, landing.x, landing.y, "sea")) continue;
        if (shipyardOf(snapshot, owner, landing) || shoreSpot(snapshot, owner, landing, options)) {
          assault = { target, landing };
          break;
        }
      }
    }
    known = { tick: snapshot.tick, ...(assault ? { plan: { targetId: assault.target.id, landing: { x: assault.landing.x, y: assault.landing.y } } } : {}) };
    memory.assault = known;
  }
  const live = known.plan && snapshot.buildings.find((building) => building.id === known!.plan!.targetId);
  return known.plan && live ? { target: live, landing: known.plan.landing } : undefined;
}

// The water at the enemy's door: by an enemy hall that no tower covers and a warship reaches from water the owner has a
// shore on; on the water its shipyard is on first (one shipyard serves the raid), then by the hall nearest its home.
function raidPlan(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): RaidPlan | undefined {
  const map = snapshot.map;
  if (!map.terrain || shoreSpots(map, BUILDING_DEFS.shipyard.radius).length === 0) return undefined;
  const home = buildings(snapshot, owner).find((building) => building.kind === "townHall");
  if (!home) return undefined;
  const memory = navalMemory(options);
  let known = memory.raid;
  if (!known || snapshot.tick - known.tick >= PLAN_RETRY) {
    const towers = enemyTowers(snapshot, owner, options);
    const yards = buildings(snapshot, owner).filter((building) => building.kind === "shipyard");
    const doors = snapshot.buildings
      .filter((building) => building.kind === "townHall" && isOpponentOwner(snapshot, owner, building.owner, options) && !covered(building, towers))
      .map((hall) => ({ hall, water: doorstep(snapshot, hall) }))
      .filter((door): door is { hall: Building; water: Point } => door.water !== undefined)
      .map((door) => ({ ...door, served: yards.some((yard) => sameGround(map, walkableGoal(map, yard.x, yard.y, "sea"), door.water, "sea")) }))
      .sort((a, b) => Number(b.served) - Number(a.served) || distance(a.hall, home) - distance(b.hall, home));
    // A water once found to have no shore of the owner's is not searched again.
    const shoreless: Point[] = [];
    let raid: RaidPlan | undefined;
    for (const { water, served } of doors) {
      if (shoreless.some((dry) => sameGround(map, dry, water, "sea"))) continue;
      if (!served && !shoreSpot(snapshot, owner, water, options)) {
        shoreless.push(water);
        continue;
      }
      raid = { water };
      break;
    }
    known = { tick: snapshot.tick, ...(raid ? { water: { x: raid.water.x, y: raid.water.y } } : {}) };
    memory.raid = known;
  }
  return known.water ? { water: known.water } : undefined;
}

// The water a warship shoots the thing from, if any is within its range of it.
function doorstep(snapshot: GameSnapshot, thing: Unit | Building): Point | undefined {
  const map = snapshot.map;
  const water = walkableGoal(map, thing.x, thing.y, "sea");
  if (!isWalkable(map, water.x, water.y, "sea")) return undefined;
  const wall = "order" in thing ? 0 : thing.radius;
  return distance(water, thing) - wall <= UNIT_DEFS.warship.attackRange ? water : undefined;
}

// What the raid shoots: the enemy's workers and buildings a warship reaches from the raid's water, out of its towers' cover.
function raidTargets(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, raid: RaidPlan): (Unit | Building)[] {
  const map = snapshot.map;
  const towers = enemyTowers(snapshot, owner, options);
  const open = (thing: Unit | Building) => {
    if (!isOpponentOwner(snapshot, owner, thing.owner, options) || covered(thing, towers)) return false;
    const water = doorstep(snapshot, thing);
    return Boolean(water && sameGround(map, water, raid.water, "sea"));
  };
  return [...snapshot.units.filter((unit) => unit.kind === "worker" && open(unit)), ...snapshot.buildings.filter(open)];
}

// The nearest worker in the raid's reach, else the nearest building.
function nearestPrey(prey: (Unit | Building)[], ship: Unit) {
  return nearestOf(prey.filter((thing) => "order" in thing), ship) ?? nearestOf(prey, ship);
}

function enemyTowers(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  return snapshot.buildings.filter((building) => building.kind === "defenseTower" && building.complete && isOpponentOwner(snapshot, owner, building.owner, options));
}

function covered(thing: Point, towers: Building[]) {
  return towers.some((tower) => distance(tower, thing) <= TOWER_COVER);
}

// The owner's shipyard on the given water, if it has one.
function shipyardOf(snapshot: GameSnapshot, owner: PlayerId, water: Point): Building | undefined {
  return buildings(snapshot, owner).find((building) => building.kind === "shipyard" && sameGround(snapshot.map, walkableGoal(snapshot.map, building.x, building.y, "sea"), water, "sea"));
}

// The shore spot (see shoreSpots) on the owner's own ground and on the given water, free to build on, nearest its halls
// there: as far off as the shore lies, but on its own side, nearer one of its halls than any enemy's on its ground.
function shoreSpot(snapshot: GameSnapshot, owner: PlayerId, water: Point, options: AiPolicyContext): Point | undefined {
  const map = snapshot.map;
  const halls = buildings(snapshot, owner).filter((building) => building.kind === "townHall");
  const home = halls[0];
  if (!home) return undefined;
  const ours = halls.filter((hall) => sameGround(map, hall, home));
  // Only the enemy halls on its own ground: one on an island sends nobody walking at the shipyard (a corner island's last
  // hall kept every shore of its lake its own, and no assault ever set out, see @@@ai-closeout).
  const theirs = snapshot.buildings.filter((building) => building.kind === "townHall" && isOpponentOwner(snapshot, owner, building.owner, options) && sameGround(map, building, home));
  const gapOf = (spot: Point, from: Building[]) => Math.min(Infinity, ...from.map((hall) => distance(hall, spot)));
  // None within an enemy's armed ship's reach (its range, the shipyard's radius and GUN_MARGIN): a site starts at a few
  // health and a ship that reaches it sinks it before its builder gets there (two warships guarding an island's last hall
  // sank five shipyards placed by them, 170 gold each and a third of the army's income: pool-templeSpring-5). Not the
  // whole water the ship sails: with no shipyard of its own there, the island's last base that one warship guarded was
  // never assaulted (five of the pool's games at 26e9560; this way two of them end).
  const guns = snapshot.units.filter((unit) => unitMover(unit.kind) === "sea" && unit.attackDamage > 0 && isEnemyOwner(snapshot, owner, unit.owner, options));
  const spots = shoreSpots(map, BUILDING_DEFS.shipyard.radius)
    .map((spot) => ({ spot, gap: gapOf(spot, ours) }))
    .filter((entry) => entry.gap >= HALL_BERTH && entry.gap < gapOf(entry.spot, theirs))
    .filter((entry) => guns.every((ship) => distance(ship, entry.spot) > ship.attackRange + BUILDING_DEFS.shipyard.radius + GUN_MARGIN))
    .sort((a, b) => a.gap - b.gap);
  for (const { spot } of spots) {
    if (!sameGround(map, spot, home) || !isBuildPlacementClear(snapshot, "shipyard", spot)) continue;
    if (sameGround(map, walkableGoal(map, spot.x, spot.y, "sea"), water, "sea")) return spot;
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
